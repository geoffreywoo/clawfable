/**
 * Generate a SOUL.md from an account's actual tweet history.
 * Reverse-engineers voice, tone, topics, style, and anti-patterns
 * from how the person actually tweets.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TwitterKeys } from './twitter-client';
import { getDeepTimeline, getMe, getFollowing } from './twitter-client';

const anthropic = new Anthropic();

export interface SoulFromTweetsResult {
  soulMd: string;
  tweetCount: number;
  topTweets: Array<{ text: string; likes: number }>;
  detectedTone: string;
  detectedTopics: string[];
  voiceSummary: string;
}

/**
 * Fetch deep tweet history and generate a SOUL.md that captures the account's actual voice.
 */
export async function generateSoulFromTweets(
  keys: TwitterKeys,
  userId: string,
  agentName: string
): Promise<SoulFromTweetsResult> {
  // Fetch deep history — up to 1000 tweets
  const timeline = await getDeepTimeline(keys, userId, 1000);

  if (timeline.length === 0) {
    throw new Error('No tweets found. Post some tweets first, then generate your SOUL.');
  }

  // Get account info
  const me = await getMe(keys);

  // Get following for context
  let followingContext = '';
  try {
    const following = await getFollowing(keys, userId, 100);
    const topFollowed = following
      .sort((a, b) => b.followersCount - a.followersCount)
      .slice(0, 20);
    const categories: Record<string, number> = {};
    for (const u of topFollowed) {
      const bio = (u.description + ' ' + u.name).toLowerCase();
      if (bio.includes('ai') || bio.includes('machine learning')) categories['AI/Tech'] = (categories['AI/Tech'] || 0) + 1;
      if (bio.includes('founder') || bio.includes('ceo') || bio.includes('startup')) categories['Founders'] = (categories['Founders'] || 0) + 1;
      if (bio.includes('investor') || bio.includes('vc')) categories['VCs'] = (categories['VCs'] || 0) + 1;
      if (bio.includes('crypto') || bio.includes('web3')) categories['Crypto'] = (categories['Crypto'] || 0) + 1;
    }
    const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
    followingContext = sorted.map(([cat, count]) => `${cat}: ${count}`).join(', ');
  } catch {
    // Skip following context if fetch fails
  }

  // Sort by engagement to find top tweets
  const sorted = [...timeline].sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));
  const topTweets = sorted.slice(0, 30);
  const bottomTweets = sorted.slice(-10);

  // Sample diverse tweets for voice analysis (top, recent, random)
  const recent = timeline.slice(0, 20);
  const random = timeline.filter((_, i) => i % Math.max(1, Math.floor(timeline.length / 20)) === 0).slice(0, 20);
  const sampleTweets = [...new Map([...topTweets.slice(0, 15), ...recent, ...random.slice(0, 10)].map(t => [t.id, t])).values()];

  // Calculate stats
  const avgLikes = Math.round(timeline.reduce((s, t) => s + t.likes, 0) / timeline.length);
  const avgLen = Math.round(timeline.reduce((s, t) => s + t.text.length, 0) / timeline.length);
  const shortCount = timeline.filter(t => t.text.length < 200).length;
  const longCount = timeline.filter(t => t.text.length > 500).length;

  // Ask Claude to reverse-engineer the voice
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `You are an expert at analyzing Twitter accounts and reverse-engineering their voice, personality, and posting strategy. You produce SOUL.md files — structured personality profiles that capture exactly how someone tweets.

Be specific and detailed. Don't be generic. The SOUL.md should be so accurate that someone reading it could write tweets indistinguishable from the original account.`,
    messages: [{
      role: 'user',
      content: `Analyze @${me.username} (${me.name}) based on their tweet history and generate a SOUL.md.

## ACCOUNT STATS
- ${timeline.length} tweets analyzed
- Average ${avgLikes} likes per tweet
- Average tweet length: ${avgLen} chars
- ${shortCount} short tweets (<200 chars), ${longCount} long tweets (500+ chars)
- Following context: ${followingContext || 'unknown'}

## TOP PERFORMING TWEETS (sorted by engagement)
${topTweets.slice(0, 15).map(t => `[${t.likes} likes, ${t.retweets} RTs] "${t.text}"`).join('\n\n')}

## RECENT TWEETS
${recent.map(t => `"${t.text}"`).join('\n\n')}

## SAMPLE OF ALL TWEETS (for style patterns)
${sampleTweets.map(t => `"${t.text}"`).join('\n\n')}

## LOWEST PERFORMING TWEETS (what to avoid)
${bottomTweets.map(t => `[${t.likes} likes] "${t.text}"`).join('\n\n')}

---

Generate a comprehensive SOUL.md with these sections:

# SOUL.md — ${agentName}

## 1) Identity
Who is this person? What's their role/position? How do they see themselves?

## 2) Voice & Tone
Exactly how they write. Sentence structure, vocabulary level, use of humor/sarcasm/data, signature phrases or patterns. Be VERY specific — quote actual patterns you see.

## 3) Objective Function
What they're optimizing for based on their best tweets. What drives their content.

## 4) Topics & Expertise
What they tweet about, ranked by frequency and performance. Be specific about their angle on each topic.

## 5) Communication Patterns
- Typical tweet length distribution
- Use of questions, hot takes, threads, data, anecdotes
- How they open tweets (patterns in first words)
- How they use @mentions, QTs, replies

## 6) Anti-Goals
What they clearly avoid based on their content. Patterns you DON'T see. Be specific.

## 7) Audience Context
Who they're writing for based on following/engagement patterns.

Output ONLY the SOUL.md markdown. No commentary.`,
    }],
  });

  const soulMd = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Extract a quick voice summary
  const summaryResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: 'Output a single JSON object with: tone (string), topics (array of strings, max 5), voiceSummary (one sentence).',
    messages: [{
      role: 'user',
      content: `Based on these top tweets, classify the voice:\n${topTweets.slice(0, 10).map(t => `"${t.text}"`).join('\n')}\n\nJSON only, no markdown.`,
    }],
  });

  let detectedTone = 'contrarian';
  let detectedTopics: string[] = [];
  let voiceSummary = '';

  try {
    const raw = summaryResponse.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '');
    const parsed = JSON.parse(raw);
    detectedTone = parsed.tone || 'contrarian';
    detectedTopics = Array.isArray(parsed.topics) ? parsed.topics : [];
    voiceSummary = parsed.voiceSummary || '';
  } catch {
    // Use defaults
  }

  return {
    soulMd,
    tweetCount: timeline.length,
    topTweets: topTweets.slice(0, 5).map(t => ({ text: t.text, likes: t.likes })),
    detectedTone,
    detectedTopics,
    voiceSummary,
  };
}
