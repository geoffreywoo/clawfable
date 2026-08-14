import type { VoiceProfile } from './soul-parser';
import { isGeoffreyVoiceProfile } from './account-taste';

export interface FrontierIdeaSeed {
  id: string;
  kind?: 'frontier' | 'startup' | 'ai_product' | 'markets' | 'culture' | 'career' | 'health' | 'sports';
  reactionPrompt?: string;
  topic: string;
  technicalObject: string;
  hiddenConstraint: string;
  nonConsensusImplication: string;
  startupBackingFact: string;
  domains: string[];
  sourceQueries: string[];
}

export interface FrontierSeedSourceFamily {
  id: string;
  label: string;
  whyUseful: string;
  queryTemplates: string[];
  domains: string[];
}

export interface FrontierSeedDiscoveryItem {
  seed: FrontierIdeaSeed;
  sourceFamilies: FrontierSeedSourceFamily[];
  researchQueries: string[];
}

const FRONTIER_SOURCE_FAMILIES: FrontierSeedSourceFamily[] = [
  {
    id: 'mineral-surveys',
    label: 'USGS and national mineral surveys',
    whyUseful: 'Best first pass for production concentration, reserves, import reliance, substitution notes, and year-over-year supply shocks.',
    domains: ['materials', 'manufacturing', 'industrial capacity', 'energy', 'compute', 'space'],
    queryTemplates: [
      'site:usgs.gov {topic} mineral commodity summary',
      'site:usgs.gov {technicalObject} supply chain reserves production imports',
      'site:pubs.usgs.gov {topic} critical minerals substitution recycling',
    ],
  },
  {
    id: 'export-controls',
    label: 'Export controls, tariffs, and industrial policy notices',
    whyUseful: 'Turns obscure materials into timely posts when a government action reveals a hidden choke point.',
    domains: ['materials', 'compute', 'energy', 'space', 'industrial capacity'],
    queryTemplates: [
      'site:bis.doc.gov {topic} export controls supply chain',
      'site:federalregister.gov {technicalObject} export controls tariff critical minerals',
      '{topic} China export controls refining processing',
    ],
  },
  {
    id: 'technical-papers-patents',
    label: 'Patents, papers, and process-engineering literature',
    whyUseful: 'Finds mechanisms: yield loss, purification steps, grain boundaries, thermal limits, qualification cycles, and failure modes.',
    domains: ['materials', 'compute', 'manufacturing', 'robotics', 'space', 'nuclear', 'energy'],
    queryTemplates: [
      'Google Patents {technicalObject} {hiddenConstraint}',
      '{technicalObject} process window yield failure mode paper',
      '{technicalObject} qualification cycle manufacturing constraint',
    ],
  },
  {
    id: 'energy-industrial-data',
    label: 'DOE, EIA, IEA, NREL, and lab reports',
    whyUseful: 'Good for power, grid, fuel-cycle, battery, hydrogen, nuclear, and industrial-load constraints that make AI/hard-tech takes less generic.',
    domains: ['energy', 'nuclear', 'industrial capacity', 'materials', 'compute'],
    queryTemplates: [
      'site:energy.gov {topic} supply chain bottleneck',
      'site:iea.org {topic} critical minerals demand scenario',
      'site:nrel.gov {technicalObject} manufacturing constraint',
      'site:eia.gov {topic} electricity demand industrial load',
    ],
  },
  {
    id: 'company-filings-earnings',
    label: 'Company filings, earnings calls, and technical supplier docs',
    whyUseful: 'Where the actual bottleneck language often lives: lead times, qualification, customer concentration, capex, and tool availability.',
    domains: ['manufacturing', 'materials', 'compute', 'energy', 'robotics', 'space', 'industrial capacity'],
    queryTemplates: [
      '{topic} 10-K supply chain customer qualification lead time',
      '{technicalObject} earnings call capacity expansion qualification',
      '{technicalObject} supplier datasheet tolerance purity grade',
    ],
  },
  {
    id: 'field-signals',
    label: 'Field signals from operators, procurement, job posts, and standards',
    whyUseful: 'Finds lived-in details: the open job req, ISO/ASTM spec, procurement wording, fixture, inspection step, or safety rule that makes a post feel native.',
    domains: ['manufacturing', 'robotics', 'space', 'materials', 'industrial capacity', 'compute'],
    queryTemplates: [
      '{technicalObject} procurement specification qualification',
      '{technicalObject} ASTM ISO standard tolerance purity',
      '{technicalObject} manufacturing engineer job posting yield metrology',
    ],
  },
];

const FRONTIER_CHOKEPOINT_SEEDS: FrontierIdeaSeed[] = [
  {
    id: 'inference-memory-power',
    topic: 'AI inference economics',
    technicalObject: 'inference ASICs, HBM bandwidth, interconnect, and rack power delivery',
    hiddenConstraint: 'useful tokens per rack can stop scaling before headline chip throughput does',
    nonConsensusImplication: 'the best inference startup may win on deployed system economics rather than the fastest standalone chip',
    startupBackingFact: 'memory bandwidth, interconnect, and rack power can cap useful inference throughput before peak chip performance',
    domains: ['compute', 'energy', 'industrial capacity'],
    sourceQueries: ['inference ASIC HBM bandwidth rack power tokens per watt', 'AI inference interconnect memory bottleneck', 'data center rack power delivery accelerators'],
  },
  {
    id: 'advanced-packaging-yield',
    topic: 'advanced packaging startups',
    technicalObject: 'chiplets, hybrid bonding, substrates, and thermal cycling',
    hiddenConstraint: 'surface roughness, alignment, package yield, and thermal reliability decide how much working compute ships',
    nonConsensusImplication: 'packaging process control can create more startup value than another peak-performance architecture slide',
    startupBackingFact: 'hybrid-bonding alignment and package yield determine how much advanced chiplet compute can ship',
    domains: ['compute', 'manufacturing', 'industrial capacity'],
    sourceQueries: ['hybrid bonding alignment yield chiplets', 'advanced packaging substrate yield thermal cycling', 'chiplet packaging process control startups'],
  },
  {
    id: 'robotics-field-uptime',
    topic: 'robotics field economics',
    technicalObject: 'actuators, reducers, seals, calibration, and field-service intervals',
    hiddenConstraint: 'demo dexterity does not reveal replacement rate or service labor at production duty cycles',
    nonConsensusImplication: 'robotics gross margin will be won by boring uptime and repair economics before general autonomy',
    startupBackingFact: 'actuator life and field-service intervals can dominate robot gross margin after the demo',
    domains: ['robotics', 'manufacturing', 'industrial capacity'],
    sourceQueries: ['robot actuator life duty cycle field service', 'robotics reducer failure replacement interval', 'industrial robot uptime maintenance economics'],
  },
  {
    id: 'transformer-interconnect',
    topic: 'grid equipment for AI infrastructure',
    technicalObject: 'large power transformers, switchgear, and data-center interconnect queues',
    hiddenConstraint: 'qualified equipment lead times can move much more slowly than compute orders or project financing',
    nonConsensusImplication: 'power-equipment suppliers can have more pricing power over AI buildouts than model vendors expect',
    startupBackingFact: 'transformer and switchgear lead times can gate an energized data center after compute is already ordered',
    domains: ['energy', 'compute', 'industrial capacity'],
    sourceQueries: ['large power transformer lead times data centers', 'switchgear supply data center interconnect', 'AI data center grid equipment bottleneck'],
  },
  {
    id: 'tungsten-hardmetal',
    topic: 'tungsten critical minerals',
    technicalObject: 'ammonium paratungstate -> tungsten carbide powder -> hardmetal cutting tools',
    hiddenConstraint: 'the choke point is powder metallurgy, binder chemistry, and qualified tool supply, not just ore in the ground',
    nonConsensusImplication: 're-industrialization bottlenecks show up first in wear parts, dies, drill bits, and machining throughput',
    startupBackingFact: 'qualified tungsten-carbide powder and tool supply can cap machining throughput even when ore is available',
    domains: ['materials', 'manufacturing', 'industrial capacity'],
    sourceQueries: ['USGS tungsten mineral commodity summary', 'tungsten carbide cutting tool supply chain', 'ammonium paratungstate China export controls'],
  },
  {
    id: 'antimony-defense-solar',
    topic: 'antimony chokeholds',
    technicalObject: 'antimony trioxide, ammunition primers, flame retardants, and solar glass clarifiers',
    hiddenConstraint: 'processing and refining capacity is more concentrated than the end products make obvious',
    nonConsensusImplication: 'defense, grid hardware, and solar deployment can share the same tiny mineral bottleneck',
    startupBackingFact: 'antimony refining capacity is much more concentrated than mining headlines imply',
    domains: ['materials', 'energy', 'industrial capacity'],
    sourceQueries: ['USGS antimony mineral commodity summary', 'antimony export controls defense supply chain', 'antimony solar glass clarifier'],
  },
  {
    id: 'gallium-germanium-rf-photonics',
    topic: 'gallium germanium semiconductors',
    technicalObject: 'gallium arsenide, gallium nitride, germanium substrates, and infrared optics',
    hiddenConstraint: 'these are mostly byproducts of aluminum and zinc refining, so demand cannot scale like a normal mining project',
    nonConsensusImplication: 'RF, power electronics, photonics, and defense sensors depend on refinery side-streams most AI investors never model',
    startupBackingFact: 'gallium is mostly a byproduct of aluminum refining, so chip demand cannot pull new supply online like a normal mine',
    domains: ['compute', 'materials', 'space'],
    sourceQueries: ['gallium germanium export controls semiconductor supply chain', 'GaN RF power electronics gallium supply', 'germanium infrared optics supply chain'],
  },
  {
    id: 'graphite-anode-processing',
    topic: 'graphite battery materials',
    technicalObject: 'spherical purified graphite and coated anode material',
    hiddenConstraint: 'the difficult step is purification, morphology control, coating, and qualification with cell makers',
    nonConsensusImplication: 'battery independence is a process-engineering problem before it is a mining problem',
    startupBackingFact: 'cell-maker qualification can take longer to expand than graphite mining',
    domains: ['materials', 'manufacturing', 'energy'],
    sourceQueries: ['spherical purified graphite anode processing', 'graphite anode qualification cell makers', 'battery graphite supply chain China'],
  },
  {
    id: 'fluorspar-hf-etch',
    topic: 'fluorspar and semiconductor chemicals',
    technicalObject: 'acid-grade fluorspar -> hydrofluoric acid -> fluoropolymers and chip etch chemistry',
    hiddenConstraint: 'high-purity chemical conversion is the bottleneck, and substitution is ugly because fluorine chemistry is everywhere',
    nonConsensusImplication: 'advanced manufacturing resilience can fail inside boring chemical intermediates, not just fabs or GPUs',
    startupBackingFact: 'semiconductor-grade hydrofluoric acid conversion, not fluorspar ore, is the hard capacity',
    domains: ['compute', 'materials', 'manufacturing'],
    sourceQueries: ['acid grade fluorspar hydrofluoric acid semiconductor etch', 'fluorspar supply chain fluoropolymers', 'high purity HF semiconductor chemicals'],
  },
  {
    id: 'rhenium-superalloys',
    topic: 'rhenium aerospace superalloys',
    technicalObject: 'rhenium-bearing single-crystal superalloys in turbine blades and rocket engines',
    hiddenConstraint: 'rhenium is a tiny molybdenum/copper byproduct stream with long qualification cycles',
    nonConsensusImplication: 'space and defense scale can be capped by grams-per-blade metallurgy, not launch demand',
    startupBackingFact: 'rhenium arrives as a tiny copper and molybdenum byproduct stream, so aerospace demand cannot directly create more supply',
    domains: ['space', 'materials', 'manufacturing'],
    sourceQueries: ['rhenium superalloy turbine blade supply chain', 'single crystal superalloy rhenium content', 'rhenium rocket engine material constraint'],
  },
  {
    id: 'beryllium-qualified-toxicity',
    topic: 'beryllium aerospace and semiconductor',
    technicalObject: 'beryllium mirrors, X-ray windows, inertial guidance parts, and thermal management components',
    hiddenConstraint: 'toxicity, machining controls, and qualification make supply expansion slow even when demand is obvious',
    nonConsensusImplication: 'some frontier-tech bottlenecks are safety/process bottlenecks pretending to be material bottlenecks',
    startupBackingFact: 'worker-safety controls make new beryllium machining capacity expensive and slow to add',
    domains: ['space', 'compute', 'manufacturing'],
    sourceQueries: ['beryllium aerospace mirror supply chain', 'beryllium machining toxicity qualification', 'beryllium semiconductor thermal management'],
  },
  {
    id: 'dysprosium-terbium-magnets',
    topic: 'rare earth magnet bottlenecks',
    technicalObject: 'NdFeB magnets doped with dysprosium and terbium for high-temperature coercivity',
    hiddenConstraint: 'magnet performance depends on separation chemistry, alloying, grain-boundary diffusion, and sintering yield',
    nonConsensusImplication: 'robots, drones, EVs, and wind turbines are all quietly competing for the same high-temperature magnet physics',
    startupBackingFact: 'grain-boundary diffusion and sintering yield determine whether NdFeB magnets hold performance at temperature',
    domains: ['materials', 'robotics', 'energy'],
    sourceQueries: ['dysprosium terbium NdFeB high temperature magnets', 'rare earth magnet grain boundary diffusion supply chain', 'robotics rare earth magnet bottleneck'],
  },
  {
    id: 'tritium-fusion-fuel-cycle',
    topic: 'fusion fuel cycle',
    technicalObject: 'tritium breeding blankets, neutron flux, lithium enrichment, and inventory accounting',
    hiddenConstraint: 'a net-energy fusion machine is not a product until the fuel cycle closes under real materials damage',
    nonConsensusImplication: 'fusion timelines should be judged by tritium logistics and first-wall survival, not only plasma shots',
    startupBackingFact: 'a fusion plant is not commercial until it breeds and accounts for its own tritium under neutron damage',
    domains: ['nuclear', 'energy', 'materials'],
    sourceQueries: ['fusion tritium breeding blanket fuel cycle', 'first wall neutron damage fusion materials', 'lithium enrichment tritium breeding'],
  },
  {
    id: 'neon-lithography-lasers',
    topic: 'neon lithography supply',
    technicalObject: 'high-purity neon for excimer lithography lasers',
    hiddenConstraint: 'noble gas purification is tied to industrial gas infrastructure and geopolitical plant geography',
    nonConsensusImplication: 'chip supply chains have invisible gas dependencies that do not look strategic until a shock hits',
    startupBackingFact: 'high-purity neon supply depends on industrial-gas purification plants, not just semiconductor demand',
    domains: ['compute', 'manufacturing', 'industrial capacity'],
    sourceQueries: ['high purity neon lithography laser supply chain', 'excimer laser neon semiconductor manufacturing', 'noble gas purification chip fabs'],
  },
];

const GEOFFREY_BROAD_SEEDS: FrontierIdeaSeed[] = [
  {
    id: 'startup-revealed-incentives',
    kind: 'startup',
    reactionPrompt: 'Name the company, founder, or decision when one is supplied. Make one direct funding, product, or company-quality call. A desire, prediction, or disagreement beats a lesson.',
    topic: 'founders, venture, and company building',
    technicalObject: 'the exact founder, company, financing term, product choice, or customer behavior in the subject cue',
    hiddenConstraint: 'the interesting part is the revealed preference in the decision, not a made-up binary or generic founder lesson',
    nonConsensusImplication: 'state the concrete company judgment Geoffrey would defend and leave the audience lesson implicit',
    startupBackingFact: '',
    domains: ['startups', 'venture', 'funding', 'companies'],
    sourceQueries: [],
  },
  {
    id: 'startup-headcount-ambition',
    kind: 'startup',
    reactionPrompt: 'Make an explicitly subjective bet about what one ambitious AI-native team can do. No efficiency sermon, universal team-size law, or invented founder anecdote.',
    topic: 'AI-native startup formation and team design',
    technicalObject: 'the capability or ambition of a small AI-native startup team',
    hiddenConstraint: 'headcount can add coordination and status before it adds a capability the company truly lacks',
    nonConsensusImplication: 'take a concrete position on what a fundable early team should look like now without preaching generic efficiency',
    startupBackingFact: '',
    domains: ['startups', 'founders', 'ai', 'talent', 'companies'],
    sourceQueries: [],
  },
  {
    id: 'startup-customer-truth',
    kind: 'startup',
    reactionPrompt: 'State which company behavior would make you want to fund, buy, or distrust the company. Keep it a preference, not a founder checklist or an invented customer story.',
    topic: 'customer pull, fundraising, and company quality',
    technicalObject: 'the exact startup, product, or customer behavior in the subject cue',
    hiddenConstraint: 'social proof is easier to manufacture than a customer repeatedly changing behavior or budget',
    nonConsensusImplication: 'make one sharp company-quality judgment from revealed customer behavior without writing a founder checklist',
    startupBackingFact: '',
    domains: ['startups', 'customers', 'funding', 'products', 'companies'],
    sourceQueries: [],
  },
  {
    id: 'ai-behavior-and-ambition',
    kind: 'ai_product',
    reactionPrompt: 'Say what you now want someone to build, what becomes newly possible, or which ambitious behavior changes. A weird coherent prediction is valid; an AI industry recap is not.',
    topic: 'AI products, research, and how ambitious people use them',
    technicalObject: 'the exact AI model, product, research object, or capability in the subject cue',
    hiddenConstraint: 'capability matters when it changes behavior, speed, ambition, or company formation, not when it only wins a benchmark',
    nonConsensusImplication: 'react to what people or startups will do differently without writing another AI industry recap',
    startupBackingFact: '',
    domains: ['ai', 'software', 'research', 'startups'],
    sourceQueries: [],
  },
  {
    id: 'ai-incumbent-bundling',
    kind: 'ai_product',
    reactionPrompt: 'Keep the exact named company, person, or product from the subject cue. Make one audacious product, valuation, capability, or company-quality call. Do not default to an acquisition or CEO-installation fantasy and do not invent a launch.',
    topic: 'AI products and incumbent distribution',
    technicalObject: 'OpenAI, Google, Anthropic, or the exact named AI company, person, or product in the subject cue',
    hiddenConstraint: 'bundling can erase a thin feature company while making an entirely new workflow worth building',
    nonConsensusImplication: 'make a specific product or company-value judgment instead of recapping a model launch',
    startupBackingFact: '',
    domains: ['ai', 'software', 'products', 'startups', 'google', 'openai'],
    sourceQueries: [],
  },
  {
    id: 'ai-talent-company-formation',
    kind: 'ai_product',
    reactionPrompt: 'Keep the named person or company when one is supplied. Take a direct position on what the builder should attempt, where the talent belongs, or which game is worth playing. Do not default to an acquisition or CEO-installation call and do not turn talent into generic career advice.',
    topic: 'AI talent and company formation',
    technicalObject: 'the exact researcher, builder, lab, company, or talent choice in the subject cue',
    hiddenConstraint: 'models change how much one person can build, but distribution, capital, and ambition still determine which game is worth playing',
    nonConsensusImplication: 'take a side on the talent or company choice in high-context startup language',
    startupBackingFact: '',
    domains: ['ai', 'talent', 'research', 'startups', 'companies'],
    sourceQueries: [],
  },
  {
    id: 'markets-ai-value-chain',
    kind: 'markets',
    reactionPrompt: 'Make one direct company, security, valuation, or value-chain bet. State the position you would defend; do not teach the audience a picks-and-shovels framework.',
    topic: 'where AI investment returns accrue',
    technicalObject: 'the exact AI company, security, or layer of the value chain in the subject cue',
    hiddenConstraint: 'revenue can grow at one layer while capex intensity, pricing competition, or supplier economics capture the return elsewhere',
    nonConsensusImplication: 'make one company or security judgment without defaulting to a generic picks-and-shovels slogan',
    startupBackingFact: '',
    domains: ['investing', 'finance', 'capital markets'],
    sourceQueries: [],
  },
  {
    id: 'markets-public-private-risk',
    kind: 'markets',
    reactionPrompt: 'Make one price-sensitive or ownership-sensitive call about the named company or security. Do not invent a holding, allocation, or generic public-versus-private comparison.',
    topic: 'public versus private AI exposure',
    technicalObject: 'a specific AI company, security, valuation, financing, or portfolio exposure that deserves a direct opinion',
    hiddenConstraint: 'company quality, entry price, position size, liquidity, and duration can point to different conclusions',
    nonConsensusImplication: 'make one position-level call without inventing a holding or turning it into a public-versus-private morality play',
    startupBackingFact: '',
    domains: ['investing', 'finance', 'ai', 'public markets', 'venture'],
    sourceQueries: [],
  },
  {
    id: 'markets-capital-duration',
    kind: 'markets',
    reactionPrompt: 'Take one side on the financing, ownership, or timing choice. Keep it to the actual company or instrument when supplied; do not write a risk-management explainer.',
    topic: 'capital duration and technology timing',
    technicalObject: 'a capital-intensive technology company choosing between expensive equity, project finance, customer funding, and waiting to scale',
    hiddenConstraint: 'the financing instrument can shape what the company is able to build and who owns the upside before product risk clears',
    nonConsensusImplication: 'make the narrow financing or ownership call Geoffrey would defend instead of explaining risk management',
    startupBackingFact: '',
    domains: ['investing', 'finance', 'capital markets', 'technology', 'venture'],
    sourceQueries: [],
  },
  {
    id: 'culture-status-revealed-preference',
    kind: 'culture',
    reactionPrompt: 'React to the exact named person, institution, product, or behavior when supplied. A blunt social judgment or real question is enough; do not manufacture a status parable.',
    topic: 'culture, status, merit, ambition, and power',
    technicalObject: 'a named person, institution, product, cultural behavior, or live status object worth reacting to',
    hiddenConstraint: 'status is legible through the actual object or behavior; an invented panel, dinner, or prestige choice proves nothing',
    nonConsensusImplication: 'make a specific social judgment in casual language without manufacturing a parable or generic life advice',
    startupBackingFact: '',
    domains: ['culture', 'status', 'merit', 'ambition'],
    sourceQueries: [],
  },
  {
    id: 'career-agency-over-credential',
    kind: 'career',
    reactionPrompt: 'Make one direct judgment about a named person, choice, credential, or act of agency. Do not address an anonymous ambitious person or package it as career advice.',
    topic: 'career, ambition, talent, and agency',
    technicalObject: 'the exact person, credential, career choice, or act of agency in the subject cue',
    hiddenConstraint: 'career advice usually hides the adviser\'s own risk tolerance, status incentives, and preferred game',
    nonConsensusImplication: 'make a direct judgment about agency or ambition without turning it into generic career advice',
    startupBackingFact: '',
    domains: ['career', 'talent', 'ambition', 'startups'],
    sourceQueries: [],
  },
  {
    id: 'health-performance-agency',
    kind: 'health',
    reactionPrompt: 'Ask a real first-person question or state a personal value preference. Do not invent a routine, result, biomarker, medical claim, or universal protocol.',
    topic: 'health, longevity, and human performance',
    technicalObject: 'the exact health, performance, or longevity object in the subject cue',
    hiddenConstraint: 'personal agency, adherence, and opportunity cost matter more than another abstract optimization claim',
    nonConsensusImplication: 'state a personal-value judgment without inventing medical evidence or giving universal health advice',
    startupBackingFact: '',
    domains: ['health', 'longevity', 'performance'],
    sourceQueries: [],
  },
  {
    id: 'sports-competitive-reality',
    kind: 'sports',
    reactionPrompt: 'Keep the named athlete, matchup, or competitive choice when supplied. Make the narrow competitive call or ask the live question; do not invent sports news or add a motivational lesson.',
    topic: 'sports, fighting, and competitive behavior',
    technicalObject: 'the exact athlete, matchup, or competitive behavior in the subject cue',
    hiddenConstraint: 'the official narrative and the observable competitive behavior may point in different directions',
    nonConsensusImplication: 'make the narrow competitive judgment; do not manufacture sports news or a motivational lesson',
    startupBackingFact: '',
    domains: ['sports', 'boxing', 'competition'],
    sourceQueries: [],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value: string, maxLength = 140): string {
  return value
    .replace(/->/g, ' ')
    .replace(/[^\w\s/%.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function fillTemplate(template: string, seed: FrontierIdeaSeed): string {
  return template
    .replaceAll('{topic}', compact(seed.topic, 80))
    .replaceAll('{technicalObject}', compact(seed.technicalObject, 100))
    .replaceAll('{hiddenConstraint}', compact(seed.hiddenConstraint, 100));
}

function seedScore(seed: FrontierIdeaSeed, targetTopic: string): number {
  const target = normalize(targetTopic);
  const haystack = normalize([
    seed.topic,
    seed.technicalObject,
    seed.hiddenConstraint,
    seed.nonConsensusImplication,
    seed.domains.join(' '),
  ].join(' '));

  if (!target) return 0;
  if (haystack.includes(target) || target.includes(normalize(seed.topic))) return 4;

  const terms = target.split(' ').filter((term) => term.length >= 4);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

export function getFrontierIdeaSeeds(voiceProfile?: VoiceProfile | null): FrontierIdeaSeed[] {
  if (!voiceProfile || !isGeoffreyVoiceProfile(voiceProfile)) return [];
  return FRONTIER_CHOKEPOINT_SEEDS;
}

export function getFrontierSeedSourceFamilies(): FrontierSeedSourceFamily[] {
  return FRONTIER_SOURCE_FAMILIES;
}

export function expandFrontierSeedResearchQueries(seed: FrontierIdeaSeed, limit = 12): string[] {
  const sourceFamilyQueries = FRONTIER_SOURCE_FAMILIES
    .filter((family) => family.domains.some((domain) => seed.domains.includes(domain)))
    .flatMap((family) => family.queryTemplates.map((template) => fillTemplate(template, seed)));
  return [...new Set([...seed.sourceQueries, ...sourceFamilyQueries])]
    .filter(Boolean)
    .slice(0, limit);
}

export function buildFrontierSeedDiscoveryPlan(voiceProfile?: VoiceProfile | null, limit = 10): FrontierSeedDiscoveryItem[] {
  return getFrontierIdeaSeeds(voiceProfile)
    .slice(0, limit)
    .map((seed) => ({
      seed,
      sourceFamilies: FRONTIER_SOURCE_FAMILIES.filter((family) =>
        family.domains.some((domain) => seed.domains.includes(domain))
      ),
      researchQueries: expandFrontierSeedResearchQueries(seed),
    }));
}

export function formatFrontierIdeaSeedBrief(seed: FrontierIdeaSeed): string {
  return `${seed.technicalObject} -> ${seed.hiddenConstraint} -> ${seed.nonConsensusImplication}`;
}

export function pickFrontierIdeaSeed({
  voiceProfile,
  targetTopic,
  slot,
  usedSeedIds = new Set<string>(),
}: {
  voiceProfile?: VoiceProfile | null;
  targetTopic: string;
  slot: number;
  usedSeedIds?: Set<string>;
}): FrontierIdeaSeed | null {
  const seeds = getFrontierIdeaSeeds(voiceProfile);
  if (seeds.length === 0) return null;

  const ranked = seeds
    .map((seed, index) => ({
      seed,
      score: seedScore(seed, targetTopic) + ((slot + index) % seeds.length) / 100,
      used: usedSeedIds.has(seed.id),
      index,
    }))
    .sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score || a.index - b.index);

  return ranked[0]?.seed || null;
}

function preferredGeoffreySeedKinds(targetTopic: string): Array<NonNullable<FrontierIdeaSeed['kind']>> {
  const target = normalize(targetTopic);
  if (/\b(?:manufactur(?:e|ing|er|ers)?|factor(?:y|ies)|industr(?:y|ial)|materials?|minerals?|rare earth|tungsten|rhenium|beryllium|magnets?|fusion|fission|nuclear|reactors?|robots?|robotics|space|rockets?|defense|asics?|semiconductors?|chips?|hbm|data centers?|grid|energy)\b/.test(target)) {
    return ['frontier'];
  }
  if (/\b(?:boxing|mma|ufc|fight|nfl|nba|football|basketball|soccer|tennis|padel|sports?|athlete)\b/.test(target)) return ['sports'];
  if (/\b(?:health|longevity|lifespan|healthspan|ketone|fitness|exercise|sleep|biohack|human performance|athletic performance)\b/.test(target)) return ['health'];
  if (/\b(?:career|talent|job market|jobs|hiring|credential|education|agency)\b/.test(target)) return ['career'];
  if (/\b(?:culture|status|merit|nepotis|social|ambition|aura|college|education|elite|power|taste)\b/.test(target)) return ['culture'];
  if (/\b(?:finance|investing|capital market|stock|portfolio|hedge fund|private equity|buyout|qqq|leverage|banking|fintech)\b/.test(target)) return ['markets'];
  if (/\b(?:ai|model|openai|anthropic|claude|codex|software|developer|research|math|science)\b/.test(target)) return ['ai_product'];
  if (/\b(?:startups?|founders?|venture|vc|funding|companies|company|products?|customers?|talent|career|jobs?)\b/.test(target)) return ['startup'];
  return ['startup', 'ai_product', 'culture', 'markets'];
}

export function pickGeoffreyIdeaSeed({
  voiceProfile,
  targetTopic,
  slot,
  usedSeedIds = new Set<string>(),
}: {
  voiceProfile?: VoiceProfile | null;
  targetTopic: string;
  slot: number;
  usedSeedIds?: Set<string>;
}): FrontierIdeaSeed | null {
  if (!voiceProfile || !isGeoffreyVoiceProfile(voiceProfile)) return null;
  const preferredKinds = preferredGeoffreySeedKinds(targetTopic);
  const frontier = FRONTIER_CHOKEPOINT_SEEDS.map((seed) => ({ ...seed, kind: 'frontier' as const }));
  const allSeeds = [...GEOFFREY_BROAD_SEEDS, ...frontier];
  const preferred = allSeeds.filter((seed) => preferredKinds.includes(seed.kind || 'frontier'));
  const unusedPreferred = preferred.filter((seed) => !usedSeedIds.has(seed.id));
  const unusedAll = allSeeds.filter((seed) => !usedSeedIds.has(seed.id));
  const pool = unusedPreferred.length > 0
    ? unusedPreferred
    : preferred.length > 0
      ? preferred
      : unusedAll.length > 0 ? unusedAll : allSeeds;
  const ranked = pool
    .map((seed, index) => ({
      seed,
      score: seedScore(seed, targetTopic) + ((slot + index) % pool.length) / 100,
      used: usedSeedIds.has(seed.id),
      index,
    }))
    .sort((a, b) => Number(a.used) - Number(b.used) || b.score - a.score || a.index - b.index);
  return ranked[0]?.seed || null;
}
