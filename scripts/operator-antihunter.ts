/** Trusted local operator adapter. All X writes use Clawfable's shared posting service. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  getAgent, getAgentOwnerId, getUser, getTweets, getTweet, createTweet,
  getProtocolSettings, getLearningSignals, getPostLog, getPerformanceHistory,
  mutateAiOperationalState,
} from '../lib/kv-storage';
import { getMe, decodeKeys, createClient } from '../lib/twitter-client';
import { publishAgentPost } from '../lib/publish-agent-post';
import { assertAgentAutomationEntitlement } from '../lib/automation-entitlement';
import { getAiBudgetSummary } from '../lib/ai-budget';

const AGENT_ID = '5';
const X_USER_ID = '2019634783962226688';
const HANDLE = 'antihunterai';
const command = process.argv[2];
function arg(name: string) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }
type Dispatch = { state: 'pending' | 'posted' | 'rejected' | 'uncertain'; at: string; result?: unknown };

async function main() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Production KV configuration required; no in-memory publishing.');
  const agent = await getAgent(AGENT_ID);
  if (!agent || agent.handle.toLowerCase() !== HANDLE || String(agent.xUserId) !== X_USER_ID) throw new Error('Account identity mismatch.');
  const ownerId = await getAgentOwnerId(AGENT_ID);
  const user = ownerId ? await getUser(String(ownerId)) : null;
  if (!user || String(user.id) !== X_USER_ID) throw new Error('Verified Anti Hunter ownership required.');
  const keys = decodeKeys(agent as Required<typeof agent>);
  if (command === 'inspect') {
    const [settings, signals, log, performance, budget] = await Promise.all([
      getProtocolSettings(AGENT_ID), getLearningSignals(AGENT_ID, 5), getPostLog(AGENT_ID, 5),
      getPerformanceHistory(AGENT_ID, 3), getAiBudgetSummary(AGENT_ID),
    ]);
    console.log(JSON.stringify({ agentId: AGENT_ID, handle: agent.handle, verifiedAt: agent.xIdentityVerifiedAt,
      settings, budget, signals, log, performance }, null, 2));
    return;
  }
  await assertAgentAutomationEntitlement(AGENT_ID, { agent, user });
  const identity = await getMe(keys);
  if (identity.id !== X_USER_ID || identity.username.toLowerCase() !== HANDLE) throw new Error('Official X identity mismatch.');
  if (command === 'draft') {
    const file = arg('--file'); if (!file) throw new Error('--file JSON required.');
    const input = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('Draft content required.');
    if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.some((s: unknown) => typeof s !== 'string')) throw new Error('Source references required.');
    const content = input.content.trim();
    const existing = (await getTweets(AGENT_ID)).find(t => t.content === content && ['draft', 'queued', 'posted'].includes(t.status));
    if (existing) { console.log(JSON.stringify({ reused: true, id: existing.id, status: existing.status, xTweetId: existing.xTweetId })); return; }
    const tweet = await createTweet({ agentId: AGENT_ID, content, type: 'original', status: 'draft',
      format: 'observation', topic: input.topic || 'engineering', contentProvenance: 'operator_written',
      rationale: 'Composed and fact-checked by the Codex Anti Hunter operator; not a human-authored voice example.',
      sourceBrief: JSON.stringify({ operator: 'codex', sources: input.sources, thesis: input.thesis || null }),
      quoteTweetId: null, quoteTweetAuthor: null, xTweetId: null, scheduledAt: null });
    console.log(JSON.stringify({ id: tweet.id, status: tweet.status, content: tweet.content })); return;
  }
  if (command === 'metrics') {
    const { checkPerformance } = await import('../lib/performance');
    console.log(JSON.stringify({ tracked: await checkPerformance(agent, { timelineLimit: 20, classificationBacklogLimit: 1 }) })); return;
  }
  const id = arg('--tweet-id'); if (!id) throw new Error('--tweet-id required.');
  const tweet = await getTweet(id, { fresh: true });
  if (!tweet || String(tweet.agentId) !== AGENT_ID) throw new Error('Draft belongs to another account or is missing.');
  if (command === 'verify') {
    if (!tweet.xTweetId) throw new Error('No published X ID.');
    const response = await createClient(keys).v2.singleTweet(tweet.xTweetId, { 'tweet.fields': ['author_id', 'created_at', 'public_metrics'] });
    if (response.data.author_id !== X_USER_ID || response.data.text !== tweet.content) throw new Error('Published author/content mismatch.');
    const signals = await getLearningSignals(AGENT_ID, 100);
    console.log(JSON.stringify({ url: `https://x.com/AntiHunterAI/status/${tweet.xTweetId}`, verified: true,
      learningRecorded: signals.some(s => s.xTweetId === tweet.xTweetId && s.signalType === 'x_post_succeeded'), data: response.data })); return;
  }
  if (command !== 'publish') throw new Error('Use inspect, draft, publish, verify, or metrics.');
  if (tweet.status === 'posted' && tweet.xTweetId) {
    console.log(JSON.stringify({ alreadyPosted: true, tweetId: tweet.xTweetId })); return;
  }
  if (tweet.status !== 'draft' || tweet.quarantinedAt || tweet.type !== 'original') throw new Error('Only reviewed original drafts may be dispatched.');
  const recent = (await getTweets(AGENT_ID)).filter(t => t.status === 'posted' && t.postedAt && Date.now() - Date.parse(t.postedAt) < 86400000);
  if (recent.length >= 4 || recent.some(t => Date.now() - Date.parse(t.postedAt!) < 6 * 3600000)) throw new Error('Operator cadence cap: four posts/day, at least six hours apart.');
  const namespace = `operator-dispatch:${id}:${createHash('sha256').update(tweet.content).digest('hex').slice(0, 16)}`;
  await mutateAiOperationalState<Dispatch, void>(AGENT_ID, namespace, current => {
    if (current) throw new Error('Existing dispatch receipt: reconcile it before any retry.');
    return { value: { state: 'pending', at: new Date().toISOString() }, result: undefined };
  });
  const response = await publishAgentPost(new Request('https://www.clawfable.com/api/agents/5/twitter/post', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tweetId: id, content: tweet.content }),
  }), { agent, user });
  const result = await response.json();
  await mutateAiOperationalState<Dispatch, void>(AGENT_ID, namespace, current => ({
    value: { ...current!, state: response.ok ? 'posted' : response.status >= 500 ? 'uncertain' : 'rejected', result }, result: undefined,
  }));
  console.log(JSON.stringify({ status: response.status, ...result }));
  if (!response.ok) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Operator failed'); process.exitCode = 1; });
