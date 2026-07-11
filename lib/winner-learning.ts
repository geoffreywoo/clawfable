import type { TweetPerformance } from './types';
import { extractCandidateFeatureTags } from './tweet-features';
import { assessGeneratedWritingPatterns } from './writing-patterns';

export interface HistoricalWinnerAssessment {
  disposition: 'native_voice_anchor' | 'qualified_system_anchor' | 'engagement_mechanic_only';
  evidenceWeight: number;
  unsafePatterns: string[];
  spreadMechanics: string[];
}

export function inferContentSpreadMechanics(
  content: string,
  options: { topic?: string | null; thesis?: string | null; replies?: number; retweets?: number } = {},
): string[] {
  const evidenceText = content.replace(/https?:\/\/\S+/gi, ' ').trim();
  const tags = extractCandidateFeatureTags(evidenceText, {
    topic: options.topic,
    thesisHint: options.thesis,
  });
  const mechanics: string[] = [];

  if (/\b(?:old|before|used to)\b[\s\S]{0,180}\b(?:new|after|now)\b|\bfrom\b[^\n.]{1,80}\bto\b/i.test(evidenceText)) {
    mechanics.push('concrete before/after contrast');
  }
  if (/\b\d[\d,.]*\s*(?:%|x|minutes?|hours?|days?|weeks?|months?|years?|ms|nm|mm|kw|mw|gw)?\b|[$£€]\s*\d/i.test(evidenceText)) {
    mechanics.push('measurable stakes');
  }
  if (/\b(?:buyer|customer|founder|investor|operator|engineer|factory|plant|supplier)\b/i.test(evidenceText)) {
    mechanics.push('clear actor with economic stakes');
  }
  if (/\b(?:status|rich|powerful|winner|loser|fund|funding|capital|money|procurement|budget)\b/i.test(evidenceText)) {
    mechanics.push('status or capital tension');
  }
  if (tags.technicalDepth && tags.technicalDepth >= 0.35) {
    mechanics.push('named technical mechanism');
  }
  if (evidenceText.length < 190) mechanics.push('compressed punchline');
  if (evidenceText.split('\n').filter((line) => line.trim()).length >= 4) mechanics.push('scan-friendly escalation');
  if (evidenceText.includes('?') || (options.replies || 0) >= Math.max(8, (options.retweets || 0) * 2)) mechanics.push('reply-generating tension');
  if (mechanics.length === 0) mechanics.push(`${tags.hook.replace(/_/g, ' ')} hook with ${tags.structure.replace(/_/g, ' ')} structure`);

  return [...new Set(mechanics)].slice(0, 4);
}

export function assessHistoricalWinner(entry: TweetPerformance): HistoricalWinnerAssessment {
  const spreadMechanics = inferContentSpreadMechanics(entry.content, {
    topic: entry.topic,
    thesis: entry.thesis,
    replies: entry.replies,
    retweets: entry.retweets,
  });
  if (entry.source !== 'autopilot') {
    return {
      disposition: 'native_voice_anchor',
      evidenceWeight: entry.source === 'manual' ? 1 : 0.9,
      unsafePatterns: [],
      spreadMechanics,
    };
  }

  const patterns = assessGeneratedWritingPatterns(entry.content);
  const anonymousAnecdote = patterns.hits.includes('anonymous-anecdote');
  const evidenceWeight = anonymousAnecdote
    ? 0.2
    : patterns.score >= 0.46
      ? 0.35
      : patterns.score >= 0.2
        ? 0.55
        : patterns.score > 0
          ? 0.72
          : 1;

  return {
    disposition: patterns.hits.length > 0 ? 'engagement_mechanic_only' : 'qualified_system_anchor',
    evidenceWeight,
    unsafePatterns: patterns.hits,
    spreadMechanics,
  };
}

export function historicalPerformanceEvidenceWeight(entry: TweetPerformance): number {
  return assessHistoricalWinner(entry).evidenceWeight;
}
