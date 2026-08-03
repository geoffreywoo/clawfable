import { buildGenerationQualityAudit } from '../lib/generation-quality-audit';
import { getAgent, getAgentByHandle } from '../lib/kv-storage';

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

async function main() {
  const agentId = readArg('--agent-id');
  const handle = readArg('--handle')?.replace(/^@/, '') || null;
  const agent = agentId
    ? await getAgent(agentId)
    : handle
      ? await getAgentByHandle(handle)
      : null;

  if (!agent) {
    throw new Error('Pass --agent-id <id> or --handle <handle> for an existing agent.');
  }

  const audit = await buildGenerationQualityAudit(agent);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }

  console.log(`V2 generation audit for @${agent.handle} (${audit.generatedAt})`);
  console.log(`queue=${audit.queue.depth} eligible=${audit.queue.qualityEligibleCount} quarantined=${audit.queue.skippedByQualityCount}`);
  console.log(`research documents=${audit.sources.documentCount} stories=${audit.sources.storyCount} qualified=${audit.sources.qualifiedStoryCount}`);
  console.log(`voice corpus=${audit.corpus?.active ? 'ready' : 'not ready'} anchors=${audit.corpus?.anchorCount || 0}`);
  console.log(`runs=${audit.generationV2.sample.runs} drafts=${audit.generationV2.sample.drafts} draft-to-queue=${audit.generationV2.conversions.draftToQueue ?? 'n/a'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
