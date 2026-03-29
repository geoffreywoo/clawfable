/**
 * Viral content generator powered by Claude.
 * Optimized for Quote Tweets — piggybacks on viral posts from the agent's network.
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
  quoteTweetId: string | null;
  quoteTweetAuthor: string | null;
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
): string {
  const parts: string[] = [];

  parts.push(`You are a tweet ghostwriter for a Twitter account. Your PRIMARY strategy is Quote Tweets (QTs) — adding sharp commentary on high-engagement posts from the network. QTs get significantly more reach because they ride existing viral content.`);

  parts.push(`\n## VOICE PROFILE
- Tone: ${voiceProfile.tone}
- Topics: ${voiceProfile.topics.join(', ')}
- Communication style: ${voiceProfile.communicationStyle}
- Anti-goals (never do these): ${voiceProfile.antiGoals.join('; ') || 'none specified'}
- Summary: ${voiceProfile.summary}
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

  // Quotable tweets — the key data for QT generation
  if (trending && trending.length > 0) {
    const quotable = collectQuotableTweets(trending);
    if (quotable.length > 0) {
      parts.push(`\n## QUOTABLE TWEETS (high-engagement posts from the network — WRITE QT COMMENTARY FOR THESE)`);
      parts.push(`Each has an ID. When you write a QT, include the "quoteTweetId" field with the exact ID.`);
      for (const qt of quotable) {
        parts.push(`- ID: "${qt.id}" | @${qt.author} (${qt.likes} likes) [${qt.category}]: "${qt.text.slice(0, 200)}${qt.text.length > 200 ? '...' : ''}"`);
      }
    }

    // Also show general trending context
    parts.push(`\n## TRENDING TOPICS IN NETWORK`);
    for (const t of trending.slice(0, 8)) {
      parts.push(`- [${t.category}] ${t.headline} (${t.source}, ${t.tweetCount} posts)`);
    }
  }

  parts.push(`\n## STRATEGY
1. **PRIORITIZE QUOTE TWEETS.** At least 60-70% of output should be QTs of the quotable tweets listed above.
2. QT commentary should be SHORT (under 200 chars ideally), OPINIONATED, and add a new angle the original didn't cover.
3. Great QT patterns: contrarian take on the original, adding missing context, a one-liner that reframes it, asking a sharp question the original doesn't answer, connecting it to a bigger trend.
4. The remaining 30-40% should be original standalone tweets on trending topics.
5. For QTs: set "quoteTweetId" to the exact ID from the quotable tweets list. For originals: set "quoteTweetId" to null.

## RULES
1. Every tweet MUST be under 280 characters. Hard limit.
2. Write in this account's exact voice. Match the style of the top performing tweets.
3. No threads, no "1/", no emojis unless the account uses them.
4. Never use hashtags unless the account's viral tweets use them.
5. Never be generic. Every tweet needs a specific, opinionated point of view.
6. For QTs: don't just agree with the original — add value, challenge it, or reframe it.
7. Vary formats across the batch.
8. Never violate the anti-goals.
9. Set "quoteTweetAuthor" to the @handle of the person being quoted (for QTs only).`);

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
): Promise<ProtocolTweet[]> {
  const systemPrompt = buildSystemPrompt(voiceProfile, analysis, trending);

  const userPrompt = `Generate exactly ${count} tweets. For each tweet, output a JSON object on its own line with these fields:
- "content": the tweet text (MUST be under 280 characters)
- "format": one of: qt_contrarian, qt_reframe, qt_question, qt_context, qt_one_liner, hot_take, question, data_point, short_punch, observation
- "targetTopic": what topic this tweet is about
- "rationale": 1 sentence on why this should perform well
- "quoteTweetId": the ID of the tweet being quoted (from the quotable list), or null for originals
- "quoteTweetAuthor": the @handle of the author being quoted, or null for originals

Prioritize QTs — they get more reach. Output ONLY JSON objects, one per line, no markdown fencing.`;

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
            quoteTweetId: parsed.quoteTweetId || null,
            quoteTweetAuthor: parsed.quoteTweetAuthor || null,
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
): Promise<ProtocolTweet | null> {
  const batch = await generateViralBatch(voiceProfile, analysis, 1, trending);
  return batch[0] || null;
}
