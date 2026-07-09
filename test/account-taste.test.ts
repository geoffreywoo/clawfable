import { describe, expect, it } from 'vitest';
import {
  assessAccountTaste,
  assessTechnicalCredibility,
  classifyTasteFeedbackReason,
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
      { voiceProfile: geoffreyVoiceProfile },
    );

    expect(opsTexture.statusTextureRisk).toBeGreaterThan(hardTechTexture.statusTextureRisk);
    expect(opsTexture.cringeRisk).toBeGreaterThan(hardTechTexture.cringeRisk);
    expect(hardTechTexture.technicalCredibilityScore).toBeGreaterThan(opsTexture.technicalCredibilityScore);
    expect(opsTexture.action).not.toBe('allow');
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
      'lame, too Slack, not elevated or technical enough, sounds like AI slop',
    );

    expect(feedback.metadata).toMatchObject({
      aiSlopComplaint: true,
      cringeComplaint: true,
      lowStatusTextureComplaint: true,
      technicalElevationRequested: true,
      tasteComplaint: true,
    });
    expect(feedback.preferenceHints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Slack/support/workflow texture'),
        expect.stringContaining('elevated technical depth'),
      ]),
    );
  });
});
