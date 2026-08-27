import { describe, expect, it } from 'vitest';
import {
  formatRemixContentForPrompt,
  formatRemixInstructionForPrompt,
  formatRemixSoulForPrompt,
  getRemixMaxTokens,
} from '@/lib/remix-prompt';

describe('remix prompt budgeting', () => {
  it('bounds remix prompt inputs while preserving the core request', () => {
    const soul = formatRemixSoulForPrompt(`# soul\n${'voice detail '.repeat(120)}SOUL_SENTINEL`);
    const content = formatRemixContentForPrompt(`core thesis ${'draft detail '.repeat(220)}CONTENT_SENTINEL`);
    const instruction = formatRemixInstructionForPrompt(`make it sharper ${'operator nuance '.repeat(80)}INSTRUCTION_SENTINEL`);

    expect(soul.length).toBeLessThan(950);
    expect(soul).not.toContain('SOUL_SENTINEL');
    expect(content.length).toBeLessThan(1850);
    expect(content).toContain('core thesis');
    expect(content).not.toContain('CONTENT_SENTINEL');
    expect(instruction.length).toBeLessThan(550);
    expect(instruction).toContain('make it sharper');
    expect(instruction).not.toContain('INSTRUCTION_SENTINEL');
  });

  it('scales remix output budget by original draft length and retry attempt', () => {
    expect(getRemixMaxTokens(120, 0)).toBe(512);
    expect(getRemixMaxTokens(120, 1)).toBe(768);
    expect(getRemixMaxTokens(600, 0)).toBe(768);
    expect(getRemixMaxTokens(600, 1)).toBe(1024);
    expect(getRemixMaxTokens(1600, 0)).toBe(1024);
    expect(getRemixMaxTokens(1600, 1)).toBe(1280);
  });
});
