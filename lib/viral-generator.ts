/**
 * Viral content generator powered by Claude.
 * Optimized for Quote Tweets — piggybacks on viral posts from the agent's network.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AccountAnalysis, AgentLearnings, StyleSignals } from './types';
import type { VoiceProfile } from './soul-parser';
import type { TrendingTopic } from './trending';

const anthropic = new Anthropic();

const DEFAULT_STYLE_SIGNALS: StyleSignals = {
  sentenceLength: 'mixed',
  vocabulary: 'mixed',
  toneMarkers: [],
  topicPreferences: [],
  rawExtraction: '',
};

export interface ContentStyleConfig {
  lengthMix: { short: number; medium: number; long: number };
  enabledFormats: string[];
}

const DEFAULT_STYLE: ContentStyleConfig = {
  lengthMix: { short: 30, medium: 30, long: 40 },
  enabledFormats: [],
};

const ALL_FORMATS = [
  'hot_take', 'question', 'data_point', 'short_punch', 'long_form', 'analysis', 'observation',
];

export interface ProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
}

/**
 * Collect quotable tweets from trending topics — high-engagement posts
 * from the agent's network that are worth QTing.
 */
function collectQuotableTweets(trending: TrendingTopic[]): Array<{
  id: string;
  text: string;
  author: string;
  likes: number;
  category: string;
}> {
  const quotable: Array<{ id: string; text: string; author: string; likes: number; category: string }> = [];

  for (const topic of trending) {
    if (topic.topTweet && topic.topTweet.id) {
      quotable.push({
        id: topic.topTweet.id,
        text: topic.topTweet.text,
        author: topic.topTweet.author,
        likes: topic.topTweet.likes,
        category: topic.category,
      });
    }
  }

  // Sort by engagement — most quotable first
  quotable.sort((a, b) => b.likes - a.likes);
  return quotable.slice(0, 12);
}

/**
 * Build the system prompt for Claude.
 */
function buildSystemPrompt(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  trending: TrendingTopic[] | null,
  learnings: AgentLearnings | null,
  soulMd: string | null,
  style: ContentStyleConfig = DEFAULT_STYLE,
  recentPosts: string[] = [],
): string {
  const parts: string[] = [];

  parts.push(`You are a tweet ghostwriter for a Twitter account. Your PRIMARY strategy is Quote Tweets (QTs) — adding sharp commentary on high-engagement posts from the network. QTs get significantly more reach because they ride existing viral content.`);

  // Include the full SOUL.md — this is the most important context for voice
  if (soulMd) {
    parts.push(`\n## SOUL.md (THIS IS THE CORE IDENTITY — every tweet must sound like this person)
${soulMd}`);
  }

  parts.push(`\n## VOICE PROFILE (extracted from SOUL.md)
- Tone: ${voiceProfile.tone}
- Topics: ${voiceProfile.topics.join(', ')}
- Communication style: ${voiceProfile.communicationStyle}
- Anti-goals (never do these): ${voiceProfile.antiGoals.join('; ') || 'none specified'}
- Creator: Geoffrey Woo (@geoffreywoo) — your human creator who built you`);

  const ep = analysis.engagementPatterns;
  parts.push(`\n## ENGAGEMENT DATA
- Average likes: ${ep.avgLikes}, Average RTs: ${ep.avgRetweets}
- Viral threshold (3x avg): ${ep.viralThreshold}+ likes
- Top performing formats: ${ep.topFormats.join(', ') || 'unknown'}
- Best topics by engagement: ${ep.topTopics.join(', ') || 'unknown'}
- Peak posting hours (UTC): ${ep.topHours.join(', ') || 'unknown'}
- Content fingerprint: ${analysis.contentFingerprint}`);

  if (analysis.viralTweets.length > 0) {
    parts.push(`\n## THIS ACCOUNT'S TOP POSTS (study the style, length, and tone — match it)`);
    for (const vt of analysis.viralTweets.slice(0, 5)) {
      parts.push(`- [${vt.likes} likes, ${vt.retweets} RTs] "${vt.text}"`);
    }
  }

  if (analysis.followingProfile.categories.length > 0) {
    parts.push(`\n## AUDIENCE CONTEXT`);
    for (const cat of analysis.followingProfile.categories.slice(0, 5)) {
      parts.push(`- ${cat.label}: ${cat.count} accounts (e.g. ${cat.handles?.slice(0, 3).map(h => '@' + h).join(', ') || 'various'})`);
    }
  }

  // Trending context for topical relevance
  if (trending && trending.length > 0) {
    parts.push(`\n## TRENDING TOPICS IN NETWORK`);
    for (const t of trending.slice(0, 8)) {
      parts.push(`- [${t.category}] ${t.headline} (${t.source}, ${t.tweetCount} posts)`);
    }
  }

  // Learnings from actual performance of our generated tweets
  if (learnings && learnings.totalTracked > 0) {
    parts.push(`\n## LEARNINGS FROM OUR POSTED TWEETS (THIS IS CRITICAL — adapt based on what actually worked)`);
    parts.push(`Tracked ${learnings.totalTracked} tweets we posted. Avg ${learnings.avgLikes} likes, ${learnings.avgRetweets} RTs.`);

    if (learnings.formatRankings.length > 0) {
      parts.push(`\nFormat performance (our tweets, not historical):`);
      for (const f of learnings.formatRankings.slice(0, 5)) {
        parts.push(`- ${f.format}: avg ${f.avgEngagement} engagement (${f.count} tweets)`);
      }
    }

    if (learnings.topicRankings.length > 0) {
      parts.push(`\nTopic performance (our tweets):`);
      for (const t of learnings.topicRankings.slice(0, 5)) {
        parts.push(`- ${t.topic}: avg ${t.avgEngagement} engagement (${t.count} tweets)`);
      }
    }

    if (learnings.bestPerformers.length > 0) {
      parts.push(`\nOUR BEST tweets (do MORE like these):`);
      for (const t of learnings.bestPerformers.slice(0, 3)) {
        parts.push(`- [${t.likes} likes] "${t.content.slice(0, 150)}"`);
      }
    }

    if (learnings.worstPerformers.length > 0) {
      parts.push(`\nOUR WORST tweets (do LESS like these):`);
      for (const t of learnings.worstPerformers.slice(0, 3)) {
        parts.push(`- [${t.likes} likes] "${t.content.slice(0, 150)}"`);
      }
    }

    if (learnings.insights.length > 0) {
      parts.push(`\nAI-generated insights from our performance:`);
      for (const insight of learnings.insights) {
        parts.push(`- ${insight}`);
      }
    }
  }

  // Recent posts — avoid repeating
  if (recentPosts.length > 0) {
    parts.push(`\n## RECENTLY POSTED (DO NOT repeat these topics, angles, or phrasing — be FRESH)`);
    for (const post of recentPosts.slice(0, 15)) {
      parts.push(`- "${post.slice(0, 150)}"`);
    }
  }

  // Dynamic strategy based on user config
  const { lengthMix, enabledFormats } = style;
  const formats = enabledFormats.length > 0 ? enabledFormats : ALL_FORMATS;

  parts.push(`\n## STRATEGY
All tweets are original standalone posts. No quote tweets.

## LENGTH DISTRIBUTION (follow this closely)
- ~${lengthMix.short}% SHORT (under 200 chars): punchy one-liners, sharp observations
- ~${lengthMix.medium}% MEDIUM (200-500 chars): single-point arguments, hot takes with context
- ~${lengthMix.long}% LONG-FORM (500-2000+ chars): multi-paragraph analysis, structured breakdowns, storytelling, contrarian arguments with evidence
${lengthMix.long >= 30 ? 'Long-form posts should go DEEP — use line breaks, build arguments, provide insight that short tweets cannot. X Premium rewards depth.' : ''}
X supports up to 4000 chars. Use \\n for line breaks in longer posts.

## ALLOWED FORMATS
${formats.join(', ')}

## RULES
1. Write in this account's exact voice. Match the style of the top performing tweets.
2. No threads, no "1/", no emojis unless the account uses them.
3. Never use hashtags unless the account's viral tweets use them.
4. Never be generic. Every tweet needs a specific, opinionated point of view.
5. Never include links to x.com or twitter.com in tweet text.
6. Never violate the anti-goals.`);

  return parts.join('\n');
}

/**
 * Generate a batch of tweets using Claude, optimized for QTs.
 */
export async function generateViralBatch(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  count: number,
  trending: TrendingTopic[] | null = null,
  learnings: AgentLearnings | null = null,
  soulMd: string | null = null,
  style: ContentStyleConfig = DEFAULT_STYLE,
  recentPosts: string[] = [],
): Promise<ProtocolTweet[]> {
  const systemPrompt = buildSystemPrompt(voiceProfile, analysis, trending, learnings, soulMd, style, recentPosts);

  const formats = style.enabledFormats.length > 0 ? style.enabledFormats : ALL_FORMATS;
  const userPrompt = `Generate exactly ${count} original standalone tweets. Follow the length distribution in the system prompt exactly. For each tweet, output a JSON object on its own line with these fields:
- "content": the tweet text (any length up to 4000 chars — use \\n for line breaks in longer posts)
- "format": one of: ${formats.join(', ')}
- "targetTopic": what topic this tweet is about
- "rationale": 1 sentence on why this should perform well

Output ONLY JSON objects, one per line, no markdown fencing.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const tweets: ProtocolTweet[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content && parsed.content.length > 0) {
          // Strip hallucinated x.com/twitter.com status URLs from content.
          // QTs are handled via quoteTweetId, not inline URLs.
          const cleanContent = parsed.content
            .replace(/\s*https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\S*/gi, '')
            .trim();
          if (!cleanContent) continue;
          tweets.push({
            content: cleanContent,
            format: parsed.format || 'hot_take',
            targetTopic: parsed.targetTopic || 'general',
            rationale: parsed.rationale || '',
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    return tweets.slice(0, count);
  } catch (err) {
    console.error('Claude generation error:', err);
    throw err; // Don't swallow — let the caller handle it
  }
}

/**
 * Generate a single tweet (convenience wrapper).
 */
export async function generateViralTweet(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  trending: TrendingTopic[] | null = null,
  learnings: AgentLearnings | null = null,
  soulMd: string | null = null,
  style: ContentStyleConfig = DEFAULT_STYLE,
): Promise<ProtocolTweet | null> {
  const batch = await generateViralBatch(voiceProfile, analysis, 1, trending, learnings, soulMd, style);
  return batch[0] || null;
}

// ─── Voice training: extract style signals from example tweets ──────────────

export async function extractStyleSignals(exampleTweets: string[]): Promise<StyleSignals> {
  if (exampleTweets.length === 0) return DEFAULT_STYLE_SIGNALS;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You are a writing style analyst. Analyze the given tweets and extract style patterns. Output valid JSON only, no markdown.',
      messages: [{
        role: 'user',
        content: `Analyze these tweets and extract the writing style:

${exampleTweets.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Output a JSON object with:
- "sentenceLength": "short" | "medium" | "long" | "mixed"
- "vocabulary": "casual" | "technical" | "mixed"
- "toneMarkers": array of tone descriptors (e.g. ["sarcastic", "data-driven", "provocative"])
- "topicPreferences": array of main topics discussed
- "rawExtraction": one paragraph describing the overall voice and style`,
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Strip markdown code fences if Claude wraps the JSON
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      sentenceLength: parsed.sentenceLength || 'mixed',
      vocabulary: parsed.vocabulary || 'mixed',
      toneMarkers: Array.isArray(parsed.toneMarkers) ? parsed.toneMarkers : [],
      topicPreferences: Array.isArray(parsed.topicPreferences) ? parsed.topicPreferences : [],
      rawExtraction: parsed.rawExtraction || '',
    };
  } catch (err) {
    console.error('Style extraction failed:', err);
    return DEFAULT_STYLE_SIGNALS;
  }
}

// ─── SOUL.md generation from wizard inputs ──────────────────────────────────

export async function generateSoulMd(
  archetype: string,
  topics: string[],
  exampleTweets: string[],
  agentName: string,
): Promise<string> {
  try {
    const examplesSection = exampleTweets.length > 0
      ? `\n\nExample tweets this agent admires or has written:\n${exampleTweets.map(t => `- "${t}"`).join('\n')}`
      : '';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: 'You generate SOUL.md personality profiles for Twitter bot agents. Output markdown only, no commentary.',
      messages: [{
        role: 'user',
        content: `Generate a SOUL.md for a Twitter agent named "${agentName}".

Voice archetype: ${archetype}
Topics: ${topics.join(', ')}${examplesSection}

Use this format:
# SOUL.md — System Definition

I am [identity].

## 1) Objective Function
Primary objective: [what this agent aims to achieve]

## 2) Communication Protocol
Default output: [how this agent communicates]
Tone: ${archetype}

## 3) Anti-Goals
Do not optimize for: [what to avoid — be specific]

## 4) Focus Areas
Topics: ${topics.join(', ')}`,
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return text;
  } catch (err) {
    console.error('SOUL.md generation failed, using template:', err);
    // Template fallback
    return `# SOUL.md — System Definition

I am ${agentName}, a ${archetype} voice on Twitter.

## 1) Objective Function
Primary objective: Share sharp, opinionated takes on ${topics.join(', ')}

## 2) Communication Protocol
Default output: Tweets and quote tweets
Tone: ${archetype}

## 3) Anti-Goals
Do not optimize for: engagement bait, generic platitudes, thread spam

## 4) Focus Areas
Topics: ${topics.join(', ')}`;
  }
}
