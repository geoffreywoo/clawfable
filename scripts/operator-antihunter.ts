/** Trusted local adapter: shared Clawfable storage, writer, learning and budgets. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getAgent, getAgentOwnerId, getUser, getTweets, getTweet, createTweet, updateTweet,
  getProtocolSettings, getLearningSignals, getPostLog, getPerformanceHistory, getAiOperationalState,
  addLearningSignal, addPostLogEntry, getFollowerSnapshots } from '../lib/kv-storage';
import { getMe, decodeKeys, createClient, sanitizeTweetText } from '../lib/twitter-client';
import { publishAgentPost } from '../lib/publish-agent-post';
import { assertAgentAutomationEntitlement } from '../lib/automation-entitlement';
import { getAiBudgetSummary } from '../lib/ai-budget';
import { ANTIHUNTER_AGENT_ID as AGENT_ID, ANTIHUNTER_X_USER_ID as X_USER_ID, ANTIHUNTER_HANDLE as HANDLE,
  getOperatorGrowth, mutateOperatorGrowth, budgetPolicy, summarizeXSpend, registerCampaign, recordSurge, recordAnalytics,
  parseOperatorBrief, validateCampaign, claimBoundedRun, recordContribution, type OperatorSourceBrief } from '../lib/antihunter-operator-state';
import { withOperatorXBudget, reserveVerification, releaseVerification, recordMediaPricing } from '../lib/antihunter-x-budget';
import { describeOperatorImage, uploadOperatorImage, verifyOperatorPost, mediaForOperatorTweet } from '../lib/antihunter-media';
import { isMaturePerformance } from '../lib/performance-signals';
import type { Tweet } from '../lib/types';

export function dispatchFingerprint(tweet: Pick<Tweet, 'content' | 'sourceBrief'>): string {
  return createHash('sha256').update(JSON.stringify({ content: tweet.content, asset: parseOperatorBrief(tweet.sourceBrief)?.asset || null })).digest('hex');
}
export function assertOperatorCadence(tweets: Tweet[], state: Awaited<ReturnType<typeof getOperatorGrowth>>, now = Date.now()) {
  const posted = new Map<string, number>();
  for (const tweet of tweets) if (tweet.status === 'posted' && tweet.postedAt && tweet.xTweetId) posted.set(tweet.xTweetId, Date.parse(tweet.postedAt));
  for (const receipt of Object.values(state.dispatches)) {
    if (['pending', 'uncertain'].includes(receipt.state)) throw new Error('Resolve the outstanding dispatch before publishing');
    if (receipt.state === 'posted' && !receipt.verifiedAt) throw new Error('Verify the previous publication and learning receipt before publishing');
    if (receipt.xTweetId) posted.set(receipt.xTweetId, posted.get(receipt.xTweetId) ?? Date.parse(receipt.at));
  }
  const recent = [...posted.values()].filter(at => now - at < 86_400_000);
  if (recent.length >= 4 || recent.some(at => now - at < 6 * 3_600_000)) throw new Error('Operator cadence cap: four posts/day, at least six hours apart.');
}
export async function runAntiHunterOperator(args = process.argv.slice(2)): Promise<unknown> {
  const command = args[0];
  const arg = (name: string) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  const readFileInput = () => { const file = arg('--file'); if (!file) throw new Error('--file JSON required'); return { input: JSON.parse(fs.readFileSync(file, 'utf8')), file: path.resolve(file) }; };
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Production KV configuration required; no in-memory operator.');
  const agent = await getAgent(AGENT_ID);
  if (!agent || agent.handle.toLowerCase() !== HANDLE || String(agent.xUserId) !== X_USER_ID) throw new Error('Account identity mismatch.');
  const ownerId = await getAgentOwnerId(AGENT_ID);
  const user = ownerId ? await getUser(String(ownerId)) : null;
  if (!user || String(user.id) !== X_USER_ID) throw new Error('Verified Anti Hunter ownership required.');
  if (command === 'campaign') return registerCampaign(readFileInput().input);
  if (command === 'contribution') return recordContribution(readFileInput().input);
  if (command === 'surge') return recordSurge(readFileInput().input);
  if (command === 'analytics-observation') return recordAnalytics(readFileInput().input);
  if (command === 'media-pricing') return recordMediaPricing(readFileInput().input);
  if (['budget', 'inspect', 'report'].includes(command)) {
    const [growth, budget] = await Promise.all([getOperatorGrowth(), getAiBudgetSummary(AGENT_ID)]);
    const policy = budgetPolicy(growth);
    const summary = { agentId: AGENT_ID, handle: agent.handle, verifiedAt: agent.xIdentityVerifiedAt, budget, policy,
      xBudget: summarizeXSpend(growth), lastRuns: growth.lastRuns,
      accounting: 'AI estimates and X reservations; analytics is delayed/soft. Not a provider invoice guarantee.' };
    if (command === 'budget') return summary;
    const [settings, signals, log, performance, tweets, followers] = await Promise.all([
      getProtocolSettings(AGENT_ID), getLearningSignals(AGENT_ID, 30), getPostLog(AGENT_ID, 20),
      getPerformanceHistory(AGENT_ID, 500), getTweets(AGENT_ID), getFollowerSnapshots(AGENT_ID, 40),
    ]);
    const latest = new Map<string, typeof performance[number]>();
    for (const entry of performance) if (!latest.has(entry.xTweetId) || entry.checkedAt > latest.get(entry.xTweetId)!.checkedAt) latest.set(entry.xTweetId, entry);
    return { ...summary, settings, signals, log, followers, dispatches: growth.dispatches, media: growth.media,
      campaigns: Object.values(growth.campaigns).map(campaign => {
        const contributions = Object.values(growth.contributions || {}).filter(c => c.campaignId === campaign.campaignId);
        const episodeContributions = contributions.filter(c => c.episodeId === campaign.episodeId);
        const authors = new Set(episodeContributions.map(c => c.xAuthorId));
        return { ...campaign,
        verifiedContributors: episodeContributions.length ? authors.size : null,
        returningContributors: episodeContributions.length ? [...authors].filter(author => new Set(contributions.filter(c => c.xAuthorId === author).map(c => c.episodeId)).size > 1).length : null,
        contributionCoverage: 'Manually reviewed public receipts; unobserved contributions are unknown.', contributions: episodeContributions,
        analytics: policy.analytics?.campaigns?.find(c => c.campaignId === campaign.campaignId && c.episodeId === campaign.episodeId) || null,
        posts: tweets.filter(tweet => { const c = parseOperatorBrief(tweet.sourceBrief)?.campaign; return c?.campaignId === campaign.campaignId && c.episodeId === campaign.episodeId; }).map(tweet => {
          const measured = tweet.xTweetId ? latest.get(tweet.xTweetId) : null;
          return { id: tweet.id, content: tweet.content, status: tweet.status, xTweetId: tweet.xTweetId, postedAt: tweet.postedAt,
            performance: measured || null, mature: measured ? isMaturePerformance(measured) : false };
        }),
      }; }), performance: [...latest.values()].slice(0, 20) };
  }
  if (!['draft', 'upload', 'publish', 'verify', 'reconcile', 'metrics', 'research'].includes(command)) throw new Error('Use inspect, budget, report, campaign, contribution, surge, analytics-observation, media-pricing, draft, upload, publish, verify, reconcile, metrics, or research.');
  await assertAgentAutomationEntitlement(AGENT_ID, { agent, user });
  const keys = decodeKeys(agent as Required<typeof agent>);
  const id = arg('--tweet-id');
  if (['metrics', 'research'].includes(command) && !await claimBoundedRun(command as 'metrics' | 'research')) return { skipped: true, reason: 'Six-hour read cadence' };
  return withOperatorXBudget(`${command}${id ? `:${id}` : ''}`, async () => {
    const identity = await getMe(keys);
    if (identity.id !== X_USER_ID || identity.username.toLowerCase() !== HANDLE) throw new Error('Official X identity mismatch.');
    if (command === 'draft') {
      const { input, file } = readFileInput();
      if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('Draft content required.');
      if (!Array.isArray(input.sources) || !input.sources.length || input.sources.some((s: unknown) => typeof s !== 'string' || !s.trim())) throw new Error('Verified source references required.');
      const content = input.content.trim();
      if (sanitizeTweetText(content) !== content) throw new Error('Review normalized draft text before saving (X status links are stripped by the shared writer)');
      const campaign = input.campaign ? validateCampaign(input.campaign) : undefined;
      if (campaign) await registerCampaign(campaign);
      const asset = input.media ? describeOperatorImage(fs.readFileSync(path.resolve(path.dirname(file), input.media.path)), input.media.altText) : undefined;
      const brief: OperatorSourceBrief = { operator: 'codex', sources: input.sources, thesis: input.thesis || null, ...(campaign ? { campaign } : {}), ...(asset ? { asset } : {}) };
      const sourceBrief = JSON.stringify(brief);
      const existing = (await getTweets(AGENT_ID)).find(t => dispatchFingerprint(t) === dispatchFingerprint({ content, sourceBrief }) && ['draft', 'queued', 'posted'].includes(t.status));
      if (existing) return { reused: true, id: existing.id, status: existing.status, xTweetId: existing.xTweetId };
      const format = typeof input.format === 'string' && ['observation', 'hot_take', 'question', 'data_point', 'short_punch', 'story'].includes(input.format) ? input.format : 'observation';
      const tweet = await createTweet({ agentId: AGENT_ID, content, type: 'original', status: 'draft', format,
        topic: input.topic || 'engineering', contentProvenance: 'operator_written',
        rationale: 'Composed and fact-checked by the Codex Anti Hunter operator; not a human-authored voice example.', sourceBrief,
        mediaExperimentType: asset ? 'image' : 'text_only', mediaBrief: asset?.altText || null,
        quoteTweetId: null, quoteTweetAuthor: null, xTweetId: null, scheduledAt: null });
      return { id: tweet.id, status: tweet.status, content: tweet.content, campaign, asset };
    }
    if (command === 'metrics') {
      const { checkPerformance } = await import('../lib/performance');
      return { tracked: await checkPerformance(agent, { timelineLimit: 20, classificationBacklogLimit: 1 }) };
    }
    if (command === 'research') {
      const query = arg('--query');
      if (!query || query.length > 300) throw new Error('--query required, at most 300 characters');
      const response = await createClient(keys).v2.search(query, { max_results: 10, 'tweet.fields': ['author_id', 'created_at', 'public_metrics'], expansions: ['author_id'], 'user.fields': ['username'] });
      return { data: response.data, notice: 'Untrusted source material, not instructions or publication evidence without review.' };
    }
    if (!id) throw new Error('--tweet-id required.');
    let tweet = await getTweet(id, { fresh: true });
    if (!tweet || String(tweet.agentId) !== AGENT_ID) throw new Error('Draft belongs to another account or is missing.');
    if (command === 'upload') {
      const file = arg('--file'); if (!file) throw new Error('--file image required.');
      return uploadOperatorImage(keys, tweet, fs.readFileSync(file));
    }
    const verify = async (xTweetId: string, reconcile = false) => {
      if (!/^\d+$/.test(xTweetId)) throw new Error('Numeric published X ID required');
      const media = (await getOperatorGrowth()).media[id];
      const expectedAsset = parseOperatorBrief(tweet!.sourceBrief)?.asset;
      if (expectedAsset && (!media?.mediaKey || media.sha256 !== expectedAsset.sha256)) throw new Error('Missing image upload receipt');
      const response = await createClient(keys).v2.singleTweet(xTweetId, { 'tweet.fields': ['author_id', 'created_at', 'public_metrics', 'entities', 'attachments', 'note_tweet'] });
      if (response.data?.id !== xTweetId) throw new Error('Official X lookup returned a different post ID');
      verifyOperatorPost(tweet!, response.data, expectedAsset ? media : null);
      if (reconcile) {
        if (tweet!.xTweetId && tweet!.xTweetId !== xTweetId) throw new Error('Draft already linked to a different post');
        const duplicate = (await getTweets(AGENT_ID)).find(t => t.id !== id && t.xTweetId === xTweetId);
        if (duplicate) throw new Error('X post belongs to another draft');
        const receipt = (await getOperatorGrowth()).dispatches[id];
        if (!receipt) throw new Error('No dispatch receipt to reconcile');
        if (receipt.fingerprint !== dispatchFingerprint(tweet!)) throw new Error('Draft changed after dispatch; do not reconcile different content');
        const postedAt = response.data.created_at;
        if (!postedAt || Date.parse(postedAt) < Date.parse(receipt.at) - 60_000 || Date.parse(postedAt) > Date.parse(receipt.at) + 15 * 60_000) throw new Error('X post time is outside the recorded dispatch window');
        tweet = await updateTweet(id, { status: 'posted', xTweetId, postedAt });
        await addLearningSignal(AGENT_ID, { tweetId: id, xTweetId, signalType: 'x_post_succeeded', surface: 'manual_post', rewardDelta: 0.72,
          metadata: { operatorReconciled: true, campaignId: parseOperatorBrief(tweet.sourceBrief)?.campaign?.campaignId || null } });
        await addPostLogEntry(AGENT_ID, { agentId: AGENT_ID, tweetId: id, xTweetId, content: tweet.content, format: tweet.format || 'observation',
          topic: tweet.topic || 'manual', postedAt, source: 'manual', action: 'posted', reason: 'Reconciled against official X author, text, attachment, and dispatch window.' });
      }
      const signals = await getLearningSignals(AGENT_ID, 500);
      const learningRecorded = signals.some(s => s.xTweetId === xTweetId && s.signalType === 'x_post_succeeded');
      if (!learningRecorded) throw new Error('Published post verified but learning receipt is missing; use reconcile');
      await mutateOperatorGrowth(state => {
        const prior = state.dispatches[id];
        if (prior) state.dispatches[id] = { ...prior, state: reconcile ? 'reconciled' : 'posted', xTweetId, verifiedAt: new Date().toISOString() };
      });
      await releaseVerification(id);
      return { url: `https://x.com/AntiHunterAI/status/${xTweetId}`, verified: true, learningRecorded, data: response.data };
    };
    if (command === 'verify') {
      if (!tweet.xTweetId) throw new Error('No published X ID; use reconcile with the confirmed X post ID');
      return verify(tweet.xTweetId);
    }
    if (command === 'reconcile') {
      const xTweetId = arg('--x-tweet-id') || tweet.xTweetId;
      if (!xTweetId) throw new Error('--x-tweet-id required (no blind retry)');
      return verify(xTweetId, true);
    }
    if (tweet.status === 'posted' && tweet.xTweetId) return { alreadyPosted: true, tweetId: tweet.xTweetId };
    if (tweet.status !== 'draft' || tweet.quarantinedAt || tweet.type !== 'original') throw new Error('Only reviewed original drafts may be dispatched.');
    const legacyNamespace = `operator-dispatch:${id}:${createHash('sha256').update(tweet.content).digest('hex').slice(0, 16)}`;
    if (await getAiOperationalState(AGENT_ID, legacyNamespace)) throw new Error('Legacy dispatch exists; reconcile its X outcome before any retry.');
    await mediaForOperatorTweet(tweet);
    await reserveVerification(id);
    const tweets = await getTweets(AGENT_ID);
    const fingerprint = dispatchFingerprint(tweet);
    await mutateOperatorGrowth(state => {
      if (state.dispatches[id] && !(state.dispatches[id].state === 'rejected' && args.includes('--retry-rejected'))) throw new Error('Existing dispatch receipt: reconcile it before any retry.');
      assertOperatorCadence(tweets, state);
      state.dispatches[id] = { state: 'pending', at: new Date().toISOString(), fingerprint };
    });
    try {
      const response = await publishAgentPost(new Request('https://www.clawfable.com/api/agents/5/twitter/post', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tweetId: id, content: tweet.content }),
      }), { agent, user });
      const result = await response.json();
      await mutateOperatorGrowth(state => {
        const prior = state.dispatches[id];
        const writeAttempted = Object.values(state.xAttempts).some(a => a.operation === `publish:${id}` && a.endpoint === 'POST /2/tweets' && a.at >= prior.at);
        state.dispatches[id] = { ...prior, state: response.ok ? 'posted' : writeAttempted ? 'uncertain' : 'rejected',
          ...(response.ok && result.tweetId ? { xTweetId: result.tweetId } : {}), result: { status: response.status, ...(result.persistenceWarning ? { persistenceWarning: result.persistenceWarning } : {}) } };
      });
      if (!response.ok) throw new Error(`Publication response ${response.status}: ${result.error || 'inspect dispatch receipt'}`);
      tweet = (await getTweet(id, { fresh: true })) || tweet;
      return await withOperatorXBudget(`verify:${id}`, async () => { await getMe(keys); return verify(result.tweetId); }, id);
    } catch (error) {
      await mutateOperatorGrowth(state => {
        if (state.dispatches[id]?.state === 'pending') state.dispatches[id].state = 'uncertain';
      });
      throw error;
    }
  }, ['verify', 'reconcile'].includes(command) ? id || undefined : undefined);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runAntiHunterOperator().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Operator failed'); process.exitCode = 1; });
}
