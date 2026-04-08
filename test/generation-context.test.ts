import { describe, expect, it, vi } from 'vitest';
import {
  addRemixEntry,
  addVoiceDirective,
  getVoiceDirectiveRules,
  createAgent,
  createTweet,
  saveFeedback,
  saveLearnings,
  saveStyleSignals,
  saveAnalysis,
} from '@/lib/kv-storage';
import { buildGenerationContext } from '@/lib/generation-context';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {},
}));

describe('generation context', () => {
  it('includes operator learning signals and orders directives oldest to newest', async () => {
    const agent = await createAgent({
      handle: 'context-agent-1',
      name: 'Context Agent 1',
      soulMd: '# SOUL\n\nSharp and specific.',
    } as any);

    await saveStyleSignals(agent.id, {
      sentenceLength: 'short',
      vocabulary: 'mixed',
      toneMarkers: ['sharp'],
      topicPreferences: ['AI'],
      rawExtraction: 'Wizard voice fingerprint',
    });

    await saveFeedback(agent.id, {
      tweetId: 'bad-1',
      tweetText: 'bad tweet',
      rating: 'down',
      generatedAt: new Date().toISOString(),
      intentSummary: 'Too vague',
      source: 'queue_delete',
      userProvidedReason: true,
    });

    await addRemixEntry(agent.id, {
      direction: 'shorter',
      originalContent: 'original 1',
      remixedContent: 'remix 1',
      ts: new Date().toISOString(),
    });
    await addRemixEntry(agent.id, {
      direction: 'shorter',
      originalContent: 'original 2',
      remixedContent: 'remix 2',
      ts: new Date().toISOString(),
    });
    await addRemixEntry(agent.id, {
      direction: 'shorter',
      originalContent: 'original 3',
      remixedContent: 'remix 3',
      ts: new Date().toISOString(),
    });

    await addVoiceDirective(agent.id, 'Use calmer endings.');
    await addVoiceDirective(agent.id, 'Lead with specifics.');

    await createTweet({
      agentId: agent.id,
      content: 'already queued tweet',
      type: 'original',
      status: 'queued',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const context = await buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 });
    const directiveRules = await getVoiceDirectiveRules(agent.id);

    expect(context.voiceProfile.communicationStyle).toContain('Style analysis: Wizard voice fingerprint');
    expect(context.voiceProfile.communicationStyle).toContain('bad tweet (why it was rejected: Too vague)');
    expect(context.voiceProfile.communicationStyle).toContain('Keep tweets short and punchy');
    expect(context.voiceProfile.communicationStyle).toContain('1. Land tweets with calm, restrained endings.');
    expect(context.voiceProfile.communicationStyle).toContain('2. Open tweets with specific details before abstractions.');
    expect(context.voiceProfile.communicationStyle).toContain('Raw coaching: Use calmer endings.');
    expect(context.voiceProfile.communicationStyle).toContain('Lesson: Concrete openings feel more native to the operator than abstract framing.');
    expect(context.memory.identityConstraints.some((item) => item.includes('Concrete openings feel more native'))).toBe(true);
    expect(directiveRules.filter((rule) => rule.status === 'active')).toHaveLength(2);
    expect(context.recentPosts).toContain('already queued tweet');
    expect(context.style.exploration.rate).toBe(35);
    expect(context.style.exploration.underusedFormats).toContain('question');
    expect(context.style.banditPolicy?.formatArms.length).toBeGreaterThan(0);
    expect(context.style.banditPolicy?.summary.some((entry) => entry.startsWith('Explore format:'))).toBe(true);
  });

  it('stops injecting stale wizard style once live learnings are established', async () => {
    const agent = await createAgent({
      handle: 'context-agent-2',
      name: 'Context Agent 2',
      soulMd: '# SOUL\n\nConfident.',
    } as any);

    await saveStyleSignals(agent.id, {
      sentenceLength: 'long',
      vocabulary: 'technical',
      toneMarkers: ['dense'],
      topicPreferences: ['AI'],
      rawExtraction: 'Old wizard style',
    });

    await saveAnalysis(agent.id, {
      agentId: agent.id,
      analyzedAt: new Date().toISOString(),
      tweetCount: 10,
      viralTweets: [],
      engagementPatterns: {
        avgLikes: 10,
        avgRetweets: 2,
        avgReplies: 1,
        avgImpressions: 500,
        topHours: [14],
        topFormats: ['hot_take'],
        topTopics: ['AI'],
        viralThreshold: 30,
      },
      followingProfile: {
        totalFollowing: 10,
        topAccounts: [],
        categories: [],
      },
      contentFingerprint: 'fingerprint',
    });

    await saveLearnings(agent.id, {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 12,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: ['Use sharper openings'],
      sourceBreakdown: {
        autopilot: 12,
        manual: 0,
        timeline: 0,
        trainingCount: 12,
        trainingSource: 'autopilot',
      },
    });

    const context = await buildGenerationContext(agent);
    expect(context.voiceProfile.communicationStyle).not.toContain('Old wizard style');
  });
});
