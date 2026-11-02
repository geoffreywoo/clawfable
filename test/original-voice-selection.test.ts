import { describe, expect, it } from 'vitest';
import { selectOriginalProductionVoiceExamples } from '@/lib/original-voice-selection';
import type { DraftCandidate, Tweet, TweetPerformance } from '@/lib/types';

const reference = (id: string, topic: string, content: string, extra: Partial<TweetPerformance> = {}): TweetPerformance => ({
  xTweetId: id, topic, content, source: 'timeline', authorshipProvenance: 'timeline_unmatched',
  voiceCorpusDispositions: ['diction_anchor'], ...extra,
} as TweetPerformance);
const attestation = { id: 'authorship', agentId: 'account', scope: 'posts_published_outside_clawfable' as const,
  source: 'explicit_owner_statement' as const, statement: 'I write my outside posts.', recordedAt: '2026-01-01T00:00:00Z' };
function fixture() {
  // A ten-reference bank with the same prefix/starvation shape as the audited
  // account, using synthetic copy rather than caching the owner's samples.
  const references = [
    reference('vc-1', 'startups', 'founder updates are useful when they contain the actual bad news'),
    reference('vc-2', 'investing', 'i bought more memory stocks but did not have the courage to swing big'),
    reference('vc-3', 'startups', 'would an investor take this meeting without a deck?'),
    reference('vc-4', 'investing', 'capital is patient until the next fundraise'),
    reference('vc-5', 'startups', 'a board meeting.\n\na bad month.\n\nwrite the difficult email first.'),
    reference('vc-6', 'investing', 'a 10% stake gets expensive when nobody asks about dilution'),
    reference('ai-1', 'AI', 'did anyone get more utility out of the new model?'),
    reference('ai-2', 'AI', 'ai will rule the world through human shells'),
    reference('ai-3', 'AI', 'i want to run the inference job while i am asleep'),
    reference('life-1', 'personal', 'coffee outside. walking home. no speeches.'),
  ];
  return { agentId: 'account', references, tweets: [] as Tweet[], drafts: [] as DraftCandidate[], attestation, subjectTexts: ['AI', 'inference model releases'] };
}

describe('production authored voice selection', () => {
  it('replaces the static first three with subject-register examples and varied authored shapes', () => {
    const f = fixture(), before = structuredClone(f), ai = selectOriginalProductionVoiceExamples(f);
    const vc = selectOriginalProductionVoiceExamples({ ...f, subjectTexts: ['startups', 'venture investing and board meetings'] });
    expect(ai).toHaveLength(3); expect(vc).toHaveLength(3);
    expect(ai.slice(0, 2).every(row => row.id.startsWith('ai-'))).toBe(true);
    expect(vc.slice(0, 2).every(row => row.id.startsWith('vc-'))).toBe(true);
    expect(ai.map(row => row.id)).not.toEqual(f.references.slice(0, 3).map(row => row.xTweetId));
    expect(ai.map(row => row.id)).not.toEqual(vc.map(row => row.id));
    expect(new Set(ai.map(row => row.id)).size).toBe(3);
    expect(ai.some(row => row.content.includes('?'))).toBe(true);
    expect(ai.some(row => !row.content.includes('?'))).toBe(true);
    for (const selected of [...ai, ...vc]) {
      expect(selected.content).toBe(f.references.find(row => row.xTweetId === selected.id)!.content);
      expect(selected.authorshipAttestationId).toBe(attestation.id);
      expect(['subject_register', 'cross_topic_diction', 'authored_range']).toContain(selected.selectionReason);
    }
    expect(f).toEqual(before);
  });

  it('filters all trust/whole-text exclusions before spending the three slots', () => {
    const f = fixture(), bad = [
      reference('generated', 'AI', 'generated text', { authorshipProvenance: 'known_clawfable_generated' }),
      reference('unknown', 'AI', 'unknown text', { authorshipProvenance: 'unknown' }),
      reference('mechanics', 'AI', 'mechanics text', { voiceCorpusDispositions: ['diction_anchor', 'mechanics_only'] }),
      reference('negative', 'AI', 'negative text', { voiceCorpusDispositions: ['diction_anchor', 'negative'] }),
      reference('excluded', 'AI', 'excluded text', { voiceCorpusDispositions: ['diction_anchor', 'excluded'] }),
      reference('nonanchor', 'AI', 'nonanchor text', { voiceCorpusDispositions: ['topic_signal'] }),
      reference('long', 'AI', 'x'.repeat(801)),
      reference('incomplete', 'AI', 'incomplete text', { isTextComplete: false }),
      reference('reply', 'AI', 'reply text', { referenceType: 'replied_to' }),
      reference('autopilot', 'AI', 'autopilot text', { source: 'autopilot' }),
      reference('copied', 'AI', 'copied text', { copied: true } as any),
      reference('heldout', 'AI', 'heldout text', { reservedForEvaluation: true } as any),
      reference('holdout', 'AI', 'holdout text', { holdout: true } as any),
      reference('foreign', 'AI', 'foreign text', { agentId: 'foreign' } as any),
      reference('app-linked', 'AI', 'missing app row text', { tweetId: 'missing-app-row' }),
      reference('experiment', 'AI', 'experiment text', { draftExperimentId: 'experiment' }),
      reference('batch', 'AI', 'batch text', { experimentBatchId: 'batch' }),
    ];
    const selected = selectOriginalProductionVoiceExamples({ ...f, references: [...bad, ...f.references] });
    expect(selected).toEqual(selectOriginalProductionVoiceExamples(f));
    expect(selected.every(row => !bad.some(b => b.xTweetId === row.id))).toBe(true);
  });

  it.each([
    null,
    { ...attestation, agentId: 'foreign' },
    { ...attestation, scope: 'other' },
    { ...attestation, source: 'inferred' },
    { ...attestation, id: ' ' },
  ])('does not promote unmatched timeline copy with invalid attestation %s', invalid => {
    const f = fixture();
    expect(selectOriginalProductionVoiceExamples({ ...f, attestation: invalid as any })).toEqual([]);
  });

  it('allows only an exact explicitly composed manual app match with no generated lineage', () => {
    const f = fixture();
    const manual = reference('manual', 'AI', 'the little model surprised me. try the boring task first.', { source: 'manual', authorshipProvenance: 'operator_composed' });
    const tweet = { id: 'app-manual', agentId: f.agentId, type: 'original', xTweetId: manual.xTweetId, content: manual.content, status: 'posted', contentProvenance: 'operator_written' } as Tweet;
    const options = { ...f, references: [manual], tweets: [tweet], attestation: null };
    expect(selectOriginalProductionVoiceExamples(options).map(row => row.id)).toEqual(['manual']);
    expect(selectOriginalProductionVoiceExamples({ ...options, tweets: [{ ...tweet, contentProvenance: null }] }).map(row => row.id)).toEqual(['manual']);
    for (const extra of [
      { generationModel: 'model' }, { generationProvider: 'openai' }, { pipelineVersion: 'v2' }, { contentProvenance: 'generated_v2' },
      { generationRunId: 'run' }, { candidateScore: 0 }, { judgeScore: 0 }, { sourceLane: 'manual_core_exploit' }, { draftCandidateId: 'draft' },
      { generationIdempotencyKey: 'key' }, { agentId: 'foreign' }, { xTweetId: 'other-id' }, { contentProvenance: 'historical_v1' },
      { parentTweetId: 'parent' }, { parentIdeaId: 'parent-idea' }, { draftExperimentId: 'experiment' }, { experimentBatchId: 'batch' },
    ]) expect(selectOriginalProductionVoiceExamples({ ...options, tweets: [{ ...tweet, ...extra } as Tweet] })).toEqual([]);
    expect(selectOriginalProductionVoiceExamples({ ...options, tweets: [tweet, { ...tweet, id: 'generated-conflict', generationModel: 'model' }] })).toEqual([]);
    expect(selectOriginalProductionVoiceExamples({ ...options, tweets: [{ ...tweet, content: 'Different or partial generated copy.', generationModel: 'model' }] })).toEqual([]);
    expect(selectOriginalProductionVoiceExamples({ ...options, drafts: [{ id: 'draft', content: manual.content } as DraftCandidate] })).toEqual([]);
    expect(selectOriginalProductionVoiceExamples({ ...options, references: [{ ...manual, authorshipProvenance: 'timeline_unmatched' }] })).toEqual([]);
    expect(selectOriginalProductionVoiceExamples({ ...options, references: [manual, { ...manual, authorshipProvenance: 'known_clawfable_generated' }] })).toEqual([]);
    for (const denial of [{ copied: true }, { reservedForEvaluation: true }, { holdout: true }, { experimentHoldout: true }]) {
      expect(selectOriginalProductionVoiceExamples({ ...options, references: [manual, { ...manual, ...denial } as any] })).toEqual([]);
    }
  });

  it('deduplicates exact IDs and normalized authored text without truncation', () => {
    const f = fixture();
    const selected = selectOriginalProductionVoiceExamples({ ...f, references: [
      ...f.references, { ...f.references[6] }, { ...f.references[6], xTweetId: 'duplicate-copy', content: `  ${f.references[6].content.toUpperCase()}  ` },
    ] });
    expect(selected).toEqual(selectOriginalProductionVoiceExamples(f));
  });
});
