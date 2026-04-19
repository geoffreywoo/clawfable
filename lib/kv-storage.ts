import type { Agent, Tweet, Mention, Metric, CreateAgentInput, UpdateAgentInput, CreateTweetInput, UpdateTweetInput, CreateMentionInput, MetricInput, AccountAnalysis, User, Session, ProtocolSettings, PostLogEntry, TweetJob, CreateTweetJobInput, UpdateTweetJobInput, TweetPerformance, AgentLearnings, WizardData, StyleSignals, FeedbackEntry, FunnelEvent, SoulVersion, VoiceDirective, LearningSignal, VoiceDirectiveRule } from './types';
import { normalizeUsername } from './internal-accounts';
import { buildVoiceDirectiveRule, getActiveVoiceDirectiveRules, mergeVoiceDirectiveRule } from './voice-directives';

// ─── In-memory fallback store ─────────────────────────────────────────────────
// Used when Vercel KV env vars are not set (local dev).
const memStore: Map<string, unknown> = new Map();

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

// kvDel can target any value type (string/hash/list/set), so it must clear
// every namespaced cache entry for that raw key. Otherwise a stale cached
// hash/list/set survives a delete and `getX` returns the old value.
function invalidateAllNamespaces(key: string): void {
  readCache.delete(key);
  readCache.delete(`hash:${key}`);
  readCache.delete(`list:${key}`);
  readCache.delete(`set:${key}`);
}

async function kvGet<T>(key: string): Promise<T | null> {
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

async function kvSet(key: string, value: unknown): Promise<void> {
  invalidateCached(key);
  try {
    const client = await getKvClient();
    if (!client) { memStore.set(key, value); return; }
    await client.set(key, value);
  } catch {
    memStore.set(key, value);
  }
}

async function kvDel(key: string): Promise<void> {
  invalidateAllNamespaces(key);
  try {
    const client = await getKvClient();
    if (!client) { memStore.delete(key); return; }
    await client.del(key);
  } catch {
    memStore.delete(key);
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

// ─── Key helpers ─────────────────────────────────────────────────────────────

const KEYS = {
  agentSet: () => 'agents',
  agent: (id: string) => `agent:${id}`,
  agentHandle: (handle: string) => `agent:handle:${handle}`,
  agentOwner: (id: string) => `agent:${id}:owner`,
  agentTweets: (id: string) => `agent:${id}:tweets`,
  agentQueue: (id: string) => `agent:${id}:queue`,
  agentMentions: (id: string) => `agent:${id}:mentions`,
  agentMetrics: (id: string) => `agent:${id}:metrics`,
  agentAnalysis: (id: string) => `agent:${id}:analysis`,
  oauthTemp: (oauthToken: string) => `oauth:${oauthToken}`,
  agentProtocol: (id: string) => `agent:${id}:protocol`,
  agentPostLog: (id: string) => `agent:${id}:postlog`,
  agentPerformance: (id: string) => `agent:${id}:performance`,
  agentLearnings: (id: string) => `agent:${id}:learnings`,
  agentTrendingCache: (id: string) => `agent:${id}:trending_cache`,
  agentSoulVersions: (id: string) => `agent:${id}:soul_versions`,
  agentFollowerHistory: (id: string) => `agent:${id}:followers`,
  agentRemixMemory: (id: string) => `agent:${id}:remix_memory`,
  agentVoiceChat: (id: string) => `agent:${id}:voice_chat`,
  agentVoiceDirectives: (id: string) => `agent:${id}:voice_directives`,
  agentVoiceDirectiveRules: (id: string) => `agent:${id}:voice_directive_rules`,
  agentSignals: (id: string) => `agent:${id}:signals`,
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
  agentWizard: (id: string) => `agent:${id}:wizard`,
  agentStyle: (id: string) => `agent:${id}:style`,
  agentFeedback: (id: string) => `agent:${id}:feedback`,
  agentEvents: (id: string) => `agent:${id}:events`,
  agentSoulBackup: (id: string) => `agent:${id}:soul_backup`,
  agentRateLimit: (id: string, action: string) => `ratelimit:${id}:${action}`,
  agentBaseline: (id: string) => `agent:${id}:baseline`,
};

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
  const id = await kvGet<string>(KEYS.agentHandle(handle));
  if (!id) return null;
  return getAgent(id);
}

export async function createAgent(data: Omit<CreateAgentInput, 'id'>): Promise<Agent> {
  const counter = await kvIncr(KEYS.counterAgent());
  const id = String(counter);
  const agent: Agent = {
    id,
    handle: data.handle,
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
  await kvSet(KEYS.agentHandle(agent.handle), id);
  return agent;
}

export async function updateAgent(id: string, data: UpdateAgentInput): Promise<Agent> {
  const existing = await getAgent(id);
  if (!existing) throw new Error(`Agent ${id} not found`);

  // If handle changed, update handle index
  if (data.handle && data.handle !== existing.handle) {
    await kvDel(KEYS.agentHandle(existing.handle));
    await kvSet(KEYS.agentHandle(data.handle), id);
  }

  const updated = { ...existing, ...data };
  await kvHset(KEYS.agent(id), updated as unknown as Record<string, unknown>);
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

  // Cascade: delete protocol, post log, learnings, performance, baseline, jobs
  await kvDel(KEYS.agentProtocol(id));
  await kvDel(KEYS.agentPostLog(id));
  await kvDel(KEYS.agentLearnings(id));
  await kvDel(KEYS.agentPerformance(id));
  await kvDel(KEYS.agentBaseline(id));
  // Delete jobs
  const jobIds = await kvLrange(KEYS.agentJobs(id), 0, -1);
  await Promise.all(jobIds.map((jid) => kvDel(`job:${jid}`)));
  await kvDel(KEYS.agentJobs(id));

  // Remove agent
  await kvDel(KEYS.agent(id));
  await kvSrem(KEYS.agentSet(), id);
  await kvDel(KEYS.agentHandle(agent.handle));
  await kvDel(KEYS.agentOwner(id));
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
  const tweets = await Promise.all(ids.map((id) => kvHgetall<Tweet>(KEYS.tweet(String(id)))));
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
  const tweets = await Promise.all(ids.map((id) => kvHgetall<Tweet>(KEYS.tweet(String(id)))));
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
    quarantineReason: data.quarantineReason ?? null,
    quarantinedAt: data.quarantinedAt ?? null,
    createdAt: new Date().toISOString(),
  };
  await kvHset(KEYS.tweet(id), serializeTweetRecord(tweet));
  await kvLpush(KEYS.agentTweets(data.agentId), id);
  if (tweet.status === 'queued') {
    await kvLpush(KEYS.agentQueue(data.agentId), id);
  }
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

export async function getMentions(agentId: string): Promise<Mention[]> {
  const ids = await kvLrange(KEYS.agentMentions(agentId), 0, -1);
  const mentions = await Promise.all(ids.map((id) => kvHgetall<Mention>(KEYS.mention(String(id)))));
  return mentions
    .filter((m): m is Mention => m !== null)
    .map((m) => normalizeId({ ...m, id: String(m.id), tweetId: m.tweetId != null ? String(m.tweetId) : null, author: String(m.author || ''), authorHandle: String(m.authorHandle || '') }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getMentionCount(agentId: string): Promise<number> {
  return kvLlen(KEYS.agentMentions(agentId));
}

export async function createMention(data: CreateMentionInput): Promise<Mention> {
  const counter = await kvIncr(KEYS.counterMention());
  const id = String(counter);
  const mention: Mention = {
    id,
    agentId: data.agentId,
    author: data.author,
    authorHandle: data.authorHandle,
    content: data.content,
    tweetId: data.tweetId ?? null,
    conversationId: data.conversationId ?? null,
    inReplyToTweetId: data.inReplyToTweetId ?? null,
    engagementLikes: data.engagementLikes ?? 0,
    engagementRetweets: data.engagementRetweets ?? 0,
    createdAt: data.createdAt || new Date().toISOString(),
  };
  await kvHset(KEYS.mention(id), mention as unknown as Record<string, unknown>);
  await kvLpush(KEYS.agentMentions(data.agentId), id);
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
  maxRepliesPerRun: 3,
  replyIntervalMins: 30,
  lastPostedAt: null,
  lastRepliedAt: null,
  totalAutoPosted: 0,
  totalAutoReplied: 0,
  lengthMix: { short: 30, medium: 30, long: 40 },
  autonomyMode: 'balanced',
  explorationRate: 35,
  enabledFormats: [],  // empty = all formats
  qtRatio: 60,
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
  return stored ? { ...DEFAULT_PROTOCOL, ...stored } : { ...DEFAULT_PROTOCOL };
}

export async function updateProtocolSettings(agentId: string, updates: Partial<ProtocolSettings>): Promise<ProtocolSettings> {
  const current = await getProtocolSettings(agentId);
  const merged = { ...current, ...updates };
  await kvSet(KEYS.agentProtocol(agentId), merged);
  return merged;
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
  autopilotProcessed: number;
  results: Array<{ agentId: string; action: string; reason: string; content?: string; repliesSent?: number }>;
}

export async function addCronLogEntry(entry: Omit<CronLogEntry, 'id'>): Promise<void> {
  const id = `cron:${Date.now()}`;
  await kvLpush(KEYS.cronLog(), JSON.stringify({ ...entry, id }));
}

export async function getCronLog(limit = 30): Promise<CronLogEntry[]> {
  const raw = await kvLrange(KEYS.cronLog(), 0, limit - 1);
  return raw.map((s) => parseListEntry<CronLogEntry>(s)).filter((e): e is CronLogEntry => e !== null);
}

// ─── Performance tracking storage ─────────────────────────────────────────────

export async function addPerformanceEntry(agentId: string, entry: TweetPerformance): Promise<void> {
  await kvLpush(KEYS.agentPerformance(agentId), JSON.stringify(entry));
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
  'deleted_from_x',
  'deleted_from_queue',
  'x_post_rejected',
  'x_post_succeeded',
]);

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

export async function getConversationHistory(
  agentId: string,
  conversationId: string,
  maxTurns = 5,
): Promise<ConversationTurn[]> {
  if (!conversationId) return [];

  // Get all stored mentions for this agent
  const mentions = await getMentions(agentId);

  // Filter to same conversation
  const inConvo = mentions.filter(
    (m) => m.conversationId && String(m.conversationId) === String(conversationId)
  );

  // Get our replies from the post log
  const postLog = await getPostLog(agentId, 100);
  const ourReplies = postLog.filter(
    (e) => (e.action === 'posted' || !e.action) && e.format === 'auto_reply' && e.content
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
  for (const reply of ourReplies) {
    // Check if this reply's topic matches a mention in this conversation
    const matchedMention = inConvo.find(
      (m) => reply.topic?.includes(String(m.authorHandle)) && reply.xTweetId
    );
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

// ─── Rate limiting ──────────────────────────────────────────────────────────

export async function checkRateLimit(agentId: string, action: string, maxPerHour: number): Promise<boolean> {
  const key = KEYS.agentRateLimit(agentId, action);
  const current = await kvGet<number>(key);
  if (current !== null && current >= maxPerHour) return false;
  const newVal = (current ?? 0) + 1;
  await kvSet(key, newVal);
  // In production KV, we'd set a TTL. In-memory fallback doesn't expire,
  // but that's acceptable for local dev.
  return true;
}
