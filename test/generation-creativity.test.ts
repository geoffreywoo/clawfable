import { describe, expect, it } from 'vitest';
import {
  buildGenerationBriefsV2,
  buildTweetWritingPromptV2,
  buildVoiceGuidanceV2,
  hydrateDynamicSeedEvidenceV2,
  selectQualifiedExplorationV2,
  type GenerateTweetBatchV2Input,
  type GenerationBriefV2,
} from '@/lib/generation-v2';
import { buildPersonalizationMemoryPrompt, PERSONALIZATION_MEMORY_PROMPT_HEADER } from '@/lib/personalization-memory-prompt';
import { pickGeoffreyIdeaSeed } from '@/lib/frontier-idea-seeds';
import type { DynamicIdeaSeed } from '@/lib/seed-synthesis';
import type { RankedPublishingCandidate } from '@/lib/publishing-candidate';
import type { IdeaCandidate, PersonalizationMemory, SourceDocument, StoryCluster } from '@/lib/types';

const now = new Date('2026-09-04T12:00:00Z');
const voiceProfile = { tone: 'plain', topics: ['crypto', 'election coverage'], antiGoals: [], communicationStyle: 'Independent reporter.', summary: 'A reporter covering crypto and elections.' };
const planningInput = {
  count: 2, stories: [], documents: [], voiceProfile,
  analysis: { engagementPatterns: { topTopics: [] } }, learnings: null,
  style: { trendMixTarget: 0, trendTolerance: 'moderate', exploration: { rate: 35, underusedTopics: [] } },
  trending: [], allTweets: [], signals: [], memory: null,
} as unknown as Parameters<typeof buildGenerationBriefsV2>[0] & GenerateTweetBatchV2Input;

const nativeBrief: GenerationBriefV2 = {
  id: 'native-1', topic: 'manufacturing', title: 'manufacturing', summary: 'A native subject.',
  authorOpportunity: 'Make an original judgment.', sourceLane: 'manual_core_exploit',
  storyClusterId: null, evidenceMode: 'operator_opinion', evidenceIds: [], sourceDocumentIds: [],
  qualifiedClaimIds: [], evidence: [], sourceBrief: 'Subject only, never evidence.',
  trendTopicId: null, trendHeadline: null, identityScore: 0.9, evidenceScore: 0.5, freshnessScore: 0.5,
};
const seed: DynamicIdeaSeed = {
  id: 'dynamic-1', kind: 'frontier', topic: 'manufacturing', technicalObject: 'factory inspection cameras',
  hiddenConstraint: 'An unverified seed hypothesis.', nonConsensusImplication: 'A provocative inference.',
  startupBackingFact: '', domains: ['manufacturing'], sourceQueries: [], synthesizedAt: now.toISOString(),
  sourceDocumentIds: ['doc-1'], provenance: 'research_synthesis',
};
const document: SourceDocument = {
  id: 'doc-1', agentId: 'agent-1', fetchedAt: now.toISOString(), publishedAt: now.toISOString(),
  title: 'Factory adds inspection cameras', publisher: 'Factory filing', canonicalUrl: 'https://example.com/filing',
  isPrimary: true, entities: [], claims: [
    { id: 'claim-1', text: 'The factory added two inspection cameras.', kind: 'fact', confidence: 0.95, entities: [] },
    { id: 'claim-unqualified', text: 'The factory can replace every worker.', kind: 'fact', confidence: 0.2, entities: [] },
  ],
} as SourceDocument;
const story: StoryCluster = {
  id: 'story-1', agentId: 'agent-1', topic: 'manufacturing', title: document.title, summary: 'A camera expansion.',
  sourceDocumentIds: ['doc-1'], qualifiedClaimIds: ['claim-1'], entities: [], primarySourceCount: 1, independentSourceCount: 1,
  evidenceQualified: true, blockReason: null, blockedUntil: null,
  scores: { identityFit: 0.9, evidenceStrength: 0.9, consequence: 0.8, freshness: 0.9, total: 0.9, novelty: 0.8, networkMomentum: 0.5 },
} as StoryCluster;

function candidate(id: string, margin = 0.9, overrides: Partial<RankedPublishingCandidate> = {}): RankedPublishingCandidate {
  const contents: Record<string, string> = {
    base: 'Camera installation has a much shorter payback period than adding another warehouse.',
    alt: 'Replacing broken valves before winter seems like the municipal decision worth measuring.',
    alt2: 'Insurance renewal negotiations would tell me more than another launch video.',
    keep: 'Curriculum experiments become useful when teachers can actually stop the failed ones.',
    weak: 'Cold storage is where the physical distribution costs become concrete.',
  };
  return {
    content: contents[id] || `A distinct observation about ${id}.`, format: id === 'base' ? 'observation' : 'short_punch',
    draftCandidateId: id, ideaId: `idea-${id}`, storyClusterId: null, targetTopic: 'operations',
    judgeBreakdown: { qualityMargin: margin, viralityUpside: 0, learnedArmPrior: 0 },
    featureTags: { hook: 'observation', tone: 'direct', structure: 'single_statement', specificity: 'concrete', riskFlags: [] },
    finalCriticVerdict: 'allow', experimentHoldout: false, ...overrides,
  } as RankedPublishingCandidate;
}

function explorationInput(rate = 100): GenerateTweetBatchV2Input {
  return { ...planningInput, count: 2, style: { ...planningInput.style, exploration: { rate, underusedTopics: [], underusedFormats: [] },
    banditPolicy: { formatArms: [{ arm: 'observation', coldStart: false, localPulls: 9 }, { arm: 'short_punch', coldStart: true, localPulls: 0 }], hookArms: [{ arm: 'observation', coldStart: false, localPulls: 9 }] },
  } } as unknown as GenerateTweetBatchV2Input;
}

describe('creative learning inputs', () => {
  it('retains another author\'s crypto and election subjects', () => {
    expect(buildGenerationBriefsV2(planningInput).map((brief) => brief.topic)).toEqual(['crypto', 'election coverage']);
  });

  it('removes raw rejected and edited prose from every ideation memory position', () => {
    for (const leading of [true, false]) {
      const memory = { alwaysDoMoreOfThis: leading ? [] : ['Keep the direct judgment.'],
        rejectedDrafts: ['RAW_REJECTED_PREMISE'], editTransformations: ['Before RAW_OLD_DRAFT after RAW_APPROVED_DRAFT'] } as PersonalizationMemory;
      const communicationStyle = `Native base.\n\n${PERSONALIZATION_MEMORY_PROMPT_HEADER}\n${buildPersonalizationMemoryPrompt(memory)}`;
      const ideaGuidance = buildVoiceGuidanceV2({ communicationStyle }, { budget: 6000, includeRawProse: false });
      expect(JSON.stringify(ideaGuidance)).not.toMatch(/RAW_REJECTED_PREMISE|RAW_OLD_DRAFT|RAW_APPROVED_DRAFT/);
      expect(JSON.stringify(buildVoiceGuidanceV2({ communicationStyle }, { budget: 6000, includeRawProse: true }))).toContain('RAW_APPROVED_DRAFT');
    }
  });

  it('gives the writer a complete approved pair and explicit substantive job', () => {
    const after = `${'A natural edited observation. '.repeat(9)}COMPLETE_AFTER_END`;
    const prompt = JSON.parse(buildTweetWritingPromptV2({ id: 'idea-1', topic: 'manufacturing', publicMove: 'I prefer checking actual yield.', claim: 'I prefer checking actual yield.', tension: 'An uncertain comparison.', implication: 'A conditional consequence.' } as IdeaCandidate,
      nativeBrief, [], [], undefined, undefined, undefined, 'reconceive', 1, null, false, voiceProfile,
      [{ signalId: 'signal-1', before: 'Polished consultant copy.', after, lesson: 'Keep the direct call.', createdAt: now.toISOString() }], 'unexpected_consequence'));
    expect(prompt.approvedEditExamples.examples[0].after).toBe(after);
    expect(prompt.responseContract.variantMoves[0].move).toBe('unexpected_consequence');
    expect(prompt.responseContract.independentCreativeMove.instruction).toContain('already present');
  });

  it('lets another author use their own relevant seed without inheriting Geoffrey\'s catalog', () => {
    expect(pickGeoffreyIdeaSeed({ voiceProfile, targetTopic: 'crypto', slot: 0 })).toBeNull();
    const ownSeed = { ...seed, topic: 'crypto', technicalObject: 'crypto custody contracts', domains: ['crypto'] };
    expect(pickGeoffreyIdeaSeed({ voiceProfile, targetTopic: 'crypto custody contracts', slot: 0, extraSeeds: [ownSeed] })?.id).toBe(seed.id);
  });
});

describe('research seed evidence rehydration', () => {
  it('carries only currently qualified factual atoms while retaining native topic provenance', () => {
    const hydrated = hydrateDynamicSeedEvidenceV2(nativeBrief, seed, [story], [document], now);
    expect(hydrated).toMatchObject({ sourceLane: 'manual_core_exploit', evidenceMode: 'verified_source', storyClusterId: story.id, sourceDocumentIds: ['doc-1'] });
    expect(hydrated.evidence.map((entry) => entry.claim)).toEqual([document.claims[0].text]);
    expect(hydrated.evidence).not.toContainEqual(expect.objectContaining({ claim: seed.hiddenConstraint }));
  });

  it.each([
    ['revoked qualification', { ...story, evidenceQualified: false }, document, seed],
    ['blocked story', { ...story, blockedUntil: '2026-09-05T00:00:00Z' }, document, seed],
    ['missing qualified claim', { ...story, qualifiedClaimIds: [] }, document, seed],
    ['old source read', story, { ...document, fetchedAt: '2026-07-01T00:00:00Z' }, seed],
    ['wrong account source', story, { ...document, agentId: 'someone-else' }, seed],
    ['expired seed', story, document, { ...seed, synthesizedAt: '2026-07-01T00:00:00Z' }],
  ])('keeps %s out of the factual packet', (_label, currentStory, currentDocument, currentSeed) => {
    expect(hydrateDynamicSeedEvidenceV2(nativeBrief, currentSeed as DynamicIdeaSeed, [currentStory as StoryCluster], [currentDocument as SourceDocument], now)).toBe(nativeBrief);
  });
});

describe('qualified exploration selection', () => {
  it('swaps at most one near-tie and records the actual randomized pool and propensity', () => {
    const selected = [candidate('keep', 0.97), candidate('base')];
    const result = selectQualifiedExplorationV2({ selected, qualifiedCandidates: [candidate('alt', 0.875), candidate('alt2', 0.88), candidate('weak', 0.86)], input: explorationInput(50), random: () => 0 });
    expect(result[0].draftCandidateId).toBe('keep');
    expect(result[1].draftCandidateId).toBe('alt');
    expect(result.filter((entry) => entry.experimentHoldout)).toHaveLength(1);
    expect(result[1].generationSelection).toEqual({ mode: 'explore', eligibleDraftIds: ['base', 'alt', 'alt2'], propensity: 0.25, explorationRate: 0.5, qualityMarginTolerance: 0.03 });
  });

  it('records the exploit probability when the configured draw retains the baseline', () => {
    const result = selectQualifiedExplorationV2({ selected: [candidate('base')], qualifiedCandidates: [candidate('alt', 0.875)], input: explorationInput(20), random: () => 0.5 });
    expect(result[0].draftCandidateId).toBe('base');
    expect(result[0].generationSelection).toMatchObject({ mode: 'exploit', propensity: 0.8, eligibleDraftIds: ['base', 'alt'] });
    expect(result[0].experimentHoldout).toBe(false);
  });

  it('measures near-ties against the best feasible margin, even when weighted ranking favored a weaker baseline', () => {
    const baseline = candidate('base', 0.9, { judgeBreakdown: { ...candidate('base').judgeBreakdown!, qualityMargin: 0.9, viralityUpside: 1, learnedArmPrior: 1 } });
    const result = selectQualifiedExplorationV2({ selected: [baseline],
      qualifiedCandidates: [candidate('alt', 0.88), candidate('alt2', 0.95)], input: explorationInput(50), random: () => 0 });
    expect(result[0].draftCandidateId).toBe('alt2');
    expect(result[0].generationSelection).toMatchObject({ eligibleDraftIds: ['base', 'alt2'], propensity: 0.5 });
  });

  it('honors zero exploration and refuses duplicates, consumed ideas, and question-budget violations', () => {
    const selected = [candidate('keep', 0.97), candidate('base')];
    const invalid = [candidate('alt', 0.88, { content: selected[0].content }), candidate('alt2', 0.88, { ideaId: 'idea-keep' }),
      candidate('question', 0.88, { content: 'Would another insurance negotiation change the buyer decision?' })];
    const input = explorationInput();
    input.learnings = { operatorVoiceReference: { styleFingerprint: { questionRatio: 0 } } } as GenerateTweetBatchV2Input['learnings'];
    expect(selectQualifiedExplorationV2({ selected, qualifiedCandidates: invalid, input, random: () => 0 }).map((entry) => entry.draftCandidateId)).toEqual(['keep', 'base']);
    expect(selectQualifiedExplorationV2({ selected, qualifiedCandidates: [candidate('alt')], input: explorationInput(0), random: () => { throw new Error('No random draw at zero rate'); } }).map((entry) => entry.draftCandidateId)).toEqual(['keep', 'base']);
  });
});
