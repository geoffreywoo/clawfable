import { describe, expect, it } from 'vitest';
import {
  assessAccountTaste,
  assessTechnicalCredibility,
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

describe('account taste scoring', () => {
  it('recognizes the current handle without applying Geoffrey taste to every hard-tech account', () => {
    expect(isGeoffreyVoiceProfile(geoffreyVoiceProfile)).toBe(true);
    expect(isGeoffreyVoiceProfile({
      ...geoffreyVoiceProfile,
      communicationStyle: 'technical and compressed',
      summary: 'Writes about inference ASICs, tungsten, and industrial capacity.',
    })).toBe(false);
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
      'lame, too Slack, not elevated or technical enough, sounds like AI slop, does not sound like me, and the content is drifting too far. it is a textbook lecture with a slogan mic-drop that reskins the old premise',
    );

    expect(feedback.metadata).toMatchObject({
      aiSlopComplaint: true,
      cringeComplaint: true,
      lowStatusTextureComplaint: true,
      technicalElevationRequested: true,
      nativeVoiceComplaint: true,
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
      ]),
    );
  });

  it('keeps review-grade generated patterns out of Geoffrey autopost queue', () => {
    const templated = assessAccountTaste(
      'creator economy question:\n\nwhen generation becomes unlimited, who owns review and provenance?',
      { voiceProfile: geoffreyVoiceProfile },
    );
    const technical = assessAccountTaste(
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

    expect(templated.action).not.toBe('allow');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: templated,
    })).toContain('strict account taste verdict');
    expect(getAutonomousQueueTasteIssue({
      voiceProfile: geoffreyVoiceProfile,
      assessment: technical,
    })).toBeNull();
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
