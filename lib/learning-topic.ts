import type { Agent, Tweet, TweetPerformance } from './types';
import { getAccountTopicPolicyIssue } from './account-topic-policy';
import { resolveAntiFundPortfolioContext } from './antifund-portfolio';

const CANONICAL_TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: 'robotics', pattern: /\b(?:robot(?:ics?|ic)?|humanoid|actuator|embodied\s+ai|physical\s+ai|autonomous\s+machine)\b/i },
  { topic: 'ai', pattern: /\b(?:ai|artificial\s+intelligence|llm|openai|chatgpt|gpt[- ]?\d|claude|anthropic|gemini|codex|devin|cognition|cursor|agentic|agents?|inference)\b/i },
  { topic: 'startups', pattern: /\b(?:startups?|founders?|fundrais(?:e|ing)|seed\s+round|series\s+[abc]|product[- ]market|venture[- ]backed)\b/i },
  { topic: 'investing', pattern: /\b(?:invest(?:or|ing|ment)?|venture\s+capital|\bvc\b|valuation|fund\s+strategy|portfolio|public\s+markets?|private\s+equity)\b/i },
  { topic: 'compute', pattern: /\b(?:gpu|tpu|asic|semiconductor|hbm|data[ -]?cent(?:er|re)|interconnect|compute|chip)\b/i },
  { topic: 'energy', pattern: /\b(?:fusion|fission|nuclear|energy|power\s+grid|megawatt|gigawatt|uranium)\b/i },
  { topic: 'manufacturing', pattern: /\b(?:manufactur(?:e|ing)|factory|industrial|metrology|supply\s+chain|re-industriali[sz]ation)\b/i },
  { topic: 'materials', pattern: /\b(?:rare\s+earth|minerals?|alloy|rhenium|beryllium|graphite|lithium|materials?)\b/i },
  { topic: 'space_defense', pattern: /\b(?:space|aerospace|defen[cs]e|missile|drone|autonomous\s+(?:boat|ship)|satellite|launch\s+vehicle)\b/i },
  { topic: 'software', pattern: /\b(?:software|developer\s+tools?|api|saas|database|browser|cloud)\b/i },
  { topic: 'culture', pattern: /\b(?:culture|status|media|creator|social|taste|wealth|career|personal|humor)\b/i },
  { topic: 'health', pattern: /\b(?:health|longevity|sleep|metabolic|fitness|biohack(?:ing)?)\b/i },
  { topic: 'crypto', pattern: /\b(?:crypto|bitcoin|ethereum|solana|blockchain|token)\b/i },
  { topic: 'sports', pattern: /\b(?:sports?|boxing|mma|ufc|nba|nfl|athlete|player|match|fight)\b/i },
];

function normalizedTopic(value: string | null | undefined): string {
  return (value || 'general')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9+.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'general';
}

export function canonicalizeLearningTopic(
  entry: Pick<TweetPerformance, 'topic' | 'content'>,
): string {
  const text = `${entry.topic || ''} ${entry.content}`;
  return CANONICAL_TOPIC_PATTERNS.find((candidate) => candidate.pattern.test(text))?.topic
    || normalizedTopic(entry.topic);
}

export function isEligibleForAccountPolicyLearning(
  agent: Pick<Agent, 'handle'>,
  entry: Pick<TweetPerformance, 'topic' | 'content' | 'tweetId' | 'xTweetId'>,
  allTweets: Tweet[] = [],
): boolean {
  const tweet = allTweets.find((candidate) => (
    (entry.tweetId && String(candidate.id) === String(entry.tweetId))
    || (entry.xTweetId && candidate.xTweetId && String(candidate.xTweetId) === String(entry.xTweetId))
  ));
  const value = `${entry.topic || ''} ${entry.content}`;
  const portfolioContext = tweet?.portfolioCompanyContext
    || resolveAntiFundPortfolioContext(value, null, 'constructive_conviction');
  return !getAccountTopicPolicyIssue(agent.handle, value, null, portfolioContext);
}
