import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFrozenEvaluationSnapshot, validateFrozenEvaluation, runFrozenEvaluation, blindedEvaluationCards, scoreFrozenEvaluation,
  type FrozenEvaluationSnapshot, type EvaluationComparison, type EvaluationVotes,
} from '../lib/astra-evaluation';
import { getAgentByHandle, getAnalysis, getSourceDocuments, getStoryClusters, getSemanticBlocks, getIdeaCandidates, getPerformanceHistory, getManualExampleCuration, getVoiceCorpusSnapshot } from '../lib/kv-storage';
import { buildGenerationContext } from '../lib/generation-context';
import { parseSoulMd } from '../lib/soul-parser';
import { createRemoteEvaluationRunner } from '../lib/astra-evaluation-remote';

function arg(name: string): string | undefined {
  const match = process.argv.find((value) => value.startsWith(`${name}=`));
  if (match) return match.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const privateRoot = path.resolve('.gstack/astra-evaluation');
function privatePath(value: string): string {
  const resolved = path.resolve(value);
  const relative = path.relative(privateRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) throw new Error('Private artifacts must be inside .gstack/astra-evaluation/.');
  return resolved;
}
async function saveJson(filename: string, value: unknown): Promise<void> {
  const target = privatePath(filename);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(`${target}.tmp`, target);
}
async function loadJson<T>(filename: string | undefined): Promise<T> {
  if (!filename) throw new Error('Missing input file argument.');
  return JSON.parse(await readFile(privatePath(filename), 'utf8')) as T;
}

async function main() {
  const modes = ['--capture', '--validate', '--run', '--score'].filter((mode) => process.argv.includes(mode));
  if (modes.length !== 1) {
    console.log('Use exactly one mode: --capture [--handle geoffwoo] [--out .gstack/astra-evaluation/session/snapshot.json]; --validate --snapshot FILE; --run --snapshot FILE [--limit 40] [--max-cost-usd 100] [--remote-origin https://clawfable.com]; --score --comparison FILE --votes FILE. Capture reads stored account data only. Run invokes real models locally with OPENAI_API_KEY or remotely with CRON_SECRET. All outputs are private; synthetic profiles have no human ground-truth labels.');
    if (modes.length > 1) process.exitCode = 1;
    return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (modes[0] === '--capture') {
    const handle = arg('--handle') || 'geoffwoo';
    if (!['geoffwoo', 'geoffreywoo'].includes(handle.replace(/^@/, '').toLowerCase())) throw new Error('This pilot capture requires the Geoffrey account.');
    const agent = await getAgentByHandle(handle.replace(/^@/, ''));
    if (!agent) throw new Error('Geoffrey account was not found. Supply the authenticated KV environment; capture does not invent a local account.');
    const [context, analysis, documents, stories, blocks, recentIdeas, history, curation, corpus] = await Promise.all([
      buildGenerationContext(agent), getAnalysis(agent.id), getSourceDocuments(agent.id, 300),
      getStoryClusters(agent.id, 200), getSemanticBlocks(agent.id), getIdeaCandidates(agent.id, 300),
      getPerformanceHistory(agent.id, 5000), getManualExampleCuration(agent.id), getVoiceCorpusSnapshot(agent.id),
    ]);
    if (!analysis) throw new Error('The account has no stored analysis to capture.');
    const snapshot = createFrozenEvaluationSnapshot({ account: { id: agent.id, handle: agent.handle }, context,
      baseVoiceProfile: parseSoulMd(agent.name, agent.soulMd), analysis, documents, stories, blocks, recentIdeas, referenceEvidence: { history, curation, corpus },
    });
    const output = privatePath(arg('--out') || path.join(privateRoot, timestamp, 'snapshot.json'));
    await saveJson(output, snapshot);
    await saveJson(path.join(path.dirname(output), 'manifest.json'), {
      version: snapshot.version, snapshotHash: snapshot.hash, capturedAt: snapshot.capturedAt,
      heldoutCount: snapshot.heldoutExamples.length, referenceSummary: snapshot.referenceSummary,
      packets: snapshot.packets.map((packet) => ({ id: packet.id, kind: packet.kind, subject: packet.subject,
        calibrationSource: packet.calibrationSource, evidenceMode: packet.input.previewContext!.briefs[0].evidenceMode })),
    });
    console.log(JSON.stringify({ status: 'captured', output, referenceSummary: snapshot.referenceSummary, ...validateFrozenEvaluation(snapshot) }));
    return;
  }
  if (modes[0] === '--score') {
    const comparison = await loadJson<EvaluationComparison>(arg('--comparison'));
    const votes = await loadJson<EvaluationVotes>(arg('--votes'));
    const score = scoreFrozenEvaluation(comparison, votes);
    const output = path.join(path.dirname(privatePath(arg('--comparison')!)), 'score.json');
    await saveJson(output, score);
    console.log(JSON.stringify({ ...score, output }, null, 2));
    if (score.status !== 'pass') process.exitCode = 2;
    return;
  }
  const snapshot = await loadJson<FrozenEvaluationSnapshot>(arg('--snapshot'));
  const validation = validateFrozenEvaluation(snapshot);
  if (modes[0] === '--validate') { console.log(JSON.stringify({ status: 'validated_without_model_calls', ...validation })); return; }
  const remoteOrigin = arg('--remote-origin');
  if (!remoteOrigin && !process.env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required for a local comparison, or use --remote-origin with CRON_SECRET. Validation alone cannot establish model quality.');
  const remoteRunner = remoteOrigin ? createRemoteEvaluationRunner(snapshot, { origin: remoteOrigin, secret: process.env.CRON_SECRET || '' }) : undefined;
  const outputDirectory = privatePath(path.join(path.dirname(privatePath(arg('--snapshot')!)), `run-${timestamp}`));
  const comparisonFile = path.join(outputDirectory, 'comparison.json');
  const comparison = await runFrozenEvaluation(snapshot, {
    runArm: remoteRunner,
    limit: Number(arg('--limit') || 40), maxEstimatedCostUsd: Number(arg('--max-cost-usd') || 100),
    onProgress: async (progress) => {
      await saveJson(comparisonFile, progress);
      console.log(JSON.stringify({ completedPackets: progress.packets.filter((packet) => packet.baseline.validPrimaryModels && packet.astra.validPrimaryModels).length,
        completedArms: progress.packets.flatMap((packet) => [packet.baseline, packet.astra]).filter((arm) => arm.trace !== null).length,
        totalPackets: 40, estimatedCostUsd: progress.estimatedCostUsd }));
    },
  });
  await saveJson(comparisonFile, comparison);
  await saveJson(path.join(outputDirectory, 'blinded-cards.json'), blindedEvaluationCards(snapshot, comparison));
  await saveJson(path.join(outputDirectory, 'votes-template.json'), {
    snapshotHash: snapshot.hash, judge: { kind: 'human', id: '' },
    votes: comparison.packets.map((packet) => ({ packetId: packet.id, choice: '', reason: '', editCharsA: null, editCharsB: null })),
  });
  console.log(JSON.stringify({ status: comparison.completed ? 'awaiting_blinded_votes' : 'incomplete_comparison', comparisonFile, estimatedCostUsd: comparison.estimatedCostUsd }));
  if (!comparison.completed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
