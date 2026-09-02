import { generateText } from './ai';
import { CLAWFABLE_PLATFORM_GOAL } from './platform-goal';
import type { StyleSignals } from './types';

const DEFAULT_STYLE_SIGNALS: StyleSignals = {
  sentenceLength: 'mixed',
  vocabulary: 'mixed',
  toneMarkers: [],
  topicPreferences: [],
  rawExtraction: '',
};

const STYLE_EXTRACTION_EXAMPLE_LIMIT = 12;
const STYLE_EXTRACTION_EXAMPLE_CHAR_LIMIT = 280;
const SOUL_EXAMPLE_LIMIT = 6;
const SOUL_EXAMPLE_CHAR_LIMIT = 220;

export function getStyleExtractionMaxTokens(exampleCount: number): number {
  if (exampleCount <= 4) return 512;
  if (exampleCount <= 8) return 768;
  return 1024;
}

export function getSoulGenerationMaxTokens(exampleCount: number): number {
  return exampleCount === 0 ? 768 : 1024;
}

function compactExampleTweet(value: string, maxChars: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, maxChars - 3).trimEnd()}...`;
}

export function formatStyleExtractionExamples(exampleTweets: string[]): string {
  return exampleTweets
    .map((tweet) => compactExampleTweet(tweet, STYLE_EXTRACTION_EXAMPLE_CHAR_LIMIT))
    .filter(Boolean)
    .slice(0, STYLE_EXTRACTION_EXAMPLE_LIMIT)
    .map((tweet, index) => `${index + 1}. "${tweet}"`)
    .join('\n');
}

export function formatSoulExampleTweets(exampleTweets: string[]): string {
  return exampleTweets
    .map((tweet) => compactExampleTweet(tweet, SOUL_EXAMPLE_CHAR_LIMIT))
    .filter(Boolean)
    .slice(0, SOUL_EXAMPLE_LIMIT)
    .map((tweet) => `- "${tweet}"`)
    .join('\n');
}

export async function extractStyleSignals(exampleTweets: string[]): Promise<StyleSignals> {
  if (exampleTweets.length === 0) return DEFAULT_STYLE_SIGNALS;
  try {
    const response = await generateText({
      task: 'classification',
      maxTokens: getStyleExtractionMaxTokens(exampleTweets.length),
      system: 'You are a writing style analyst. Analyze the given tweets and extract style patterns. Output valid JSON only, no markdown.',
      prompt: `Analyze these tweets and extract the writing style:\n\n${formatStyleExtractionExamples(exampleTweets)}\n\nOutput a JSON object with:\n- "sentenceLength": "short" | "medium" | "long" | "mixed"\n- "vocabulary": "casual" | "technical" | "mixed"\n- "toneMarkers": array of tone descriptors\n- "topicPreferences": array of main topics discussed\n- "rawExtraction": one paragraph describing the overall voice and style`,
    });
    const parsed = JSON.parse(response.text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim());
    return {
      sentenceLength: parsed.sentenceLength || 'mixed',
      vocabulary: parsed.vocabulary || 'mixed',
      toneMarkers: Array.isArray(parsed.toneMarkers) ? parsed.toneMarkers : [],
      topicPreferences: Array.isArray(parsed.topicPreferences) ? parsed.topicPreferences : [],
      rawExtraction: parsed.rawExtraction || '',
    };
  } catch (error) {
    console.error('Style extraction failed:', error);
    return DEFAULT_STYLE_SIGNALS;
  }
}

export async function generateSoulMd(
  archetype: string,
  topics: string[],
  exampleTweets: string[],
  agentName: string,
): Promise<string> {
  try {
    const examplesSection = exampleTweets.length > 0
      ? `\n\nExample tweets this agent admires or has written:\n${formatSoulExampleTweets(exampleTweets)}`
      : '';
    const response = await generateText({
      task: 'soul_generation',
      maxTokens: getSoulGenerationMaxTokens(exampleTweets.length),
      system: `You generate SOUL.md personality profiles for X accounts. Output markdown only, no commentary.\n\nEvery SOUL.md must inherit this non-editable Clawfable platform goal: ${CLAWFABLE_PLATFORM_GOAL}`,
      prompt: `Generate a SOUL.md for an X account named "${agentName}".\n\nVoice archetype: ${archetype}\nTopics: ${topics.join(', ')}${examplesSection}\n\nUse this format:\n# SOUL.md - System Definition\n\nI am [identity].\n\n## 1) Objective Function\nPrimary objective: Pilot this X account as an authentic extension of its owner's voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.\n\n## 2) Communication Protocol\nDefault output: [how this agent communicates]\nTone: ${archetype}\n\n## 3) Anti-Goals\nDo not optimize for: [what to avoid - be specific]\n\n## 4) Focus Areas\nTopics: ${topics.join(', ')}`,
    });
    return response.text;
  } catch (error) {
    console.error('SOUL.md generation failed, using template:', error);
    return `# SOUL.md - System Definition\n\nI am ${agentName}, a ${archetype} voice on X.\n\n## 1) Objective Function\nPrimary objective: Pilot this X account as an authentic extension of its owner's voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.\n\n## 2) Communication Protocol\nDefault output: Standalone posts and live replies\nTone: ${archetype}\n\n## 3) Anti-Goals\nDo not optimize for: engagement bait, generic platitudes, thread spam\n\n## 4) Focus Areas\nTopics: ${topics.join(', ')}`;
  }
}
