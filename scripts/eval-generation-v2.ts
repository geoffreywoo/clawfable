import { getAgent, getAgentByHandle } from '../lib/kv-storage';
import { loadGenerationV2Metrics } from '../lib/generation-v2-metrics';
import { getPublishingV2QualityPolicyVersion } from '../lib/publishing-quality-policy';

function readArg(name: string): string | null {
  const exact = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function main() {
  const requestedId = readArg('--agent-id');
  const agent = requestedId
    ? await getAgent(requestedId)
    : await getAgentByHandle('geoffwoo') || await getAgentByHandle('geoffreywoo');
  if (!agent) throw new Error('No @geoffwoo agent found. Pass --agent-id if needed.');
  const report = await loadGenerationV2Metrics(
    agent.id,
    getPublishingV2QualityPolicyVersion('original', agent.handle),
  );
  console.log(JSON.stringify({ agentId: agent.id, handle: `@${agent.handle}`, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
