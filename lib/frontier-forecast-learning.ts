import type {
  FrontierForecastDomain,
  FrontierForecastGrounding,
  FrontierForecastHorizon,
  FrontierForecastLearningProfile,
  FrontierForecastPerformanceSlice,
  FrontierForecastPosture,
  TweetPerformance,
} from './types';
import {
  buildPerformanceSignalBaseline,
  computeRelativeSpreadSignal,
} from './performance-signals';

export const FRONTIER_FORECAST_LEARNING_VERSION = 'frontier-forecast-learning-2';

export interface FrontierForecastFeatures {
  domain: FrontierForecastDomain | null;
  horizon: FrontierForecastHorizon;
  posture: FrontierForecastPosture;
  grounding: FrontierForecastGrounding;
  isForecast: boolean;
  aggressive: boolean;
  exponentialMechanism: boolean;
}

const ROBOTICS_PATTERN = /\b(?:robot(?:ics?|ic)?|humanoid|actuator|autonomous\s+(?:vehicle|system|machine)|embodied\s+ai|physical\s+ai|manipulation|gripper|fleet\s+learning)\b/i;
const COMPUTE_POWER_PATTERN = /\b(?:gpu|tpu|asic|inference\s+chip|compute|token\s+cost|tokens?\s+per\s+dollar|data[ -]?cent(?:er|re)|power\s+density|megawatt|gigawatt|hbm|interconnect|training\s+run)\b/i;
const AI_PATTERN = /\b(?:ai|artificial\s+intelligence|llm|model|openai|chatgpt|gpt[- ]?\d|claude|anthropic|gemini|codex|devin|cognition|cursor|agentic|agents?)\b/i;
const ADOPTION_PATTERN = /\b(?:adopt|use|users?|engineers?|developers?|employees?|jobs?|work|workflow|company|companies|teams?|default|replace|hire|headcount|labor|customer|consumer|teenagers?|students?)\b/i;
const STARTUP_ORG_PATTERN = /\b(?:startups?|founders?|series\s+[abc]|seed\s+round|org\s+chart|headcount|employees?|teams?|compan(?:y|ies)|venture|funding|valuation|ipo)\b/i;
const FORECAST_PATTERN = /\b(?:next\s+(?:quarter|year|(?:the\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:-|to)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))?\s+months?)|within\s+(?:the\s+next\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:-|to)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))?\s+(?:months?|years?)|in\s+(?:the\s+next\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:-|to)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))?\s+(?:months?|years?)|by\s+20\d{2}|before\s+20\d{2}|will|going\s+to|base\s+case|prediction|i(?:['’]d|\s+would)\s+bet|i\s+expect|soon|inevitable)\b/i;
const WISH_PATTERN = /^(?:i\s+)?(?:want|hope)\b|\b(?:should|needs?\s+to)\b/i;
const COMMITTED_PATTERN = /\b(?:will|going\s+to|base\s+case|inevitable|by\s+20\d{2}|before\s+20\d{2}|next\s+(?:quarter|year))\b/i;
const OWNED_BET_PATTERN = /\bi(?:['’]d|\s+would)\s+bet\b|\bi\s+(?:expect|think|believe)\b/i;
const CURVE_PATTERN = /\b(?:exponential|doubl(?:e|es|ed|ing)|compound(?:s|ed|ing)?|scaling\s+(?:curve|law)|learning\s+curve|cost\s+curve|price[- ]performance|tokens?\s+per\s+dollar|capability\s+(?:gain|jump|improvement)|each\s+(?:generation|model)|fleet\s+data|reliability\s+curve|iteration\s+rate|threshold|recursive\s+improvement)\b/i;
const MECHANISM_PATTERN = /\b(?:inference|training|compute|data|cost|latency|reliability|deployment|utilization|power|capability|automation|headcount|labor|fleet|simulation|teleoperation|distillation|memory|context|tool\s+use)\b/i;
const THRESHOLD_BEHAVIOR_PATTERN = /\b(?:once|until|before|after|when)\b[\s\S]{0,120}\b(?:default|replace|choose|stop|start|ask|hire|build|buy|use|ship|work)\b/i;
const ACTOR_PATTERN = /\b(?:openai|anthropic|claude|chatgpt|gemini|codex|devin|cognition|cursor|founders?|startups?|companies|engineers?|developers?|teenagers?|students?|workers?|factories|customers?|investors?)\b/i;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

const MONTH_WORD_VALUES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseMonthValue(value: string): number {
  return MONTH_WORD_VALUES[value.toLowerCase()] || Number(value);
}

function horizonFromText(text: string, now: Date): FrontierForecastHorizon {
  const months = text.match(/\b(?:next|within|in)\s+(?:the\s+next\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:-|to)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))?\s+months?\b/i);
  if (months) {
    const value = parseMonthValue(months[2] || months[1]);
    if (value <= 5) return 'under_6_months';
    if (value <= 12) return '6_12_months';
    if (value <= 24) return '12_24_months';
    return 'over_24_months';
  }
  if (/\bnext\s+quarter\b|\bthis\s+year\b/i.test(text)) return 'under_6_months';
  if (/\bnext\s+year\b/i.test(text)) return '6_12_months';
  const year = text.match(/\b(?:by|before)\s+(20\d{2})\b/i);
  if (year) {
    const delta = Number(year[1]) - now.getUTCFullYear();
    if (delta <= 0) return 'under_6_months';
    if (delta === 1) return '6_12_months';
    if (delta === 2) return '12_24_months';
    return 'over_24_months';
  }
  return 'implicit';
}

function domainFromText(text: string): FrontierForecastDomain | null {
  if (ROBOTICS_PATTERN.test(text)) return 'robotics_deployment';
  if (COMPUTE_POWER_PATTERN.test(text)) return 'compute_power';
  if (!AI_PATTERN.test(text)) return null;
  if (STARTUP_ORG_PATTERN.test(text)) return 'startup_organization';
  if (ADOPTION_PATTERN.test(text)) return 'ai_adoption';
  return 'ai_capability';
}

export function extractFrontierForecastFeatures(
  content: string,
  topic: string | null | undefined = null,
  now = new Date(),
): FrontierForecastFeatures {
  const text = `${topic || ''} ${content}`;
  const domain = domainFromText(text);
  const horizon = horizonFromText(text, now);
  const isForecast = Boolean(domain && (horizon !== 'implicit' || FORECAST_PATTERN.test(text)));
  const posture: FrontierForecastPosture = WISH_PATTERN.test(content.trim())
    ? 'wish_or_request'
    : OWNED_BET_PATTERN.test(text)
      ? 'owned_bet'
      : COMMITTED_PATTERN.test(text) || horizon !== 'implicit'
        ? 'committed_prediction'
        : content.includes('?')
          ? 'question'
          : 'observation';
  const exponentialMechanism = Boolean(
    domain
    && (CURVE_PATTERN.test(text) || (AI_PATTERN.test(text) && THRESHOLD_BEHAVIOR_PATTERN.test(text))),
  );
  const quantified = /\b\d+(?:\.\d+)?\s*(?:x|%|months?|years?|tokens?|gpus?|robots?|employees?)\b|\b20\d{2}\b/i.test(text);
  const grounding: FrontierForecastGrounding = quantified && (CURVE_PATTERN.test(text) || isForecast)
    ? 'quantified_curve'
    : THRESHOLD_BEHAVIOR_PATTERN.test(text)
      ? 'named_threshold'
      : MECHANISM_PATTERN.test(text)
        ? 'mechanism_backed'
        : ACTOR_PATTERN.test(text)
          ? 'named_actor_only'
          : 'ungrounded';
  return {
    domain,
    horizon,
    posture,
    grounding,
    isForecast,
    aggressive: isForecast && (posture === 'committed_prediction' || posture === 'owned_bet'),
    exponentialMechanism,
  };
}

interface ProfileRow {
  entry: TweetPerformance;
  features: FrontierForecastFeatures;
  spreadScore: number;
  qualityScore: number;
  win: boolean;
}

function buildSlices(rows: ProfileRow[], key: (row: ProfileRow) => string): FrontierForecastPerformanceSlice[] {
  const buckets = new Map<string, ProfileRow[]>();
  for (const row of rows) {
    const bucketKey = key(row);
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(row);
    buckets.set(bucketKey, bucket);
  }
  return [...buckets.entries()]
    .map(([bucketKey, entries]) => ({
      key: bucketKey,
      posts: entries.length,
      operatorPosts: entries.filter((row) => row.entry.source !== 'autopilot').length,
      generatedPosts: entries.filter((row) => row.entry.source === 'autopilot').length,
      wins: entries.filter((row) => row.win).length,
      avgSpreadScore: Number((entries.reduce((sum, row) => sum + row.spreadScore, 0) / entries.length).toFixed(3)),
      avgQualityScore: Math.round(entries.reduce((sum, row) => sum + row.qualityScore, 0) / entries.length),
    }))
    .sort((left, right) => (
      right.avgSpreadScore - left.avgSpreadScore
      || right.wins - left.wins
      || right.posts - left.posts
      || left.key.localeCompare(right.key)
    ));
}

function readableKey(value: string): string {
  return value.replace(/_/g, ' ');
}

function winningPattern(label: string, row: FrontierForecastPerformanceSlice): string {
  return `${label} ${readableKey(row.key)} averages ${row.avgSpreadScore.toFixed(2)} relative spread across ${row.posts} posts (${row.wins} wins).`;
}

function losingPattern(label: string, row: FrontierForecastPerformanceSlice): string {
  return `Avoid overusing ${label} ${readableKey(row.key)}: ${row.avgSpreadScore.toFixed(2)} relative spread across ${row.posts} posts with ${row.wins} wins.`;
}

export function buildFrontierForecastLearningProfile(
  history: TweetPerformance[],
  now = new Date(),
): FrontierForecastLearningProfile {
  const baseline = buildPerformanceSignalBaseline(history);
  const rows = history.flatMap((entry): ProfileRow[] => {
    const features = extractFrontierForecastFeatures(entry.content, entry.topic, now);
    if (!features.domain) return [];
    const spread = typeof entry.relativeSpreadScore === 'number'
      ? { score: clamp(entry.relativeSpreadScore), metricCoverage: entry.spreadMetricCoverage || 0 }
      : computeRelativeSpreadSignal(entry, baseline);
    const qualityScore = entry.qualityAdjustedGrowthScore
      ?? entry.actionRewards?.qualityAdjustedGrowthScore
      ?? 50;
    return [{
      entry,
      features,
      spreadScore: spread.score,
      qualityScore,
      win: entry.wasViral || spread.score >= 0.72 || qualityScore >= 72,
    }];
  });
  const forecasts = rows.filter((row) => row.features.isForecast);
  const domains = buildSlices(rows, (row) => row.features.domain!);
  const horizons = buildSlices(forecasts, (row) => row.features.horizon);
  const postures = buildSlices(rows, (row) => row.features.posture);
  const groundingModes = buildSlices(rows, (row) => row.features.grounding);
  const candidatePatterns = [
    ...horizons.map((row) => ({ label: 'Horizon', row })),
    ...postures.map((row) => ({ label: 'Posture', row })),
    ...groundingModes.map((row) => ({ label: 'Grounding', row })),
  ].filter(({ row }) => row.posts >= 2);
  const winningPatterns = candidatePatterns
    .filter(({ row }) => row.wins > 0 && row.avgSpreadScore >= 0.58)
    .sort((left, right) => right.row.avgSpreadScore - left.row.avgSpreadScore || right.row.posts - left.row.posts)
    .slice(0, 5)
    .map(({ label, row }) => winningPattern(label, row));
  const avoidPatterns = candidatePatterns
    .filter(({ label, row }) => {
      const policyRequiredShape = (
        (label === 'Horizon' && row.key === '6_12_months')
        || (label === 'Posture' && ['committed_prediction', 'owned_bet'].includes(row.key))
        || (label === 'Grounding' && ['quantified_curve', 'named_threshold', 'mechanism_backed'].includes(row.key))
      );
      return !policyRequiredShape && (row.avgSpreadScore < 0.45 || row.wins === 0);
    })
    .sort((left, right) => left.row.avgSpreadScore - right.row.avgSpreadScore || right.row.posts - left.row.posts)
    .slice(0, 4)
    .map(({ label, row }) => losingPattern(label, row));
  const directMetricRows = rows.filter((row) => (
    typeof row.entry.quotes === 'number' && typeof row.entry.bookmarks === 'number'
  )).length;

  return {
    version: FRONTIER_FORECAST_LEARNING_VERSION,
    generatedAt: now.toISOString(),
    eligiblePosts: rows.length,
    forecastPosts: forecasts.length,
    operatorPosts: rows.filter((row) => row.entry.source !== 'autopilot').length,
    generatedPosts: rows.filter((row) => row.entry.source === 'autopilot').length,
    directShareMetricCoverage: rows.length > 0 ? Number((directMetricRows / rows.length).toFixed(3)) : 0,
    aggressiveForecastShare: forecasts.length > 0
      ? Number((forecasts.filter((row) => row.features.aggressive).length / forecasts.length).toFixed(3))
      : 0,
    exponentialMechanismShare: forecasts.length > 0
      ? Number((forecasts.filter((row) => row.features.exponentialMechanism).length / forecasts.length).toFixed(3))
      : 0,
    domains,
    horizons,
    postures,
    groundingModes,
    winningPatterns,
    avoidPatterns,
  };
}

export function describeFrontierForecastPattern(
  content: string,
  topic: string | null | undefined = null,
): string | null {
  const features = extractFrontierForecastFeatures(content, topic);
  if (!features.domain) return null;
  return [
    readableKey(features.domain),
    readableKey(features.horizon),
    readableKey(features.posture),
    readableKey(features.grounding),
    features.exponentialMechanism ? 'nonlinear threshold' : 'linear or implicit trajectory',
  ].join(' / ');
}
