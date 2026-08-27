import { describe, expect, it } from 'vitest';
import { createAgent, addVoiceDirective, getVoiceDirectiveRules, getVoiceDirectives } from '@/lib/kv-storage';
import { buildVoiceDirectiveRule, getActiveVoiceDirectiveRules, mergeVoiceDirectiveRule } from '@/lib/voice-directives';

describe('voice directive rules', () => {
  it('compiles raw coaching into scoped normalized rules and lessons', () => {
    const forbidden = buildVoiceDirectiveRule('Never use the word "democratizing" — it sounds corporate.');
    expect(forbidden.scope.type).toBe('forbidden_phrase');
    expect(forbidden.scope.operator).toBe('ban');
    expect(forbidden.scope.target).toBe('democratizing');
    expect(forbidden.normalizedRule).toContain('Never use the phrase "democratizing"');
    expect(forbidden.systemLesson).toContain('weakens voice credibility');

    const length = buildVoiceDirectiveRule('Keep tweets under 180 characters unless it is a deep analysis post.');
    expect(length.scope.type).toBe('length');
    expect(length.scope.target).toBe('under 180 chars');
    expect(length.normalizedRule).toContain('under 180 chars');
    expect(length.systemLesson).toContain('Length is part of the voice contract');
  });

  it('supersedes overlapping directives instead of stacking them forever', () => {
    const older = buildVoiceDirectiveRule('Lead with specifics.', {
      createdAt: '2026-04-01T00:00:00.000Z',
    });
    const newer = buildVoiceDirectiveRule('Lead with concrete observations.', {
      createdAt: '2026-04-02T00:00:00.000Z',
    });

    const merged = mergeVoiceDirectiveRule([older], newer);
    const active = getActiveVoiceDirectiveRules(merged);

    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(newer.id);
    expect(active[0].supersedesRuleIds).toContain(older.id);
    expect(merged.find((rule) => rule.id === older.id)?.status).toBe('superseded');
  });

  it('keeps structured history while exposing only active raw directives to the rest of the app', async () => {
    const agent = await createAgent({
      handle: 'directive-rules-agent',
      name: 'Directive Rules Agent',
      soulMd: '# SOUL\n\nSpecific and sharp.',
    } as any);

    await addVoiceDirective(agent.id, 'Lead with specifics.');
    await addVoiceDirective(agent.id, 'Lead with concrete observations.');
    await addVoiceDirective(agent.id, 'Never use the word "democratizing".');

    const rules = await getVoiceDirectiveRules(agent.id);
    const directives = await getVoiceDirectives(agent.id);

    expect(rules.filter((rule) => rule.status === 'active')).toHaveLength(2);
    expect(rules.some((rule) => rule.status === 'superseded' && rule.rawDirective === 'Lead with specifics.')).toBe(true);
    expect(directives).toEqual([
      'Never use the word "democratizing".',
      'Lead with concrete observations.',
    ]);
  });
});
