import type { Agent, Tweet, Mention, Metric, CreateAgentInput, UpdateAgentInput, CreateTweetInput, UpdateTweetInput, CreateMentionInput, MetricInput, AccountAnalysis, User, Session, ProtocolSettings, PostLogEntry, TweetJob, CreateTweetJobInput, UpdateTweetJobInput, TweetPerformance, AgentLearnings, WizardData, StyleSignals, FeedbackEntry, FunnelEvent, SoulVersion, VoiceDirective, LearningSignal, VoiceDirectiveRule, BrowserCompanionPairing, EngagementSession, ManualExampleCuration, AutopilotHealthSnapshot, DraftExperiment, TrendOpportunity, RelationshipOpportunity, ViralityPostmortem, OutcomeEvent, MetricAvailability, RelationshipProfile, IdeaAtom, CriticVerdict } from './types';
import { normalizeUsername } from './internal-accounts';
import { buildVoiceDirectiveRule, getActiveVoiceDirectiveRules, mergeVoiceDirectiveRule } from './voice-directives';
import { computeActionRewards, computeEarlyVelocityScore } from './virality-signals';
import { assessTasteRisk } from './virality-signals';

// ─── In-memory fallback store ─────────────────────────────────────────────────
// Used when Vercel KV env vars are not set (local dev). Next compiles API routes
// and server components into separate module instances, so keep the fallback on
// globalThis instead of per-module state.
const LOCAL_KV_SYMBOL = Symbol.for('clawfable.localKvFallback');

type LocalKvFallback = {
  memStore: Map<string, unknown>;
  memExpiry: Map<string, number>;
};

const localKvFallbackGlobal = globalThis as typeof globalThis & {
  [LOCAL_KV_SYMBOL]?: LocalKvFallback;
};

const localKvFallback = localKvFallbackGlobal[LOCAL_KV_SYMBOL] ??= {
  memStore: new Map<string, unknown>(),
  memExpiry: new Map<string, number>(),
};

const { memStore, memExpiry } = localKvFallback;

// ─── KV client accessor ───────────────────────────────────────────────────────
// Returns the kv client if Vercel KV is available and configured, else null.
// Using 'any' here to avoid depending on specific @vercel/kv internal types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _kvClient: any = undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getKvClient(): Promise<any> {
  if (_kvClient !== undefined) return _kvClient;
  try {
    // Check required env vars exist first
    if (!process.env.KV_REST_API_URL && !process.env.KV_URL) {
      _kvClient = null;
      return null;
    }
    const mod = await import('@vercel/kv');
    _kvClient = mod.kv;
    return _kvClient;
  } catch {
    _kvClient = null;
    return null;
  }
}

// ─── Request-scoped read cache ────────────────────────────────────────────────
// Memoizes KV reads within a single function invocation to dramatically cut
// command counts on hot paths (cron). Writes invalidate the entry.
// The cache is keyed by KV key string. Reset between requests via resetReadCache().
const readCache = new Map<string, unknown>();

export function resetReadCache(): void {
  readCache.clear();
}

function getCached<T>(key: string): { hit: boolean; value: T | null } {
  if (readCache.has(key)) {
    return { hit: true, value: readCache.get(key) as T | null };
  }
  return { hit: false, value: null };
}

function setCached(key: string, value: unknown): void {
  readCache.set(key, value);
}

function invalidateCached(key: string): void {
  readCache.delete(key);
}

function deleteMemKey(key: string): void {
  memStore.delete(key);
  memExpiry.delete(key);
}

function isMemExpired(key: string): boolean {
  const expiresAt = memExpiry.get(key);
  if (!expiresAt) return false;
  if (Date.now() < expiresAt) return false;
  deleteMemKey(key);
  invalidateAllNamespaces(key);
  return true;
}

// kvDel can target any value type (string/hash/list/set), so it must clear
// every namespaced cache entry for that raw key. Otherwise a stale cached
// hash/list/set survives a delete and `getX` returns the old value.
function invalidateAllNamespaces(key: string): void {
  readCache.delete(key);
  readCache.delete(`hash:${key}`);
  readCache.delete(`list:${key}`);
  readCache.delete(`set:${key}`);
}

function normalizeAgentHandle(handle: string | null | undefined): string {
  return normalizeUsername(handle);
}

async function kvGet<T>(key: string): Promise<T | null> {
  if (isMemExpired(key)) return null;
  const cached = getCached<T>(key);
  if (cached.hit) return cached.value;
  try {
    const client = await getKvClient();
    if (!client) {
      const value = (memStore.get(key) as T) ?? null;
      setCached(key, value);
      return value;
    }
    const value = (await client.get(key)) as T | null;
    setCached(key, value);
    return value;
  } catch {
    const value = (memStore.get(key) as T) ?? null;
    setCached(key, value);
    return value;
  }
}

async function kvSet(key: string, value: unknown, options: { ex?: number; nx?: boolean } = {}): Promise<boolean> {
  invalidateCached(key);
  try {
    const client = await getKvClient();
    if (!client) {
      if (isMemExpired(key)) {
        // expired keys are removed by isMemExpired
      } else if (options.nx && memStore.has(key)) {
        return false;
      }
      memStore.set(key, value);
      if (options.ex && options.ex > 0) {
        memExpiry.set(key, Date.now() + options.ex * 1000);
      } else {
        memExpiry.delete(key);
      }
      return true;
    }
    const result = Object.keys(options).length > 0
      ? await client.set(key, value, options)
      : await client.set(key, value);
    return result !== null;
  } catch {
    if (isMemExpired(key)) {
      // expired keys are removed by isMemExpired
    } else if (options.nx && memStore.has(key)) {
      return false;
    }
    memStore.set(key, value);
    if (options.ex && options.ex > 0) {
      memExpiry.set(key, Date.now() + options.ex * 1000);
    } else {
      memExpiry.delete(key);
    }
    return true;
  }
}

async function kvDel(key: string): Promise<void> {
  invalidateAllNamespaces(key);
  try {
    const client = await getKvClient();
    if (!client) { deleteMemKey(key); return; }
    await client.del(key);
  } catch {
    deleteMemKey(key);
  }
}

async function kvSadd(key: string, ...members: string[]): Promise<void> {
  invalidateCached(`set:${key}`);
  try {
    const client = await getKvClient();
    if (!client) {
      const existing = (memStore.get(key) as Set<string>) ?? new Set<string>();
      for (const m of members) existing.add(m);
      memStore.set(key, existing);
      return;
    }
    await client.sadd(key, ...members);
  } catch {
    const existing = (memStore.get(key) as Set<string>) ?? new Set<string>();
    for (const m of members) existing.add(m);
    memStore.set(key, existing);
  }
}

async function kvSmembers(key: string): Promise<string[]> {
  const cacheKey = `set:${key}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached.hit && cached.value) return cached.value;
  try {
    const client = await getKvClient();
    if (!client) {
      const s = memStore.get(key) as Set<string> | undefined;
      const value = s ? Array.from(s) : [];
      setCached(cacheKey, value);
      return value;
    }
    const value = (await client.smembers(key)) as string[];
    setCached(cacheKey, value);
    return value;
  } catch {
    const s = memStore.get(key) as Set<string> | undefined;
    const value = s ? Array.from(s) : [];
    setCached(cacheKey, value);
    return value;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

async function kvScanKeys(match: string): Promise<string[]> {
  const cacheKey = `scan:${match}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached.hit && cached.value) return cached.value;
  try {
    const client = await getKvClient();
    if (!client) {
      const regex = globToRegExp(match);
      const value = Array.from(memStore.keys()).filter((key) => regex.test(key));
      setCached(cacheKey, value);
      return value;
    }

    let cursor = '0';
    const keys: string[] = [];
    do {
      const result = await client.scan(cursor, { match, count: 200 }) as [string, string[]];
      cursor = String(result?.[0] ?? '0');
      keys.push(...(result?.[1] ?? []).map(String));
    } while (cursor !== '0');

    setCached(cacheKey, keys);
    return keys;
  } catch {
    const regex = globToRegExp(match);
    const value = Array.from(memStore.keys()).filter((key) => regex.test(key));
    setCached(cacheKey, value);
    return value;
  }
}

async function kvSrem(key: string, member: string): Promise<void> {
  invalidateCached(`set:${key}`);
  try {
    const client = await getKvClient();
    if (!client) {
      const s = memStore.get(key) as Set<string> | undefined;
      if (s) s.delete(member);
      return;
    }
    await client.srem(key, member);
  } catch {
    const s = memStore.get(key) as Set<string> | undefined;
    if (s) s.delete(member);
  }
}

async function kvIncr(key: string): Promise<number> {
  invalidateCached(key);
  try {
    const client = await getKvClient();
    if (!client) {
      const n = ((memStore.get(key) as number) ?? 0) + 1;
      memStore.set(key, n);
      return n;
    }
    return await client.incr(key);
  } catch {
    const n = ((memStore.get(key) as number) ?? 0) + 1;
    memStore.set(key, n);
    return n;
  }
}

async function kvLpush(key: string, ...values: string[]): Promise<void> {
  invalidateCached(`list:${key}`);
  try {
    const client = await getKvClient();
    if (!client) {
      const list = (memStore.get(key) as string[]) ?? [];
      list.unshift(...values);
      memStore.set(key, list);
      return;
    }
    await client.lpush(key, ...values);
  } catch {
    const list = (memStore.get(key) as string[]) ?? [];
    list.unshift(...values);
    memStore.set(key, list);
  }
}

async function kvLrange(key: string, start: number, stop: number): Promise<string[]> {
  // Cache the full list once per request and slice in-memory for subsequent reads.
  // This collapses N range reads of the same list into a single KV command.
  const cacheKey = `list:${key}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached.hit && cached.value) {
    return stop === -1 ? cached.value.slice(start) : cached.value.slice(start, stop + 1);
  }
  try {
    const client = await getKvClient();
    if (!client) {
      const list = (memStore.get(key) as string[]) ?? [];
      setCached(cacheKey, list);
      return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
    }
    // Fetch the full list once so subsequent ranges are free.
    const full = (await client.lrange(key, 0, -1)) as string[];
    setCached(cacheKey, full);
    return stop === -1 ? full.slice(start) : full.slice(start, stop + 1);
  } catch {
    const list = (memStore.get(key) as string[]) ?? [];
    setCached(cacheKey, list);
    return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
  }
}

async function kvLlen(key: string): Promise<number> {
  const cacheKey = `list:${key}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached.hit && cached.value) {
    return cached.value.length;
  }
  try {
    const client = await getKvClient();
    if (!client) {
      const list = (memStore.get(key) as string[]) ?? [];
      setCached(cacheKey, list);
      return list.length;
    }
    if (typeof client.llen === 'function') {
      return Number(await client.llen(key));
    }
    const full = (await client.lrange(key, 0, -1)) as string[];
    setCached(cacheKey, full);
    return full.length;
  } catch {
    const list = (memStore.get(key) as string[]) ?? [];
    setCached(cacheKey, list);
    return list.length;
  }
}

async function kvLrem(key: string, count: number, value: string): Promise<void> {
  invalidateCached(`list:${key}`);
  try {
    const client = await getKvClient();
    if (!client) {
      const list = (memStore.get(key) as string[]) ?? [];
      const idx = list.indexOf(value);
      if (idx !== -1) list.splice(idx, 1);
      memStore.set(key, list);
      return;
    }
    await client.lrem(key, count, value);
  } catch {
    const list = (memStore.get(key) as string[]) ?? [];
    const idx = list.indexOf(value);
    if (idx !== -1) list.splice(idx, 1);
    memStore.set(key, list);
  }
}

async function kvHset(key: string, fields: Record<string, unknown>): Promise<void> {
  invalidateCached(`hash:${key}`);
  try {
    const client = await getKvClient();
    if (!client) {
      const existing = (memStore.get(key) as Record<string, unknown>) ?? {};
      memStore.set(key, { ...existing, ...fields });
      return;
    }
    await client.hset(key, fields);
  } catch {
    const existing = (memStore.get(key) as Record<string, unknown>) ?? {};
    memStore.set(key, { ...existing, ...fields });
  }
}

async function kvHgetall<T>(key: string): Promise<T | null> {
  const cacheKey = `hash:${key}`;
  const cached = getCached<T>(cacheKey);
  if (cached.hit) return cached.value;
  try {
    const client = await getKvClient();
    if (!client) {
      const value = (memStore.get(key) as T) ?? null;
      setCached(cacheKey, value);
      return value;
    }
    const value = (await client.hgetall(key)) as T | null;
    setCached(cacheKey, value);
    return value;
  } catch {
    const value = (memStore.get(key) as T) ?? null;
    setCached(cacheKey, value);
    return value;
  }
}

function unwrapPipelineResult(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 2) {
    const [error, result] = value;
    if (error === null || error === undefined || error instanceof Error || typeof error === 'string') {
      return result;
    }
  }
  return value;
}

async function kvHgetallMany<T>(keys: string[]): Promise<Array<T | null>> {
  if (keys.length === 0) return [];

  const results = new Array<T | null>(keys.length).fill(null);
  const misses: Array<{ index: number; key: string; cacheKey: string }> = [];

  keys.forEach((key, index) => {
    const cacheKey = `hash:${key}`;
    const cached = getCached<T>(cacheKey);
    if (cached.hit) {
      results[index] = cached.value;
    } else {
      misses.push({ index, key, cacheKey });
    }
  });

  if (misses.length === 0) return results;

  try {
    const client = await getKvClient();
    if (!client) {
      for (const miss of misses) {
        const value = (memStore.get(miss.key) as T) ?? null;
        setCached(miss.cacheKey, value);
        results[miss.index] = value;
      }
      return results;
    }

    if (typeof client.pipeline === 'function') {
      const pipeline = client.pipeline();
      for (const miss of misses) {
        pipeline.hgetall(miss.key);
      }
      const values = await pipeline.exec();
      values.forEach((raw: unknown, offset: number) => {
        const miss = misses[offset];
        const value = (unwrapPipelineResult(raw) as T | null) ?? null;
        setCached(miss.cacheKey, value);
        results[miss.index] = value;
      });
      return results;
    }

    const values = await Promise.all(misses.map((miss) => client.hgetall(miss.key) as Promise<T | null>));
    values.forEach((value, offset) => {
      const miss = misses[offset];
      const normalized = value ?? null;
      setCached(miss.cacheKey, normalized);
      results[miss.index] = normalized;
    });
    return results;
  } catch {
    for (const miss of misses) {
      const value = (memStore.get(miss.key) as T) ?? null;
      setCached(miss.cacheKey, value);
      results[miss.index] = value;
    }
    return results;
  }
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

const KEYS = {
  agentSet: () => 'agents',
  agent: (id: string) => `agent:${id}`,
  agentHandle: (handle: string) => `agent:handle:${normalizeAgentHandle(handle)}`,
  agentOwner: (id: string) => `agent:${id}:owner`,
  agentTweets: (id: string) => `agent:${id}:tweets`,
  agentQueue: (id: string) => `agent:${id}:queue`,
  agentMentions: (id: string) => `agent:${id}:mentions`,
  agentMentionByTweet: (agentId: string, tweetId: string) => `agent:${agentId}:mention:tweet:${tweetId}`,
  agentMetrics: (id: string) => `agent:${id}:metrics`,
  agentAnalysis: (id: string) => `agent:${id}:analysis`,
  oauthTemp: (oauthToken: string) => `oauth:${oauthToken}`,
  agentProtocol: (id: string) => `agent:${id}:protocol`,
  agentPostLog: (id: string) => `agent:${id}:postlog`,
  agentPerformance: (id: string) => `agent:${id}:performance`,
  agentExperiments: (id: string) => `agent:${id}:experiments`,
  draftExperiment: (id: string) => `experiment:${id}`,
  agentLearnings: (id: string) => `agent:${id}:learnings`,
  agentTrendOpportunities: (id: string) => `agent:${id}:trend_opportunities`,
  agentRelationshipOpportunities: (id: string) => `agent:${id}:relationship_opportunities`,
  agentViralityPostmortems: (id: string) => `agent:${id}:virality_postmortems`,
  agentTrendingCache: (id: string) => `agent:${id}:trending_cache`,
  agentEngagementSessions: (id: string) => `agent:${id}:engage_sessions`,
  agentSoulVersions: (id: string) => `agent:${id}:soul_versions`,
  agentFollowerHistory: (id: string) => `agent:${id}:followers`,
  agentRemixMemory: (id: string) => `agent:${id}:remix_memory`,
  agentVoiceChat: (id: string) => `agent:${id}:voice_chat`,
  agentVoiceDirectives: (id: string) => `agent:${id}:voice_directives`,
  agentVoiceDirectiveRules: (id: string) => `agent:${id}:voice_directive_rules`,
  agentManualExamples: (id: string) => `agent:${id}:manual_examples`,
  agentSignals: (id: string) => `agent:${id}:signals`,
  agentOutcomeEvents: (id: string) => `agent:${id}:outcome_events`,
  agentMetricAvailability: (id: string) => `agent:${id}:metric_availability`,
  agentRelationshipProfiles: (id: string) => `agent:${id}:relationship_profiles`,
  agentIdeaAtoms: (id: string) => `agent:${id}:idea_atoms`,
  agentCriticVerdicts: (id: string) => `agent:${id}:critic_verdicts`,
  agentAutopilotLock: (id: string) => `agent:${id}:autopilot_lock`,
  agentAutopilotHealth: (id: string) => `agent:${id}:autopilot_health`,
  browserPairing: (id: string) => `browser:pairing:${id}`,
  browserPairingByToken: (token: string) => `browser:pairing:token:${token}`,
  browserPairingChallenge: (challenge: string) => `browser:pairing:challenge:${challenge}`,
  userBrowserPairings: (userId: string) => `user:${userId}:browser_pairings`,
  engagementSession: (id: string) => `engage:session:${id}`,
  cronLog: () => 'cron:log',
  userSet: () => 'users',
  user: (xUserId: string) => `user:${xUserId}`,
  userAgents: (xUserId: string) => `user:${xUserId}:agents`,
  stripeCustomerUser: (customerId: string) => `stripe:customer:${customerId}:user`,
  stripeSubscriptionUser: (subscriptionId: string) => `stripe:subscription:${subscriptionId}:user`,
  session: (token: string) => `session:${token}`,
  userUsername: (username: string) => `user:username:${username}`,
  tweet: (id: string) => `tweet:${id}`,
  mention: (id: string) => `mention:${id}`,
  agentJobs: (id: string) => `agent:${id}:jobs`,
  job: (id: string) => `job:${id}`,
  counterAgent: () => 'counter:agent',
  counterTweet: () => 'counter:tweet',
  counterMention: () => 'counter:mention',
  counterJob: () => 'counter:job',
  counterEngagementSession: () => 'counter:engagement_session',
  counterBrowserPairing: () => 'counter:browser_pairing',
  agentWizard: (id: string) => `agent:${id}:wizard`,
  agentStyle: (id: string) => `agent:${id}:style`,
  agentFeedback: (id: string) => `agent:${id}:feedback`,
  agentEvents: (id: string) => `agent:${id}:events`,
  agentSoulBackup: (id: string) => `agent:${id}:soul_backup`,
  agentRateLimit: (id: string, action: string) => `ratelimit:${id}:${action}`,
  agentBaseline: (id: string) => `agent:${id}:baseline`,
  counterOutcomeEvent: () => 'counter:outcome_event',
  counterIdeaAtom: () => 'counter:idea_atom',
};

export class AgentHandleConflictError extends Error {
  readonly handle: string;
  readonly existingAgentId: string | null;

  constructor(handle: string, existingAgentId?: string | null) {
    const normalizedHandle = normalizeAgentHandle(handle);
    super(`An agent for @${normalizedHandle} already exists.`);
    this.name = 'AgentHandleConflictError';
    this.handle = normalizedHandle;
    this.existingAgentId = existingAgentId ? String(existingAgentId) : null;
  }
}

function hasLiveAgentCredentials(agent: Pick<Agent, 'apiKey' | 'apiSecret' | 'accessToken' | 'accessSecret'>): boolean {
  return Boolean(agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret);
}

function compareCanonicalHandleAgents(a: Agent, b: Agent): number {
  const connectedDelta = Number(b.isConnected === 1) - Number(a.isConnected === 1);
  if (connectedDelta !== 0) return connectedDelta;

  const liveKeysDelta = Number(hasLiveAgentCredentials(b)) - Number(hasLiveAgentCredentials(a));
  if (liveKeysDelta !== 0) return liveKeysDelta;

  const xUserDelta = Number(Boolean(b.xUserId)) - Number(Boolean(a.xUserId));
  if (xUserDelta !== 0) return xUserDelta;

  const readyDelta = Number(b.setupStep === 'ready') - Number(a.setupStep === 'ready');
  if (readyDelta !== 0) return readyDelta;

  const createdAtDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdAtDelta !== 0) return createdAtDelta;

  const aId = Number(a.id);
  const bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId)) {
    return aId - bId;
  }

  return String(a.id).localeCompare(String(b.id));
}

async function getAgentsByHandleValue(handle: string): Promise<Agent[]> {
  const normalizedHandle = normalizeAgentHandle(handle);
  if (!normalizedHandle) return [];

  const agents = await getAgents();
  return agents
    .filter((agent) => normalizeAgentHandle(agent.handle) === normalizedHandle)
    .sort(compareCanonicalHandleAgents);
}

async function getHandleConflict(handle: string, excludeAgentId?: string | null): Promise<Agent | null> {
  const excludedId = excludeAgentId ? String(excludeAgentId) : null;
  const matches = await getAgentsByHandleValue(handle);
  return matches.find((agent) => !excludedId || String(agent.id) !== excludedId) ?? null;
}

async function syncCanonicalHandleIndex(handle: string): Promise<Agent | null> {
  const normalizedHandle = normalizeAgentHandle(handle);
  if (!normalizedHandle) return null;

  const canonical = (await getAgentsByHandleValue(normalizedHandle))[0] ?? null;
  if (!canonical) {
    await kvDel(KEYS.agentHandle(normalizedHandle));
    return null;
  }

  const currentId = await kvGet<string>(KEYS.agentHandle(normalizedHandle));
  if (String(currentId || '') !== String(canonical.id)) {
    await kvSet(KEYS.agentHandle(normalizedHandle), String(canonical.id));
  }

  return canonical;
}

// ─── Agent storage ────────────────────────────────────────────────────────────

export async function getAgents(): Promise<Agent[]> {
  const ids = await kvSmembers(KEYS.agentSet());
  if (ids.length === 0) return [];
  const agents = await Promise.all(ids.map((id) => kvHgetall<Agent>(KEYS.agent(String(id)))));
  return agents
    .filter((a): a is Agent => a !== null)
    .map(normalizeId)
    .sort(compareNewestRecordFirst);
}

export async function getAgent(id: string): Promise<Agent | null> {
  const agent = await kvHgetall<Agent>(KEYS.agent(String(id)));
  return agent ? normalizeId(agent) : null;
}

export async function getAgentByHandle(handle: string): Promise<Agent | null> {
  return syncCanonicalHandleIndex(handle);
}

export async function createAgent(data: Omit<CreateAgentInput, 'id'>): Promise<Agent> {
  const normalizedHandle = normalizeAgentHandle(data.handle);
  if (!normalizedHandle) {
    throw new Error('Agent handle is required');
  }

  const existing = await getHandleConflict(normalizedHandle);
  if (existing) {
    throw new AgentHandleConflictError(normalizedHandle, existing.id);
  }

  const counter = await kvIncr(KEYS.counterAgent());
  const id = String(counter);
  const agent: Agent = {
    id,
    handle: normalizedHandle,
    name: data.name,
    soulMd: data.soulMd,
    soulSummary: data.soulSummary ?? null,
    apiKey: data.apiKey ?? null,
    apiSecret: data.apiSecret ?? null,
    accessToken: data.accessToken ?? null,
    accessSecret: data.accessSecret ?? null,
    isConnected: data.isConnected ?? 0,
    xUserId: data.xUserId ?? null,
    soulPublic: data.soulPublic ?? 1,
    setupStep: data.setupStep ?? 'oauth',
    createdAt: new Date().toISOString(),
  };
  await kvHset(KEYS.agent(id), agent as unknown as Record<string, unknown>);
  await kvSadd(KEYS.agentSet(), id);
  await syncCanonicalHandleIndex(agent.handle);
  return agent;
}

export async function updateAgent(id: string, data: UpdateAgentInput): Promise<Agent> {
  const existing = await getAgent(id);
  if (!existing) throw new Error(`Agent ${id} not found`);

  const previousHandle = normalizeAgentHandle(existing.handle);
  const nextHandle = data.handle !== undefined
    ? normalizeAgentHandle(data.handle)
    : previousHandle;
  if (!nextHandle) throw new Error('Agent handle is required');

  const conflictingAgent = await getHandleConflict(nextHandle, id);
  if (conflictingAgent) {
    throw new AgentHandleConflictError(nextHandle, conflictingAgent.id);
  }

  const updated = { ...existing, ...data, handle: nextHandle };
  await kvHset(KEYS.agent(id), updated as unknown as Record<string, unknown>);

  if (previousHandle !== nextHandle) {
    await syncCanonicalHandleIndex(previousHandle);
  }
  await syncCanonicalHandleIndex(nextHandle);

  return updated;
}

export async function invalidateAgentConnection(id: string): Promise<Agent | null> {
  const existing = await getAgent(id);
  if (!existing) return null;

  const alreadyDisconnected = existing.isConnected !== 1
    && !existing.apiKey
    && !existing.apiSecret
    && !existing.accessToken
    && !existing.accessSecret;

  if (alreadyDisconnected) {
    return existing;
  }

  return updateAgent(id, {
    apiKey: null,
    apiSecret: null,
    accessToken: null,
    accessSecret: null,
    isConnected: 0,
  });
}

export async function deleteAgent(id: string): Promise<void> {
  const agent = await getAgent(id);
  if (!agent) return;

  // Cascade: delete tweets
  const tweetIds = await kvLrange(KEYS.agentTweets(id), 0, -1);
  await Promise.all(tweetIds.map((tid) => kvDel(KEYS.tweet(tid))));
  await kvDel(KEYS.agentTweets(id));

  // Cascade: delete queue refs
  await kvDel(KEYS.agentQueue(id));

  // Cascade: delete mentions
  const mentionIds = await kvLrange(KEYS.agentMentions(id), 0, -1);
  await Promise.all(mentionIds.map((mid) => kvDel(KEYS.mention(mid))));
  await kvDel(KEYS.agentMentions(id));

  // Cascade: delete metrics hash
  await kvDel(KEYS.agentMetrics(id));

  // Cascade: delete analysis
  await kvDel(KEYS.agentAnalysis(id));

  // Cascade: delete activation funnel data
  await kvDel(KEYS.agentWizard(id));
  await kvDel(KEYS.agentStyle(id));
  await kvDel(KEYS.agentFeedback(id));
  await kvDel(KEYS.agentEvents(id));
  await kvDel(KEYS.agentSoulBackup(id));
  await kvDel(KEYS.agentManualExamples(id));

  // Cascade: delete protocol, post log, learnings, performance, baseline, jobs
  await kvDel(KEYS.agentProtocol(id));
  await kvDel(KEYS.agentPostLog(id));
  await kvDel(KEYS.agentLearnings(id));
  await kvDel(KEYS.agentPerformance(id));
  await kvDel(KEYS.agentTrendOpportunities(id));
  await kvDel(KEYS.agentRelationshipOpportunities(id));
  await kvDel(KEYS.agentViralityPostmortems(id));
  const experimentIds = await kvLrange(KEYS.agentExperiments(id), 0, -1);
  await Promise.all(experimentIds.map((experimentId) => kvDel(KEYS.draftExperiment(String(experimentId)))));
  await kvDel(KEYS.agentExperiments(id));
  await kvDel(KEYS.agentBaseline(id));
  const engagementSessionIds = await kvLrange(KEYS.agentEngagementSessions(id), 0, -1);
  await Promise.all(engagementSessionIds.map((sessionId) => kvDel(KEYS.engagementSession(String(sessionId)))));
  await kvDel(KEYS.agentEngagementSessions(id));
  // Delete jobs
  const jobIds = await kvLrange(KEYS.agentJobs(id), 0, -1);
  await Promise.all(jobIds.map((jid) => kvDel(`job:${jid}`)));
  await kvDel(KEYS.agentJobs(id));

  // Remove agent
  await kvDel(KEYS.agent(id));
  await kvSrem(KEYS.agentSet(), id);
  await syncCanonicalHandleIndex(agent.handle);
  await removeAgentFromAllUsers(id);
}

// ─── Tweet storage ────────────────────────────────────────────────────────────

// Vercel KV (Upstash) auto-deserializes numeric strings as numbers.
// IDs are always strings internally, so coerce on read.
function normalizeId<T extends { id: unknown }>(obj: T): T & { id: string } {
  return { ...obj, id: String(obj.id) };
}

function compareNewestRecordFirst<T extends { createdAt: string; id?: unknown }>(a: T, b: T): number {
  const createdAtDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (createdAtDelta !== 0) return createdAtDelta;

  const aId = Number(a.id);
  const bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId)) {
    return bId - aId;
  }

  return String(b.id ?? '').localeCompare(String(a.id ?? ''));
}

function normalizeUser(user: User): User {
  return {
    ...user,
    id: String(user.id),
    stripeCustomerId: user.stripeCustomerId ?? null,
    stripeSubscriptionId: user.stripeSubscriptionId ?? null,
    billingEmail: user.billingEmail ?? null,
    billingStatus: user.billingStatus ?? 'free',
    plan: user.plan ?? 'free',
    currentPeriodEnd: user.currentPeriodEnd ?? null,
  };
}

async function setUserUsernameIndex(user: Pick<User, 'id' | 'username'>): Promise<void> {
  const normalized = normalizeUsername(user.username);
  if (!normalized) return;
  await kvSet(KEYS.userUsername(normalized), String(user.id));
}

function normalizeTweetRecord(tweet: Tweet): Tweet {
  const coerceNullableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const coerceNullableJson = <T>(value: unknown): T | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object') return value as T;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return null;
  };
  const coerceNullableBoolean = (value: unknown): boolean | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return null;
  };

  return {
    ...tweet,
    id: String(tweet.id),
    originalContent: tweet.originalContent ?? tweet.content,
    editCount: tweet.editCount ?? 0,
    lastEditedAt: tweet.lastEditedAt ?? null,
    approvedAt: tweet.approvedAt ?? null,
    postedAt: tweet.postedAt ?? null,
    rationale: tweet.rationale ?? null,
    generationMode: tweet.generationMode ?? null,
    candidateScore: coerceNullableNumber(tweet.candidateScore),
    confidenceScore: coerceNullableNumber(tweet.confidenceScore),
    voiceScore: coerceNullableNumber(tweet.voiceScore),
    noveltyScore: coerceNullableNumber(tweet.noveltyScore),
    predictedEngagementScore: coerceNullableNumber(tweet.predictedEngagementScore),
    freshnessScore: coerceNullableNumber(tweet.freshnessScore),
    repetitionRiskScore: coerceNullableNumber(tweet.repetitionRiskScore),
    policyRiskScore: coerceNullableNumber(tweet.policyRiskScore),
    surpriseScore: coerceNullableNumber(tweet.surpriseScore),
    creativeRiskScore: coerceNullableNumber(tweet.creativeRiskScore),
    slopScore: coerceNullableNumber(tweet.slopScore),
    replyBaitScore: coerceNullableNumber(tweet.replyBaitScore),
    hookType: tweet.hookType ?? null,
    toneType: tweet.toneType ?? null,
    specificityType: tweet.specificityType ?? null,
    structureType: tweet.structureType ?? null,
    thesis: tweet.thesis ?? null,
    coverageCluster: tweet.coverageCluster ?? null,
    featureTags: coerceNullableJson(tweet.featureTags),
    judgeScore: coerceNullableNumber(tweet.judgeScore),
    judgeBreakdown: coerceNullableJson(tweet.judgeBreakdown),
    judgeNotes: tweet.judgeNotes ?? null,
    mutationRound: coerceNullableNumber(tweet.mutationRound),
    rewardPrediction: coerceNullableNumber(tweet.rewardPrediction),
    globalPriorWeight: coerceNullableNumber(tweet.globalPriorWeight),
    localPriorWeight: coerceNullableNumber(tweet.localPriorWeight),
    scoreProvenance: coerceNullableJson(tweet.scoreProvenance),
    rewardBreakdown: coerceNullableJson(tweet.rewardBreakdown),
    sourceLane: tweet.sourceLane ?? null,
    styleMode: tweet.styleMode === 'shitpoast' ? 'shitpoast' : 'standard',
    creativeLane: tweet.creativeLane ?? null,
    targetAudienceSegment: tweet.targetAudienceSegment ?? null,
    segmentHypothesis: tweet.segmentHypothesis ?? null,
    promptStrategy: tweet.promptStrategy ?? null,
    mediaExperimentType: tweet.mediaExperimentType ?? null,
    mediaBrief: tweet.mediaBrief ?? null,
    portfolioRole: tweet.portfolioRole ?? null,
    relationshipTargetHandle: tweet.relationshipTargetHandle ?? null,
    followupForTweetId: tweet.followupForTweetId ?? null,
    followupTrigger: tweet.followupTrigger ?? null,
    trendFitScore: coerceNullableNumber(tweet.trendFitScore),
    criticScores: coerceNullableJson(tweet.criticScores),
    actionRewardPrediction: coerceNullableJson(tweet.actionRewardPrediction),
    draftExperimentId: tweet.draftExperimentId ?? null,
    experimentBatchId: tweet.experimentBatchId ?? null,
    experimentHypothesis: tweet.experimentHypothesis ?? null,
    experimentHoldout: coerceNullableBoolean(tweet.experimentHoldout),
    promptVariant: tweet.promptVariant ?? null,
    trendTopicId: tweet.trendTopicId ?? null,
    trendHeadline: tweet.trendHeadline ?? null,
    quarantineReason: tweet.quarantineReason ?? null,
    quarantinedAt: tweet.quarantinedAt ?? null,
  };
}

function serializeTweetRecord(tweet: Tweet): Record<string, unknown> {
  return {
    ...tweet,
    featureTags: tweet.featureTags ? JSON.stringify(tweet.featureTags) : null,
    judgeBreakdown: tweet.judgeBreakdown ? JSON.stringify(tweet.judgeBreakdown) : null,
    scoreProvenance: tweet.scoreProvenance ? JSON.stringify(tweet.scoreProvenance) : null,
    rewardBreakdown: tweet.rewardBreakdown ? JSON.stringify(tweet.rewardBreakdown) : null,
    criticScores: tweet.criticScores ? JSON.stringify(tweet.criticScores) : null,
    actionRewardPrediction: tweet.actionRewardPrediction ? JSON.stringify(tweet.actionRewardPrediction) : null,
  };
}

// Upstash auto-deserializes JSON list entries into objects.
// Local dev (in-memory) stores them as strings. Handle both.
function parseListEntry<T>(entry: unknown): T | null {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === 'object') return entry as T;
  if (typeof entry === 'string') {
    try { return JSON.parse(entry) as T; }
    catch { return null; }
  }
  return null;
}

export async function getTweets(agentId: string): Promise<Tweet[]> {
  const ids = await kvLrange(KEYS.agentTweets(agentId), 0, -1);
  const tweets = await kvHgetallMany<Tweet>(ids.map((id) => KEYS.tweet(String(id))));
  return tweets.filter((t): t is Tweet => t !== null).map(normalizeTweetRecord);
}

export async function getTweetCount(agentId: string): Promise<number> {
  return kvLlen(KEYS.agentTweets(agentId));
}

export async function getTweet(id: string): Promise<Tweet | null> {
  const tweet = await kvHgetall<Tweet>(KEYS.tweet(String(id)));
  return tweet ? normalizeTweetRecord(tweet) : null;
}

export async function getPreviewTweets(agentId: string): Promise<Tweet[]> {
  const tweets = await getTweets(agentId);
  return tweets.filter((tweet) => tweet.status === 'preview');
}

export async function getQueuedTweets(agentId: string): Promise<Tweet[]> {
  const ids = await kvLrange(KEYS.agentQueue(agentId), 0, -1);
  const tweets = await kvHgetallMany<Tweet>(ids.map((id) => KEYS.tweet(String(id))));
  return tweets.filter((t): t is Tweet => t !== null && t.status === 'queued').map(normalizeTweetRecord);
}

export async function createTweet(data: CreateTweetInput): Promise<Tweet> {
  const counter = await kvIncr(KEYS.counterTweet());
  const id = String(counter);
  const tweet: Tweet = {
    id,
    agentId: data.agentId,
    content: data.content,
    originalContent: data.content,
    type: data.type ?? 'original',
    status: data.status ?? 'draft',
    format: data.format ?? null,
    topic: data.topic ?? null,
    xTweetId: data.xTweetId ?? null,
    quoteTweetId: data.quoteTweetId ?? null,
    quoteTweetAuthor: data.quoteTweetAuthor ?? null,
    scheduledAt: data.scheduledAt ?? null,
    deletionReason: null,
    editCount: 0,
    lastEditedAt: null,
    approvedAt: data.status === 'queued' ? new Date().toISOString() : null,
    postedAt: data.status === 'posted' ? new Date().toISOString() : null,
    rationale: data.rationale ?? null,
    generationMode: data.generationMode ?? null,
    candidateScore: data.candidateScore ?? null,
    confidenceScore: data.confidenceScore ?? null,
    voiceScore: data.voiceScore ?? null,
    noveltyScore: data.noveltyScore ?? null,
    predictedEngagementScore: data.predictedEngagementScore ?? null,
    freshnessScore: data.freshnessScore ?? null,
    repetitionRiskScore: data.repetitionRiskScore ?? null,
    policyRiskScore: data.policyRiskScore ?? null,
    surpriseScore: data.surpriseScore ?? null,
    creativeRiskScore: data.creativeRiskScore ?? null,
    slopScore: data.slopScore ?? null,
    replyBaitScore: data.replyBaitScore ?? null,
    hookType: data.hookType ?? null,
    toneType: data.toneType ?? null,
    specificityType: data.specificityType ?? null,
    structureType: data.structureType ?? null,
    thesis: data.thesis ?? null,
    coverageCluster: data.coverageCluster ?? null,
    featureTags: data.featureTags ?? null,
    judgeScore: data.judgeScore ?? null,
    judgeBreakdown: data.judgeBreakdown ?? null,
    judgeNotes: data.judgeNotes ?? null,
    mutationRound: data.mutationRound ?? null,
    rewardPrediction: data.rewardPrediction ?? null,
    globalPriorWeight: data.globalPriorWeight ?? null,
    localPriorWeight: data.localPriorWeight ?? null,
    scoreProvenance: data.scoreProvenance ?? null,
    rewardBreakdown: data.rewardBreakdown ?? null,
    sourceLane: data.sourceLane ?? null,
    styleMode: data.styleMode ?? 'standard',
    creativeLane: data.creativeLane ?? null,
    targetAudienceSegment: data.targetAudienceSegment ?? null,
    segmentHypothesis: data.segmentHypothesis ?? null,
    promptStrategy: data.promptStrategy ?? null,
    mediaExperimentType: data.mediaExperimentType ?? null,
    mediaBrief: data.mediaBrief ?? null,
    portfolioRole: data.portfolioRole ?? null,
    relationshipTargetHandle: data.relationshipTargetHandle ?? null,
    followupForTweetId: data.followupForTweetId ?? null,
    followupTrigger: data.followupTrigger ?? null,
    trendFitScore: data.trendFitScore ?? null,
    criticScores: data.criticScores ?? null,
    actionRewardPrediction: data.actionRewardPrediction ?? null,
    draftExperimentId: data.draftExperimentId ?? null,
    experimentBatchId: data.experimentBatchId ?? null,
    experimentHypothesis: data.experimentHypothesis ?? null,
    experimentHoldout: data.experimentHoldout ?? null,
    promptVariant: data.promptVariant ?? null,
    trendTopicId: data.trendTopicId ?? null,
    trendHeadline: data.trendHeadline ?? null,
    quarantineReason: data.quarantineReason ?? null,
    quarantinedAt: data.quarantinedAt ?? null,
    createdAt: new Date().toISOString(),
  };
  await kvHset(KEYS.tweet(id), serializeTweetRecord(tweet));
  await kvLpush(KEYS.agentTweets(data.agentId), id);
  if (tweet.status === 'queued') {
    await kvLpush(KEYS.agentQueue(data.agentId), id);
  }
  if (tweet.draftExperimentId) {
    await createDraftExperiment(data.agentId, {
      id: tweet.draftExperimentId,
      tweetId: tweet.id,
      xTweetId: tweet.xTweetId,
      batchId: tweet.experimentBatchId ?? null,
      slot: null,
      creativeLane: tweet.creativeLane || 'operator_take',
      sourceLane: tweet.sourceLane ?? null,
      styleMode: tweet.styleMode ?? 'standard',
      generationMode: tweet.generationMode ?? 'balanced',
      format: tweet.format,
      topic: tweet.topic,
      hook: tweet.hookType ?? null,
      tone: tweet.toneType ?? null,
      specificity: tweet.specificityType ?? null,
      structure: tweet.structureType ?? null,
      coverageCluster: tweet.coverageCluster ?? null,
      hypothesis: tweet.experimentHypothesis || tweet.rationale || 'Test whether this draft earns approval and engagement.',
      promptVariant: tweet.promptVariant || 'default',
      holdout: tweet.experimentHoldout === true,
      predictedReward: tweet.rewardPrediction ?? null,
      predictedConfidence: tweet.confidenceScore ?? null,
      candidateScore: tweet.candidateScore ?? null,
      voiceScore: tweet.voiceScore ?? null,
      noveltyScore: tweet.noveltyScore ?? null,
      surpriseScore: tweet.surpriseScore ?? null,
      creativeRiskScore: tweet.creativeRiskScore ?? null,
      slopScore: tweet.slopScore ?? null,
      replyBaitScore: tweet.replyBaitScore ?? null,
      policyRiskScore: tweet.policyRiskScore ?? null,
      targetAudienceSegment: tweet.targetAudienceSegment ?? null,
      segmentHypothesis: tweet.segmentHypothesis ?? null,
      promptStrategy: tweet.promptStrategy ?? null,
      mediaExperimentType: tweet.mediaExperimentType ?? null,
      mediaBrief: tweet.mediaBrief ?? null,
      portfolioRole: tweet.portfolioRole ?? null,
      relationshipTargetHandle: tweet.relationshipTargetHandle ?? null,
      criticScores: tweet.criticScores ?? null,
      actionRewardPrediction: tweet.actionRewardPrediction ?? null,
    });
  }
  await Promise.all([
    addOutcomeEvent(data.agentId, {
      eventType: tweet.status === 'queued' ? 'queued' : tweet.status === 'posted' ? 'posted' : 'generated',
      source: 'tweet',
      tweetId: tweet.id,
      xTweetId: tweet.xTweetId || undefined,
      idempotencyKey: `tweet:${tweet.id}:created:${tweet.status}`,
      metadata: {
        status: tweet.status,
        type: tweet.type,
        format: tweet.format,
        topic: tweet.topic,
        candidateScore: tweet.candidateScore,
        confidenceScore: tweet.confidenceScore,
        sourceLane: tweet.sourceLane,
        creativeLane: tweet.creativeLane,
        portfolioRole: tweet.portfolioRole,
      },
    }).catch(() => null),
    addCriticVerdictForTweet(tweet).catch(() => null),
    recordIdeaAtomFromTweet(tweet, {
      generatedDelta: 1,
      queuedDelta: tweet.status === 'queued' ? 1 : 0,
      postedDelta: tweet.status === 'posted' ? 1 : 0,
    }).catch(() => null),
  ]);
  return tweet;
}

export async function updateTweet(id: string, data: UpdateTweetInput): Promise<Tweet> {
  const existing = await getTweet(id);
  if (!existing) throw new Error(`Tweet ${id} not found`);

  const prevStatus = existing.status;
  const nextData = { ...data };

  if (data.content !== undefined && data.content !== existing.content) {
    nextData.originalContent = existing.originalContent ?? existing.content;
    nextData.editCount = (existing.editCount ?? 0) + 1;
    nextData.lastEditedAt = new Date().toISOString();
    if (existing.quarantinedAt && data.quarantinedAt === undefined && data.quarantineReason === undefined) {
      nextData.quarantinedAt = null;
      nextData.quarantineReason = null;
    }
  }

  if (data.status === 'queued' && prevStatus !== 'queued' && !existing.approvedAt) {
    nextData.approvedAt = new Date().toISOString();
  }

  if (data.status === 'posted' && prevStatus !== 'posted') {
    nextData.postedAt = typeof data.postedAt === 'string' ? data.postedAt : new Date().toISOString();
    if (!existing.approvedAt) {
      nextData.approvedAt = new Date().toISOString();
    }
  }

  const updated = normalizeTweetRecord({ ...existing, ...nextData });
  await kvHset(KEYS.tweet(id), serializeTweetRecord(updated));

  // Sync queue list
  if (data.status !== undefined && data.status !== prevStatus) {
    if (data.status === 'queued' && prevStatus !== 'queued') {
      await kvLpush(KEYS.agentQueue(existing.agentId), id);
    } else if (data.status !== 'queued' && prevStatus === 'queued') {
      await kvLrem(KEYS.agentQueue(existing.agentId), 0, id);
    }
  }

  await Promise.all([
    data.content !== undefined && data.content !== existing.content
      ? addOutcomeEvent(existing.agentId, {
          eventType: 'edited',
          source: 'tweet',
          tweetId: updated.id,
          xTweetId: updated.xTweetId || undefined,
          idempotencyKey: `tweet:${updated.id}:edited:${updated.editCount}`,
          metadata: {
            editCount: updated.editCount ?? 0,
            status: updated.status,
            format: updated.format,
            topic: updated.topic,
          },
        }).catch(() => null)
      : Promise.resolve(null),
    data.status !== undefined && data.status !== prevStatus
      ? addOutcomeEvent(existing.agentId, {
          eventType: data.status === 'deleted_from_x' ? 'deleted' : data.status === 'posted' ? 'posted' : data.status === 'queued' ? 'queued' : 'generated',
          source: 'tweet',
          tweetId: updated.id,
          xTweetId: updated.xTweetId || undefined,
          idempotencyKey: `tweet:${updated.id}:status:${data.status}`,
          metadata: {
            fromStatus: prevStatus,
            toStatus: data.status,
            format: updated.format,
            topic: updated.topic,
            candidateScore: updated.candidateScore,
            confidenceScore: updated.confidenceScore,
          },
        }).catch(() => null)
      : Promise.resolve(null),
    addCriticVerdictForTweet(updated).catch(() => null),
    recordIdeaAtomFromTweet(updated, {
      generatedDelta: data.content !== undefined && data.content !== existing.content ? 1 : 0,
      queuedDelta: data.status === 'queued' && prevStatus !== 'queued' ? 1 : 0,
      postedDelta: data.status === 'posted' && prevStatus !== 'posted' ? 1 : 0,
      rejectedDelta: data.status === 'deleted_from_x' && prevStatus !== 'deleted_from_x' ? 1 : 0,
      riskNote: data.status === 'deleted_from_x' ? data.deletionReason || existing.deletionReason || null : null,
    }).catch(() => null),
  ]);

  return updated;
}

export async function deleteTweet(id: string): Promise<void> {
  const tweet = await getTweet(id);
  if (!tweet) return;
  await kvDel(KEYS.tweet(id));
  await kvLrem(KEYS.agentTweets(tweet.agentId), 0, id);
  await kvLrem(KEYS.agentQueue(tweet.agentId), 0, id);
}

// ─── Mention storage ──────────────────────────────────────────────────────────

async function getMentionsRange(agentId: string, start: number, stop: number): Promise<Mention[]> {
  const ids = await kvLrange(KEYS.agentMentions(agentId), start, stop);
  const mentions = await kvHgetallMany<Mention>(ids.map((id) => KEYS.mention(String(id))));
  return mentions
    .filter((m): m is Mention => m !== null)
    .map(normalizeMentionRecord)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function normalizeMentionRecord(mention: Mention): Mention {
  return normalizeId({
    ...mention,
    id: String(mention.id),
    tweetId: mention.tweetId != null ? String(mention.tweetId) : null,
    author: String(mention.author || ''),
    authorHandle: String(mention.authorHandle || ''),
  });
}

export async function getRecentMentions(agentId: string, limit = 100): Promise<Mention[]> {
  const safeLimit = Math.max(0, Math.min(1000, Math.floor(limit)));
  if (safeLimit === 0) return [];
  return getMentionsRange(agentId, 0, safeLimit - 1);
}

export async function getMentions(agentId: string): Promise<Mention[]> {
  return getMentionsRange(agentId, 0, -1);
}

export async function getMentionCount(agentId: string): Promise<number> {
  return kvLlen(KEYS.agentMentions(agentId));
}

export async function createMention(data: CreateMentionInput): Promise<Mention> {
  const counter = await kvIncr(KEYS.counterMention());
  const id = String(counter);
  const tweetId = data.tweetId != null ? String(data.tweetId) : null;
  const tweetIndexKey = tweetId ? KEYS.agentMentionByTweet(data.agentId, tweetId) : null;

  if (tweetIndexKey) {
    const claimed = await kvSet(tweetIndexKey, id, { nx: true });
    if (!claimed) {
      const existingId = await kvGet<string>(tweetIndexKey);
      const existing = existingId ? await kvHgetall<Mention>(KEYS.mention(String(existingId))) : null;
      if (existing) return normalizeMentionRecord(existing);
    }
  }

  const mention: Mention = {
    id,
    agentId: data.agentId,
    author: data.author,
    authorHandle: data.authorHandle,
    content: data.content,
    tweetId,
    conversationId: data.conversationId ?? null,
    inReplyToTweetId: data.inReplyToTweetId ?? null,
    engagementLikes: data.engagementLikes ?? 0,
    engagementRetweets: data.engagementRetweets ?? 0,
    createdAt: data.createdAt || new Date().toISOString(),
  };
  await kvHset(KEYS.mention(id), mention as unknown as Record<string, unknown>);
  await kvLpush(KEYS.agentMentions(data.agentId), id);
  if (tweetIndexKey) {
    await kvSet(tweetIndexKey, id);
  }
  return mention;
}

// ─── Metrics storage ──────────────────────────────────────────────────────────

export async function getMetrics(agentId: string): Promise<Record<string, number>> {
  const hash = await kvHgetall<Record<string, number>>(KEYS.agentMetrics(agentId));
  return hash ?? {};
}

export async function setMetric(agentId: string, name: string, value: number): Promise<void> {
  await kvHset(KEYS.agentMetrics(agentId), { [name]: value });
}

// ─── Convenience: get metrics as flat Metric array ───────────────────────────

export async function getMetricsArray(agentId: string): Promise<Metric[]> {
  const hash = await getMetrics(agentId);
  return Object.entries(hash).map(([metricName, value], i) => ({
    id: `${agentId}:${metricName}`,
    agentId,
    metricName,
    value: Number(value),
    date: new Date().toISOString(),
  }));
}

// ─── Analysis storage ────────────────────────────────────────────────────────

export async function getAnalysis(agentId: string): Promise<AccountAnalysis | null> {
  return kvGet<AccountAnalysis>(KEYS.agentAnalysis(agentId));
}

export async function saveAnalysis(agentId: string, analysis: AccountAnalysis): Promise<void> {
  await kvSet(KEYS.agentAnalysis(agentId), analysis);
}

// ─── OAuth temp storage ──────────────────────────────────────────────────────

export interface OAuthTempData {
  oauthTokenSecret: string;
  agentId: string | null;
  purpose: 'login' | 'connect';
  forkHandle?: string; // handle of agent whose SOUL to fork on signup
  createdAt?: string;
}

export async function saveOAuthTemp(oauthToken: string, data: OAuthTempData): Promise<void> {
  await kvSet(KEYS.oauthTemp(oauthToken), data);
}

export async function getOAuthTemp(oauthToken: string): Promise<OAuthTempData | null> {
  return kvGet<OAuthTempData>(KEYS.oauthTemp(oauthToken));
}

export async function deleteOAuthTemp(oauthToken: string): Promise<void> {
  await kvDel(KEYS.oauthTemp(oauthToken));
}

// ─── Protocol settings storage ────────────────────────────────────────────────

const DEFAULT_PROTOCOL: ProtocolSettings = {
  enabled: false,
  postsPerDay: 3,
  activeHoursStart: 0,
  activeHoursEnd: 0,
  minQueueSize: 5,
  autoReply: false,
  highValueReplyMode: false,
  minReplyValueScore: 0.58,
  earlyVelocityFollowups: true,
  supervisedTrendDesk: true,
  relationshipQueueEnabled: true,
  portfolioOptimizerEnabled: true,
  mediaExperimentRate: 15,
  maxRepliesPerRun: 3,
  replyIntervalMins: 30,
  lastPostedAt: null,
  postCooldownUntil: null,
  lastRepliedAt: null,
  lastReplyCheckedAt: null,
  totalAutoPosted: 0,
  totalAutoReplied: 0,
  lengthMix: { short: 30, medium: 30, long: 40 },
  autonomyMode: 'balanced',
  explorationRate: 35,
  trendMixTarget: 35,
  trendTolerance: 'moderate',
  shitpoastEnabled: false,
  enabledFormats: [],  // empty = all formats
  qtRatio: 0,
  marketingEnabled: false,
  marketingMix: 0,
  marketingRole: '',
  soulEvolutionMode: 'auto',
  lastEvolvedAt: null,
  proactiveReplies: false,
  proactiveLikes: false,
  autoFollow: false,
  agentShoutouts: false,
  peakHours: [],
  contentCalendar: {},
};

export async function getProtocolSettings(agentId: string): Promise<ProtocolSettings> {
  const stored = await kvGet<ProtocolSettings>(KEYS.agentProtocol(agentId));
  const settings = stored ? { ...DEFAULT_PROTOCOL, ...stored } : { ...DEFAULT_PROTOCOL };
  return {
    ...settings,
    proactiveReplies: false,
    proactiveLikes: false,
  };
}

export async function updateProtocolSettings(agentId: string, updates: Partial<ProtocolSettings>): Promise<ProtocolSettings> {
  const current = await getProtocolSettings(agentId);
  const merged = { ...current, ...updates, proactiveReplies: false, proactiveLikes: false };
  await kvSet(KEYS.agentProtocol(agentId), merged);
  return merged;
}

const DEFAULT_MANUAL_EXAMPLE_CURATION: ManualExampleCuration = {
  pinnedXTweetIds: [],
  blockedXTweetIds: [],
  updatedAt: new Date(0).toISOString(),
};

function normalizeManualExampleCuration(value: ManualExampleCuration | null | undefined): ManualExampleCuration {
  return {
    pinnedXTweetIds: [...new Set((value?.pinnedXTweetIds || []).map((id) => String(id)))],
    blockedXTweetIds: [...new Set((value?.blockedXTweetIds || []).map((id) => String(id)))],
    updatedAt: value?.updatedAt || DEFAULT_MANUAL_EXAMPLE_CURATION.updatedAt,
  };
}

export async function getManualExampleCuration(agentId: string): Promise<ManualExampleCuration> {
  const stored = await kvGet<ManualExampleCuration>(KEYS.agentManualExamples(agentId));
  return normalizeManualExampleCuration(stored);
}

export async function updateManualExampleCuration(
  agentId: string,
  updates: Partial<ManualExampleCuration>,
): Promise<ManualExampleCuration> {
  const current = await getManualExampleCuration(agentId);
  const next = normalizeManualExampleCuration({
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  await kvSet(KEYS.agentManualExamples(agentId), next);
  return next;
}

// ─── Autopilot health storage ────────────────────────────────────────────────

export async function getAutopilotHealth(agentId: string): Promise<AutopilotHealthSnapshot | null> {
  return kvGet<AutopilotHealthSnapshot>(KEYS.agentAutopilotHealth(agentId));
}

export async function setAutopilotHealth(snapshot: AutopilotHealthSnapshot): Promise<AutopilotHealthSnapshot> {
  await kvSet(KEYS.agentAutopilotHealth(snapshot.agentId), snapshot);
  return snapshot;
}

// ─── Post log storage ────────────────────────────────────────────────────────

export async function addPostLogEntry(agentId: string, entry: Omit<PostLogEntry, 'id'>): Promise<PostLogEntry> {
  const id = `${agentId}:${Date.now()}`;
  const full: PostLogEntry = { ...entry, id };
  await kvLpush(KEYS.agentPostLog(agentId), JSON.stringify(full));
  return full;
}

export async function getPostLog(agentId: string, limit = 20): Promise<PostLogEntry[]> {
  const raw = await kvLrange(KEYS.agentPostLog(agentId), 0, limit - 1);
  return raw.map((s) => parseListEntry<PostLogEntry>(s)).filter((e): e is PostLogEntry => e !== null);
}

// ─── Cron log storage ─────────────────────────────────────────────────────────

export interface CronLogEntry {
  id: string;
  timestamp: string;
  mentionsRefreshed: number;
  performanceTracked?: number;
  autopilotProcessed: number;
  results: Array<{ agentId: string; action: string; reason: string; content?: string; repliesSent?: number; runId?: string }>;
}

export async function addCronLogEntry(entry: Omit<CronLogEntry, 'id'>): Promise<void> {
  const id = `cron:${Date.now()}`;
  await kvLpush(KEYS.cronLog(), JSON.stringify({ ...entry, id }));
}

export async function getCronLog(limit = 30): Promise<CronLogEntry[]> {
  const raw = await kvLrange(KEYS.cronLog(), 0, limit - 1);
  return raw.map((s) => parseListEntry<CronLogEntry>(s)).filter((e): e is CronLogEntry => e !== null);
}

// ─── Draft experiment ledger ─────────────────────────────────────────────────

function normalizeDraftExperiment(experiment: DraftExperiment): DraftExperiment {
  const numberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const booleanOrFalse = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value === 'true';
    return false;
  };
  const jsonArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String) : [value];
      } catch {
        return [value];
      }
    }
    return [];
  };
  const jsonObject = <T>(value: unknown): T | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object') return value as T;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return null;
  };

  return {
    ...experiment,
    id: String(experiment.id),
    agentId: String(experiment.agentId),
    tweetId: experiment.tweetId ? String(experiment.tweetId) : null,
    xTweetId: experiment.xTweetId ? String(experiment.xTweetId) : null,
    batchId: experiment.batchId ? String(experiment.batchId) : null,
    slot: numberOrNull(experiment.slot),
    status: experiment.status || 'generated',
    creativeLane: experiment.creativeLane || 'operator_take',
    sourceLane: experiment.sourceLane ?? null,
    styleMode: experiment.styleMode === 'shitpoast' ? 'shitpoast' : 'standard',
    generationMode: experiment.generationMode || 'balanced',
    format: experiment.format ?? null,
    topic: experiment.topic ?? null,
    hook: experiment.hook ?? null,
    tone: experiment.tone ?? null,
    specificity: experiment.specificity ?? null,
    structure: experiment.structure ?? null,
    coverageCluster: experiment.coverageCluster ?? null,
    hypothesis: experiment.hypothesis || 'Test whether this draft earns approval and engagement.',
    promptVariant: experiment.promptVariant || 'default',
    holdout: booleanOrFalse(experiment.holdout),
    predictedReward: numberOrNull(experiment.predictedReward),
    predictedConfidence: numberOrNull(experiment.predictedConfidence),
    candidateScore: numberOrNull(experiment.candidateScore),
    voiceScore: numberOrNull(experiment.voiceScore),
    noveltyScore: numberOrNull(experiment.noveltyScore),
    surpriseScore: numberOrNull(experiment.surpriseScore),
    creativeRiskScore: numberOrNull(experiment.creativeRiskScore),
    slopScore: numberOrNull(experiment.slopScore),
    replyBaitScore: numberOrNull(experiment.replyBaitScore),
    policyRiskScore: numberOrNull(experiment.policyRiskScore),
    targetAudienceSegment: experiment.targetAudienceSegment ?? null,
    segmentHypothesis: experiment.segmentHypothesis ?? null,
    promptStrategy: experiment.promptStrategy ?? null,
    mediaExperimentType: experiment.mediaExperimentType ?? null,
    mediaBrief: experiment.mediaBrief ?? null,
    portfolioRole: experiment.portfolioRole ?? null,
    relationshipTargetHandle: experiment.relationshipTargetHandle ?? null,
    criticScores: jsonObject(experiment.criticScores),
    actionRewardPrediction: jsonObject(experiment.actionRewardPrediction),
    immediateReward: numberOrNull(experiment.immediateReward),
    finalReward: numberOrNull(experiment.finalReward),
    totalReward: numberOrNull(experiment.totalReward),
    actionRewards: jsonObject(experiment.actionRewards),
    earlyVelocityScore: numberOrNull(experiment.earlyVelocityScore),
    actualEngagement: numberOrNull(experiment.actualEngagement),
    engagementRate: numberOrNull(experiment.engagementRate),
    performanceLift: numberOrNull(experiment.performanceLift),
    lastSignalType: experiment.lastSignalType ?? null,
    outcomeNotes: jsonArray(experiment.outcomeNotes),
    createdAt: experiment.createdAt || new Date().toISOString(),
    updatedAt: experiment.updatedAt || new Date().toISOString(),
    completedAt: experiment.completedAt ?? null,
  };
}

function serializeDraftExperiment(experiment: DraftExperiment): Record<string, unknown> {
  return {
    ...experiment,
    outcomeNotes: JSON.stringify(experiment.outcomeNotes || []),
    criticScores: experiment.criticScores ? JSON.stringify(experiment.criticScores) : null,
    actionRewardPrediction: experiment.actionRewardPrediction ? JSON.stringify(experiment.actionRewardPrediction) : null,
    actionRewards: experiment.actionRewards ? JSON.stringify(experiment.actionRewards) : null,
  };
}

export async function createDraftExperiment(
  agentId: string,
  data: Omit<DraftExperiment, 'agentId' | 'createdAt' | 'updatedAt' | 'completedAt' | 'status' | 'immediateReward' | 'finalReward' | 'totalReward' | 'actionRewards' | 'earlyVelocityScore' | 'actualEngagement' | 'engagementRate' | 'performanceLift' | 'lastSignalType' | 'outcomeNotes'> & Partial<Pick<DraftExperiment, 'status' | 'immediateReward' | 'finalReward' | 'totalReward' | 'actionRewards' | 'earlyVelocityScore' | 'actualEngagement' | 'engagementRate' | 'performanceLift' | 'lastSignalType' | 'outcomeNotes' | 'completedAt'>>
): Promise<DraftExperiment> {
  const now = new Date().toISOString();
  const experiment = normalizeDraftExperiment({
    agentId,
    status: 'generated',
    immediateReward: null,
    finalReward: null,
    totalReward: null,
    actionRewards: null,
    earlyVelocityScore: null,
    actualEngagement: null,
    engagementRate: null,
    performanceLift: null,
    lastSignalType: null,
    outcomeNotes: [],
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...data,
  } as DraftExperiment);

  await kvHset(KEYS.draftExperiment(experiment.id), serializeDraftExperiment(experiment));
  await kvLpush(KEYS.agentExperiments(agentId), experiment.id);
  return experiment;
}

export async function getDraftExperiment(id: string): Promise<DraftExperiment | null> {
  const experiment = await kvHgetall<DraftExperiment>(KEYS.draftExperiment(String(id)));
  return experiment ? normalizeDraftExperiment(experiment) : null;
}

export async function getDraftExperiments(agentId: string, limit = 100): Promise<DraftExperiment[]> {
  const ids = await kvLrange(KEYS.agentExperiments(agentId), 0, limit - 1);
  const experiments = await Promise.all(ids.map((id) => getDraftExperiment(String(id))));
  return experiments.filter((experiment): experiment is DraftExperiment => experiment !== null);
}

export async function updateDraftExperiment(
  id: string,
  updates: Partial<Omit<DraftExperiment, 'id' | 'agentId' | 'createdAt'>>
): Promise<DraftExperiment | null> {
  const current = await getDraftExperiment(id);
  if (!current) return null;
  const updated = normalizeDraftExperiment({
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  await kvHset(KEYS.draftExperiment(id), serializeDraftExperiment(updated));
  return updated;
}

async function updateDraftExperimentFromSignal(agentId: string, signal: LearningSignal): Promise<void> {
  if (!signal.tweetId) return;
  const tweet = await getTweet(String(signal.tweetId));
  if (!tweet?.draftExperimentId) return;

  const status =
    signal.signalType === 'approved_without_edit' ? 'approved' :
    signal.signalType === 'taste_more_like_this' ? 'approved' :
    signal.signalType === 'edited_before_queue' || signal.signalType === 'edited_before_post' || signal.signalType === 'taste_calibration_edit' ? 'edited' :
    signal.signalType === 'x_post_succeeded' || signal.signalType === 'reply_posted' ? 'posted' :
    signal.signalType === 'deleted_from_queue' || signal.signalType === 'x_post_rejected' || signal.signalType === 'reply_rejected' || signal.signalType === 'taste_less_like_this' ? 'rejected' :
    signal.signalType === 'deleted_from_x' ? 'deleted' :
    undefined;

  const existing = await getDraftExperiment(tweet.draftExperimentId);
  const notes = [
    ...(existing?.outcomeNotes || []),
    signal.reason || (typeof signal.metadata?.preferenceHint === 'string' ? String(signal.metadata.preferenceHint) : ''),
  ].filter(Boolean).slice(-8);
  const immediate = typeof existing?.immediateReward === 'number'
    ? Math.max(-1, Math.min(1, existing.immediateReward + signal.rewardDelta))
    : signal.rewardDelta;

  await updateDraftExperiment(tweet.draftExperimentId, {
    tweetId: tweet.id,
    xTweetId: signal.xTweetId || tweet.xTweetId || null,
    status: status || existing?.status || 'generated',
    immediateReward: Number(immediate.toFixed(3)),
    totalReward: Number(((existing?.finalReward || 0) + immediate).toFixed(3)),
    lastSignalType: signal.signalType,
    outcomeNotes: notes,
    completedAt: status === 'rejected' || status === 'deleted' ? new Date().toISOString() : existing?.completedAt || null,
  });
}

async function updateDraftExperimentFromPerformance(agentId: string, entry: TweetPerformance): Promise<void> {
  const experimentId = entry.draftExperimentId;
  if (!experimentId) return;
  const experiment = await getDraftExperiment(experimentId);
  const engagement = entry.likes + (entry.retweets * 2) + (entry.replies * 1.5);
  const actionRewards = entry.actionRewards || computeActionRewards(entry);
  const qualityLift = actionRewards.qualityAdjustedGrowthReward ?? actionRewards.total;
  const earlyVelocityScore = entry.earlyVelocityScore ?? computeEarlyVelocityScore(entry);
  const notes = [
    ...(experiment?.outcomeNotes || []),
    `Live performance: ${entry.likes} likes, ${entry.retweets} reposts, ${entry.replies} replies. Quality growth ${actionRewards.qualityAdjustedGrowthScore ?? 'n/a'}/100; reward ${qualityLift >= 0 ? '+' : ''}${qualityLift}.`,
  ].slice(-8);

  await updateDraftExperiment(experimentId, {
    xTweetId: entry.xTweetId || experiment?.xTweetId || null,
    status: 'measured',
    finalReward: Number(qualityLift.toFixed(3)),
    actionRewards,
    earlyVelocityScore,
    actualEngagement: Number(engagement.toFixed(3)),
    engagementRate: entry.engagementRate,
    performanceLift: Number(qualityLift.toFixed(3)),
    totalReward: Number(((experiment?.immediateReward || 0) + qualityLift).toFixed(3)),
    lastSignalType: 'x_post_succeeded',
    outcomeNotes: notes,
    completedAt: new Date().toISOString(),
  });
}

// ─── Performance tracking storage ─────────────────────────────────────────────

export async function addPerformanceEntry(agentId: string, entry: TweetPerformance): Promise<void> {
  await kvLpush(KEYS.agentPerformance(agentId), JSON.stringify(entry));
  const measuredReward = entry.actionRewards?.total ?? computeActionRewards(entry).total;
  if (entry.tweetId) {
    const tweet = await getTweet(String(entry.tweetId));
    if (tweet) {
      await updateIdeaAtomOutcomeFromTweet(tweet, {
        rewardDelta: measuredReward,
        riskNote: entry.slopScore && entry.slopScore > 0.35 ? `Slop risk ${entry.slopScore}` : null,
      }).catch(() => null);
    }
  }
  await addOutcomeEvent(agentId, {
    eventType: 'metric_checkpoint',
    source: 'metrics',
    tweetId: entry.tweetId || undefined,
    xTweetId: entry.xTweetId,
    idempotencyKey: `metric:${entry.xTweetId}:${entry.performanceCheckpoint || 'unknown'}:${entry.checkedAt}`,
    rewardDelta: entry.actionRewards?.total,
    reason: `${entry.performanceCheckpoint || 'performance'} checkpoint: ${entry.likes} likes, ${entry.retweets} reposts, ${entry.replies} replies.`,
    metadata: {
      checkpoint: entry.performanceCheckpoint || null,
      likes: entry.likes,
      retweets: entry.retweets,
      replies: entry.replies,
      impressions: entry.impressions,
      engagementRate: entry.engagementRate,
      qualityAdjustedGrowthScore: entry.qualityAdjustedGrowthScore ?? null,
      source: entry.source,
    },
    createdAt: entry.checkedAt,
  }).catch(() => null);
  await updateDraftExperimentFromPerformance(agentId, entry);
}

export async function getPerformanceHistory(agentId: string, limit = 50): Promise<TweetPerformance[]> {
  const raw = await kvLrange(KEYS.agentPerformance(agentId), 0, limit - 1);
  return raw.map((s) => parseListEntry<TweetPerformance>(s)).filter((e): e is TweetPerformance => e !== null);
}

export async function getLearnings(agentId: string): Promise<AgentLearnings | null> {
  return kvGet<AgentLearnings>(KEYS.agentLearnings(agentId));
}

export async function saveLearnings(agentId: string, learnings: AgentLearnings): Promise<void> {
  await kvSet(KEYS.agentLearnings(agentId), learnings);
}

// ─── Growth opportunity storage ──────────────────────────────────────────────

function dedupeById<T extends { id: string; createdAt?: string }>(items: T[], limit: number): T[] {
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(String(item.id))) return false;
      seen.add(String(item.id));
      return true;
    })
    .sort((a, b) => {
      const left = a.createdAt ? Date.parse(a.createdAt) : 0;
      const right = b.createdAt ? Date.parse(b.createdAt) : 0;
      return right - left;
    })
    .slice(0, limit);
}

export async function saveTrendOpportunities(agentId: string, opportunities: TrendOpportunity[]): Promise<TrendOpportunity[]> {
  const existing = await getTrendOpportunities(agentId, 50);
  const merged = dedupeById([...opportunities, ...existing], 50);
  await kvSet(KEYS.agentTrendOpportunities(agentId), merged);
  return merged;
}

export async function getTrendOpportunities(agentId: string, limit = 20): Promise<TrendOpportunity[]> {
  const data = await kvGet<TrendOpportunity[]>(KEYS.agentTrendOpportunities(agentId));
  return (data || []).slice(0, limit);
}

export async function saveRelationshipOpportunities(agentId: string, opportunities: RelationshipOpportunity[]): Promise<RelationshipOpportunity[]> {
  const existing = await getRelationshipOpportunities(agentId, 50);
  const merged = dedupeById([...opportunities, ...existing], 50)
    .sort((a, b) => b.score - a.score || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  await kvSet(KEYS.agentRelationshipOpportunities(agentId), merged);
  return merged;
}

export async function getRelationshipOpportunities(agentId: string, limit = 20): Promise<RelationshipOpportunity[]> {
  const data = await kvGet<RelationshipOpportunity[]>(KEYS.agentRelationshipOpportunities(agentId));
  return (data || []).slice(0, limit);
}

export async function saveViralityPostmortem(agentId: string, postmortem: ViralityPostmortem): Promise<ViralityPostmortem[]> {
  const existing = await getViralityPostmortems(agentId, 50);
  const merged = dedupeById([postmortem, ...existing], 50);
  await kvSet(KEYS.agentViralityPostmortems(agentId), merged);
  return merged;
}

export async function saveViralityPostmortems(agentId: string, postmortems: ViralityPostmortem[]): Promise<ViralityPostmortem[]> {
  const existing = await getViralityPostmortems(agentId, 50);
  const merged = dedupeById([...postmortems, ...existing], 50);
  await kvSet(KEYS.agentViralityPostmortems(agentId), merged);
  return merged;
}

export async function getViralityPostmortems(agentId: string, limit = 20): Promise<ViralityPostmortem[]> {
  const data = await kvGet<ViralityPostmortem[]>(KEYS.agentViralityPostmortems(agentId));
  return (data || []).slice(0, limit);
}

// ─── Baseline storage (frozen engagement snapshot) ──────────────────────────

export interface EngagementBaseline {
  avgLikes: number;
  avgRetweets: number;
  tweetCount: number;
  snapshotDate: string;
}

export async function getBaseline(agentId: string): Promise<EngagementBaseline | null> {
  return kvGet<EngagementBaseline>(KEYS.agentBaseline(agentId));
}

export async function saveBaseline(agentId: string, baseline: EngagementBaseline): Promise<void> {
  // Never overwrite — baseline is frozen on first autopilot enable
  const existing = await getBaseline(agentId);
  if (existing) return;
  await kvSet(KEYS.agentBaseline(agentId), baseline);
}

// ─── User storage ────────────────────────────────────────────────────────────

export async function getUser(xUserId: string): Promise<User | null> {
  const user = await kvHgetall<User>(KEYS.user(xUserId));
  return user ? normalizeUser(user) : null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  const indexedId = await kvGet<string>(KEYS.userUsername(normalized));
  if (indexedId) {
    const indexedUser = await getUser(String(indexedId));
    if (indexedUser) return indexedUser;
    await kvDel(KEYS.userUsername(normalized));
  }

  // Legacy rows predate the username index. Recover once and persist the index.
  const ids = await kvSmembers(KEYS.userSet());
  if (ids.length === 0) return null;

  const users = await Promise.all(ids.map((id) => getUser(String(id))));
  const normalizedUsers = users.filter((user): user is User => user !== null);
  await Promise.all(normalizedUsers.map((user) => setUserUsernameIndex(user)));

  return normalizedUsers.find((user) => normalizeUsername(user.username) === normalized) ?? null;
}

export async function getUsers(): Promise<User[]> {
  let ids = await kvSmembers(KEYS.userSet());
  if (ids.length === 0) {
    const scannedIds = Array.from(new Set(
      (await kvScanKeys('user:*'))
        .map((key) => key.match(/^user:([^:]+)$/)?.[1] || null)
        .filter((id): id is string => Boolean(id))
    ));

    if (scannedIds.length > 0) {
      await kvSadd(KEYS.userSet(), ...scannedIds);
      ids = scannedIds;
    }
  }

  if (ids.length === 0) return [];
  const users = await Promise.all(ids.map((id) => kvHgetall<User>(KEYS.user(String(id)))));
  return users
    .filter((user): user is User => user !== null)
    .map(normalizeUser)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function getOrCreateUser(xUserId: string, username: string, name: string): Promise<User> {
  const existing = await getUser(xUserId);
  if (existing) return existing;
  const user: User = {
    id: xUserId,
    username,
    name,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingEmail: null,
    billingStatus: 'free',
    plan: 'free',
    currentPeriodEnd: null,
    createdAt: new Date().toISOString(),
  };
  await kvHset(KEYS.user(xUserId), user as unknown as Record<string, unknown>);
  await kvSadd(KEYS.userSet(), xUserId);
  await setUserUsernameIndex(user);
  return user;
}

export async function updateUser(xUserId: string, updates: Partial<User>): Promise<User> {
  const current = await getUser(xUserId);
  if (!current) {
    throw new Error(`User ${xUserId} not found`);
  }
  const merged = normalizeUser({ ...current, ...updates });
  const previousUsername = normalizeUsername(current.username);
  await kvHset(KEYS.user(xUserId), merged as unknown as Record<string, unknown>);
  await kvSadd(KEYS.userSet(), xUserId);
  const nextUsername = normalizeUsername(merged.username);
  if (previousUsername && previousUsername !== nextUsername) {
    await kvDel(KEYS.userUsername(previousUsername));
  }
  await setUserUsernameIndex(merged);
  return merged;
}

export async function linkStripeCustomerToUser(userId: string, customerId: string): Promise<void> {
  await kvSet(KEYS.stripeCustomerUser(customerId), userId);
}

export async function getUserIdByStripeCustomer(customerId: string): Promise<string | null> {
  return kvGet<string>(KEYS.stripeCustomerUser(customerId));
}

export async function linkStripeSubscriptionToUser(userId: string, subscriptionId: string): Promise<void> {
  await kvSet(KEYS.stripeSubscriptionUser(subscriptionId), userId);
}

export async function getUserIdByStripeSubscription(subscriptionId: string): Promise<string | null> {
  return kvGet<string>(KEYS.stripeSubscriptionUser(subscriptionId));
}

export async function unlinkStripeSubscription(subscriptionId: string): Promise<void> {
  await kvDel(KEYS.stripeSubscriptionUser(subscriptionId));
}

// ─── Session storage ─────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  const session: Session = { userId, createdAt: new Date().toISOString() };
  await kvSet(KEYS.session(token), session);
  return token;
}

export async function getSession(token: string): Promise<Session | null> {
  return kvGet<Session>(KEYS.session(token));
}

export async function deleteSession(token: string): Promise<void> {
  await kvDel(KEYS.session(token));
}

// ─── User-agent mapping ──────────────────────────────────────────────────────

export async function getUserAgentIds(userId: string): Promise<string[]> {
  return kvSmembers(KEYS.userAgents(userId));
}

export async function getUserAgents(userId: string): Promise<Agent[]> {
  const ids = await getUserAgentIds(userId);
  if (ids.length === 0) return [];
  const agents = await Promise.all(ids.map((id) => kvHgetall<Agent>(KEYS.agent(id))));
  return agents
    .filter((a): a is Agent => a !== null)
    .map(normalizeId)
    .sort(compareNewestRecordFirst);
}

export async function addAgentToUser(userId: string, agentId: string): Promise<void> {
  await kvSadd(KEYS.userAgents(userId), agentId);
  await kvSet(KEYS.agentOwner(agentId), userId);
}

export async function removeAgentFromUser(userId: string, agentId: string): Promise<void> {
  await kvSrem(KEYS.userAgents(userId), agentId);
  await kvDel(KEYS.agentOwner(agentId));
}

export async function removeAgentFromAllUsers(agentId: string): Promise<void> {
  const users = await getUsers();
  if (users.length > 0) {
    await Promise.all(users.map((user) => kvSrem(KEYS.userAgents(String(user.id)), String(agentId))));
  }
  await kvDel(KEYS.agentOwner(agentId));
}

export async function getAgentOwnerId(agentId: string): Promise<string | null> {
  return kvGet<string>(KEYS.agentOwner(agentId));
}

// ─── Tweet job storage ──────────────────────────────────────────────────────

export async function getJobs(agentId: string): Promise<TweetJob[]> {
  const ids = await kvSmembers(KEYS.agentJobs(agentId));
  if (ids.length === 0) return [];
  const jobs = await Promise.all(ids.map((id) => kvHgetall<TweetJob>(KEYS.job(id))));
  return jobs
    .filter((j): j is TweetJob => j !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getJob(id: string): Promise<TweetJob | null> {
  return kvHgetall<TweetJob>(KEYS.job(id));
}

export async function createJob(data: CreateTweetJobInput): Promise<TweetJob> {
  const counter = await kvIncr(KEYS.counterJob());
  const id = String(counter);
  const job: TweetJob = {
    id,
    agentId: data.agentId,
    name: data.name,
    description: data.description,
    schedule: data.schedule,
    postsPerRun: data.postsPerRun,
    topics: data.topics,
    formats: data.formats,
    enabled: data.enabled,
    lastRunAt: null,
    totalPosted: 0,
    createdAt: new Date().toISOString(),
    source: data.source,
  };
  await kvHset(KEYS.job(id), job as unknown as Record<string, unknown>);
  await kvSadd(KEYS.agentJobs(data.agentId), id);
  return job;
}

export async function updateJob(id: string, data: UpdateTweetJobInput): Promise<TweetJob> {
  const existing = await getJob(id);
  if (!existing) throw new Error(`Job ${id} not found`);
  const updated = { ...existing, ...data };
  await kvHset(KEYS.job(id), updated as unknown as Record<string, unknown>);
  return updated;
}

export async function deleteJob(id: string): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  await kvDel(KEYS.job(id));
  await kvSrem(KEYS.agentJobs(job.agentId), id);
}

// ─── Wizard data storage ────────────────────────────────────────────────────

export async function saveWizardData(agentId: string, data: WizardData): Promise<void> {
  await kvSet(KEYS.agentWizard(agentId), data);
}

export async function getWizardData(agentId: string): Promise<WizardData | null> {
  return kvGet<WizardData>(KEYS.agentWizard(agentId));
}

// ─── Style signals storage ──────────────────────────────────────────────────

export async function saveStyleSignals(agentId: string, signals: StyleSignals): Promise<void> {
  await kvSet(KEYS.agentStyle(agentId), signals);
}

export async function getStyleSignals(agentId: string): Promise<StyleSignals | null> {
  return kvGet<StyleSignals>(KEYS.agentStyle(agentId));
}

// ─── Feedback storage ───────────────────────────────────────────────────────

export async function saveFeedback(agentId: string, entry: FeedbackEntry): Promise<void> {
  const existing = await getFeedback(agentId);
  // Prune on write: keep only last 30 days and max 20 entries
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const pruned = existing.filter(e => new Date(e.generatedAt).getTime() > thirtyDaysAgo);
  const deduped = entry.tweetId
    ? pruned.filter((e) => !(e.tweetId === entry.tweetId && e.source === entry.source))
    : pruned;
  deduped.push(entry);
  const capped = deduped.slice(-20);
  await kvSet(KEYS.agentFeedback(agentId), capped);
}

export async function getFeedback(agentId: string): Promise<FeedbackEntry[]> {
  const data = await kvGet<FeedbackEntry[]>(KEYS.agentFeedback(agentId));
  return data ?? [];
}

export async function getRecentNegativeFeedback(agentId: string, limit = 5): Promise<string[]> {
  const all = await getFeedback(agentId);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return all
    .filter(e => e.rating === 'down' && new Date(e.generatedAt).getTime() > thirtyDaysAgo)
    .slice(-limit)
    .map((entry) => {
      const reason = entry.intentSummary?.trim() || entry.reason?.trim();
      return reason ? `${entry.tweetText} (why it was rejected: ${reason})` : entry.tweetText;
    });
}

// ─── Learning signal storage ────────────────────────────────────────────────

const UNIQUE_SIGNAL_TYPES = new Set<LearningSignal['signalType']>([
  'approved_without_edit',
  'edited_before_queue',
  'edited_before_post',
  'reply_generated',
  'reply_rejected',
  'reply_posted',
  'tweet_liked',
  'tweet_like_failed',
  'deleted_from_x',
  'deleted_from_queue',
  'x_post_rejected',
  'x_post_succeeded',
]);

const MAX_OUTCOME_EVENTS = 500;
const MAX_IDEA_ATOMS = 120;
const MAX_CRITIC_VERDICTS = 250;

function compactMetadata(metadata: OutcomeEvent['metadata'] | undefined): OutcomeEvent['metadata'] | undefined {
  if (!metadata) return undefined;
  const compact: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 40)) {
    if (value === null || typeof value === 'boolean') {
      compact[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      compact[key] = Number(value.toFixed(4));
    } else if (typeof value === 'string') {
      compact[key] = value.slice(0, 500);
    }
  }
  return compact;
}

export async function addOutcomeEvent(
  agentId: string,
  event: Omit<OutcomeEvent, 'id' | 'agentId' | 'createdAt'> & { createdAt?: string }
): Promise<OutcomeEvent> {
  const createdAt = event.createdAt || new Date().toISOString();
  const idempotencyKey = event.idempotencyKey || `${event.eventType}:${event.tweetId || event.xTweetId || crypto.randomUUID()}`;
  const existing = await getOutcomeEvents(agentId, MAX_OUTCOME_EVENTS);
  const duplicate = existing.find((item) => item.idempotencyKey === idempotencyKey);
  if (duplicate) return duplicate;

  const counter = await kvIncr(KEYS.counterOutcomeEvent());
  const full: OutcomeEvent = {
    id: String(counter),
    agentId,
    createdAt,
    ...event,
    idempotencyKey,
    metadata: compactMetadata(event.metadata),
  };
  await kvSet(KEYS.agentOutcomeEvents(agentId), [full, ...existing].slice(0, MAX_OUTCOME_EVENTS));
  return full;
}

export async function getOutcomeEvents(agentId: string, limit = 100): Promise<OutcomeEvent[]> {
  const data = await kvGet<OutcomeEvent[]>(KEYS.agentOutcomeEvents(agentId));
  return (data ?? []).slice(0, limit);
}

function normalizeIdeaClaim(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '')
    .trim()
    .slice(0, 180);
}

function extractIdeaClaim(tweet: Tweet): string | null {
  const thesis = normalizeIdeaClaim(tweet.thesis || '');
  if (thesis.length >= 12) return thesis;
  const firstLine = normalizeIdeaClaim(tweet.content.split('\n').find((line) => line.trim()) || tweet.content);
  if (firstLine.length < 12) return null;
  return firstLine;
}

function blendIdeaAtomReward(current: number, next: number, observations: number): number {
  const weight = Math.max(0, Math.min(1000, Math.floor(observations)));
  const blended = ((current * weight) + next) / (weight + 1);
  return Number(Math.max(-1, Math.min(1, blended)).toFixed(3));
}

async function recordIdeaAtomFromTweet(
  tweet: Tweet,
  counts: {
    generatedDelta?: number;
    queuedDelta?: number;
    postedDelta?: number;
    rejectedDelta?: number;
    riskNote?: string | null;
  } = {}
): Promise<void> {
  const claim = extractIdeaClaim(tweet);
  if (!claim) return;
  const existing = await getIdeaAtoms(tweet.agentId, MAX_IDEA_ATOMS);
  const normalizedClaim = claim.toLowerCase();
  const now = new Date().toISOString();
  const found = existing.find((atom) => atom.claim.toLowerCase() === normalizedClaim);
  const generatedDelta = Math.max(0, counts.generatedDelta || 0);
  const queuedDelta = Math.max(0, counts.queuedDelta || 0);
  const postedDelta = Math.max(0, counts.postedDelta || 0);
  const rejectedDelta = Math.max(0, counts.rejectedDelta || 0);
  const riskNote = counts.riskNote?.trim() || null;
  const next = found
    ? {
        ...found,
        riskNote: riskNote || found.riskNote,
        topic: found.topic || tweet.topic,
        audience: found.audience || tweet.targetAudienceSegment || null,
        sourceTweetId: generatedDelta > 0 ? tweet.id : found.sourceTweetId || tweet.id,
        lastUsedAt: generatedDelta > 0 || queuedDelta > 0 || postedDelta > 0 || rejectedDelta > 0 ? now : found.lastUsedAt,
        performance: {
          ...found.performance,
          generated: found.performance.generated + generatedDelta,
          queued: found.performance.queued + queuedDelta,
          posted: found.performance.posted + postedDelta,
          rejected: found.performance.rejected + rejectedDelta,
        },
        updatedAt: now,
      }
    : {
        id: String(await kvIncr(KEYS.counterIdeaAtom())),
        agentId: tweet.agentId,
        claim,
        tension: tweet.rationale?.slice(0, 240) || null,
        audience: tweet.targetAudienceSegment || null,
        proof: tweet.mediaBrief?.slice(0, 240) || null,
        example: tweet.content.slice(0, 280),
        riskNote: riskNote || (tweet.policyRiskScore && tweet.policyRiskScore > 0.28 ? `Policy risk ${tweet.policyRiskScore}` : null),
        topic: tweet.topic,
        sourceTweetId: tweet.id,
        lastUsedAt: now,
        performance: {
          generated: Math.max(1, generatedDelta),
          queued: queuedDelta,
          posted: postedDelta,
          rejected: rejectedDelta,
          avgReward: 0,
        },
        createdAt: now,
        updatedAt: now,
      } satisfies IdeaAtom;
  const rest = existing.filter((atom) => atom.id !== next.id);
  await kvSet(KEYS.agentIdeaAtoms(tweet.agentId), [next, ...rest].slice(0, MAX_IDEA_ATOMS));
}

export async function markIdeaAtomRejectedForTweet(tweet: Tweet, reason?: string | null): Promise<void> {
  const claim = extractIdeaClaim(tweet);
  if (!claim) return;
  const existing = await getIdeaAtoms(tweet.agentId, MAX_IDEA_ATOMS);
  const found = existing.find((atom) => atom.claim.toLowerCase() === claim.toLowerCase());
  const trimmedReason = reason?.trim();
  await recordIdeaAtomFromTweet(tweet, {
    generatedDelta: found ? 0 : 1,
    queuedDelta: !found && tweet.status === 'queued' ? 1 : 0,
    postedDelta: !found && tweet.status === 'posted' ? 1 : 0,
    rejectedDelta: 1,
    riskNote: trimmedReason ? `Rejected: ${trimmedReason.slice(0, 170)}` : null,
  });
}

async function updateIdeaAtomOutcomeFromTweet(
  tweet: Tweet,
  outcome: { rewardDelta?: number | null; rejectedDelta?: number; postedDelta?: number; riskNote?: string | null }
): Promise<void> {
  const claim = extractIdeaClaim(tweet);
  if (!claim) return;

  await recordIdeaAtomFromTweet(tweet);

  const existing = await getIdeaAtoms(tweet.agentId, MAX_IDEA_ATOMS);
  const normalizedClaim = claim.toLowerCase();
  const found = existing.find((atom) => atom.claim.toLowerCase() === normalizedClaim);
  if (!found) return;

  const rejectedDelta = Math.max(0, outcome.rejectedDelta || 0);
  const rewardDelta = typeof outcome.rewardDelta === 'number' && Number.isFinite(outcome.rewardDelta)
    ? Math.max(-1, Math.min(1, outcome.rewardDelta))
    : null;
  const observations = found.performance.generated + found.performance.queued + found.performance.posted + found.performance.rejected;
  const next: IdeaAtom = {
    ...found,
    riskNote: outcome.riskNote || found.riskNote,
    lastUsedAt: new Date().toISOString(),
    performance: {
      ...found.performance,
      posted: found.performance.posted + Math.max(0, outcome.postedDelta || 0),
      rejected: found.performance.rejected + rejectedDelta,
      avgReward: rewardDelta === null
        ? found.performance.avgReward
        : blendIdeaAtomReward(found.performance.avgReward || 0, rewardDelta, observations),
    },
    updatedAt: new Date().toISOString(),
  };
  const rest = existing.filter((atom) => atom.id !== next.id);
  await kvSet(KEYS.agentIdeaAtoms(tweet.agentId), [next, ...rest].slice(0, MAX_IDEA_ATOMS));
}

export async function getIdeaAtoms(agentId: string, limit = 40): Promise<IdeaAtom[]> {
  const data = await kvGet<IdeaAtom[]>(KEYS.agentIdeaAtoms(agentId));
  return (data ?? []).slice(0, limit);
}

function buildCriticVerdict(tweet: Tweet): CriticVerdict {
  const assessment = assessTasteRisk(tweet.content, {
    surface: tweet.type === 'reply' ? 'reply' : 'post',
    policyRiskScore: tweet.policyRiskScore,
    creativeRiskScore: tweet.creativeRiskScore,
    slopScore: tweet.slopScore,
    voiceScore: tweet.voiceScore,
    highValueScore: tweet.replyBaitScore,
  });
  const lower = tweet.content.toLowerCase();
  const genericness = Math.min(1, (tweet.slopScore ?? 0.18) + (/(game changer|unlock|future of|paradigm shift)/i.test(tweet.content) ? 0.25 : 0));
  const overclaiming = /\b(always|never|guaranteed|nobody|everyone)\b/i.test(tweet.content) ? 0.65 : Math.min(1, (tweet.policyRiskScore ?? 0.1) + 0.1);
  const cringe = /(10x|hustle|gm\b|wagmi|based|alpha)/i.test(lower) ? 0.48 : Math.min(1, (tweet.creativeRiskScore ?? 0.18) * 0.6);
  const voiceDrift = Math.max(0, 1 - (tweet.voiceScore ?? 0.72));
  const factualRisk = Math.min(1, (tweet.criticScores?.factualRisk ?? tweet.policyRiskScore ?? 0.12));
  const engagementBait = Math.min(1, (tweet.replyBaitScore ?? 0.1) + (/(agree\?|thoughts\?|what am i missing)/i.test(tweet.content) ? 0.25 : 0));
  const replySuitability = tweet.type === 'reply' ? Math.min(1, tweet.replyBaitScore ?? 0.55) : Math.min(1, tweet.replyBaitScore ?? 0.25);
  const score = Number(Math.max(
    assessment.score,
    genericness * 0.55,
    overclaiming * 0.55,
    cringe * 0.5,
    voiceDrift * 0.7,
    factualRisk * 0.65,
    engagementBait * 0.35,
  ).toFixed(3));
  const action = assessment.action === 'block' || score >= 0.68 ? 'block' : assessment.action === 'review' || score >= 0.48 ? 'review' : 'allow';
  return {
    id: `${tweet.agentId}:${tweet.id}`,
    agentId: tweet.agentId,
    tweetId: tweet.id,
    action,
    score,
    reasons: assessment.reasons.length > 0 ? assessment.reasons : action === 'allow' ? ['cleared deterministic critic'] : ['critic risk threshold exceeded'],
    genericness: Number(genericness.toFixed(3)),
    overclaiming: Number(overclaiming.toFixed(3)),
    cringe: Number(cringe.toFixed(3)),
    voiceDrift: Number(voiceDrift.toFixed(3)),
    factualRisk: Number(factualRisk.toFixed(3)),
    engagementBait: Number(engagementBait.toFixed(3)),
    replySuitability: Number(replySuitability.toFixed(3)),
    createdAt: new Date().toISOString(),
  };
}

export async function addCriticVerdictForTweet(tweet: Tweet): Promise<CriticVerdict> {
  const verdict = buildCriticVerdict(tweet);
  const existing = await getCriticVerdicts(tweet.agentId, MAX_CRITIC_VERDICTS);
  const rest = existing.filter((item) => item.tweetId !== tweet.id);
  await kvSet(KEYS.agentCriticVerdicts(tweet.agentId), [verdict, ...rest].slice(0, MAX_CRITIC_VERDICTS));
  return verdict;
}

export async function getCriticVerdicts(agentId: string, limit = 100): Promise<CriticVerdict[]> {
  const data = await kvGet<CriticVerdict[]>(KEYS.agentCriticVerdicts(agentId));
  return (data ?? []).slice(0, limit);
}

export async function getMetricAvailability(agentId: string): Promise<MetricAvailability[]> {
  const data = await kvGet<MetricAvailability[]>(KEYS.agentMetricAvailability(agentId));
  return data ?? [];
}

export async function saveMetricAvailability(agentId: string, availability: MetricAvailability[]): Promise<MetricAvailability[]> {
  await kvSet(KEYS.agentMetricAvailability(agentId), availability);
  return availability;
}

function normalizeRelationshipHandle(handle: string | null | undefined): string | null {
  const normalized = normalizeUsername(handle || '');
  return normalized || null;
}

export async function upsertRelationshipProfile(
  agentId: string,
  input: {
    handle: string;
    displayName?: string | null;
    mentionId?: string | null;
    topic?: string | null;
    outcome?: RelationshipProfile['lastOutcome'];
    replied?: boolean;
    rejected?: boolean;
    cooldownMins?: number;
    doNotReply?: boolean;
  }
): Promise<RelationshipProfile | null> {
  const handle = normalizeRelationshipHandle(input.handle);
  if (!handle) return null;
  const profiles = await getRelationshipProfiles(agentId, 250);
  const existing = profiles.find((profile) => profile.handle.toLowerCase() === handle.toLowerCase());
  const now = new Date().toISOString();
  const topics = [...new Set([
    ...(existing?.topics || []),
    ...(input.topic ? [input.topic.slice(0, 80)] : []),
  ])].slice(-8);
  const interactions = (existing?.interactions || 0) + 1;
  const repliesSent = (existing?.repliesSent || 0) + (input.replied ? 1 : 0);
  const repliesRejected = (existing?.repliesRejected || 0) + (input.rejected ? 1 : 0);
  const relationshipScore = Math.max(0, Math.min(1,
    (existing?.relationshipScore ?? 0.2)
    + (input.replied ? 0.08 : 0.02)
    - (input.rejected ? 0.06 : 0)
    + Math.min(0.2, interactions * 0.01)
  ));
  const cooldownUntil = input.cooldownMins
    ? new Date(Date.now() + input.cooldownMins * 60 * 1000).toISOString()
    : existing?.cooldownUntil || null;
  const profile: RelationshipProfile = {
    handle,
    agentId,
    displayName: input.displayName ?? existing?.displayName ?? null,
    lastMentionId: input.mentionId ?? existing?.lastMentionId ?? null,
    lastInteractionAt: now,
    topics,
    relationshipScore: Number(relationshipScore.toFixed(3)),
    interactions,
    repliesSent,
    repliesRejected,
    cooldownUntil,
    doNotReply: input.doNotReply ?? existing?.doNotReply ?? false,
    lastOutcome: input.outcome ?? existing?.lastOutcome ?? null,
    updatedAt: now,
  };
  const rest = profiles.filter((item) => item.handle.toLowerCase() !== handle.toLowerCase());
  await kvSet(KEYS.agentRelationshipProfiles(agentId), [profile, ...rest].slice(0, 250));
  return profile;
}

export async function getRelationshipProfiles(agentId: string, limit = 100): Promise<RelationshipProfile[]> {
  const data = await kvGet<RelationshipProfile[]>(KEYS.agentRelationshipProfiles(agentId));
  return (data ?? []).slice(0, limit);
}

export async function addLearningSignal(
  agentId: string,
  signal: Omit<LearningSignal, 'id' | 'agentId' | 'createdAt'> & { createdAt?: string }
): Promise<LearningSignal> {
  const createdAt = signal.createdAt || new Date().toISOString();
  const full: LearningSignal = {
    id: `${agentId}:${signal.signalType}:${signal.tweetId || signal.xTweetId || crypto.randomUUID()}`,
    agentId,
    createdAt,
    ...signal,
  };

  const existing = await getLearningSignals(agentId, 250);
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const pruned = existing.filter((entry) => new Date(entry.createdAt).getTime() > ninetyDaysAgo);
  const deduped = UNIQUE_SIGNAL_TYPES.has(full.signalType) && full.tweetId
    ? pruned.filter((entry) => !(entry.signalType === full.signalType && entry.tweetId === full.tweetId))
    : pruned;

  deduped.unshift(full);
  const capped = deduped.slice(0, 250);
  await kvSet(KEYS.agentSignals(agentId), capped);
  await updateDraftExperimentFromSignal(agentId, full);
  if (full.tweetId) {
    const tweet = await getTweet(String(full.tweetId));
    if (tweet) {
      const rejectedDelta = (
        full.signalType === 'deleted_from_queue'
        || full.signalType === 'deleted_from_x'
        || full.signalType === 'x_post_rejected'
        || full.signalType === 'reply_rejected'
        || full.signalType === 'taste_less_like_this'
      ) ? 1 : 0;
      await updateIdeaAtomOutcomeFromTweet(tweet, {
        rewardDelta: full.rewardDelta,
        rejectedDelta,
        postedDelta: full.signalType === 'x_post_succeeded' && tweet.status !== 'posted' ? 1 : 0,
        riskNote: rejectedDelta > 0 ? full.reason || 'Rejected by operator signal' : null,
      }).catch(() => null);
    }
  }
  await addOutcomeEvent(agentId, {
    eventType: full.signalType,
    source: 'learning_signal',
    tweetId: full.tweetId,
    xTweetId: full.xTweetId,
    rewardDelta: full.rewardDelta,
    reason: full.reason,
    metadata: full.metadata,
    idempotencyKey: `learning:${full.id}`,
    createdAt: full.createdAt,
  }).catch(() => null);
  return full;
}

export async function getLearningSignals(agentId: string, limit = 200): Promise<LearningSignal[]> {
  const data = await kvGet<LearningSignal[]>(KEYS.agentSignals(agentId));
  return (data ?? []).slice(0, limit);
}

// ─── Conversation history ────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'them' | 'us';
  author: string;
  content: string;
  tweetId: string;
}

const CONVERSATION_REPLY_FORMATS = new Set([
  'auto_reply',
  'auto_reply_high_value',
]);

export async function getConversationHistory(
  agentId: string,
  conversationId: string,
  maxTurns = 5,
): Promise<ConversationTurn[]> {
  if (!conversationId) return [];

  // Recent conversation context is enough for reply generation and avoids
  // scanning very large historical mention archives on busy accounts.
  const mentions = await getRecentMentions(agentId, 1000);

  // Filter to same conversation
  const inConvo = mentions.filter(
    (m) => m.conversationId && String(m.conversationId) === String(conversationId)
  );

  // Get our replies from the post log
  const postLog = await getPostLog(agentId, 100);
  const ourReplies = postLog.filter(
    (e) => (e.action === 'posted' || e.action === 'replied' || !e.action) && CONVERSATION_REPLY_FORMATS.has(e.format) && e.content
  );

  // Build conversation turns sorted by time
  const turns: Array<ConversationTurn & { ts: number }> = [];

  for (const m of inConvo) {
    turns.push({
      role: 'them',
      author: m.authorHandle,
      content: m.content,
      tweetId: String(m.tweetId || ''),
      ts: new Date(m.createdAt).getTime(),
    });
  }

  // Match our replies to mentions in this conversation
  const inConvoByTweetId = new Map(
    inConvo
      .map((mention) => [String(mention.tweetId || ''), mention] as const)
      .filter(([tweetId]) => tweetId.length > 0)
  );
  for (const reply of ourReplies) {
    const replyTargetId = String(reply.tweetId || '');
    const matchedMention = replyTargetId
      ? inConvoByTweetId.get(replyTargetId)
      : inConvo.find((m) => reply.topic?.includes(String(m.authorHandle)) && reply.xTweetId);
    if (matchedMention) {
      turns.push({
        role: 'us',
        author: 'agent',
        content: reply.content,
        tweetId: reply.xTweetId || '',
        ts: new Date(reply.postedAt).getTime(),
      });
    }
  }

  // Sort by time, take last N turns
  turns.sort((a, b) => a.ts - b.ts);
  return turns.slice(-maxTurns).map(({ role, author, content, tweetId }) => ({ role, author, content, tweetId }));
}

// ─── Soul backup storage ────────────────────────────────────────────────────

export async function saveSoulBackup(agentId: string, soulMd: string): Promise<void> {
  await kvSet(KEYS.agentSoulBackup(agentId), soulMd);
}

// ─── Soul version stack ─────────────────────────────────────────────────────

export async function pushSoulVersion(agentId: string, soulMd: string, reason: string): Promise<void> {
  const versions = await getSoulVersions(agentId);
  const nextVersion = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;
  const entry: SoulVersion = { version: nextVersion, soulMd, updatedAt: new Date().toISOString(), reason };
  await kvLpush(KEYS.agentSoulVersions(agentId), JSON.stringify(entry));
  // Trim to last 10 versions
  const current = await kvLrange(KEYS.agentSoulVersions(agentId), 0, -1);
  if (current.length > 10) {
    // Remove oldest entries beyond 10
    for (let i = 10; i < current.length; i++) {
      await kvLrem(KEYS.agentSoulVersions(agentId), -1, current[i] as string);
    }
  }
}

export async function getSoulVersions(agentId: string): Promise<SoulVersion[]> {
  const raw = await kvLrange(KEYS.agentSoulVersions(agentId), 0, 9);
  return raw.map((s) => parseListEntry<SoulVersion>(s)).filter((e): e is SoulVersion => e !== null);
}

// ─── Funnel event storage ───────────────────────────────────────────────────

export async function logFunnelEvent(agentId: string, event: string, meta?: Record<string, unknown>): Promise<void> {
  const entry: FunnelEvent = { event, ts: new Date().toISOString(), meta };
  await kvLpush(KEYS.agentEvents(agentId), JSON.stringify(entry));
}

export async function getFunnelEvents(agentId: string, limit = 100): Promise<FunnelEvent[]> {
  const raw = await kvLrange(KEYS.agentEvents(agentId), 0, limit - 1);
  return raw.map((s) => parseListEntry<FunnelEvent>(s)).filter((e): e is FunnelEvent => e !== null);
}

/** Milestone names in funnel order. */
const FUNNEL_MILESTONES = ['wizard_start', 'wizard_soul_complete', 'preview_approve', 'first_post', 'tenth_post'] as const;

export interface FunnelSummary {
  milestones: Array<{ event: string; reached: boolean; ts: string | null }>;
  currentStage: string;
  completionPct: number;
}

export function computeFunnelSummary(events: FunnelEvent[]): FunnelSummary {
  const eventMap = new Map<string, string>(); // event -> earliest ts
  for (const e of events) {
    if (!eventMap.has(e.event)) {
      eventMap.set(e.event, e.ts);
    }
  }

  const milestones = FUNNEL_MILESTONES.map((event) => ({
    event,
    reached: eventMap.has(event),
    ts: eventMap.get(event) ?? null,
  }));

  // Current stage = last reached milestone, or 'not_started'
  let currentStage = 'not_started';
  let reached = 0;
  for (const m of milestones) {
    if (m.reached) {
      currentStage = m.event;
      reached++;
    }
  }

  return {
    milestones,
    currentStage,
    completionPct: Math.round((reached / FUNNEL_MILESTONES.length) * 100),
  };
}

// ─── Voice coaching chat + directives ────────────────────────────────────

export async function addVoiceChatMessage(agentId: string, message: VoiceDirective): Promise<void> {
  await kvLpush(KEYS.agentVoiceChat(agentId), JSON.stringify(message));
}

export async function getVoiceChat(agentId: string, limit = 50): Promise<VoiceDirective[]> {
  const raw = await kvLrange(KEYS.agentVoiceChat(agentId), 0, limit - 1);
  return raw.map((s) => parseListEntry<VoiceDirective>(s)).filter((e): e is VoiceDirective => e !== null).reverse();
}

async function saveVoiceDirectiveRules(agentId: string, rules: VoiceDirectiveRule[]): Promise<void> {
  await kvSet(KEYS.agentVoiceDirectiveRules(agentId), rules.slice(0, 50));
}

async function migrateLegacyVoiceDirectiveRules(agentId: string): Promise<VoiceDirectiveRule[]> {
  const raw = await kvLrange(KEYS.agentVoiceDirectives(agentId), 0, 19);
  const directives = raw
    .map((entry) => typeof entry === 'string' ? entry : String(entry))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (directives.length === 0) return [];

  const baseTime = Date.now() - (directives.length * 1000);
  const chronological = directives.reverse();
  let migratedRules: VoiceDirectiveRule[] = [];
  for (const [index, directive] of chronological.entries()) {
    const compiled = buildVoiceDirectiveRule(directive, {
      createdAt: new Date(baseTime + (index * 1000)).toISOString(),
      sourceMessage: 'Legacy directive import',
    });
    migratedRules = mergeVoiceDirectiveRule(migratedRules, compiled);
  }

  await saveVoiceDirectiveRules(agentId, migratedRules);
  return migratedRules;
}

export async function getVoiceDirectiveRules(agentId: string): Promise<VoiceDirectiveRule[]> {
  const stored = await kvGet<VoiceDirectiveRule[]>(KEYS.agentVoiceDirectiveRules(agentId));
  if (stored && stored.length > 0) {
    return stored
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  return migrateLegacyVoiceDirectiveRules(agentId);
}

/** Standing directives extracted from operator coaching. Fed into every generation. */
export async function addVoiceDirective(
  agentId: string,
  directive: string,
  options: { sourceMessage?: string | null; createdAt?: string } = {},
): Promise<VoiceDirectiveRule> {
  const existing = await getVoiceDirectiveRules(agentId);
  const compiled = buildVoiceDirectiveRule(directive, options);
  const merged = mergeVoiceDirectiveRule(existing, compiled);
  await saveVoiceDirectiveRules(agentId, merged);
  return merged.find((rule) => rule.id === compiled.id) || compiled;
}

export async function getVoiceDirectives(agentId: string): Promise<string[]> {
  const rules = await getVoiceDirectiveRules(agentId);
  return getActiveVoiceDirectiveRules(rules)
    .slice(0, 20)
    .map((rule) => rule.rawDirective);
}

// ─── Remix memory ───────────────────────────────────────────────────────────

export interface RemixEntry {
  direction: string;       // 'shorter' | 'spicier' | 'custom' etc
  customPrompt?: string;   // the actual instruction if custom
  originalContent: string;
  remixedContent: string;
  ts: string;
}

export async function addRemixEntry(agentId: string, entry: RemixEntry): Promise<void> {
  await kvLpush(KEYS.agentRemixMemory(agentId), JSON.stringify(entry));
}

export async function getRemixMemory(agentId: string, limit = 30): Promise<RemixEntry[]> {
  const raw = await kvLrange(KEYS.agentRemixMemory(agentId), 0, limit - 1);
  return raw.map((s) => parseListEntry<RemixEntry>(s)).filter((e): e is RemixEntry => e !== null);
}

/**
 * Analyze remix patterns: if the operator consistently uses the same direction
 * or similar custom prompts, extract them as standing rules.
 */
export async function getRemixPatterns(agentId: string): Promise<string[]> {
  const entries = await getRemixMemory(agentId, 30);
  if (entries.length < 3) return [];

  // Count direction frequency
  const dirCounts: Record<string, number> = {};
  const customPrompts: string[] = [];
  for (const e of entries) {
    dirCounts[e.direction] = (dirCounts[e.direction] || 0) + 1;
    if (e.customPrompt) customPrompts.push(e.customPrompt);
  }

  const patterns: string[] = [];

  // If a direction is used 3+ times, it's a standing preference
  for (const [dir, count] of Object.entries(dirCounts)) {
    if (count >= 3 && dir !== 'custom') {
      const labels: Record<string, string> = {
        shorter: 'Keep tweets short and punchy (under 200 chars)',
        longer: 'Prefer longer, detailed posts with analysis',
        spicier: 'Be more provocative and attention-grabbing',
        softer: 'Keep tone thoughtful and nuanced',
        funnier: 'Add more wit and humor',
        data: 'Include data, numbers, and concrete evidence',
        question: 'Frame more tweets as questions',
        contrarian: 'Take more contrarian angles',
      };
      if (labels[dir]) patterns.push(`Operator preference (${count}x): ${labels[dir]}`);
    }
  }

  // Extract REPEATED custom prompts (3+ similar uses = standing pattern, not one-offs)
  if (customPrompts.length >= 3) {
    // Group similar prompts by first 30 chars (catches "make it shorter" variants)
    const promptGroups: Record<string, string[]> = {};
    for (const p of customPrompts) {
      const key = p.slice(0, 30).toLowerCase();
      if (!promptGroups[key]) promptGroups[key] = [];
      promptGroups[key].push(p);
    }
    for (const [, group] of Object.entries(promptGroups)) {
      if (group.length >= 2) {
        patterns.push(`Operator custom direction (${group.length}x): "${group[0]}"`);
      }
    }
  }

  return patterns;
}

// ─── Follower tracking ──────────────────────────────────────────────────────

export interface FollowerSnapshot {
  count: number;
  ts: string;
}

export async function addFollowerSnapshot(agentId: string, count: number): Promise<void> {
  const entry: FollowerSnapshot = { count, ts: new Date().toISOString() };
  await kvLpush(KEYS.agentFollowerHistory(agentId), JSON.stringify(entry));
}

export async function getFollowerHistory(agentId: string, limit = 30): Promise<FollowerSnapshot[]> {
  const raw = await kvLrange(KEYS.agentFollowerHistory(agentId), 0, limit - 1);
  return raw.map((s) => parseListEntry<FollowerSnapshot>(s)).filter((e): e is FollowerSnapshot => e !== null);
}

// ─── Trending cache ─────────────────────────────────────────────────────────

interface TrendingCacheEntry {
  data: unknown;
  cachedAt: string;
}

interface BrowserPairingChallenge {
  challenge: string;
  ownerUserId: string;
  createdAt: string;
  expiresAt: string;
}

const TRENDING_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function getTrendingCache(agentId: string): Promise<unknown | null> {
  const entry = await kvGet<TrendingCacheEntry>(KEYS.agentTrendingCache(agentId));
  if (!entry) return null;
  const age = Date.now() - new Date(entry.cachedAt).getTime();
  if (age > TRENDING_CACHE_TTL_MS) return null; // expired
  return entry.data;
}

export async function setTrendingCache(agentId: string, data: unknown): Promise<void> {
  await kvSet(KEYS.agentTrendingCache(agentId), { data, cachedAt: new Date().toISOString() });
}

// ─── Engagement sessions ────────────────────────────────────────────────────

function normalizeEngagementSession(session: EngagementSession): EngagementSession {
  return {
    ...session,
    id: String(session.id),
    machineLabel: session.machineLabel ?? null,
    approvedAt: session.approvedAt ?? null,
    startedAt: session.startedAt ?? null,
    completedAt: session.completedAt ?? null,
    abortedAt: session.abortedAt ?? null,
    lastError: session.lastError ?? null,
    actions: Array.isArray(session.actions)
      ? session.actions.map((action) => ({
          ...action,
          id: String(action.id),
          draft: action.draft ? {
            ...action.draft,
            tweetId: String(action.draft.tweetId),
            updatedAt: action.draft.updatedAt,
          } : null,
          resultTweetId: action.resultTweetId ? String(action.resultTweetId) : null,
          resultTweetUrl: action.resultTweetUrl ?? null,
          proof: action.proof ? {
            ...action.proof,
            localPath: action.proof.localPath ?? null,
            note: action.proof.note ?? null,
          } : null,
          failureReason: action.failureReason ?? null,
          startedAt: action.startedAt ?? null,
          completedAt: action.completedAt ?? null,
          candidate: {
            ...action.candidate,
            id: String(action.candidate.id),
            agentId: String(action.candidate.agentId),
            tweetId: String(action.candidate.tweetId),
            tweetUrl: action.candidate.tweetUrl,
            authorId: action.candidate.authorId ? String(action.candidate.authorId) : null,
            authorName: action.candidate.authorName ?? null,
            topic: action.candidate.topic ?? null,
          },
        }))
      : [],
  };
}

export async function getEngagementSession(id: string): Promise<EngagementSession | null> {
  const session = await kvGet<EngagementSession>(KEYS.engagementSession(id));
  return session ? normalizeEngagementSession(session) : null;
}

export async function listEngagementSessions(agentId: string, limit = 10): Promise<EngagementSession[]> {
  const ids = await kvLrange(KEYS.agentEngagementSessions(agentId), 0, limit - 1);
  const sessions = await Promise.all(ids.map((id) => getEngagementSession(String(id))));
  return sessions
    .filter((session): session is EngagementSession => session !== null)
    .sort(compareNewestRecordFirst);
}

export async function getActiveEngagementSession(agentId: string): Promise<EngagementSession | null> {
  const sessions = await listEngagementSessions(agentId, 20);
  return sessions.find((session) => ['draft', 'approved', 'running'].includes(session.state)) ?? null;
}

export async function getDraftEngagementSession(agentId: string): Promise<EngagementSession | null> {
  const sessions = await listEngagementSessions(agentId, 20);
  return sessions.find((session) => session.state === 'draft') ?? null;
}

export async function saveEngagementSession(session: EngagementSession): Promise<EngagementSession> {
  const normalized = normalizeEngagementSession({
    ...session,
    updatedAt: new Date().toISOString(),
  });
  await kvSet(KEYS.engagementSession(normalized.id), normalized);
  return normalized;
}

export async function createEngagementSession(session: Omit<EngagementSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<EngagementSession> {
  const counter = await kvIncr(KEYS.counterEngagementSession());
  const now = new Date().toISOString();
  const created = normalizeEngagementSession({
    ...session,
    id: `engage-${counter}`,
    createdAt: now,
    updatedAt: now,
  });
  await kvSet(KEYS.engagementSession(created.id), created);
  await kvLpush(KEYS.agentEngagementSessions(created.agentId), created.id);
  return created;
}

export async function updateEngagementSession(
  id: string,
  updates: Partial<Omit<EngagementSession, 'id' | 'agentId' | 'createdAt'>>
): Promise<EngagementSession> {
  const existing = await getEngagementSession(id);
  if (!existing) throw new Error(`Engagement session ${id} not found`);
  const updated = normalizeEngagementSession({
    ...existing,
    ...updates,
    id: existing.id,
    agentId: existing.agentId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  await kvSet(KEYS.engagementSession(id), updated);
  return updated;
}

// ─── Browser companion pairings ─────────────────────────────────────────────

function normalizeBrowserCompanionPairing(pairing: BrowserCompanionPairing): BrowserCompanionPairing {
  return {
    ...pairing,
    id: String(pairing.id),
    ownerUserId: String(pairing.ownerUserId),
    token: String(pairing.token),
    machineLabel: pairing.machineLabel,
    currentAgentId: pairing.currentAgentId ? String(pairing.currentAgentId) : null,
    currentAgentHandle: pairing.currentAgentHandle ?? null,
    lastHeartbeatAt: pairing.lastHeartbeatAt ?? null,
    expiresAt: pairing.expiresAt ?? null,
  };
}

export async function createBrowserCompanionPairingChallenge(ownerUserId: string, ttlMinutes = 10): Promise<BrowserPairingChallenge> {
  const challenge = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const record: BrowserPairingChallenge = {
    challenge,
    ownerUserId: String(ownerUserId),
    createdAt,
    expiresAt,
  };
  await kvSet(KEYS.browserPairingChallenge(challenge), record);
  return record;
}

export async function consumeBrowserCompanionPairingChallenge(challenge: string): Promise<BrowserPairingChallenge | null> {
  const record = await kvGet<BrowserPairingChallenge>(KEYS.browserPairingChallenge(challenge));
  if (!record) return null;
  await kvDel(KEYS.browserPairingChallenge(challenge));
  if (new Date(record.expiresAt).getTime() < Date.now()) return null;
  return record;
}

export async function getBrowserCompanionPairing(id: string): Promise<BrowserCompanionPairing | null> {
  const pairing = await kvGet<BrowserCompanionPairing>(KEYS.browserPairing(id));
  return pairing ? normalizeBrowserCompanionPairing(pairing) : null;
}

export async function getBrowserCompanionPairingByToken(token: string): Promise<BrowserCompanionPairing | null> {
  const pairingId = await kvGet<string>(KEYS.browserPairingByToken(token));
  if (!pairingId) return null;
  return getBrowserCompanionPairing(String(pairingId));
}

export async function listBrowserCompanionPairingsForUser(ownerUserId: string): Promise<BrowserCompanionPairing[]> {
  const ids = await kvSmembers(KEYS.userBrowserPairings(ownerUserId));
  const pairings = await Promise.all(ids.map((id) => getBrowserCompanionPairing(String(id))));
  return pairings
    .filter((pairing): pairing is BrowserCompanionPairing => pairing !== null)
    .sort(compareNewestRecordFirst);
}

export async function getLatestBrowserCompanionPairingForUser(ownerUserId: string): Promise<BrowserCompanionPairing | null> {
  const pairings = await listBrowserCompanionPairingsForUser(ownerUserId);
  return pairings[0] ?? null;
}

export async function createBrowserCompanionPairing(
  ownerUserId: string,
  machineLabel: string,
  ttlHours = 24 * 7
): Promise<BrowserCompanionPairing> {
  const counter = await kvIncr(KEYS.counterBrowserPairing());
  const id = `pair-${counter}`;
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const pairing = normalizeBrowserCompanionPairing({
    id,
    ownerUserId: String(ownerUserId),
    machineLabel,
    token,
    status: 'active',
    currentAgentId: null,
    currentAgentHandle: null,
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
  });
  await kvSet(KEYS.browserPairing(id), pairing);
  await kvSet(KEYS.browserPairingByToken(token), id);
  await kvSadd(KEYS.userBrowserPairings(ownerUserId), id);
  return pairing;
}

export async function updateBrowserCompanionPairing(
  id: string,
  updates: Partial<Omit<BrowserCompanionPairing, 'id' | 'ownerUserId' | 'createdAt' | 'token'>>
): Promise<BrowserCompanionPairing> {
  const existing = await getBrowserCompanionPairing(id);
  if (!existing) throw new Error(`Browser companion pairing ${id} not found`);
  const updated = normalizeBrowserCompanionPairing({
    ...existing,
    ...updates,
    id: existing.id,
    ownerUserId: existing.ownerUserId,
    createdAt: existing.createdAt,
    token: existing.token,
    updatedAt: new Date().toISOString(),
  });
  await kvSet(KEYS.browserPairing(id), updated);
  return updated;
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

export async function checkRateLimit(agentId: string, action: string, maxPerHour: number, windowMs = 60 * 60 * 1000): Promise<boolean> {
  const key = KEYS.agentRateLimit(agentId, action);
  const current = await kvGet<{ count: number; resetAt: string }>(key);
  const resetAtMs = current?.resetAt ? Date.parse(current.resetAt) : 0;
  const active = current && Number.isFinite(resetAtMs) && resetAtMs > Date.now();
  const count = active ? current.count : 0;
  if (count >= maxPerHour) return false;
  const resetAt = active && current?.resetAt
    ? current.resetAt
    : new Date(Date.now() + windowMs).toISOString();
  const ttlSeconds = Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000));
  await kvSet(key, { count: count + 1, resetAt }, { ex: ttlSeconds });
  return true;
}

export interface AutopilotLock {
  agentId: string;
  owner: string;
  purpose: 'cron' | 'manual' | 'autopilot';
  acquiredAt: string;
  expiresAt: string;
}

export async function acquireAutopilotLock(
  agentId: string,
  owner = `run:${crypto.randomUUID()}`,
  ttlSeconds = 8 * 60,
  purpose: AutopilotLock['purpose'] = 'autopilot',
): Promise<{ acquired: boolean; owner: string; lock: AutopilotLock | null }> {
  const now = Date.now();
  const lock: AutopilotLock = {
    agentId,
    owner,
    purpose,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
  };
  const acquired = await kvSet(KEYS.agentAutopilotLock(agentId), lock, { nx: true, ex: ttlSeconds });
  if (acquired) return { acquired: true, owner, lock };
  const existing = await kvGet<AutopilotLock>(KEYS.agentAutopilotLock(agentId));
  return { acquired: false, owner, lock: existing };
}

export async function releaseAutopilotLock(agentId: string, owner: string): Promise<boolean> {
  const key = KEYS.agentAutopilotLock(agentId);
  const existing = await kvGet<AutopilotLock>(key);
  if (!existing || existing.owner !== owner) return false;
  await kvDel(key);
  return true;
}

export async function getAutopilotLock(agentId: string): Promise<AutopilotLock | null> {
  return kvGet<AutopilotLock>(KEYS.agentAutopilotLock(agentId));
}
