import type { Agent, Tweet, Mention, Metric, CreateAgentInput, UpdateAgentInput, CreateTweetInput, UpdateTweetInput, CreateMentionInput, MetricInput, AccountAnalysis } from './types';

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
  tweet: (id: string) => `tweet:${id}`,
  mention: (id: string) => `mention:${id}`,
  counterAgent: () => 'counter:agent',
  counterTweet: () => 'counter:tweet',
  counterMention: () => 'counter:mention',
};

// ─── Agent storage ────────────────────────────────────────────────────────────

export async function getAgents(): Promise<Agent[]> {
  const ids = await kvSmembers(KEYS.agentSet());
  if (ids.length === 0) return [];
  const agents = await Promise.all(ids.map((id) => kvHgetall<Agent>(KEYS.agent(id))));
  return agents
    .filter((a): a is Agent => a !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getAgent(id: string): Promise<Agent | null> {
  return kvHgetall<Agent>(KEYS.agent(id));
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

  // Remove agent
  await kvDel(KEYS.agent(id));
  await kvSrem(KEYS.agentSet(), id);
  await kvDel(KEYS.agentHandle(agent.handle));
}

// ─── Tweet storage ────────────────────────────────────────────────────────────

export async function getTweets(agentId: string): Promise<Tweet[]> {
  const ids = await kvLrange(KEYS.agentTweets(agentId), 0, -1);
  const tweets = await Promise.all(ids.map((id) => kvHgetall<Tweet>(KEYS.tweet(id))));
  return tweets.filter((t): t is Tweet => t !== null);
}

export async function getQueuedTweets(agentId: string): Promise<Tweet[]> {
  const ids = await kvLrange(KEYS.agentQueue(agentId), 0, -1);
  const tweets = await Promise.all(ids.map((id) => kvHgetall<Tweet>(KEYS.tweet(id))));
  return tweets.filter((t): t is Tweet => t !== null && t.status === 'queued');
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
  const existing = await kvHgetall<Tweet>(KEYS.tweet(id));
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
  const tweet = await kvHgetall<Tweet>(KEYS.tweet(id));
  if (!tweet) return;
  await kvDel(KEYS.tweet(id));
  await kvLrem(KEYS.agentTweets(tweet.agentId), 0, id);
  await kvLrem(KEYS.agentQueue(tweet.agentId), 0, id);
}

// ─── Mention storage ──────────────────────────────────────────────────────────

export async function getMentions(agentId: string): Promise<Mention[]> {
  const ids = await kvLrange(KEYS.agentMentions(agentId), 0, -1);
  const mentions = await Promise.all(ids.map((id) => kvHgetall<Mention>(KEYS.mention(id))));
  return mentions.filter((m): m is Mention => m !== null);
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
    createdAt: new Date().toISOString(),
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

export async function saveOAuthTemp(oauthToken: string, data: { oauthTokenSecret: string; agentId: string }): Promise<void> {
  await kvSet(KEYS.oauthTemp(oauthToken), data);
}

export async function getOAuthTemp(oauthToken: string): Promise<{ oauthTokenSecret: string; agentId: string } | null> {
  return kvGet<{ oauthTokenSecret: string; agentId: string }>(KEYS.oauthTemp(oauthToken));
}

export async function deleteOAuthTemp(oauthToken: string): Promise<void> {
  await kvDel(KEYS.oauthTemp(oauthToken));
}
