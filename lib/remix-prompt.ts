const REMIX_SOUL_PROMPT_LIMIT = 900;
const REMIX_CONTENT_PROMPT_LIMIT = 1800;
const REMIX_INSTRUCTION_PROMPT_LIMIT = 500;

function compactRemixPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatRemixSoulForPrompt(soulMd: string | null | undefined): string {
  if (!soulMd?.trim()) return '';
  return compactRemixPromptText(soulMd, REMIX_SOUL_PROMPT_LIMIT);
}

export function formatRemixContentForPrompt(content: string): string {
  return compactRemixPromptText(content, REMIX_CONTENT_PROMPT_LIMIT);
}

export function formatRemixInstructionForPrompt(instruction: string): string {
  return compactRemixPromptText(instruction, REMIX_INSTRUCTION_PROMPT_LIMIT);
}

export function getRemixMaxTokens(originalLength: number, attempt: number): number {
  const retryExtra = attempt > 0 ? 256 : 0;
  if (originalLength <= 280) return 512 + retryExtra;
  if (originalLength <= 1000) return 768 + retryExtra;
  return 1024 + retryExtra;
}
