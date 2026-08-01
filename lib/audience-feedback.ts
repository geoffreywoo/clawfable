import type { AudienceVoiceComplaintTag } from './types';

export interface AudienceVoiceComplaintClassification {
  isComplaint: boolean;
  confidence: number;
  tags: AudienceVoiceComplaintTag[];
}

const COMPLAINT_PATTERNS: Array<{
  tag: AudienceVoiceComplaintTag;
  confidence: number;
  pattern: RegExp;
}> = [
  { tag: 'ai_slop', confidence: 0.98, pattern: /\b(?:ai slop|chatgpt slop|llm slop)\b/i },
  { tag: 'not_your_voice', confidence: 0.98, pattern: /\b(?:doesn['\u2019]?t|does not|dont|don['\u2019]?t) sound like (?:you|geoff(?:rey)?)\b/i },
  { tag: 'not_your_voice', confidence: 0.94, pattern: /\b(?:not your voice|this isn['\u2019]?t you|this is not you)\b/i },
  { tag: 'bot_voice', confidence: 0.94, pattern: /\b(?:sounds?|reads?) like (?:a |an )?(?:ai|bot|chatgpt)\b/i },
  { tag: 'generated_voice', confidence: 0.92, pattern: /\b(?:clearly|obviously|definitely) (?:ai|generated|written by ai)\b/i },
  { tag: 'generated_voice', confidence: 0.9, pattern: /\b(?:ai[- ]generated|generated tweet|bot[- ]written)\b/i },
];

const PRAISE_OR_NEGATION_PATTERN = /\b(?:not|isn['\u2019]?t|is not|doesn['\u2019]?t|does not)\s+(?:read |sound |feel )?(?:like )?(?:ai slop|chatgpt slop|llm slop|a bot|ai[- ]generated)\b/i;

export function classifyAudienceVoiceComplaint(content: string): AudienceVoiceComplaintClassification {
  const compact = content.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return { isComplaint: false, confidence: 0, tags: [] };
  if (PRAISE_OR_NEGATION_PATTERN.test(compact)) return { isComplaint: false, confidence: 0, tags: [] };

  const matches = COMPLAINT_PATTERNS.filter((entry) => entry.pattern.test(compact));
  if (matches.length === 0) return { isComplaint: false, confidence: 0, tags: [] };

  return {
    isComplaint: true,
    confidence: Math.max(...matches.map((entry) => entry.confidence)),
    tags: [...new Set(matches.map((entry) => entry.tag))],
  };
}
