import type { Agent, Tweet, Mention, Metric, CreateAgentInput, UpdateAgentInput, CreateTweetInput, UpdateTweetInput, CreateMentionInput, MetricInput, AccountAnalysis, User, Session, ProtocolSettings, PostLogEntry, TweetJob, CreateTweetJobInput, UpdateTweetJobInput, TweetPerformance, AgentLearnings, WizardData, StyleSignals, FeedbackEntry, FunnelEvent } from './types';

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

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const client = await getKvClient();
    if (!client) return (memStore.get(key) as T) ?? null;
    return (await client.get(key)) as T | null;
  } catch {
    return (memStore.get(key) as T) ?? null;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const client = await getKvClient();
    if (!client) { memStore.set(key, value); return; }
    await client.set(key, value);
  } catch {
    memStore.set(key, value);
  }
}

async function kvDel(key: string): Promise<void> {
  try {
    const client = await getKvClient();
    if (!client) { memStore.delete(key); return; }
    await client.del(key);
  } catch {
    memStore.delete(key);
  }
}

async function kvSadd(key: string, ...members: string[]): Promise<void> {
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
  try {
    const client = await getKvClient();
    if (!client) {
      const s = memStore.get(key) as Set<string> | undefined;
      return s ? Array.from(s) : [];
    }
    return (await client.smembers(key)) as string[];
  } catch {
    const s = memStore.get(key) as Set<string> | undefined;
    return s ? Array.from(s) : [];
  }
}

async function kvSrem(key: string, member: string): Promise<void> {
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
  try {
    const client = await getKvClient();
    if (!client) {
      const list = (memStore.get(key) as string[]) ?? [];
      return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
    }
    return (await client.lrange(key, start, stop)) as string[];
  } catch {
    const list = (memStore.get(key) as string[]) ?? [];
    return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
  }
}

async function kvLrem(key: string, count: number, value: string): Promise<void> {
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
  try {
    const client = await getKvClient();
    if (!client) return (memStore.get(key) as T) ?? null;
    return (await client.hgetall(key)) as T | null;
  } catch {
    return (memStore.get(key) as T) ?? null;
  }
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

const KEYS = {
  agentSet: () => 'agents',
  agent: (id: string) => `agent:${id}`,
  agentHandle: (handle: string) => `agent:handle:${handle}`,
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
  cronLog: () => 'cron:log',
  user: (xUserId: string) => `user:${xUserId}`,
  userAgents: (xUserId: string) => `user:${xUserId}:agents`,
  session: (token: string) => `session:${token}`,
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
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
}

// ─── Tweet storage ────────────────────────────────────────────────────────────

// Vercel KV (Upstash) auto-deserializes numeric strings as numbers.
// IDs are always strings internally, so coerce on read.
function normalizeId<T extends { id: unknown }>(obj: T): T & { id: string } {
  return { ...obj, id: String(obj.id) };
}

export async function getTweets(agentId: string): Promise<Tweet[]> {
  const ids = await kvLrange(KEYS.agentTweets(agentId), 0, -1);
  const tweets = await Promise.all(ids.map((id) => kvHgetall<Tweet>(KEYS.tweet(String(id)))));
  return tweets.filter((t): t is Tweet => t !== null).map(normalizeId);
}

export async function getTweet(id: string): Promise<Tweet | null> {
  const tweet = await kvHgetall<Tweet>(KEYS.tweet(String(id)));
  return tweet ? normalizeId(tweet) : null;
}

export async function getPreviewTweets(agentId: string): Promise<Tweet[]> {
  const tweets = await getTweets(agentId);
  return tweets.filter((tweet) => tweet.status === 'preview');
}

export async function getQueuedTweets(agentId: string): Promise<Tweet[]> {
  const ids = await kvLrange(KEYS.agentQueue(agentId), 0, -1);
  const tweets = await Promise.all(ids.map((id) => kvHgetall<Tweet>(KEYS.tweet(String(id)))));
  return tweets.filter((t): t is Tweet => t !== null && t.status === 'queued').map(normalizeId);
}

export async function createTweet(data: CreateTweetInput): Promise<Tweet> {
  const counter = await kvIncr(KEYS.counterTweet());
  const id = String(counter);
  const tweet: Tweet = {
    id,
    agentId: data.agentId,
    content: data.content,
    type: data.type ?? 'original',
    status: data.status ?? 'draft',
    topic: data.topic ?? null,
    xTweetId: data.xTweetId ?? null,
    quoteTweetId: data.quoteTweetId ?? null,
    quoteTweetAuthor: data.quoteTweetAuthor ?? null,
    scheduledAt: data.scheduledAt ?? null,
    createdAt: new Date().toISOString(),
  };
  await kvHset(KEYS.tweet(id), tweet as unknown as Record<string, unknown>);
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
  const updated = { ...existing, ...data };
  await kvHset(KEYS.tweet(id), updated as unknown as Record<string, unknown>);

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
  enabledFormats: [],  // empty = all formats
  qtRatio: 60,
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
  return raw.map((s) => {
    try { return JSON.parse(s) as PostLogEntry; }
    catch { return null; }
  }).filter((e): e is PostLogEntry => e !== null);
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
  return raw.map((s) => {
    try { return JSON.parse(s) as CronLogEntry; }
    catch { return null; }
  }).filter((e): e is CronLogEntry => e !== null);
}

// ─── Performance tracking storage ─────────────────────────────────────────────

export async function addPerformanceEntry(agentId: string, entry: TweetPerformance): Promise<void> {
  await kvLpush(KEYS.agentPerformance(agentId), JSON.stringify(entry));
}

export async function getPerformanceHistory(agentId: string, limit = 50): Promise<TweetPerformance[]> {
  const raw = await kvLrange(KEYS.agentPerformance(agentId), 0, limit - 1);
  return raw.map((s) => {
    try { return JSON.parse(s) as TweetPerformance; }
    catch { return null; }
  }).filter((e): e is TweetPerformance => e !== null);
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
  return kvHgetall<User>(KEYS.user(xUserId));
}

export async function getOrCreateUser(xUserId: string, username: string, name: string): Promise<User> {
  const existing = await getUser(xUserId);
  if (existing) return existing;
  const user: User = { id: xUserId, username, name, createdAt: new Date().toISOString() };
  await kvHset(KEYS.user(xUserId), user as unknown as Record<string, unknown>);
  return user;
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
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addAgentToUser(userId: string, agentId: string): Promise<void> {
  await kvSadd(KEYS.userAgents(userId), agentId);
}

export async function removeAgentFromUser(userId: string, agentId: string): Promise<void> {
  await kvSrem(KEYS.userAgents(userId), agentId);
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
  pruned.push(entry);
  const capped = pruned.slice(-20);
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

// ─── Soul backup storage ────────────────────────────────────────────────────

export async function saveSoulBackup(agentId: string, soulMd: string): Promise<void> {
  await kvSet(KEYS.agentSoulBackup(agentId), soulMd);
}

// ─── Funnel event storage ───────────────────────────────────────────────────

export async function logFunnelEvent(agentId: string, event: string, meta?: Record<string, unknown>): Promise<void> {
  const entry: FunnelEvent = { event, ts: new Date().toISOString(), meta };
  await kvLpush(KEYS.agentEvents(agentId), JSON.stringify(entry));
}

export async function getFunnelEvents(agentId: string, limit = 100): Promise<FunnelEvent[]> {
  const raw = await kvLrange(KEYS.agentEvents(agentId), 0, limit - 1);
  return raw.map((s) => {
    try { return JSON.parse(s) as FunnelEvent; }
    catch { return null; }
  }).filter((e): e is FunnelEvent => e !== null);
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
