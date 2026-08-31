import type { LearningSignal, PortfolioCompanyGenerationContext, Tweet } from './types';

export const ANTIFUND_PORTFOLIO_SOURCE_URL = 'https://antifund.com/#portfolio';
export const ANTIFUND_PORTFOLIO_SNAPSHOT_VERSION = 'antifund-portfolio-2026-08-21';
export const ANTIFUND_PORTFOLIO_POLICY_VERSION = 'antifund-portfolio-alignment-3';
export const ANTIFUND_PORTFOLIO_PROMOTION_POLICY_VERSION = 'antifund-priority-promotion-2';
export const ANTIFUND_PORTFOLIO_SNAPSHOT_EXPIRES_AT = '2026-11-19T00:00:00.000Z';

export const ANTIFUND_FLAGSHIP_PROMOTION_COMPANY_IDS = [
  'openai',
  'anduril',
  'helion',
  'saronic',
  'general-matter',
  'cognition',
  'etched',
  'physical-intelligence',
  'ramp',
  'elevenlabs',
  'polymarket',
  'ketone-iq',
  'eight-sleep',
  'betr',
  'kings-league',
  'chronosphere',
  'spacex',
] as const;

export const ANTIFUND_PROMOTION_EXCLUDED_COMPANY_IDS = ['natural'] as const;

export const ANTIFUND_AUTONOMOUS_PROMOTION_COMPANY_IDS = ['openai', 'cognition'] as const;

const FLAGSHIP_PROMOTION_COMPANY_IDS = new Set<string>(ANTIFUND_FLAGSHIP_PROMOTION_COMPANY_IDS);
const PROMOTION_EXCLUDED_COMPANY_IDS = new Set<string>(ANTIFUND_PROMOTION_EXCLUDED_COMPANY_IDS);
const AUTONOMOUS_PROMOTION_COMPANY_IDS = new Set<string>(ANTIFUND_AUTONOMOUS_PROMOTION_COMPANY_IDS);

export type AntiFundPortfolioCategory =
  | 'ai_infrastructure_national_resilience'
  | 'software_finance_applied_ai'
  | 'consumer_platforms_brands'
  | 'realized_public_outcomes';

export interface AntiFundPortfolioCompany {
  id: string;
  name: string;
  url: string;
  description: string;
  category: AntiFundPortfolioCategory;
  aliases: string[];
  officialXHandles: string[];
  sportsAdjacent: boolean;
  promotionTier: 'flagship' | 'standard' | 'excluded';
}

type PortfolioRow = readonly [
  name: string,
  url: string,
  description: string,
  category: AntiFundPortfolioCategory,
  aliases?: readonly string[],
  officialXHandles?: readonly string[],
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const ROWS: PortfolioRow[] = [
  ['OpenAI', 'https://openai.com/', 'Frontier AI research and products.', 'ai_infrastructure_national_resilience', [], ['openai']],
  ['Anduril', 'https://www.anduril.com/', 'Autonomous defense systems and manufacturing.', 'ai_infrastructure_national_resilience', [], ['anduriltech']],
  ['Helion', 'https://www.helionenergy.com/', 'Commercial fusion energy.', 'ai_infrastructure_national_resilience', [], ['helion_energy']],
  ['Saronic', 'https://www.saronic.com/', 'Autonomous surface vessels for maritime defense.', 'ai_infrastructure_national_resilience', [], ['saronic']],
  ['General Matter', 'https://generalmatter.com/', 'Nuclear fuel infrastructure.', 'ai_infrastructure_national_resilience', [], ['generalmatter']],
  ['General Galactic', 'https://www.gengalactic.com/', 'Spacecraft and propulsion for orbital logistics.', 'ai_infrastructure_national_resilience'],
  ['Aeon', 'https://www.aeonindustrial.com/', 'Autonomous tactical systems for U.S. and allied defense.', 'ai_infrastructure_national_resilience', ['Aeon Industrial']],
  ['Westmag', 'https://www.westmag.com/', 'American-made motors and actuators for drones and robots.', 'ai_infrastructure_national_resilience'],
  ['Orbital', 'https://orbital.inc/', 'AI compute infrastructure in low Earth orbit.', 'ai_infrastructure_national_resilience', ['Orbital Inc']],
  ['Trajectory', 'https://trajectory.ai/', 'Continual-learning infrastructure for production AI.', 'ai_infrastructure_national_resilience', ['Trajectory AI']],
  ['Enigma', 'https://enigma.inc/', 'AI models and interfaces for intuitive human-robot interaction.', 'ai_infrastructure_national_resilience', ['Enigma Inc']],
  ['Cognition', 'https://cognition.ai/', 'Applied AI systems and end-to-end software agents.', 'ai_infrastructure_national_resilience', ['Cognition AI'], ['cognition']],
  ['Etched', 'https://www.etched.com/', 'Purpose-built chips for transformer inference.', 'ai_infrastructure_national_resilience', [], ['etched']],
  ['Modal', 'https://modal.com/', 'Cloud infrastructure for AI and data workloads.', 'ai_infrastructure_national_resilience', ['Modal Labs'], ['modal']],
  ['Physical Intelligence', 'https://www.physicalintelligence.company/', 'General-purpose AI for the physical world.', 'ai_infrastructure_national_resilience', ['PI'], ['physical_int']],
  ['Kela Systems', 'https://kelasys.com/', 'Defense systems for modern military operations.', 'ai_infrastructure_national_resilience', ['Kela']],
  ['Merge', 'https://www.merge.io/', 'Brain-computer interfaces.', 'ai_infrastructure_national_resilience', ['Merge Labs']],
  ['Efference', 'https://efference.ai/', 'Perception and compute infrastructure for robotics.', 'ai_infrastructure_national_resilience'],
  ['Ramp', 'https://ramp.com/', 'Corporate cards and finance automation.', 'software_finance_applied_ai', [], ['tryramp']],
  ['ElevenLabs', 'https://elevenlabs.io/', 'AI voice research and products.', 'software_finance_applied_ai', ['Eleven Labs'], ['elevenlabs']],
  ['Erebor', 'https://erebor.bank/', 'Banking infrastructure for the innovation economy.', 'software_finance_applied_ai'],
  ['Monaco', 'https://www.monaco.com/', 'AI-native sales infrastructure for startups.', 'software_finance_applied_ai'],
  ['Lighter', 'https://lighter.xyz/', 'Verifiable exchange infrastructure built with custom ZK systems.', 'software_finance_applied_ai'],
  ['Polymarket', 'https://polymarket.com/', 'Global prediction-market platform.', 'software_finance_applied_ai', [], ['polymarket']],
  ['Archive', 'https://archive.com/', 'AI-powered creator marketing infrastructure.', 'software_finance_applied_ai', ['Archive.com']],
  ['WithCoverage', 'https://withcoverage.com/', 'Insurance and risk infrastructure for ambitious businesses.', 'software_finance_applied_ai', ['With Coverage']],
  ['Cluely', 'https://cluely.com/', 'Real-time AI desktop assistance.', 'software_finance_applied_ai'],
  ['Melius', 'https://www.melius.com/', 'Creative workspace for AI agents and generative models.', 'software_finance_applied_ai'],
  ['Natural', 'https://www.natural.co/', 'Payments infrastructure for AI agents.', 'software_finance_applied_ai', ['Natural.co']],
  ['Creed', 'https://usecreed.com/', 'AI-guided Bible study and prayer.', 'software_finance_applied_ai', ['Use Creed']],
  ['Pensive', 'https://www.pensive.com/', 'AI grading and tutoring for higher education.', 'software_finance_applied_ai'],
  ['Olipop', 'https://drinkolipop.com/', 'Prebiotic soda.', 'consumer_platforms_brands'],
  ['Wander', 'https://www.wander.com/', 'Luxury travel platform with hotel-grade hospitality.', 'consumer_platforms_brands'],
  ['Oats Overnight', 'https://www.oatsovernight.com/', 'High-protein overnight oats sold direct-to-consumer.', 'consumer_platforms_brands'],
  ['Palm Tree Crew', 'https://www.palmtreecrew.com/', 'Live entertainment and lifestyle platform.', 'consumer_platforms_brands'],
  ['Kings League', 'https://kingsleague.pro/', 'Global, creator-led 7 vs 7 soccer league.', 'consumer_platforms_brands', [], ['kingsleague']],
  ['Happy Dad', 'https://happydad.com/', 'Hard seltzer and ready-to-drink beverages.', 'consumer_platforms_brands'],
  ['Passes', 'https://www.passes.com/', 'Creator commerce infrastructure.', 'consumer_platforms_brands'],
  ['Sesh', 'https://seshproducts.com/', 'Tobacco-free nicotine pouch brand.', 'consumer_platforms_brands'],
  ['Ketone-IQ', 'https://ketone.com/', 'Ketone-based energy and performance products.', 'consumer_platforms_brands', ['Ketone IQ'], ['ketone']],
  ['SipMargs', 'https://www.sipmargs.com/', 'Sparkling margarita ready-to-drink beverages.', 'consumer_platforms_brands', ['Sip Margs']],
  ['Khloud', 'https://khloudfoods.com/', 'High-protein popcorn.', 'consumer_platforms_brands'],
  ['Eight Sleep', 'https://www.eightsleep.com/', 'Temperature-controlled sleep systems.', 'consumer_platforms_brands', [], ['eightsleep']],
  ['Betr', 'https://betr.app/', 'Sports betting, fantasy, and media.', 'consumer_platforms_brands', [], ['betr']],
  ['W', 'https://getw.com/', "Men's personal care.", 'consumer_platforms_brands', ['Get W']],
  ['Chronosphere', 'https://chronosphere.io/', 'Cloud observability platform; acquired by Palo Alto Networks for $3.35B.', 'realized_public_outcomes', [], ['chronosphereio']],
  ['Rail', 'https://rail.io/', 'Stablecoin payments infrastructure; acquired by Ripple for $200M.', 'realized_public_outcomes', ['Rail.io']],
  ['Aerodome', 'https://www.aerodome.com/', 'Public-safety drone infrastructure; acquired by Flock Safety.', 'realized_public_outcomes'],
  ['Metis', 'https://www.withmetis.ai/', 'Continual-learning infrastructure for enterprise agents; acquired by DoorDash in March 2026.', 'realized_public_outcomes', ['With Metis']],
  ['Poke.com', 'https://poke.com/', 'Personal AI agent acquired by Cognition in July 2026.', 'realized_public_outcomes', ['Poke']],
  ['SpaceX', 'https://www.spacex.com/', 'Space and launch infrastructure.', 'realized_public_outcomes', ['Space X'], ['spacex']],
];

export const ANTIFUND_PORTFOLIO_COMPANIES: AntiFundPortfolioCompany[] = ROWS.map(([
  name,
  url,
  description,
  category,
  aliases = [],
  officialXHandles = [],
]) => {
  const id = slug(name);
  return {
    id,
    name,
    url,
    description,
    category,
    aliases: [...new Set([name, ...aliases])],
    officialXHandles: officialXHandles.map((handle) => handle.replace(/^@/, '').toLowerCase()),
    sportsAdjacent: name === 'Betr' || name === 'Kings League',
    promotionTier: FLAGSHIP_PROMOTION_COMPANY_IDS.has(id)
      ? 'flagship'
      : PROMOTION_EXCLUDED_COMPANY_IDS.has(id)
        ? 'excluded'
        : 'standard',
  };
});

export const ANTIFUND_PROMOTION_COMPANIES = ANTIFUND_PORTFOLIO_COMPANIES.filter((company) => (
  company.promotionTier === 'flagship'
));

export const ANTIFUND_AUTONOMOUS_PROMOTION_COMPANIES = ANTIFUND_PORTFOLIO_COMPANIES.filter((company) => (
  AUTONOMOUS_PROMOTION_COMPANY_IDS.has(company.id)
));

export function isAntiFundPortfolioPromotionEligible(
  company: AntiFundPortfolioCompany | null | undefined,
): company is AntiFundPortfolioCompany {
  return company?.promotionTier === 'flagship';
}

export function isAntiFundAutonomousPromotionEligible(
  company: AntiFundPortfolioCompany | null | undefined,
): boolean {
  return Boolean(company && AUTONOMOUS_PROMOTION_COMPANY_IDS.has(company.id));
}

export function getAntiFundAutonomousPromotionPolicyIssue(
  context: PortfolioCompanyGenerationContext | null | undefined,
): string | null {
  if (!context || context.intent !== 'constructive_conviction') return null;
  const company = getAntiFundPortfolioCompany(context.companyId);
  if (isAntiFundAutonomousPromotionEligible(company)) return null;
  return `Autonomous Anti Fund company-conviction posts currently prioritize OpenAI and Cognition; ${company?.name || context.companyName || 'this company'} remains eligible only for a qualified live development.`;
}

const GENERIC_COMPANY_NAMES = new Set([
  'aeon', 'archive', 'creed', 'enigma', 'lighter', 'merge', 'modal', 'monaco',
  'natural', 'orbital', 'passes', 'pensive', 'pi', 'poke', 'rail', 'ramp', 'sesh',
  'trajectory', 'wander', 'w',
]);

function regexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

function normalizeEntity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsAlias(
  text: string,
  alias: string,
  options: { required?: boolean; exactEntities?: Set<string> } = {},
): boolean {
  const normalized = alias.trim();
  if (!normalized) return false;
  if (options.required) return new RegExp(`\\b${regexLiteral(normalized)}\\b`, 'i').test(text);
  if (GENERIC_COMPANY_NAMES.has(normalized.toLowerCase())) {
    return options.exactEntities?.has(normalizeEntity(normalized)) === true;
  }
  return new RegExp(`\\b${regexLiteral(normalized)}\\b`, 'i').test(text);
}

export function isAntiFundPortfolioCompanyMentioned(
  text: string,
  company: AntiFundPortfolioCompany,
  options: { required?: boolean; exactEntities?: string[] } = {},
): boolean {
  const lower = text.toLowerCase();
  if (company.officialXHandles.some((handle) => new RegExp(`(^|[^a-z0-9_])@${regexLiteral(handle)}\\b`, 'i').test(text))) {
    return true;
  }
  try {
    const host = new URL(company.url).hostname.replace(/^www\./, '').toLowerCase();
    if (host && lower.includes(host)) return true;
  } catch {
    // The registry is static and validated in tests; malformed URLs simply lose domain matching.
  }
  const exactEntities = new Set((options.exactEntities || []).map(normalizeEntity));
  return company.aliases.some((alias) => containsAlias(text, alias, {
    required: options.required,
    exactEntities,
  }));
}

export function findAntiFundPortfolioCompanies(
  text: string,
  options: { exactEntities?: string[] } = {},
): AntiFundPortfolioCompany[] {
  return ANTIFUND_PORTFOLIO_COMPANIES.filter((company) => (
    isAntiFundPortfolioCompanyMentioned(text, company, options)
  ));
}

export function findSingleAntiFundPortfolioCompany(
  text: string,
  options: { exactEntities?: string[] } = {},
): AntiFundPortfolioCompany | null {
  const matches = findAntiFundPortfolioCompanies(text, options);
  return matches.length === 1 ? matches[0] : null;
}

export function findOfficialAntiFundPortfolioPublisher(
  publisher: string | null | undefined,
): AntiFundPortfolioCompany | null {
  const handle = String(publisher || '').replace(/^@/, '').trim().toLowerCase();
  if (!handle) return null;
  return ANTIFUND_PORTFOLIO_COMPANIES.find((company) => (
    company.officialXHandles.includes(handle)
  )) || null;
}

export function buildAntiFundPortfolioContext(
  company: AntiFundPortfolioCompany,
  intent: PortfolioCompanyGenerationContext['intent'],
): PortfolioCompanyGenerationContext {
  return {
    policyVersion: ANTIFUND_PORTFOLIO_POLICY_VERSION,
    snapshotVersion: ANTIFUND_PORTFOLIO_SNAPSHOT_VERSION,
    snapshotExpiresAt: ANTIFUND_PORTFOLIO_SNAPSHOT_EXPIRES_AT,
    companyId: company.id,
    companyName: company.name,
    companyUrl: company.url,
    category: company.category,
    description: company.description,
    sportsAdjacent: company.sportsAdjacent,
    promotionTier: company.promotionTier,
    relationship: 'antifund_selected_investment',
    intent,
    sourceUrl: ANTIFUND_PORTFOLIO_SOURCE_URL,
  };
}

export function getAntiFundPortfolioCompany(
  companyId: string | null | undefined,
): AntiFundPortfolioCompany | null {
  return ANTIFUND_PORTFOLIO_COMPANIES.find((company) => company.id === companyId) || null;
}

export function getAntiFundPortfolioContextIssues(
  context: PortfolioCompanyGenerationContext | null | undefined,
  now = new Date(),
): string[] {
  if (!context || typeof context !== 'object') return ['portfolio_context_missing'];
  const company = getAntiFundPortfolioCompany(context.companyId);
  const issues: string[] = [];
  if (!company) return ['portfolio_context_unknown_company'];
  const canonical = buildAntiFundPortfolioContext(company, context.intent);
  if (context.policyVersion !== canonical.policyVersion) issues.push('portfolio_context_policy_stale');
  if (context.snapshotVersion !== canonical.snapshotVersion) issues.push('portfolio_context_snapshot_stale');
  if (context.snapshotExpiresAt !== canonical.snapshotExpiresAt) issues.push('portfolio_context_expiry_mismatch');
  if (now.getTime() >= Date.parse(canonical.snapshotExpiresAt)) issues.push('portfolio_context_snapshot_expired');
  if (company.promotionTier === 'excluded') issues.push('portfolio_company_promotion_excluded');
  if (company.promotionTier !== 'flagship') issues.push('portfolio_company_not_flagship');
  if (
    context.companyName !== canonical.companyName
    || context.companyUrl !== canonical.companyUrl
    || context.category !== canonical.category
    || context.description !== canonical.description
    || context.sportsAdjacent !== canonical.sportsAdjacent
    || context.promotionTier !== canonical.promotionTier
    || context.relationship !== canonical.relationship
    || context.sourceUrl !== canonical.sourceUrl
    || !['live_development', 'constructive_conviction'].includes(context.intent)
  ) issues.push('portfolio_context_canonical_mismatch');
  return [...new Set(issues)];
}

const SPORTS_PORTFOLIO_COMPANY_IDS = new Set(['betr', 'kings-league']);
const SPORTS_PORTFOLIO_BUSINESS_PATTERN = /\b(?:acquir(?:e|es|ed|ing)|acquisition|business|capital|company|creator|distribution|economics|expand(?:s|ed|ing)?|expansion|fantasy|format|funding|fundraise|growth|launch(?:es|ed|ing)?|market|media|partnership|partners?|platform|product|app|brand|raise[sd]?|revenue|rights|round|scale|sportsbook|startup|audience|betting)\b/i;
const SPORTS_EVENT_OR_PLAYER_PATTERN = /\b(?:athlete|betting\s+odds|bout|boxer|coach|draft\s+pick|fight\s+card|fighter|finals?|fixture|game|highlight|match|matchup|mvp|odds\s+on|player|playoffs?|quarterfinal|roster|score|semifinal|sign\s+(?:him|her|this\s+player)|standings|tonight|tournament|trade|versus|vs\.?)\b/i;

export function isQualifiedSportsPortfolioContext(
  value: string | null | undefined,
  context: PortfolioCompanyGenerationContext | null | undefined,
): boolean {
  if (!context || getAntiFundPortfolioContextIssues(context).length > 0) return false;
  const company = getAntiFundPortfolioCompany(context.companyId);
  if (!company || !SPORTS_PORTFOLIO_COMPANY_IDS.has(company.id)) return false;
  const content = String(value || '');
  if (!isAntiFundPortfolioCompanyMentioned(content, company, { required: true })) return false;
  if (!SPORTS_PORTFOLIO_BUSINESS_PATTERN.test(content)) return false;
  return !SPORTS_EVENT_OR_PLAYER_PATTERN.test(content);
}

export function resolveAntiFundPortfolioContext(
  content: string,
  existingContext: PortfolioCompanyGenerationContext | null | undefined = null,
  intent: PortfolioCompanyGenerationContext['intent'] = 'constructive_conviction',
): PortfolioCompanyGenerationContext | null {
  const existingCompany = existingContext ? getAntiFundPortfolioCompany(existingContext.companyId) : null;
  if (existingCompany && isAntiFundPortfolioCompanyMentioned(content, existingCompany, { required: true })) {
    return buildAntiFundPortfolioContext(existingCompany, intent);
  }
  const company = findSingleAntiFundPortfolioCompany(content);
  return company ? buildAntiFundPortfolioContext(company, intent) : null;
}

const DISPARAGEMENT_PATTERN = /\b(?:scam|fraud(?:ulent)?|ponzi|vaporware|trash|garbage|lame|overrated|doomed|dead\s+company|bad\s+company|weak\s+team|no\s+moat|will\s+fail|can(?:not|'t)\s+compete|not\s+(?:convinced|impressed)|wouldn(?:'t|\s+not)\s+back|don(?:'t|\s+not)\s+(?:buy|back|trust)|avoid\s+(?:it|them|the\s+company)|(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:short|selling)|\bshort\s+(?:it|the\s+stock|the\s+company))\b/i;
const NEGATIVE_OUTCOME_PATTERN = /\b(?:(?:should|must|needs?\s+to)\s+be\s+(?:banned|blocked|boycotted|stopped|shut\s+down|avoided)|(?:can|could|will|may)\s+(?:collapse|die|fail|harm|hurt|lose|mislead|underperform|worsen)|(?:is|looks?|seems?)\s+(?:bad|dangerous|harmful|weak|worse))\b/i;
const INVENTED_ACCESS_PATTERN = /\b(?:(?:i|we)(?:'ve|\s+have)?\s+(?:invested\s+in|backed|met|talked\s+(?:to|with)|spoke\s+(?:to|with)|saw|visited|remember|heard\s+from|were\s+shown)|(?:my|our)\s+(?:investment|portfolio\s+company)|(?:i|we)\s+(?:had|took)\s+a\s+call\s+with|the\s+team\s+(?:told|showed|sent)\s+(?:me|us))\b/i;
const AD_COPY_PATTERN = /\b(?:sign\s+up|join\s+the\s+waitlist|book\s+a\s+demo|use\s+code|buy\s+now|download\s+now|check\s+(?:it|them)\s+out|our\s+portfolio\s+company|proud\s+to\s+(?:back|support|invest))\b/i;
const CONSTRUCTIVE_CONVICTION_PATTERN = /\b(?:i\s+(?:think|believe|want|love)|i(?:'d|\s+would)\s+(?:now\s+)?(?:back|bet|buy|choose|expect|favor|give|make|pick|prefer|put|rank|take|use|watch)|deserves?|worth|winner|special|underestimated|undervalued|impressive|insane|huge|great|best|ahead|faster|early|cheap|dominant|breakout|real|congrats|congratulations|endorsement|unusually\s+(?:concrete|convincing|credible)|earn(?:s|ed)?\s+(?:the\s+right|attention|credibility|weight)|gets?\s+(?:there|to|it|this|that|better|faster|cheaper|stronger|bigger|interesting)|(?:can|could|will|should)\s+(?:build|become|compound|create|capture|expand|grow|improve|lead|lower|own|prove|reduce|scale|ship|unlock|win))\b/i;
const NATURAL_COMPANY_PROMOTION_PATTERN = /(?:\bi\s+(?:think|believe|want|love)\s+Natural(?:\.co)?\b)|(?:\b(?:back|bet(?:ting)?|bullish|buy(?:ing)?|invest(?:ed|ing)?|long)\s+(?:in\s+|on\s+)?Natural(?:\.co)?\b)|(?:\bNatural(?:\.co)?\b\s+(?:can|could|will|should|is|gets|deserves|builds?|launch(?:es|ed|ing)?|owns?|rais(?:e|es|ed|ing)|wins?)\b)/;

export function getAntiFundPortfolioPolicyIssues(
  content: string,
  context: PortfolioCompanyGenerationContext | null | undefined = null,
): string[] {
  const company = context ? getAntiFundPortfolioCompany(context.companyId) : null;
  const contextIssues = context ? getAntiFundPortfolioContextIssues(context) : [];
  if (contextIssues.length > 0) return contextIssues;
  const mentionedCompanies = company
    ? [company]
    : findAntiFundPortfolioCompanies(content);
  const naturalCompanyMention = !company
    && /\bNatural(?:\.co)?\b/.test(content)
    && (
      /\b(?:agentic|ai\s+agents?|commerce|company|fintech|payments?|startup|transactions?)\b/i.test(content)
      || NATURAL_COMPANY_PROMOTION_PATTERN.test(content)
    );
  const mentioned = company
    ? isAntiFundPortfolioCompanyMentioned(content, company, { required: true })
    : mentionedCompanies.length > 0 || naturalCompanyMention;
  if (!mentioned && !context) return [];
  const issues: string[] = [];

  if (mentionedCompanies.some((entry) => entry.promotionTier === 'excluded') || naturalCompanyMention) {
    issues.push('portfolio_company_promotion_excluded');
  }
  if (
    (context && mentionedCompanies.some((entry) => entry.promotionTier !== 'flagship'))
    || naturalCompanyMention
  ) issues.push('portfolio_company_not_flagship');

  if (company?.sportsAdjacent && !isQualifiedSportsPortfolioContext(content, context)) {
    issues.push('portfolio_sports_business_relevance_missing');
  }
  if (context && (!company || !mentioned)) issues.push('portfolio_company_dropped');
  if (mentioned && (DISPARAGEMENT_PATTERN.test(content) || NEGATIVE_OUTCOME_PATTERN.test(content))) {
    issues.push('portfolio_disparagement');
  }
  if (context && INVENTED_ACCESS_PATTERN.test(content)) issues.push('portfolio_invented_access');
  if (context && AD_COPY_PATTERN.test(content)) issues.push('portfolio_ad_copy');
  if (context && !CONSTRUCTIVE_CONVICTION_PATTERN.test(content)) issues.push('portfolio_constructive_conviction_missing');
  return [...new Set(issues)];
}

export function getAntiFundPortfolioPolicyIssue(
  content: string,
  context: PortfolioCompanyGenerationContext | null | undefined = null,
): string | null {
  const issues = getAntiFundPortfolioPolicyIssues(content, context);
  if (issues.length === 0) return null;
  return `Anti Fund portfolio alignment failed: ${issues.join(', ')}.`;
}

const PORTFOLIO_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function isAntiFundPortfolioBriefDue(
  tweets: Tweet[],
  signals: LearningSignal[] = [],
  now = new Date(),
): boolean {
  const recent = tweets
    .filter((tweet) => !tweet.quarantinedAt && ['queued', 'posted'].includes(tweet.status))
    .slice(0, 10);
  const portfolioCount = recent.filter((tweet) => (
    (
      tweet.portfolioCompanyContext
      && getAntiFundPortfolioContextIssues(tweet.portfolioCompanyContext, now).length === 0
      && isAntiFundAutonomousPromotionEligible(
        getAntiFundPortfolioCompany(tweet.portfolioCompanyContext.companyId),
      )
    )
    || findAntiFundPortfolioCompanies(`${tweet.topic || ''} ${tweet.content}`)
      .some(isAntiFundAutonomousPromotionEligible)
  )).length;
  // Standing portfolio conviction is a sparse accent, not a batch quota.
  // One OpenAI or Cognition subject reserves the next ten committed slots.
  if (portfolioCount >= 1) return false;
  const retryBlocked = signals.some((signal) => (
    ['deleted_from_queue', 'deleted_from_x', 'edited_before_queue', 'edited_before_post'].includes(signal.signalType)
    && typeof signal.metadata?.portfolioCompanyId === 'string'
    && isAntiFundAutonomousPromotionEligible(
      getAntiFundPortfolioCompany(signal.metadata.portfolioCompanyId),
    )
    && now.getTime() - Date.parse(signal.createdAt) < PORTFOLIO_RETRY_COOLDOWN_MS
  ));
  return !retryBlocked;
}

export function selectAntiFundPortfolioCompany(
  recentContent: string[],
  rotationKey: string,
): AntiFundPortfolioCompany | null {
  const recent = recentContent.join('\n');
  const eligible = ANTIFUND_AUTONOMOUS_PROMOTION_COMPANIES.filter((company) => (
    !isAntiFundPortfolioCompanyMentioned(recent, company)
  ));
  const pool = eligible.length > 0 ? eligible : ANTIFUND_AUTONOMOUS_PROMOTION_COMPANIES;
  if (pool.length === 0) return null;
  const hash = [...rotationKey].reduce((value, character) => (
    ((value * 31) + character.charCodeAt(0)) >>> 0
  ), 0);
  return pool[hash % pool.length];
}
