import type { VoiceProfile } from './soul-parser';
import { isGeoffreyVoiceProfile } from './account-taste';

export interface FrontierIdeaSeed {
  id: string;
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
