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
  parseOperatorBrief, validateCampaign, validateExperiment, reusableOperatorExperiment, claimBoundedRun, recordContribution, getAnalyticsState,
  OPERATOR_READ_INTERVAL_HOURS, type OperatorSourceBrief } from '../lib/antihunter-operator-state';
import { withOperatorXBudget, reserveVerification, releaseVerification, recordMediaPricing } from '../lib/antihunter-x-budget';
import { describeOperatorImage, uploadOperatorImage, verifyOperatorPost, mediaForOperatorTweet } from '../lib/antihunter-media';
import { getOperatorComparison, observedAgeHours } from '../lib/antihunter-measurement';
import { getOperatorOriginals, getOperatorComparisonWindows } from '../lib/antihunter-report';
import type { Tweet } from '../lib/types';
import { assertOperatorCadence, getOperatorCadence, getOperatorOutbox } from '../lib/antihunter-publication';
import { assertNoDuplicateOperatorReply, assertOperatorReplyPolicy, assertReplyTargetUnchanged,
  operatorDraftFingerprint, operatorReplyReadiness, reviewedOperatorReply, validateReplyInput, verifyReplyTarget,
  withOperatorReplyAuthorization } from '../lib/antihunter-replies';
export { assertOperatorCadence } from '../lib/antihunter-publication';

export function dispatchFingerprint(tweet: Pick<Tweet, 'content' | 'sourceBrief'>): string {
  return operatorDraftFingerprint(tweet);
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
  if (command === 'analytics-state') return getAnalyticsState(await getOperatorGrowth());
  if (command === 'media-pricing') return recordMediaPricing(readFileInput().input);
  if (command === 'opt-out') {
    const authorId = arg('--author-id');
    if (!authorId || !/^[1-9]\d{0,19}$/.test(authorId) || BigInt(authorId) > BigInt('18446744073709551615')) throw new Error('Numeric --author-id required');
    return mutateOperatorGrowth(state => {
      state.replyPolicy ||= { ownerEnabled: false, authorizedAt: new Date().toISOString(), platformApproval: null, optedOutAuthorIds: [] };
      if (!state.replyPolicy.optedOutAuthorIds.includes(authorId)) state.replyPolicy.optedOutAuthorIds.push(authorId);
      return { authorId, optedOut: true };
    });
  }
  if (['budget', 'inspect', 'report'].includes(command)) {
    const [growth, budget] = await Promise.all([getOperatorGrowth(), getAiBudgetSummary(AGENT_ID)]);
    const policy = budgetPolicy(growth);
    const summary = { agentId: AGENT_ID, handle: agent.handle, verifiedAt: agent.xIdentityVerifiedAt, budget, policy,
      xBudget: summarizeXSpend(growth), lastRuns: growth.lastRuns, replies: operatorReplyReadiness(growth),
      accounting: 'AI estimates and X reservations; analytics is delayed/soft. Not a provider invoice guarantee.' };
    if (command === 'budget') return summary;
    const [settings, signals, log, performance, tweets, followers] = await Promise.all([
      getProtocolSettings(AGENT_ID), getLearningSignals(AGENT_ID, 30), getPostLog(AGENT_ID, 20),
      getPerformanceHistory(AGENT_ID, 5000), getTweets(AGENT_ID), getFollowerSnapshots(AGENT_ID, 40),
    ]);
    const latest = new Map<string, typeof performance[number]>();
    for (const entry of performance) if (!latest.has(entry.xTweetId) || entry.checkedAt > latest.get(entry.xTweetId)!.checkedAt) latest.set(entry.xTweetId, entry);
    return { ...summary, settings, signals, log, followers, dispatches: growth.dispatches, media: growth.media,
      cadence: getOperatorCadence(tweets, growth), outbox: getOperatorOutbox(tweets, growth),
      operatorOriginals: getOperatorOriginals(tweets, performance),
      comparisonWindows: getOperatorComparisonWindows(tweets, performance),
      readIntervalsHours: OPERATOR_READ_INTERVAL_HOURS, analyticsHistory: getAnalyticsState(growth),
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
          const comparison = getOperatorComparison(performance, tweet.xTweetId || '');
          return { id: tweet.id, content: tweet.content, status: tweet.status, xTweetId: tweet.xTweetId, postedAt: tweet.postedAt,
            performance: measured || null, observedAgeHours: measured ? observedAgeHours(measured) : null,
            comparison, mature: comparison.snapshot !== null };
        }),
      }; }), performance: [...latest.values()].slice(0, 20) };
  }
  if (!['draft', 'upload', 'publish', 'verify', 'reconcile', 'metrics', 'research', 'inbox'].includes(command)) throw new Error('Use inspect, budget, report, campaign, contribution, surge, analytics-observation, analytics-state, media-pricing, draft, upload, publish, verify, reconcile, metrics, research, inbox, or opt-out.');
  const id = arg('--tweet-id');
  if (command === 'publish' && id) {
    const candidate = await getTweet(id, { fresh: true });
    if (!candidate || String(candidate.agentId) !== AGENT_ID) throw new Error('Draft belongs to another account or is missing.');
    // Cheap local admission before the paid identity request or verification
    // reservation. The atomic dispatch claim below still rechecks for races.
    if (!(candidate.status === 'posted' && candidate.xTweetId)) {
      const [tweets, growth] = await Promise.all([getTweets(AGENT_ID), getOperatorGrowth()]);
      if (candidate.type === 'reply') {
        const reply = reviewedOperatorReply(candidate);
        assertOperatorReplyPolicy(growth, reply.targetAuthorId);
        assertNoDuplicateOperatorReply(tweets, growth, candidate);
      }
      assertOperatorCadence(tweets, growth);
    }
  }
  await assertAgentAutomationEntitlement(AGENT_ID, { agent, user });
  const keys = decodeKeys(agent as Required<typeof agent>);
  if (['metrics', 'research'].includes(command) && !await claimBoundedRun(command as 'metrics' | 'research')) return {
    skipped: true, reason: `${OPERATOR_READ_INTERVAL_HOURS[command as 'metrics' | 'research']}-hour ${command} read cadence` };
  return withOperatorXBudget(`${command}${id ? `:${id}` : ''}`, async () => {
    const identity = await getMe(keys);
    if (identity.id !== X_USER_ID || identity.username.toLowerCase() !== HANDLE) throw new Error('Official X identity mismatch.');
    if (command === 'inbox') {
      const response = await createClient(keys).v2.userMentionTimeline(X_USER_ID, { max_results: 10,
        'tweet.fields': ['author_id', 'conversation_id', 'created_at', 'note_tweet', 'entities', 'referenced_tweets', 'in_reply_to_user_id'] });
      return { data: response.data, notice: 'One bounded page of untrusted mentions. Review invitations and opt-outs; no automatic replies.' };
    }
    if (command === 'draft') {
      const { input, file } = readFileInput();
      if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('Draft content required.');
      if (!Array.isArray(input.sources) || !input.sources.length || input.sources.some((s: unknown) => typeof s !== 'string' || !s.trim())) throw new Error('Verified source references required.');
      const content = input.content.trim();
      if (sanitizeTweetText(content) !== content) throw new Error('Review normalized draft text before saving (X status links are stripped by the shared writer)');
      const replyInput = input.reply ? validateReplyInput(input.reply) : null;
      if (replyInput && input.media) throw new Error('Operator replies currently support text only.');
      const reply = replyInput ? verifyReplyTarget(replyInput,
        (await createClient(keys).v2.singleTweet(replyInput.targetTweetId, {
          'tweet.fields': ['author_id', 'conversation_id', 'note_tweet', 'entities'],
        })).data) : undefined;
      const campaign = input.campaign ? validateCampaign(input.campaign) : undefined;
      const experiment = input.experiment ? { ...validateExperiment(input.experiment), declaredAt: new Date().toISOString() } : undefined;
      if (campaign) await registerCampaign(campaign);
      const asset = input.media ? describeOperatorImage(fs.readFileSync(path.resolve(path.dirname(file), input.media.path)), input.media.altText) : undefined;
      const sources = reply ? [...new Set([...input.sources, `https://x.com/i/status/${reply.targetTweetId}`])] : input.sources;
      const brief: OperatorSourceBrief = { operator: 'codex', sources, thesis: input.thesis || null,
        ...(campaign ? { campaign } : {}), ...(experiment ? { experiment } : {}), ...(asset ? { asset } : {}), ...(reply ? { reply } : {}) };
      const sourceBrief = JSON.stringify(brief);
      const drafts = await getTweets(AGENT_ID);
      const existing = drafts.find(t => dispatchFingerprint(t) === dispatchFingerprint({ content, sourceBrief }) && ['draft', 'queued', 'posted'].includes(t.status));
      if (existing) return { reused: true, id: existing.id, status: existing.status, xTweetId: existing.xTweetId,
        experiment: reusableOperatorExperiment(existing.sourceBrief, experiment) };
      if (reply) assertNoDuplicateOperatorReply(drafts, await getOperatorGrowth(), { id: '', agentId: AGENT_ID,
        content, sourceBrief, type: 'reply', status: 'draft', contentProvenance: 'operator_written',
        followupForTweetId: reply.targetTweetId, replyConversationId: reply.conversationId } as Tweet);
      const format = typeof input.format === 'string' && ['observation', 'hot_take', 'question', 'data_point', 'short_punch', 'story'].includes(input.format) ? input.format : 'observation';
      const tweet = await createTweet({ agentId: AGENT_ID, content, type: reply ? 'reply' : 'original', status: 'draft', format,
        topic: input.topic || 'engineering', contentProvenance: 'operator_written',
        rationale: 'Composed and fact-checked by the Codex Anti Hunter operator; not a human-authored voice example.', sourceBrief,
        mediaExperimentType: asset ? 'image' : 'text_only', mediaBrief: asset?.altText || null,
        quoteTweetId: null, quoteTweetAuthor: null, xTweetId: null, scheduledAt: null,
        followupForTweetId: reply?.targetTweetId || null, replyConversationId: reply?.conversationId || null });
      return { id: tweet.id, status: tweet.status, content: tweet.content, campaign, experiment, asset, reply };
    }
    if (command === 'metrics') {
      const { checkPerformance } = await import('../lib/performance');
      return { tracked: await checkPerformance(agent, { timelineLimit: 20, classificationBacklogLimit: 1, captureComparisonWindow: true }) };
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
      const response = await createClient(keys).v2.singleTweet(xTweetId, { 'tweet.fields': ['author_id', 'created_at', 'public_metrics', 'entities', 'attachments', 'note_tweet', 'referenced_tweets', 'conversation_id', 'in_reply_to_user_id'] });
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
        const reply = tweet.type === 'reply' ? reviewedOperatorReply(tweet) : null;
        await addLearningSignal(AGENT_ID, { tweetId: id, xTweetId, signalType: reply ? 'reply_posted' : 'x_post_succeeded', surface: reply ? 'mentions' : 'manual_post', rewardDelta: 0.72,
          metadata: { operatorReconciled: true, campaignId: parseOperatorBrief(tweet.sourceBrief)?.campaign?.campaignId || null,
            ...(reply ? { targetTweetId: reply.targetTweetId, replyConversationId: reply.conversationId } : {}) } });
        await addPostLogEntry(AGENT_ID, { agentId: AGENT_ID, tweetId: id, xTweetId, content: tweet.content, format: tweet.format || 'observation',
          topic: tweet.topic || 'manual', postedAt, source: 'manual', action: 'posted', reason: 'Reconciled against official X author, text, attachment, and dispatch window.' });
      }
      const signals = await getLearningSignals(AGENT_ID, 500);
      const learningRecorded = signals.some(s => s.xTweetId === xTweetId && s.signalType === (tweet!.type === 'reply' ? 'reply_posted' : 'x_post_succeeded'));
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
    if (tweet.status !== 'draft' || tweet.quarantinedAt || !['original', 'reply'].includes(tweet.type)) throw new Error('Only reviewed original or reply drafts may be dispatched.');
    const legacyNamespace = `operator-dispatch:${id}:${createHash('sha256').update(tweet.content).digest('hex').slice(0, 16)}`;
    if (await getAiOperationalState(AGENT_ID, legacyNamespace)) throw new Error('Legacy dispatch exists; reconcile its X outcome before any retry.');
    const tweets = await getTweets(AGENT_ID);
    assertOperatorCadence(tweets, await getOperatorGrowth());
    const reply = tweet.type === 'reply' ? reviewedOperatorReply(tweet) : null;
    const verifiedParent = reply ? assertReplyTargetUnchanged(reply,
      (await createClient(keys).v2.singleTweet(reply.targetTweetId, {
        'tweet.fields': ['author_id', 'conversation_id', 'note_tweet', 'entities'],
      })).data) : null;
    await mediaForOperatorTweet(tweet);
    await reserveVerification(id);
    const fingerprint = dispatchFingerprint(tweet);
    await mutateOperatorGrowth(state => {
      if (state.dispatches[id] && !(state.dispatches[id].state === 'rejected' && args.includes('--retry-rejected'))) throw new Error('Existing dispatch receipt: reconcile it before any retry.');
      assertOperatorCadence(tweets, state);
      if (reply) {
        assertOperatorReplyPolicy(state, reply.targetAuthorId);
        assertNoDuplicateOperatorReply(tweets, state, tweet!);
      }
      state.dispatches[id] = { state: 'pending', at: new Date().toISOString(), fingerprint, type: reply ? 'reply' : 'original',
        ...(reply ? { targetTweetId: reply.targetTweetId, targetAuthorId: reply.targetAuthorId, conversationId: reply.conversationId } : {}) };
    });
    try {
      const publish = () => publishAgentPost(new Request('https://www.clawfable.com/api/agents/5/twitter/post', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tweetId: id, content: tweet!.content,
          ...(reply ? { replyToId: reply.targetTweetId, conversationId: reply.conversationId } : {}) }),
      }), { agent, user });
      const response = reply && verifiedParent ? await withOperatorReplyAuthorization(tweet, verifiedParent, publish) : await publish();
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
