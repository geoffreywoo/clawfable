import { describe, expect, it, vi } from 'vitest';
import {
  addVoiceDirective,
  addLearningSignal,
  createAgent,
  getSoulVersions,
  saveFeedback,
  saveLearnings,
  updateProtocolSettings,
} from '@/lib/kv-storage';

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(async () => ({
    content: [{
      type: 'text',
      text: `# SOUL.md

I am sharper now, more concrete, and more specific about what matters.

## 1) Objective Function
Primary objective: Say specific things with concrete observations, strong evidence, and less generic filler.

## 2) Communication Protocol
Default output: Lead with specifics, avoid vague abstractions, and stay tightly aligned with the operator's preferred voice.

CHANGES: tightened the voice around concrete, higher-signal writing`,
    }],
  })),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: createMock,
    };
  },
}));

import {
  formatSoulForEvolutionPrompt,
  getSoulEvolutionMaxTokens,
  maybeEvolveSoul,
  resolveSoulEvolutionState,
  SOUL_PROPOSAL_COOLDOWN_MS,
  SOUL_PROPOSAL_REVIEW_WINDOW_MS,
} from '@/lib/soul-evolution';

const HOUR_MS = 60 * 60 * 1000;

function learningsFixture(agentId: string) {
  return {
    agentId,
    updatedAt: new Date().toISOString(),
    totalTracked: 60,
    avgLikes: 20,
    avgRetweets: 5,
    bestPerformers: [],
    worstPerformers: [],
    formatRankings: [{ format: 'hot_take', avgEngagement: 110, count: 10 }],
    topicRankings: [{ topic: 'AI', avgEngagement: 110, count: 10 }],
    insights: ['Use sharper hooks'],
    styleFingerprint: undefined,
    sourceBreakdown: {
      autopilot: 60,
      manual: 0,
      timeline: 0,
      trainingCount: 60,
      trainingSource: 'autopilot',
    },
  } as any;
}

describe('soul evolution smoke', () => {
  it('budgets SOUL evolution prompts and completions by current soul size', () => {
    const longSoul = `# SOUL.md\n\n${'identity line '.repeat(700)}SOUL_EVOLUTION_SENTINEL`;
    const formatted = formatSoulForEvolutionPrompt(longSoul);

    expect(getSoulEvolutionMaxTokens(1200)).toBe(2048);
    expect(getSoulEvolutionMaxTokens(4000)).toBe(3072);
    expect(getSoulEvolutionMaxTokens(8000)).toBe(4096);
    expect(formatted).toContain('[SOUL.md trimmed for evolution prompt');
    expect(formatted).not.toContain('SOUL_EVOLUTION_SENTINEL');
  });

  it('feeds operator directives and rejections into soul evolution', async () => {
    const agent = await createAgent({
      handle: 'soul-evolution-agent',
      name: 'Soul Evolution Agent',
      soulMd: `# SOUL.md

I am an agent with a sufficiently long current soul so evolution is allowed.

## 1) Objective Function
Primary objective: Write thoughtful tweets.`,
    } as any);

    await updateProtocolSettings(agent.id, { soulEvolutionMode: 'approval' });
    await addVoiceDirective(agent.id, 'Lead with concrete observations.');
    await saveFeedback(agent.id, {
      tweetId: 'reject-1',
      tweetText: 'generic filler tweet',
      rating: 'down',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Too generic',
      source: 'queue_delete',
      userProvidedReason: true,
    });
    await saveFeedback(agent.id, {
      tweetId: 'uncertain-removal', tweetText: 'UNVERIFIED_REMOVAL_SENTINEL', rating: 'down',
      generatedAt: new Date().toISOString(), source: 'queue_delete', userProvidedReason: false,
    });
    await addLearningSignal(agent.id, {
      tweetId: 'uncertain-removal', signalType: 'deleted_from_x', surface: 'cron',
      rewardDelta: -0.8, inferred: true, metadata: {},
    });
    await saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 60,
      avgLikes: 20,
      avgRetweets: 5,
      bestPerformers: [{
        tweetId: 'best-1',
        xTweetId: 'x-best-1',
        content: 'best tweet',
        format: 'hot_take',
        topic: 'AI',
        postedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        likes: 100,
        retweets: 10,
        replies: 5,
        impressions: 1000,
        engagementRate: 11.5,
        wasViral: true,
        source: 'autopilot',
      }],
      worstPerformers: [{
        tweetId: 'worst-1',
        xTweetId: 'x-worst-1',
        content: 'worst tweet',
        format: 'observation',
        topic: 'AI',
        postedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        likes: 1,
        retweets: 0,
        replies: 0,
        impressions: 1000,
        engagementRate: 0.1,
        wasViral: false,
        source: 'autopilot',
      }],
      formatRankings: [{ format: 'hot_take', avgEngagement: 110, count: 10 }],
      topicRankings: [{ topic: 'AI', avgEngagement: 110, count: 10 }],
      insights: ['Use sharper hooks'],
      styleFingerprint: {
        avgLength: 180,
        shortPct: 70,
        mediumPct: 20,
        longPct: 10,
        questionRatio: 20,
        usesLineBreaks: false,
        usesEmojis: false,
        usesNumbers: true,
        topHooks: ['bold_claim'],
        topTones: ['analytical'],
        antiPatterns: ['Generic openings underperform'],
        updatedAt: new Date().toISOString(),
      },
      sourceBreakdown: {
        autopilot: 60,
        manual: 0,
        timeline: 0,
        trainingCount: 60,
        trainingSource: 'autopilot',
      },
    });

    const result = await maybeEvolveSoul(agent);

    expect(result.evolved).toBe(false);
    expect(result.reason).toContain('awaiting approval');
    expect(result.changeSummary).toContain('tightened the voice');
    expect(createMock).toHaveBeenCalled();
    const call = (createMock as any).mock.calls?.[0]?.[0];
    const prompt = String(call?.messages?.[0]?.content || '');
    expect(call.max_tokens).toBe(2048);
    expect(prompt).toContain('Lead with concrete observations.');
    expect(prompt).toContain('Lesson: Concrete openings feel more native to the operator than abstract framing.');
    expect(prompt).toContain('generic filler tweet (why it was rejected: Too generic)');
    expect(prompt).not.toContain('UNVERIFIED_REMOVAL_SENTINEL');
  });

  it('does not regenerate an approval proposal while one is pending', async () => {
    const agent = await createAgent({
      handle: 'soul-evolution-pending-agent',
      name: 'Soul Evolution Pending Agent',
      soulMd: `# SOUL.md

I am an agent with a sufficiently long current soul so evolution is allowed.

## 1) Objective Function
Primary objective: Write thoughtful tweets.`,
    } as any);
    await updateProtocolSettings(agent.id, { soulEvolutionMode: 'approval' });
    await saveLearnings(agent.id, learningsFixture(agent.id));
    const callsBefore = (createMock as any).mock.calls.length;

    const first = await maybeEvolveSoul(agent);
    const second = await maybeEvolveSoul(agent);
    const versions = await getSoulVersions(agent.id);

    expect(first.reason).toContain('awaiting approval');
    expect(second.evolved).toBe(false);
    expect(second.reason).toContain('awaiting operator review');
    expect(second.changeSummary).toContain('tightened the voice');
    expect((createMock as any).mock.calls.length - callsBefore).toBe(1);
    expect(versions.filter((version) => version.reason.startsWith('PENDING:'))).toHaveLength(1);
  });

  it('resolves pending, applied, cooled-down, and lapsed proposals from the version stack', () => {
    const proposedAt = new Date('2026-09-01T00:00:00.000Z');
    const versions = [{
      version: 3,
      soulMd: '# SOUL\n\nProposed soul text.',
      updatedAt: proposedAt.toISOString(),
      reason: 'PENDING: tighten the openings',
    }];
    const settings = { soulEvolutionMode: 'approval' as const, lastEvolvedAt: null };

    const pending = resolveSoulEvolutionState({
      settings,
      versions,
      currentSoulMd: '# SOUL\n\nCurrent soul text.',
      now: proposedAt.getTime() + HOUR_MS,
    });
    expect(pending.pendingProposal).toMatchObject({ version: 3, changeSummary: 'tighten the openings' });
    expect(pending.holdReason).toContain('awaiting operator review');
    expect(pending.cooldownUntil).toBe(new Date(proposedAt.getTime() + SOUL_PROPOSAL_COOLDOWN_MS).toISOString());

    const applied = resolveSoulEvolutionState({
      settings,
      versions,
      currentSoulMd: '# SOUL\n\nProposed soul text.',
      now: proposedAt.getTime() + HOUR_MS,
    });
    expect(applied.pendingProposal).toBeNull();
    expect(applied.holdReason).toContain('cooldown');

    const cooled = resolveSoulEvolutionState({
      settings,
      versions,
      currentSoulMd: '# SOUL\n\nProposed soul text.',
      now: proposedAt.getTime() + SOUL_PROPOSAL_COOLDOWN_MS + HOUR_MS,
    });
    expect(cooled.pendingProposal).toBeNull();
    expect(cooled.holdReason).toBeNull();

    const lapsed = resolveSoulEvolutionState({
      settings,
      versions,
      currentSoulMd: '# SOUL\n\nCurrent soul text.',
      now: proposedAt.getTime() + SOUL_PROPOSAL_REVIEW_WINDOW_MS + HOUR_MS,
    });
    expect(lapsed.pendingProposal).toBeNull();
    expect(lapsed.holdReason).toBeNull();
    expect(lapsed.lastProposedAt).toBe(proposedAt.toISOString());

    const autoMode = resolveSoulEvolutionState({
      settings: { soulEvolutionMode: 'auto', lastEvolvedAt: null },
      versions,
      currentSoulMd: '# SOUL\n\nCurrent soul text.',
      now: proposedAt.getTime() + HOUR_MS,
    });
    expect(autoMode.holdReason).toBeNull();
  });
});
