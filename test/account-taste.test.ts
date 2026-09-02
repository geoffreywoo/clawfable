import { describe, expect, it } from 'vitest';
import {
  assessAccountTaste,
  assessTechnicalCredibility,
  buildGeoffreyNativeGenerationBrief,
  buildGeoffreyNativeV2WriterContract,
  buildGeoffreyNativeWritingBrief,
  classifyTasteFeedbackReason,
  getAutonomousQueueTasteIssue,
  isGeoffreyVoiceProfile,
} from '@/lib/account-taste';

const geoffreyVoiceProfile = {
  tone: 'technical operator/investor',
  topics: ['AI', 'inference asics', 'fusion', 'fission', 'rare earth minerals', 'robotics', 'space'],
  antiGoals: ['generic hype', 'low-status SaaS-ops texture'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed, technical, native voice.',
  summary: 'Geoffrey writes about frontier tech, industrial capacity, and AI infrastructure from technical constraints.',
};

const genericVoiceProfile = {
  tone: 'direct',
  topics: ['support', 'saas', 'pricing'],
  antiGoals: ['hype'],
  communicationStyle: 'plain founder notes from the support queue',
  summary: 'A SaaS founder writing about customer support and pricing.',
};

describe('account taste scoring', () => {
  it('recognizes the current handle without applying Geoffrey taste to every hard-tech account', () => {
    expect(isGeoffreyVoiceProfile(geoffreyVoiceProfile)).toBe(true);
    expect(isGeoffreyVoiceProfile({
      ...geoffreyVoiceProfile,
      communicationStyle: 'short, casual, high-conviction',
      summary: 'You are geoffreywoo. You focus on AI, crypto, tech, and startups.',
    })).toBe(true);
    expect(isGeoffreyVoiceProfile({
      ...geoffreyVoiceProfile,
      communicationStyle: 'technical and compressed',
      summary: 'Writes about inference ASICs, tungsten, and industrial capacity.',
    })).toBe(false);
  });

  it('calibrates casual register against known manual Geoffrey sentence shapes', () => {
    const anchors = [
      { content: 'google should buy @cognition for $200b and make @ScottWu46 ceo', topic: 'AI', source: 'timeline' },
      { content: 'don’t pray on other people’s downfall.\n\nit simply reveals your own insecurity of never having your own meteoric rise.', topic: 'culture', source: 'timeline' },
      { content: 'i’m going to cold turkey quit all caffeine (except tea) and nicotine for 2 weeks. who’s in?', topic: 'personal', source: 'timeline' },
    ];
    const learnings = {
      operatorVoiceReference: {
        bestPerformers: anchors,
        startupRegisterExamples: [],
        pinnedExamples: [],
      },
    } as any;

    for (const anchor of anchors) {
      const assessment = assessAccountTaste(anchor.content, { voiceProfile: geoffreyVoiceProfile, learnings });
      expect(assessment.casualStartupScore).toBeGreaterThanOrEqual(0.58);
    }
    expect(assessAccountTaste(
      "funny how founders who swear they’d never give up control suddenly eat a worse structure when a tier-1 term sheet lands",
      { voiceProfile: geoffreyVoiceProfile, learnings },
    ).casualStartupScore).toBeGreaterThanOrEqual(0.58);
    expect(assessAccountTaste(
      'most impressive thing a seed team can show me is the list of roles they refused to hire.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    ).casualStartupScore).toBeGreaterThanOrEqual(0.58);
    const compactTechnicalCall = assessAccountTaste(
      'etched should hire the compiler lead before the celebrity researcher.\n\nthe chip is the company and the compiler is how it becomes usable.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    expect(compactTechnicalCall.casualStartupScore).toBeGreaterThanOrEqual(0.58);
    expect(compactTechnicalCall.technicalCredibilityScore).toBeGreaterThanOrEqual(0.45);
  });

  it('treats a compressed named IPO timing call as high-context diction, not a generic placeholder', () => {
    const anchors = [
      { content: 'google should buy @cognition for $200b and make @ScottWu46 ceo', topic: 'AI', source: 'timeline' },
      { content: 'yes, threshold to beat is QQQ. mid market pe funds all seem like zombies.', topic: 'finance', source: 'timeline' },
    ];
    const learnings = {
      operatorVoiceReference: {
        bestPerformers: anchors,
        startupRegisterExamples: anchors,
        pinnedExamples: [],
      },
    } as any;
    const named = assessAccountTaste(
      'modal goes public before databricks.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    const equivalentNamed = assessAccountTaste(
      'Databricks goes public earlier than Modal.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    const generic = assessAccountTaste(
      'a company goes public before another company.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );

    expect(named.casualStartupScore).toBeGreaterThanOrEqual(0.58);
    expect(equivalentNamed.casualStartupScore).toBeGreaterThanOrEqual(0.58);
    expect(named.casualStartupScore).toBeGreaterThan(generic.casualStartupScore);
    expect(generic.casualStartupScore).toBeLessThan(0.58);
  });

  it('lets concise named assertions reach the critic without treating capitalization as stiffness', () => {
    const anchors = [
      { content: 'google should buy @cognition for $200b and make @ScottWu46 ceo', topic: 'AI', source: 'timeline' },
      { content: 'yes, threshold to beat is QQQ. mid market pe funds all seem like zombies.', topic: 'finance', source: 'timeline' },
    ];
    const learnings = {
      operatorVoiceReference: {
        bestPerformers: anchors,
        startupRegisterExamples: anchors,
        pinnedExamples: [],
      },
    } as any;

    const named = assessAccountTaste(
      'Rico makes this hard, but Usyk still gets the late TKO.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    const generic = assessAccountTaste(
      'The product will win.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );

    expect(named.casualStartupScore).toBeGreaterThanOrEqual(0.58);
    expect(generic.casualStartupScore).toBeLessThan(0.58);
  });

  it('prefers Geoffrey-native technical anchors over topic-swapped AI advice', () => {
    const generic = assessAccountTaste(
      'The real edge in AI infrastructure is not more models, but better feedback loops. Most people miss that the winners will compound learning faster.',
      { voiceProfile: geoffreyVoiceProfile },
    );
    const native = assessAccountTaste(
      'Inference ASICs are becoming a power-delivery problem. HBM bandwidth can look fine on paper while rack density quietly caps tokens per watt.',
      { voiceProfile: geoffreyVoiceProfile },
    );

    expect(native.nativeVoiceScore).toBeGreaterThan(generic.nativeVoiceScore);
    expect(native.technicalCredibilityScore).toBeGreaterThan(generic.technicalCredibilityScore);
    expect(native.cringeRisk).toBeLessThan(generic.cringeRisk);
    expect(generic.action).toBe('block');
  });

  it('penalizes Slack and workflow texture even when it is superficially concrete', () => {
    const opsTexture = assessAccountTaste(
      'The best AI teams know the rollout is working when the Slack channel gets quieter and every support ticket has a clean handoff.',
      { voiceProfile: geoffreyVoiceProfile },
    );
    const hardTechTexture = assessAccountTaste(
      'The quiet AI infra constraint is packaging yield. A 2% substrate miss matters more than another dashboard if the accelerator cannot survive thermal cycling.',
      {
        voiceProfile: geoffreyVoiceProfile,
        sourceTexts: ['Packaging yield data shows a 2% substrate miss under thermal cycling.'],
      },
    );

    expect(opsTexture.statusTextureRisk).toBeGreaterThan(hardTechTexture.statusTextureRisk);
    expect(opsTexture.cringeRisk).toBeGreaterThan(hardTechTexture.cringeRisk);
    expect(hardTechTexture.technicalCredibilityScore).toBeGreaterThan(opsTexture.technicalCredibilityScore);
    expect(opsTexture.action).not.toBe('allow');
  });

  it('blocks fabricated lived experience even when the technical nouns are credible', () => {
    const fabricated = assessAccountTaste(
      'A machine shop owner showed me two carbide end mills. One ran 11 hours. One chipped after 47 minutes. Powder size distribution decides.',
      {
        voiceProfile: geoffreyVoiceProfile,
        sourceTexts: ['Tungsten carbide depends on powder metallurgy, binder chemistry, sintering, and tool qualification.'],
      },
    );
    const sourced = assessAccountTaste(
      'Tungsten carbide tooling is downstream of powder size distribution, cobalt binder chemistry, sintering control, and customer qualification.',
      {
        voiceProfile: geoffreyVoiceProfile,
        sourceTexts: ['Tungsten carbide depends on powder size distribution, cobalt binder chemistry, sintering, and tool qualification.'],
      },
    );

    expect(fabricated.truthfulnessRisk).toBeGreaterThanOrEqual(0.8);
    expect(fabricated.action).toBe('block');
    expect(sourced.truthfulnessRisk).toBe(0);
    expect(sourced.nativeVoiceScore).toBeGreaterThan(fabricated.nativeVoiceScore);
  });

  it('blocks close paraphrases of recently rejected drafts', () => {
    const rejected = 'rare earth independence is downstream of a very annoying object: the high-temperature NdFeB magnet. dysprosium and terbium preserve coercivity while grain-boundary diffusion and sintering yield decide output.';
    const assessment = assessAccountTaste(
      'high-temperature NdFeB is where rare earth independence gets annoying. dysprosium and terbium preserve coercivity. grain-boundary diffusion and sintering yield decide usable output.',
      {
        voiceProfile: geoffreyVoiceProfile,
        memory: {
          alwaysDoMoreOfThis: [],
          neverDoThisAgain: [],
          rejectedDrafts: [rejected],
          topicsWithMomentum: [],
          formatsUnderTested: [],
          operatorHiddenPreferences: [],
          editTransformations: [],
          identityConstraints: [],
          weeklyChanges: [],
          updatedAt: '2026-07-14T00:00:00.000Z',
        },
      },
    );

    expect(assessment.rejectedDraftSimilarity).toBeGreaterThanOrEqual(0.55);
    expect(assessment.action).toBe('block');
    expect(assessment.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('recently rejected draft'),
    ]));
  });

  it('blocks copied followed-account phrasing while allowing an independently written technical angle', () => {
    const source = 'Hybrid bonding surface roughness determines alignment yield across advanced chiplet packages.';
    const copied = assessAccountTaste(
      'Hybrid bonding surface roughness determines alignment yield before advanced chiplet packages can ship.',
      {
        voiceProfile: geoffreyVoiceProfile,
        untrustedSourceTexts: [source],
      },
    );
    const independent = assessAccountTaste(
      'Advanced packaging fails when wafer planarity and overlay tolerance miss the process window.',
      {
        voiceProfile: geoffreyVoiceProfile,
        untrustedSourceTexts: [source],
      },
    );

    expect(copied.sourceCopyRisk).toBeGreaterThanOrEqual(0.58);
    expect(copied.action).toBe('block');
    expect(copied.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('copies external source phrasing'),
    ]));
    expect(independent.sourceCopyRisk).toBe(0);
  });

  it('does not let an untrusted network source substantiate its numeric claim', () => {
    const source = 'Hybrid bonding yield improved by 47% after a new surface treatment.';
    const assessment = assessAccountTaste(
      'Hybrid bonding yield improved by 47% after a new surface treatment.',
      {
        voiceProfile: geoffreyVoiceProfile,
        sourceTexts: [],
        untrustedSourceTexts: [source],
      },
    );

    expect(assessment.truthfulnessRisk).toBeGreaterThanOrEqual(0.5);
    expect(assessment.action).toBe('block');
  });

  it('requires technical substance even when a draft has current source context', () => {
    const thin = assessAccountTaste(
      'someone posted an agent that trains models. startup formation gets weird when experimentation becomes agent labor.',
      { voiceProfile: geoffreyVoiceProfile },
    );
    const thinIssue = getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: { ...thin, action: 'allow' },
      hasSourceContext: true,
    });
    const unsourcedJoke = assessAccountTaste(
      'startup purgatory is a robot that works until the customer changes the lighting. congrats, you discovered photons.',
      { voiceProfile: geoffreyVoiceProfile },
    );
    const jokeIssue = getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: { ...unsourcedJoke, action: 'allow' },
      hasSourceContext: false,
    });

    expect(thin.technicalCredibilityScore).toBeLessThan(0.36);
    expect(thinIssue).toContain('below the Geoffrey queue floor');
    expect(unsourcedJoke.technicalCredibilityScore).toBeLessThan(0.5);
    expect(jokeIssue).toContain('without current source context');
  });

  it('allows a source-backed native startup one-liner without forcing a mechanism inventory', () => {
    const startupAnchors = [
      {
        content: 'compute pricing is an actually good use case. the sports product is still obviously a sportsbook.',
        topic: 'AI',
        source: 'timeline',
      },
      {
        content: 'x algo def way better. more useful content. more friends. yall cooking.',
        topic: 'product',
        source: 'timeline',
      },
      {
        content: 'yes, threshold to beat is QQQ. mid market pe funds all seem like zombies.',
        topic: 'finance',
        source: 'timeline',
      },
    ];
    const assessment = assessAccountTaste(
      'openai bundling codex into every work surface makes a lot of vertical software look kinda cooked. model quality was never the whole product.',
      {
        voiceProfile: geoffreyVoiceProfile,
        learnings: {
          operatorVoiceReference: {
            bestPerformers: startupAnchors,
            startupRegisterExamples: startupAnchors,
            pinnedExamples: [],
          },
        } as any,
      },
    );

    expect(assessment.technicalCredibilityScore).toBeLessThan(0.36);
    expect(assessment.casualStartupScore).toBeGreaterThanOrEqual(0.64);
    expect(assessment.stiffnessRisk).toBeLessThan(0.28);
    expect(assessment.action).toBe('allow');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment,
      hasSourceContext: true,
    })).toBeNull();
  });

  it('allows a concrete broad native take without forcing technical nouns into it', () => {
    const broadAnchors = [
      {
        content: 'padel is actually a good rich guy sport. easy enough to start, jus competitive enough to get obsessed.',
        topic: 'sports',
        source: 'timeline',
      },
      {
        content: 'x algo def way better. more useful content. more friends. yall cooking.',
        topic: 'product',
        source: 'timeline',
      },
      {
        content: 'yes, threshold to beat is QQQ. mid market pe funds all seem like zombies.',
        topic: 'finance',
        source: 'timeline',
      },
    ];
    const assessment = assessAccountTaste(
      'jake paul calling out nfl guys is way more interesting than another influencer fight. those guys actually have money and something to lose.',
      {
        voiceProfile: geoffreyVoiceProfile,
        learnings: {
          operatorVoiceReference: {
            bestPerformers: broadAnchors,
            startupRegisterExamples: broadAnchors,
            pinnedExamples: [],
          },
        } as any,
      },
    );

    expect(assessment.technicalCredibilityScore).toBeLessThan(0.36);
    expect(assessment.casualStartupScore).toBeGreaterThanOrEqual(0.58);
    expect(assessment.action).toBe('allow');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment,
      hasSourceContext: true,
      technicalLane: false,
    })).toBeNull();
  });

  it('uses manual lexical rhythm as a positive voice model, not only topic depth', () => {
    const manualAnchor = {
      content: 'bro.. best bullshitter in the game in action\n\nyou can make up stories for a self-help crowd, but you cannot bullshit ai twitter autists',
      topic: 'AI',
      thesis: 'bullshit does not survive technical audiences',
      hook: 'callout',
      tone: 'provocative',
      specificity: 'story_led',
      structure: 'argument',
      likes: 363,
      retweets: 8,
      replies: 10,
      impressions: 10000,
      engagementRate: 0.04,
      wasViral: true,
      source: 'timeline',
      tweetId: 'manual-1',
      xTweetId: 'x-manual-1',
      postedAt: '2026-07-03T00:00:00.000Z',
      checkedAt: '2026-07-04T00:00:00.000Z',
      format: 'hot_take',
    } as const;
    const learnings = {
      operatorVoiceReference: {
        sampleCount: 1,
        bestPerformers: [manualAnchor],
        pinnedExamples: [],
        styleFingerprint: {
          avgLength: manualAnchor.content.length,
          shortPct: 0,
          mediumPct: 100,
          longPct: 0,
          questionRatio: 0,
          usesLineBreaks: true,
          usesEmojis: false,
          usesNumbers: false,
          topHooks: ['callout'],
          topTones: ['provocative'],
          antiPatterns: [],
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      },
    } as any;

    const generic = assessAccountTaste(
      'Tungsten supply chain security is a critical strategic priority for American re-industrialization.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    const native = assessAccountTaste(
      'bro.. america keeps funding tungsten mines like ore is the product. carbide powder and sintering are the product. the mine is where the paperwork starts.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );

    expect(native.nativeVoiceScore).toBeGreaterThan(generic.nativeVoiceScore);
    expect(native.nativeStyleScore).toBeGreaterThan(generic.nativeStyleScore);
    expect(native.voiceDriftRisk).toBeLessThan(generic.voiceDriftRisk);
    expect(native.genericAccountFitRisk).toBeLessThan(generic.genericAccountFitRisk);
  });

  it('rewards mechanisms and penalizes vague frontier-tech hype', () => {
    const vague = assessTechnicalCredibility(
      'Frontier tech will re-industrialize America because AI changes everything and hard tech is finally having its moment.',
    );
    const specific = assessTechnicalCredibility(
      'Rare earth separation is a solvent-extraction bottleneck: ore grade, reagent cost, and tailings permits constrain whether the magnet supply curve moves.',
    );

    expect(specific.score).toBeGreaterThan(vague.score);
    expect(specific.domains).toContain('materials');
    expect(vague.vagueHypeRisk).toBeGreaterThan(specific.vagueHypeRisk);
    expect(specific.notes).toContain('names mechanism or bottleneck');
  });

  it('turns taste complaints into structured reusable learning hints', () => {
    const feedback = classifyTasteFeedbackReason(
      'lame, too Slack, not elevated or technical enough, sounds like AI slop, does not sound like me, and the content is drifting too far. it is a stiff analyst memo, not casual startup-native diction. it is a textbook lecture with a slogan mic-drop that reskins the old premise',
    );

    expect(feedback.metadata).toMatchObject({
      aiSlopComplaint: true,
      cringeComplaint: true,
      lowStatusTextureComplaint: true,
      technicalElevationRequested: true,
      nativeVoiceComplaint: true,
      stiffDictionComplaint: true,
      casualStartupVoiceRequested: true,
      identityDriftComplaint: true,
      technicalLectureComplaint: true,
      syntheticPunchlineComplaint: true,
      manualAnchorReskinComplaint: true,
      tasteComplaint: true,
    });
    expect(feedback.preferenceHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Slack/support/workflow texture'),
        expect.stringContaining('elevated technical depth'),
        expect.stringContaining('native content identity'),
        expect.stringContaining('casual startup-native diction'),
      ]),
    );
  });

  it('stores rubric-shaped forecast feedback without rejecting the AI topic', () => {
    const feedback = classifyTasteFeedbackReason(
      'AI slop: this horizon-first forecast reads like a rubric-shaped forecast worksheet.',
      '',
      { voiceProfile: geoffreyVoiceProfile },
    );

    expect(feedback.metadata).toMatchObject({
      aiSlopComplaint: true,
      forecastChecklistComplaint: true,
      tasteComplaint: true,
    });
    expect(feedback.preferenceHints.join(' ')).toContain('keep the public thought singular');
    expect(feedback.preferenceHints.join(' ')).not.toMatch(/avoid AI|reject AI/i);
  });

  it('stores over-specialization feedback as a broadening instruction', () => {
    const feedback = classifyTasteFeedbackReason(
      'the candidates are too technical and too specialized. broaden the topics and stop making everything manufacturing heavy.',
    );

    expect(feedback.metadata).toMatchObject({
      overSpecializedTopicComplaint: true,
      tasteComplaint: true,
    });
    expect(feedback.preferenceHints.join(' ')).toContain('do not equate specificity with manufacturing detail');
  });

  it('stores a sports opt-out as an explicit account-topic instruction', () => {
    const feedback = classifyTasteFeedbackReason(
      'the sports content is not in my style. stop posting about sports',
      '',
      { voiceProfile: geoffreyVoiceProfile },
    );

    expect(feedback.metadata).toMatchObject({
      sportsTopicOptOut: true,
      tasteComplaint: true,
      accountSpecificHints: 'geoffrey',
    });
    expect(feedback.preferenceHints.join(' ')).toContain('Random sports');
    expect(feedback.preferenceHints.join(' ')).toContain('Betr and Kings League');

    const generic = classifyTasteFeedbackReason(
      'the sports content is not in my style. stop posting about sports',
      '',
      { voiceProfile: genericVoiceProfile },
    );
    expect(generic.metadata).toMatchObject({ sportsTopicOptOut: true });
    expect(generic.metadata).not.toHaveProperty('accountSpecificHints');
    expect(generic.preferenceHints.join(' ')).not.toContain('Betr');
    expect(generic.preferenceHints.join(' ')).not.toContain('@geoffwoo');
  });

  it('classifies the operator reason only, never the rejected tweet text', () => {
    const duplicate = classifyTasteFeedbackReason(
      'This repeats an angle already used or rejected.',
      'space launch cadence will double once the robotics dashboard catches up with the frontier',
    );
    expect(duplicate.preferenceHints).toEqual([]);
    expect(duplicate.metadata).not.toHaveProperty('technicalElevationRequested');
    expect(duplicate.metadata).not.toHaveProperty('lowStatusTextureComplaint');
    expect(duplicate.metadata).not.toHaveProperty('tasteComplaint');

    const explicit = classifyTasteFeedbackReason('not elevated or technical enough', 'a plain draft');
    expect(explicit.metadata).toMatchObject({ technicalElevationRequested: true, tasteComplaint: true });
  });

  it('keeps Geoffrey-specific wording out of hints for other accounts', () => {
    const reason = 'does not sound like me, too Slack';
    const generic = classifyTasteFeedbackReason(reason, '', { voiceProfile: genericVoiceProfile });
    expect(generic.metadata).toMatchObject({ nativeVoiceComplaint: true, lowStatusTextureComplaint: true });
    expect(generic.preferenceHints.join(' ')).not.toMatch(/geoffrey|geoffwoo/i);
    expect(generic.preferenceHints.join(' ')).toContain("account's native voice");
    expect(generic.preferenceHints.join(' ')).toContain('Slack/support/workflow texture');

    const unscoped = classifyTasteFeedbackReason(reason);
    expect(unscoped.preferenceHints.join(' ')).not.toMatch(/geoffrey|geoffwoo/i);

    const geoffrey = classifyTasteFeedbackReason(reason, '', { voiceProfile: geoffreyVoiceProfile });
    expect(geoffrey.preferenceHints.join(' ')).toContain('native Geoffrey voice');
    expect(geoffrey.preferenceHints.join(' ')).toContain('insufficient proof for Geoffrey');
  });

  it('stores lagging AI baseline feedback as a future-horizon instruction', () => {
    const feedback = classifyTasteFeedbackReason(
      'OpenAI is already at a trillion-dollar valuation and elite engineers already use Devin for hard work. Be more bullish and AI-pilled. My voice should be 6-12 months ahead of its time.',
      'i would bet people start using ChatGPT as a generic verb',
    );

    expect(feedback.metadata).toMatchObject({
      frontierBaselineLagComplaint: true,
      futureHorizonMonths: '6-12',
      aiBullishPostureRequested: true,
      roboticsTimelineConvictionRequested: true,
      exponentialIntuitionRequested: true,
      forecastGroundingRequested: true,
      tasteComplaint: true,
    });
    expect(feedback.metadata).not.toHaveProperty('aiSlopComplaint');
    expect(feedback.preferenceHints.join(' ')).toContain('current frontier adoption');
    expect(feedback.preferenceHints.join(' ')).toContain('nonlinear capability');
  });

  it('keeps the live writer contract positive-first with a bounded hard-rule section', () => {
    const contract = buildGeoffreyNativeV2WriterContract();
    const whatIndex = contract.indexOf('What to write:');
    const rulesIndex = contract.indexOf('Hard rules');
    expect(whatIndex).toBeGreaterThan(-1);
    expect(rulesIndex).toBeGreaterThan(whatIndex);
    expect(contract).toContain('unreasonable, funny, combative, or personally costly');
    expect(contract).toContain('not a risk to sand off');
    // Prohibition density stays bounded: the hard-rule section is the minority
    // of the contract, not the bulk of it.
    const ruleSection = contract.slice(rulesIndex);
    expect(ruleSection.length).toBeLessThan(contract.length / 2);
  });

  it('keeps the narrow portfolio sports exception in every Geoffrey writing contract', () => {
    for (const contract of [
      buildGeoffreyNativeGenerationBrief(),
      buildGeoffreyNativeV2WriterContract(),
      buildGeoffreyNativeWritingBrief(),
    ]) {
      expect(contract).toContain('Betr and Kings League');
      expect(contract).toMatch(/Never write about games, athletes, players, scores, matchups, or picks/i);
    }
  });

  it('keeps the current AI baseline and a non-formulaic 6-12 month lead in every Geoffrey writing contract', () => {
    for (const contract of [
      buildGeoffreyNativeGenerationBrief(),
      buildGeoffreyNativeV2WriterContract(),
      buildGeoffreyNativeWritingBrief(),
    ]) {
      expect(contract).toContain('6-12');
      expect(contract).toMatch(/OpenAI.*trillion-dollar scale/i);
      expect(contract).toMatch(/frontier engineers.*coding agents/i);
      expect(contract).toMatch(/robots.*factor(?:y|ies).*warehouse/i);
      expect(contract).toMatch(/(?:literal timeline is optional|not a requirement to print|does not require a printed timeline)/i);
    }
  });

  it('keeps review-grade generated patterns out of Geoffrey autopost queue', () => {
    const templated = assessAccountTaste(
      'creator economy question:\n\nwhen generation becomes unlimited, who owns review and provenance?',
      { voiceProfile: geoffreyVoiceProfile },
    );
    const stiffTechnical = assessAccountTaste(
      'graphite qualification fails downstream of purification, particle morphology and coating yield. the mine cannot solve a cell-maker rejection.',
      {
        voiceProfile: geoffreyVoiceProfile,
        learnings: {
          operatorVoiceReference: {
            bestPerformers: [{
              content: 'compute pricing is an actually good use case. the sports product is still obviously a sportsbook.',
              topic: 'AI',
              source: 'timeline',
            }],
            pinnedExamples: [],
          },
        } as any,
      },
    );
    const nativeStartup = assessAccountTaste(
      'graphite mine decks are way too early in the stack. purification + coating yield decide what a cell maker will actually buy.',
      {
        voiceProfile: geoffreyVoiceProfile,
        learnings: {
          operatorVoiceReference: {
            bestPerformers: [{
              content: 'compute pricing is an actually good use case. the sports product is still obviously a sportsbook.',
              topic: 'AI',
              source: 'timeline',
            }],
            startupRegisterExamples: [{
              content: 'compute pricing is an actually good use case. the sports product is still obviously a sportsbook.',
              topic: 'AI',
              source: 'timeline',
            }],
            pinnedExamples: [],
          },
        } as any,
      },
    );

    expect(templated.action).not.toBe('allow');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: templated,
    })).toContain('strict account taste verdict');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: stiffTechnical,
    })).toContain('strict account taste verdict');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: nativeStartup,
      hasSourceContext: true,
    })).toBeNull();
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: { ...nativeStartup, action: 'review' },
      hasSourceContext: true,
    })).toBeNull();
    expect(nativeStartup.casualStartupScore).toBeGreaterThan(stiffTechnical.casualStartupScore);
    expect(nativeStartup.stiffnessRisk).toBeLessThan(stiffTechnical.stiffnessRisk);
  });

  it('prefers actor-and-stakes market judgment over neutral research summaries', () => {
    const learnings = {
      operatorVoiceReference: {
        bestPerformers: [],
        pinnedExamples: [],
        startupRegisterExamples: [
          {
            content: 'software is nepo + codex/claude\nhardware is where alpha is left',
            topic: 'AI',
            source: 'timeline',
          },
          {
            content: 'yes, threshold to beat is QQQ. those guys all seem like zombies',
            topic: 'finance',
            source: 'timeline',
          },
        ],
      },
    } as any;
    const stiff = assessAccountTaste(
      'rhenium scarcity is hard for aerospace buyers to fix. supply comes out in tiny amounts from copper and molybdenum production, so demand has little leverage.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    const native = assessAccountTaste(
      'rhenium could rip and copper miners still wont care. tiny byproduct in a massive market. aerospace guys just have to eat the price.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );

    expect(native.casualStartupScore).toBeGreaterThan(stiff.casualStartupScore);
    expect(native.stiffnessRisk).toBeLessThan(stiff.stiffnessRisk);
    expect(native.nativeVoiceScore).toBeGreaterThan(stiff.nativeVoiceScore);
    expect(stiff.action).not.toBe('allow');
    expect(native.action).toBe('allow');
  });

  it('recognizes materials processing mechanisms as technical credibility', () => {
    const assessment = assessTechnicalCredibility(
      'rhenium is a tiny copper and molybdenum byproduct. turbine-blade buyers can pay way more without creating much new recovery.',
    );

    expect(assessment.domains).toContain('materials');
    expect(assessment.mechanismScore).toBeGreaterThanOrEqual(0.1);
    expect(assessment.score).toBeGreaterThanOrEqual(0.45);
  });

  it('recognizes battery-material qualification without rewarding vague battery hype', () => {
    const specific = assessTechnicalCredibility(
      'coated anode material that no cell maker has qualified is just very expensive powder sitting in a warehouse',
    );
    const vague = assessTechnicalCredibility(
      'battery independence is the future',
    );

    expect(specific.domains).toContain('materials');
    expect(specific.mechanismScore).toBe(0.11);
    expect(specific.specificityScore).toBeGreaterThanOrEqual(0.14);
    expect(specific.score).toBeGreaterThanOrEqual(0.45);
    expect(vague.score).toBeLessThan(0.45);
  });

  it('recognizes confidential-computing control-plane mechanisms', () => {
    const assessment = assessTechnicalCredibility(
      'i’d fund the control plane for encrypted workloads before another gpu marketplace. my bet is TDX hosts become interchangeable. policy, failover, and auditability are where the software margin lives.',
    );

    expect(assessment.domains).toContain('compute');
    expect(assessment.score).toBeGreaterThanOrEqual(0.45);
  });

  it('recognizes casual hard-tech market actors without requiring memo keywords', () => {
    const learnings = {
      operatorVoiceReference: {
        bestPerformers: [],
        pinnedExamples: [],
        startupRegisterExamples: [
          { content: 'software is nepo + codex/claude\nhardware is where alpha is left', topic: 'AI', source: 'timeline' },
          { content: 'x algo def way better. more useful content. more friends. yall cooking.', topic: 'AI', source: 'timeline' },
        ],
      },
    } as any;
    const rhenium = assessAccountTaste(
      'rhenium is exactly the kind of tiny input that can make a giant space thesis look dumb. aerospace wants more; copper and molybdenum production decides what shows up.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );
    const magnets = assessAccountTaste(
      'pretty bad setup for robot and drone companies. they need the same high-temperature NdFeB performance as EVs and wind, then get to negotiate with a much smaller checkbook.',
      { voiceProfile: geoffreyVoiceProfile, learnings },
    );

    for (const assessment of [rhenium, magnets]) {
      expect(assessment.casualStartupScore).toBeGreaterThanOrEqual(0.58);
      expect(assessment.technicalCredibilityScore).toBeGreaterThanOrEqual(0.45);
      expect(assessment.cringeRisk).toBeLessThan(0.32);
      expect(assessment.action).toBe('allow');
    }
  });

  it('rejects polished technical explainers that are still generic ghostwriting', () => {
    const drafts = [
      'hardware founders: put the ugly production constraint in the pitch.\n\nvacuum leak rate. coating uniformity. thermal drift. tool wear.\n\nif you cannot name what blocks shipment, the prototype is still a science project.',
      'working physics is the beginning of a hardware product.\n\nshipment requires calibration, fixtures, test coverage, supplier controls, traceability and customer qualification.\n\nthe clever object becomes a product when another company can trust it repeatedly.',
      'when underwriting a space company, start with the replacement cycle.\n\nradiation degrades electronics. thermal cycling fatigues hardware. launch replenishment costs money.\n\nan impressive payload can still produce ugly economics if the constellation must be replaced faster than expected.',
    ];

    for (const content of drafts) {
      const assessment = assessAccountTaste(content, { voiceProfile: geoffreyVoiceProfile });
      expect(assessment.generatedPatternRisk).toBeGreaterThanOrEqual(0.34);
      expect(assessment.genericAccountFitRisk).toBeGreaterThanOrEqual(0.3);
      expect(assessment.action).not.toBe('allow');
    }
  });

  it('rejects research-summary phrasing even when the facts are technical', () => {
    const drafts = [
      'rare earth magnets look like a mining story. they are actually a chemistry and manufacturing story. separation, alloying, grain-boundary diffusion, sintering yield.',
      "everyone's building battery companies. fewer are solving graphite qualification. purification, morphology control, coating, cell-maker sign-off.",
    ];

    for (const content of drafts) {
      const assessment = assessAccountTaste(content, { voiceProfile: geoffreyVoiceProfile });
      expect(assessment.action).not.toBe('allow');
      expect(assessment.generatedPatternRisk).toBeGreaterThanOrEqual(0.36);
    }
  });

  it('rejects concise startup aphorisms that still sound generated', () => {
    const drafts = [
      'vc gets much harder when every firm has the same model outputs and founder intros. judgment is the product again.',
      'rare earth magnet startups live or die on process yield.',
      'fintech margins get interesting when the product owns the customer.',
      'Xiaomi can make robotics a real product category, not jus a science project.',
      'Xiaomi-Robotics-1 is worth watching.',
      'rhenium price can move way before supply responds.',
      'inference chip startups with bad package yield lose, even with great silicon. buyers cannot deploy parts that do not ship.',
      'the robotics magnet supplier that controls high-temperature performance wins. catalog resellers lose.',
      'an inference-chip startup with a great die and weak packaging is still a company that cannot ship enough working systems.',
      'i think investors underprice magnet process knowhow. a drone company cannot autonomy-software its way around bad sintering yield at temperature.',
      'a rocket company can create more engine demand and basically no direct rhenium supply response. that is a nasty scaling curve.',
      'i care more about the packaging team than another peak-performance slide. advanced chiplet compute only ships if alignment and yield hold up.',
      'i would not underwrite a beryllium machining startup like normal contract manufacturing. safety makes the capacity slower and more expensive before demand matters.',
      'i stop trusting the chiplet pitch when package yield is missing. that number decides how much compute the startup can actually ship.',
      "i'd worry less about the robot demo and more about whether its motor supplier can make high-temperature magnets consistently.",
      'i care less about the magnet spec than whether the supplier can hit it after sintering, over and over.',
      'funny that the chiplet startup may deserve to be underwritten as a packaging company. alignment and package yield set how much compute ships.',
    ];

    for (const content of drafts) {
      const assessment = assessAccountTaste(content, { voiceProfile: geoffreyVoiceProfile });
      expect(assessment.generatedPatternRisk).toBeGreaterThanOrEqual(0.32);
      expect(assessment.action).not.toBe('allow');
    }
  });

  it('rejects polished setup sentences that delay the actual position', () => {
    const drafts = [
      'Xiaomi-Robotics-1 is the reminder.\n\nconsumer hardware companies already have the ugly parts figured out.',
      'the Archer upside is no longer just urban passenger flight.\n\nautonomy + payload + range opens a much larger company.',
      'there is no straightforward rhenium capacity trade.\n\naerospace buyers need more, but suppliers recover tiny amounts.',
      'beryllium is one of those markets where owning material is not enough.',
    ];

    for (const content of drafts) {
      const assessment = assessAccountTaste(content, { voiceProfile: geoffreyVoiceProfile });
      expect(assessment.generatedPatternRisk).toBeGreaterThanOrEqual(0.32);
      expect(assessment.action).not.toBe('allow');
    }
  });

  it('rejects institutional euphemisms and canned final-copy scaffolds', () => {
    const drafts = [
      'startups have to underwrite against that now.',
      'high payload + long range opens a larger market. cost claim has to hold though.',
      'Generating the app is the demo.\nKeeping it working at scale is the product.',
      'industrial-gas operators have to build purification capacity. very different clock.',
    ];

    for (const content of drafts) {
      const assessment = assessAccountTaste(content, { voiceProfile: geoffreyVoiceProfile });
      expect(assessment.generatedPatternRisk).toBeGreaterThanOrEqual(0.28);
      expect(assessment.action).not.toBe('allow');
    }
  });

  it('rejects technical mini-lectures and manufactured mic-drop closers', () => {
    const falsePositives = [
      'a fusion plasma shot can be scientifically insane and still leave the commercial machine unresolved.\n\nThe plant must breed tritium, account for scarce fuel inventory, move heat through neutron-damaged materials and replace first-wall components without turning uptime into fiction.\n\nThat is why “net energy” cannot carry the whole timeline. The reactor has to close its own fuel cycle while surviving the thing that makes fusion useful: neutron flux.\n\nShow me tritium logistics and component life. Then we can argue about when fusion becomes a product.',
      'private equity loves “operational improvement” until the machine needs a qualified replacement spindle and the vendor lead time does not care about the IRR model.\n\nspreadsheet finance meets atoms. atoms win.',
      'battery nationalism keeps pointing at the mine while spherical purified graphite is stuck doing purification, morphology control, coating and cell qualification.\n\ncongrats on owning dirt. the anode still has standards.',
      'a fab can buy the famous machine and still wait on high-purity hydrofluoric acid.\n\nadvanced manufacturing policy loves glamorous capex. fluorine chemistry remains extremely unglamorous and extremely required.',
      'battery independence apparently means digging up graphite and then discovering the cell maker cares about particle shape, purity, coating and qualification.\n\nmining guys meet process engineering and immediately ask for an extension.',
      'beryllium supply is a worker-safety and qualification problem wearing a critical-mineral costume.\n\ntoxic dust makes machining capacity difficult to add. aerospace and semiconductor buyers then need the new process qualified.',
    ];

    for (const content of falsePositives) {
      const assessment = assessAccountTaste(content, { voiceProfile: geoffreyVoiceProfile });
      expect(assessment.generatedPatternRisk).toBeGreaterThanOrEqual(0.34);
      expect(assessment.nativeVoiceScore).toBeLessThan(0.6);
      expect(assessment.action).toBe('block');
      expect(assessment.notes).toEqual(expect.arrayContaining([
        expect.stringContaining('generated pattern'),
      ]));
    }
  });
});
