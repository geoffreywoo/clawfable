import { describe, expect, it } from 'vitest';
import {
  ASTRA_IDEA_GENERATION_SYSTEM_V2, buildAstraIdeaGenerationPromptV2, buildGenerationBriefsV2,
  buildAstraSingleIdeaGenerationPromptV2,
  astraSubstantiveIdeaDirectionsV2,
  buildIdeaGenerationPromptV2, buildVoiceGuidanceV2, hydrateDynamicSeedEvidenceV2,
  V2_IDEA_VOICE_GUIDANCE_BUDGET_CHARS, V2_WRITER_VOICE_GUIDANCE_BUDGET_CHARS, V2_JUDGE_VOICE_GUIDANCE_BUDGET_CHARS,
  type GenerationBriefV2,
} from '@/lib/generation-v2';
import type { VoiceProfile } from '@/lib/soul-parser';
import type { SourceDocument, StoryCluster } from '@/lib/types';
import type { DynamicIdeaSeed } from '@/lib/seed-synthesis';

const geoffrey: VoiceProfile = { accountHandle: 'geoffwoo', tone: 'provocative', topics: ['AI', 'startups'],
  summary: 'A founder who takes direct positions on capital and company decisions.',
  antiGoals: ['Avoid analyst exposition.\n\n## Content Pillars\nExpose consensus masquerading as judgment.'],
  communicationStyle: `Casual, high-context, blunt.\n\n## OPERATOR VOICE DIRECTIVES\n1. Earlier model preference.\n   Lesson: A redundant wrapper.\n   Scope: topic / prefer: AI models\n   Raw coaching: Prefer OpenAI examples such as GPT-4 or o1.\n2. Updated model preference.\n   Lesson: Another wrapper.\n   Scope: topic / avoid: AI models\n   Raw coaching: Never reference GPT-4 or o1; use current or forward models.\n3. Sentence discipline.\n   Scope: hook / prefer: direct judgment\n   Raw coaching: Lead with the actual capital or product judgment.\n4. Unrelated newer topic.\n   Scope: topic / prefer: gardening\n   Raw coaching: Describe the soil before choosing a tomato variety.\nNote: Higher numbers are newer.\n\n## RECENT REJECTED DRAFTS\nRAW_REJECTED_DRAFT_DO_NOT_COPY`,
};
const other: VoiceProfile = { accountHandle: 'independent_reporter', tone: 'skeptical', topics: ['AI'], antiGoals: ['No promotional copy.'],
  communicationStyle: 'Ask a precise critical question.', summary: 'An independent technology reporter.' };
const brief: GenerationBriefV2 = { id: 'brief-1', topic: 'AI inference economics', title: 'AI inference economics',
  summary: 'An explicitly requested subject.', authorOpportunity: 'Make an owned judgment without invented facts.',
  sourceLane: 'manual_core_exploit', storyClusterId: null, evidenceMode: 'operator_opinion', evidenceIds: [], sourceDocumentIds: [],
  qualifiedClaimIds: [], evidence: [], sourceBrief: 'A subject, not evidence.', trendTopicId: null, trendHeadline: null,
  identityScore: 0.9, evidenceScore: 0.5, freshnessScore: 0.5,
  creativeSeed: { id: 'unrelated-talent-seed', kind: 'ai_product', object: 'a researcher choosing which company to join',
    hiddenConstraint: 'Career moves depend on ambition.', nonConsensusDirection: 'Make a talent call.', reactionPrompt: 'Choose a career direction.' },
};
const now = new Date('2026-09-04T12:00:00Z');
const planning = (voiceProfile: VoiceProfile, requestedTopic: string) => ({ count: 1, requestedTopic, voiceProfile,
  analysis: { engagementPatterns: { topTopics: voiceProfile.topics } }, learnings: null, style: { trendMixTarget: 0 },
  allTweets: [], signals: [], memory: null, stories: [], documents: [], now,
}) as unknown as Parameters<typeof buildGenerationBriefsV2>[0];

const parse = (profile = geoffrey, packet = brief) => JSON.parse(buildAstraIdeaGenerationPromptV2([packet], profile));

describe('Astra idea development contract', () => {
  it('assigns three independent substantive approaches without increasing propositions or removing evidence rules', () => {
    const prompts = [0, 1, 2].map((index) => JSON.parse(buildAstraSingleIdeaGenerationPromptV2([[brief], geoffrey], index)));
    expect(prompts.map((prompt) => prompt.requirements.ideasPerBrief)).toEqual([1, 1, 1]);
    expect(prompts.map((prompt) => prompt.requirements.independentApproach.move))
      .toEqual(['direct_conviction', 'decision_question', 'institutional_consequence']);
    for (const prompt of prompts) {
      expect(prompt.requirements.opinion).toContain('No invented current event');
      expect(prompt.requirements.frontier).toContain('ultra bullish');
      expect(prompt.briefs[0].id).toBe(brief.id);
    }
    expect(prompts[0].requirements.independentApproach.substance).toContain('Use and demand');
    expect(prompts[1].requirements.independentApproach.substance).toContain('only call assigned capital structure');
    expect(prompts[2].requirements.independentApproach.substance).toContain('Institutional scale');
    expect(astraSubstantiveIdeaDirectionsV2({ topic: 'founder ownership', title: 'founder ownership' }).map((value) => value.split(':')[0]))
      .toEqual(['Decision rights', 'Incentives and exposure', 'Liquidity and transfers']);
    const teacher = astraSubstantiveIdeaDirectionsV2({ topic: 'classroom feedback', title: 'classroom feedback' }).join(' ');
    expect(teacher).toContain('student');
    expect(teacher).not.toContain('venture financing');
    expect(() => buildAstraSingleIdeaGenerationPromptV2([[brief], geoffrey], 3)).toThrow('invalid_astra_idea_approach');
  });
  it('keeps SOUL meaning, separates malformed positive themes, and orders relevant coaching without redundant wrappers', () => {
    const prompt = parse();
    expect(prompt.author.communicationStyle).toBe('Casual, high-context, blunt.');
    expect(prompt.author.worldview).toBe(geoffrey.summary);
    expect(prompt.author.antiGoals).toEqual(['Avoid analyst exposition.']);
    expect(prompt.author.soulThemes).toEqual(['## Content Pillars\nExpose consensus masquerading as judgment.']);
    expect(prompt.author.coachingNewestFirst.map((entry: any) => entry.precedence)).toEqual([3, 2, 1]);
    expect(prompt.author.coachingNewestFirst[1].instruction).toContain('Never reference GPT-4 or o1');
    expect(JSON.stringify(prompt)).not.toContain('redundant wrapper');
    expect(JSON.stringify(prompt)).not.toContain('RAW_REJECTED_DRAFT_DO_NOT_COPY');
    expect(ASTRA_IDEA_GENERATION_SYSTEM_V2).toContain('only when they conflict on the same subject');
  });

  it('preserves the latest complete correction when long old coaching exceeds every stage guidance budget', () => {
    const correction = 'Never reference GPT-4 or o1; use current or forward models. Do not make an exception for an OpenAI example.';
    const old = `Prefer GPT-4 or o1. ${'Outdated example with irrelevant detail. '.repeat(180)}`;
    const profile = { ...geoffrey, communicationStyle: `Casual.\n\n## OPERATOR VOICE DIRECTIVES\n1. Earlier model preference.\n   Lesson: ${'Old lesson wrapper. '.repeat(160)}\n   Scope: topic / prefer: AI models\n   Raw coaching: ${old}\n2. Latest model correction.\n   Scope: topic / avoid: AI models\n   Raw coaching: ${correction}\nNote: If any directives seem contradictory, prefer the MORE RECENT ones (higher numbers).` };
    const prompt = parse(profile);
    expect(prompt.author.coachingNewestFirst).toEqual([{ precedence: 2, instruction: correction }]);
    for (const budget of [V2_IDEA_VOICE_GUIDANCE_BUDGET_CHARS, V2_WRITER_VOICE_GUIDANCE_BUDGET_CHARS, V2_JUDGE_VOICE_GUIDANCE_BUDGET_CHARS]) {
      const guidance = buildVoiceGuidanceV2(profile, { budget, includeRawProse: true });
      const body = guidance.learnedSections[0].body;
      expect(body).toContain(correction);
      expect(body).toContain('higher numbers');
      expect(body).not.toContain('Earlier model preference');
      expect(body).not.toContain('Outdated example');
      expect(body.length + guidance.learnedSections[0].heading.length).toBeLessThanOrEqual(budget);
    }
  });

  it('retains an indivisible newest correction rather than clipping its final exception', () => {
    const correction = `${'Use concrete account-specific observations. '.repeat(65)}Never invent a personal experience to satisfy this rule.`;
    const profile = { ...geoffrey, communicationStyle: `Casual.\n\n## OPERATOR VOICE DIRECTIVES\n1. Older rule.\n   Raw coaching: Tell an invented first-person story.\n2. Newest rule.\n   Lesson: ${'Redundant wrapper. '.repeat(200)}\n   Raw coaching: ${correction}\nNote: Higher numbers are newer.` };
    expect(parse(profile).author.coachingNewestFirst).toEqual([{ precedence: 2, instruction: correction }]);
    const shared = buildVoiceGuidanceV2(profile, { budget: V2_IDEA_VOICE_GUIDANCE_BUDGET_CHARS, includeRawProse: false });
    expect(shared.learnedSections[0].body).toContain(correction);
    expect(shared.learnedSections[0].body).not.toContain('Redundant wrapper');
    expect(shared.learnedSections[0].body).not.toContain('invented first-person story');
  });

  it('preserves a sole oversized rule when no chronology note is rendered', () => {
    const instruction = `${'Use a concrete subject. '.repeat(130)}Never invent personal experience, even when it would make the subject concrete.`;
    const profile = { ...geoffrey, communicationStyle: `Casual.\n\n## OPERATOR VOICE DIRECTIVES\n1. Only coaching rule.\n   Lesson: ${'Repeated lesson. '.repeat(280)}\n   Raw coaching: ${instruction}` };
    const shared = buildVoiceGuidanceV2(profile, { budget: V2_IDEA_VOICE_GUIDANCE_BUDGET_CHARS, includeRawProse: false });
    expect(shared.learnedSections[0].body).toContain(instruction);
    expect(shared.learnedSections[0].body).not.toContain('Repeated lesson');
    expect(parse(profile).author.coachingNewestFirst).toEqual([{ precedence: 1, instruction }]);
  });

  it('preserves three distinct public moves, independently safe opinion fields, and the exact frontier stance', () => {
    const prompt = parse();
    expect(prompt.requirements.ideasPerBrief).toBe(3);
    expect(ASTRA_IDEA_GENERATION_SYSTEM_V2).toContain('three materially different ideas');
    expect(ASTRA_IDEA_GENERATION_SYSTEM_V2).toContain('Vary what the author notices or believes');
    expect(prompt.requirements.opinion).toContain('Every field independently');
    expect(prompt.requirements.opinion).toContain('No invented current event');
    expect(prompt.requirements.opinion).toContain('personal experience, habit, or emotion');
    expect(prompt.requirements.opinion).toContain('every repeated number stays explicitly subjective');
    expect(prompt.requirements.frontier).toContain('6–12 months');
    for (const baseline of ['OpenAI at trillion scale', 'ChatGPT as a verb', 'coding agents on frontier engineering', 'robots piloting', 'one agent-built unicorn', 'one model obviating one startup team']) {
      expect(prompt.requirements.frontier).toContain(baseline);
    }
    expect(prompt.requirements.frontier).toContain('ultra bullish');
    expect(prompt.requirements.frontier).toContain('At most one proposition prints a horizon');
    expect(prompt.requirements.frontier).toContain('do not print a horizon/conditional/mechanism/consequence worksheet');
    expect(prompt.briefs[0].inspiration).toBeNull();
    expect(prompt.requirements).not.toHaveProperty('portfolio');
    expect(prompt.requirements).not.toHaveProperty('evidence');
  });

  it('retains qualified facts verbatim, attribution, numerical scope, roles, and stripped-event boundaries without duplicate source prose', () => {
    const sourced = { ...brief, evidenceMode: 'verified_source' as const, evidenceIds: ['source-1'], qualifiedClaimIds: ['claim-1'],
      sourceDocumentIds: ['source-1'], sourceBrief: 'DUPLICATE_SOURCE_WRAPPER_NOT_NEEDED',
      operatorTopicContext: { entityRoles: [{ name: 'Example investor', role: 'person' }], strippedEventTerms: ['acquired'], relationshipStatus: 'unverified' } as never,
      evidence: [{ sourceDocumentId: 'source-1', claimId: 'claim-1', publisher: 'Example filing', publishedAt: now.toISOString(),
        claim: 'The company reports that 12 customers tested its service.' }],
    };
    const prompt = parse(geoffrey, sourced);
    expect(prompt.briefs[0].allowedEvidenceIds).toEqual(['source-1']);
    expect(prompt.briefs[0].evidence[0]).toMatchObject({ claim: sourced.evidence[0].claim, publisher: 'Example filing', publishedAt: now.toISOString() });
    expect(prompt.briefs[0].operatorTopicContext).toEqual(sourced.operatorTopicContext);
    expect(prompt.requirements.evidence).toContain('Preserve who says/reports it and its numerical scope');
    expect(prompt.requirements.subject).toContain('infer no relationships and never restore stripped event terms');
    expect(prompt.requirements).not.toHaveProperty('opinion');
    expect(JSON.stringify(prompt)).not.toContain('DUPLICATE_SOURCE_WRAPPER_NOT_NEEDED');
  });

  it('shares safe historical fingerprint projection across both stacks and omits raw failed-idea prose in Astra', () => {
    const historical = JSON.stringify({ source: 'generated_post', coverage: 'A RAW HISTORICAL SENTENCE THAT MUST NEVER BECOME AN IDEA',
      topic: 'A SECOND RAW SENTENCE', semanticKey: 'inference:cost:buyer' });
    const retry = [{ briefId: brief.id, attempts: [{ publicMove: 'RAW_FAILED_PUBLIC_MOVE_DO_NOT_COPY', claim: 'RAW_FAILED_CLAIM',
      tension: 'RAW_FAILED_TENSION', implication: 'RAW_FAILED_IMPLICATION', rejectionCodes: ['unsupported_operator_fact'] }] }];
    const control = JSON.parse(buildIdeaGenerationPromptV2([brief], geoffrey, [historical]));
    const astra = JSON.parse(buildAstraIdeaGenerationPromptV2([brief], geoffrey, [historical], undefined, [], [], retry));
    expect(control.previousPremises).toEqual([{ source: 'generated_post', semanticKey: 'cost:customer:inference' }]);
    for (const prompt of [control, astra]) {
      expect(JSON.stringify(prompt)).not.toContain('A RAW HISTORICAL SENTENCE');
      expect(JSON.stringify(prompt)).not.toContain('A SECOND RAW SENTENCE');
    }
    expect(astra.retry.failures[0].attempts[0].rejectionCodes).toEqual(['unsupported_operator_fact']);
    expect(JSON.stringify(astra)).not.toContain('RAW_FAILED_PUBLIC_MOVE_DO_NOT_COPY');
    expect(JSON.stringify(astra)).not.toContain('RAW_FAILED_CLAIM');
    expect(control.requirements).toHaveProperty('geoffreyNativeMoveContract');
    expect(astra.requirements).not.toHaveProperty('geoffreyNativeMoveContract');
  });

  it('keeps another account free of Geoffrey stance and portfolio-promotion targets', () => {
    const prompt = parse(other, { ...brief, portfolioCompanyContext: { companyName: 'Example company', intent: 'live_development' } as never });
    expect(prompt.author.communicationStyle).toBe(other.communicationStyle);
    expect(prompt.requirements).not.toHaveProperty('account');
    expect(prompt.requirements).not.toHaveProperty('frontier');
    expect(prompt.requirements.portfolio).not.toContain('OpenAI/Cognition');
    expect(prompt.requirements.portfolio).toContain('this account’s own voice and risk boundaries');
    for (const topic of ['OpenAI', 'Natural']) {
      const requested = buildGenerationBriefsV2(planning(other, topic));
      expect(requested).toHaveLength(1);
      expect(requested[0].topic).toBe(topic);
      expect(requested[0].portfolioCompanyContext).toBeNull();
    }
  });

  it('hydrates another account’s qualified company facts without attaching Anti Fund policy', () => {
    const document = { id: 'source-1', agentId: 'account-1', fetchedAt: now.toISOString(), publishedAt: now.toISOString(),
      title: 'OpenAI reports a deployment', publisher: 'OpenAI', canonicalUrl: 'https://openai.com/example', isPrimary: true, entities: ['OpenAI'],
      claims: [{ id: 'claim-1', text: 'OpenAI reports a deployment.', kind: 'fact', confidence: 0.95, entities: ['OpenAI'] }],
    } as SourceDocument;
    const story = { id: 'story-1', agentId: 'account-1', topic: 'AI', title: document.title, summary: document.title,
      sourceDocumentIds: [document.id], qualifiedClaimIds: ['claim-1'], entities: ['OpenAI'], primarySourceCount: 1, independentSourceCount: 1,
      evidenceQualified: true, blockReason: null, blockedUntil: null,
      scores: { identityFit: 0.9, evidenceStrength: 0.95, consequence: 0.8, freshness: 0.9, total: 0.9 },
    } as StoryCluster;
    const seed = { id: 'dynamic-seed', provenance: 'research_synthesis', synthesizedAt: now.toISOString(), sourceDocumentIds: [document.id] } as DynamicIdeaSeed;
    const hydrated = hydrateDynamicSeedEvidenceV2(brief, seed, [story], [document], now, other);
    expect(hydrated.evidence[0].claim).toBe(document.claims[0].text);
    expect(hydrated.portfolioCompanyContext).toBeNull();
    expect(hydrateDynamicSeedEvidenceV2(brief, seed, [story], [document], now, geoffrey).portfolioCompanyContext?.companyName).toBe('OpenAI');
  });
});
