import {
  buildFrontierSeedDiscoveryPlan,
  formatFrontierIdeaSeedBrief,
} from '../lib/frontier-idea-seeds';

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

function wantsJson(): boolean {
  return process.argv.includes('--json');
}

const geoffreyVoiceProfile = {
  tone: 'technical operator/investor',
  topics: ['AI', 'inference asics', 'tungsten and critical minerals', 'rare earth minerals', 'fusion', 'robotics', 'space'],
  antiGoals: ['generic hype', 'low-status SaaS-ops texture'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed hard-tech constraints.',
  summary: 'Geoffrey writes about AI infrastructure, industrial capacity, and frontier-tech chokeholds.',
};

const topicFilter = (readArg('--topic') || '').toLowerCase();
const plan = buildFrontierSeedDiscoveryPlan(geoffreyVoiceProfile, 50)
  .filter((item) => {
    if (!topicFilter) return true;
    return [
      item.seed.topic,
      item.seed.technicalObject,
      item.seed.hiddenConstraint,
      item.seed.nonConsensusImplication,
      item.seed.domains.join(' '),
    ].join(' ').toLowerCase().includes(topicFilter);
  });

if (wantsJson()) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  console.log(`Frontier seed discovery plan (${plan.length} seed${plan.length === 1 ? '' : 's'})`);
  console.log('');

  for (const item of plan) {
    console.log(`# ${item.seed.topic} [${item.seed.id}]`);
    console.log(formatFrontierIdeaSeedBrief(item.seed));
    console.log(`Source families: ${item.sourceFamilies.map((family) => family.label).join('; ')}`);
    console.log('Queries:');
    for (const query of item.researchQueries.slice(0, 8)) {
      console.log(`- ${query}`);
    }
    console.log('');
  }
}
