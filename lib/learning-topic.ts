import type { Agent, Tweet, TweetPerformance } from './types';
import { getAccountTopicPolicyIssue } from './account-topic-policy';
import { resolveAntiFundPortfolioContext } from './antifund-portfolio';

const DECLARED_TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: 'robotics', pattern: /\b(?:robot(?:ics?|ic)?|humanoid|physical\s+ai|embodied\s+ai)\b/i },
  { topic: 'compute', pattern: /\b(?:compute|inference\s+hardware|asic|gpu|tpu|semiconductor|chips?|data[ -]?cent(?:er|re)|hbm|rack)\b/i },
  { topic: 'energy', pattern: /\b(?:energy|fusion|fission|nuclear|power|grid|uranium)\b/i },
  { topic: 'manufacturing', pattern: /\b(?:manufactur(?:e|ing)|factory|industrial|supply\s+chain|re-industriali[sz]ation)\b/i },
  { topic: 'materials', pattern: /\b(?:materials?|minerals?|rare\s+earth|metallurgy|graphite|lithium)\b/i },
  { topic: 'space_defense', pattern: /\b(?:space|aerospace|defen[cs]e|starlink|satellite|rocket|drone)\b/i },
  { topic: 'crypto', pattern: /\b(?:crypto|bitcoin|ethereum|solana|blockchain|web3)\b/i },
  { topic: 'sports', pattern: /\b(?:sports?|boxing|mma|ufc|nba|nfl|football|basketball|soccer|tennis)\b/i },
  { topic: 'politics_geopolitics', pattern: /\b(?:politics?|geopolitics?|regulation|policy|election|government)\b/i },
  { topic: 'health', pattern: /\b(?:health|longevity|sleep|metabolic|fitness|biohack(?:ing)?)\b/i },
  { topic: 'investing', pattern: /\b(?:invest(?:or|ing|ment)?|finance|venture|markets?|economics|fintech|stocks?|portfolio|fund)\b/i },
  { topic: 'startups', pattern: /\b(?:startups?|founders?|funding|fundraise|seed|series\s+[abc]|company\s+building)\b/i },
  { topic: 'software', pattern: /\b(?:software|technology|tech|engineering|product|developer|browser|saas|cloud|database)\b/i },
  { topic: 'culture', pattern: /\b(?:culture|status|media|creator|social|career|jobs?|future\s+of\s+work|personal|humor)\b/i },
  { topic: 'ai', pattern: /\b(?:ai|artificial\s+intelligence|llm|openai|chatgpt|gpt|claude|anthropic|gemini|codex|devin|cognition|cursor|agents?)\b/i },
];

const CONTENT_TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: 'robotics', pattern: /\b(?:robot(?:ics?|ic)?|humanoid|actuator|embodied\s+ai|physical\s+ai|autonomous\s+machine)\b/i },
  { topic: 'compute', pattern: /\b(?:gpu|tpu|asic|semiconductor|hbm|data[ -]?cent(?:er|re)|interconnect|inference\s+(?:chip|hardware)|compute|chip|rack\s+power)\b/i },
  { topic: 'energy', pattern: /\b(?:fusion|fission|nuclear|energy|power\s+grid|megawatt|gigawatt|uranium)\b/i },
  { topic: 'manufacturing', pattern: /\b(?:manufactur(?:e|ing)|factory|industrial|metrology|supply\s+chain|re-industriali[sz]ation)\b/i },
  { topic: 'materials', pattern: /\b(?:rare\s+earth|minerals?|alloy|rhenium|beryllium|graphite|lithium|materials?)\b/i },
  { topic: 'space_defense', pattern: /\b(?:starlink|space|aerospace|defen[cs]e|missile|drone|autonomous\s+(?:boat|ship)|satellite|launch\s+vehicle)\b/i },
  { topic: 'startups', pattern: /\b(?:startups?|founders?|fundrais(?:e|ing)|seed\s+round|series\s+[abc]|product[- ]market|venture[- ]backed)\b/i },
  { topic: 'investing', pattern: /\b(?:invest(?:or|ing|ment)?|venture\s+capital|\bvc\b|valuation|fund\s+strategy|portfolio|public\s+markets?|private\s+equity|fintech|capital\s+markets?)\b/i },
  { topic: 'ai', pattern: /\b(?:ai|artificial\s+intelligence|llm|openai|chatgpt|gpt[- ]?\d|claude|anthropic|gemini|codex|devin|cognition|cursor|agentic|agents?|inference)\b/i },
  { topic: 'software', pattern: /\b(?:software|developer\s+tools?|api|saas|database|browser|cloud)\b/i },
  { topic: 'culture', pattern: /\b(?:culture|status|media|creator|social|taste|wealth|career|jobs?|labor|personal|humor)\b/i },
  { topic: 'health', pattern: /\b(?:health|longevity|sleep|metabolic|fitness|biohack(?:ing)?)\b/i },
  { topic: 'crypto', pattern: /\b(?:crypto|bitcoin|ethereum|solana|blockchain|token)\b/i },
  { topic: 'politics_geopolitics', pattern: /\b(?:politics?|geopolitics?|regulation|election|congress|government|white\s+house)\b/i },
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
  const declared = normalizedTopic(entry.topic);
  const declaredTopic = DECLARED_TOPIC_PATTERNS.find((candidate) => candidate.pattern.test(declared))?.topic;
  if (declaredTopic) return declaredTopic;
  return CONTENT_TOPIC_PATTERNS.find((candidate) => candidate.pattern.test(entry.content))?.topic || 'general';
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
