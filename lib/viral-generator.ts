/**
 * Viral content generator powered by Claude.
 * Produces tweets informed by the agent's soul profile, account analysis,
 * engagement patterns, and what's trending in their network.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AccountAnalysis } from './types';
import type { VoiceProfile } from './soul-parser';
import type { TrendingTopic } from './trending';

const anthropic = new Anthropic();

export interface ProtocolTweet {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
}

/**
 * Build the system prompt that instructs Claude to generate tweets.
 */
function buildSystemPrompt(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  trending: TrendingTopic[] | null,
): string {
  const parts: string[] = [];

  // Soul / voice identity
  parts.push(`You are a tweet ghostwriter for a Twitter account. Your job is to write tweets that sound authentic to this account's voice and are optimized for engagement based on what has historically worked.`);

  parts.push(`\n## VOICE PROFILE
- Tone: ${voiceProfile.tone}
- Topics: ${voiceProfile.topics.join(', ')}
- Communication style: ${voiceProfile.communicationStyle}
- Anti-goals (never do these): ${voiceProfile.antiGoals.join('; ') || 'none specified'}
- Summary: ${voiceProfile.summary}`);

  // Engagement patterns from analysis
  const ep = analysis.engagementPatterns;
  parts.push(`\n## ENGAGEMENT DATA
- Average likes: ${ep.avgLikes}, Average RTs: ${ep.avgRetweets}
- Viral threshold (3x avg): ${ep.viralThreshold}+ likes
- Top performing formats: ${ep.topFormats.join(', ') || 'unknown'}
- Best topics by engagement: ${ep.topTopics.join(', ') || 'unknown'}
- Peak posting hours (UTC): ${ep.topHours.join(', ') || 'unknown'}
- Content fingerprint: ${analysis.contentFingerprint}`);

  // Viral tweet examples — the account's actual best posts
  if (analysis.viralTweets.length > 0) {
    parts.push(`\n## TOP PERFORMING TWEETS (study the style, length, format, and tone)`);
    for (const vt of analysis.viralTweets.slice(0, 5)) {
      parts.push(`- [${vt.likes} likes, ${vt.retweets} RTs] "${vt.text}"`);
    }
  }

  // Following context
  if (analysis.followingProfile.categories.length > 0) {
    parts.push(`\n## AUDIENCE CONTEXT (who this account follows — write content that resonates with this audience)`);
    for (const cat of analysis.followingProfile.categories.slice(0, 5)) {
      parts.push(`- ${cat.label}: ${cat.count} accounts (e.g. ${cat.handles?.slice(0, 3).map(h => '@' + h).join(', ') || 'various'})`);
    }
  }

  // Trending in their network
  if (trending && trending.length > 0) {
    parts.push(`\n## CURRENTLY TRENDING IN THEIR NETWORK (use these as inspiration for timely takes)`);
    for (const t of trending.slice(0, 8)) {
      const topTweetInfo = t.topTweet ? ` — top post by @${t.topTweet.author}: "${t.topTweet.text.slice(0, 100)}" (${t.topTweet.likes} likes)` : '';
      parts.push(`- [${t.category}] ${t.headline} (${t.source}, ${t.tweetCount} posts)${topTweetInfo}`);
    }
  }

  parts.push(`\n## RULES
1. Every tweet MUST be under 280 characters. This is a hard limit.
2. Write in the exact voice/tone described above. Match the style of the top performing tweets.
3. Make each tweet a standalone post — no threads, no "1/", no emojis unless the account uses them.
4. Prioritize formats that have historically performed well for this account.
5. Reference current trending topics when relevant — timely takes get more engagement.
6. Never use hashtags unless the account's viral tweets use them.
7. Never be generic. Every tweet should have a specific, opinionated point of view.
8. Vary the format: mix hot takes, questions, data points, short punches, and structured posts.
9. Never violate the anti-goals.`);

  return parts.join('\n');
}

/**
 * Generate a batch of tweets using Claude.
 */
export async function generateViralBatch(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  count: number,
  trending: TrendingTopic[] | null = null,
): Promise<ProtocolTweet[]> {
  const systemPrompt = buildSystemPrompt(voiceProfile, analysis, trending);

  const userPrompt = `Generate exactly ${count} tweets. For each tweet, output a JSON object on its own line with these fields:
- "content": the tweet text (MUST be under 280 characters)
- "format": one of: hot_take, question, data_point, short_punch, thread_hook, explainer, structured, observation
- "targetTopic": what topic this tweet is about
- "rationale": 1 sentence explaining why this tweet should perform well based on the engagement data

Output ONLY the JSON objects, one per line, no markdown fencing, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Parse line-by-line JSON
    const tweets: ProtocolTweet[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content && parsed.content.length <= 280) {
          tweets.push({
            content: parsed.content,
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
    console.error('Claude generation error:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Generate a single tweet (convenience wrapper).
 */
export async function generateViralTweet(
  voiceProfile: VoiceProfile,
  analysis: AccountAnalysis,
  trending: TrendingTopic[] | null = null,
): Promise<ProtocolTweet | null> {
  const batch = await generateViralBatch(voiceProfile, analysis, 1, trending);
  return batch[0] || null;
}
