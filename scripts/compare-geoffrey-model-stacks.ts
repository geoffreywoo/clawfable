import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  GEOFFREY_CONTROL_MODEL_STACK,
  GEOFFREY_PRIMARY_MODEL_STACK,
} from '../lib/ai';
import type { GenerationModelStackId } from '../lib/types';

type JsonRecord = Record<string, any>;

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function runArm(modelStack: GenerationModelStackId, batches: number): JsonRecord {
  const executable = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const script = resolve(process.cwd(), 'scripts/remote-shadow-eval-geoffrey.ts');
  const result = spawnSync(executable, [
    script,
    '--compact',
    `--batches=${batches}`,
    `--model-stack=${modelStack}`,
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`${modelStack} shadow failed with status ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function number(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function summarize(result: JsonRecord) {
  const shadow = result.shadow || {};
  return {
    modelStack: shadow.modelStack,
    requestedDrafts: number(shadow.requestedDrafts),
    completedBatches: number(shadow.completedBatches),
    generatedDrafts: number(shadow.generatedDrafts),
    eligibleDrafts: number(shadow.eligibleDrafts),
    eligibleRate: number(shadow.requestedDrafts) > 0
      ? Number((number(shadow.eligibleDrafts) / number(shadow.requestedDrafts)).toFixed(4))
      : 0,
    distinctEligibleBriefs: number(shadow.distinctEligibleBriefs),
    knownAntiSlopViolations: number(shadow.knownAntiSlopViolations),
    providerModels: shadow.providerModels || {},
    topIssues: shadow.topIssues || [],
    eligibleExamples: shadow.eligibleExamples || [],
  };
}

function main() {
  const batches = Number(readArg('--batches') || 6);
  if (!Number.isInteger(batches) || batches < 1 || batches > 12) {
    throw new Error('--batches must be an integer from 1 to 12');
  }

  const treatment = summarize(runArm(GEOFFREY_PRIMARY_MODEL_STACK, batches));
  const control = summarize(runArm(GEOFFREY_CONTROL_MODEL_STACK, batches));
  const treatmentPreferred = treatment.knownAntiSlopViolations === 0
    && (
      treatment.eligibleRate > control.eligibleRate
      || (
        treatment.eligibleRate === control.eligibleRate
        && treatment.distinctEligibleBriefs >= control.distinctEligibleBriefs
      )
    );

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    comparison: {
      batchesPerArm: batches,
      defaultLiveStack: GEOFFREY_PRIMARY_MODEL_STACK,
      shadowControlStack: GEOFFREY_CONTROL_MODEL_STACK,
      treatment,
      control,
      delta: {
        eligibleDrafts: treatment.eligibleDrafts - control.eligibleDrafts,
        eligibleRate: Number((treatment.eligibleRate - control.eligibleRate).toFixed(4)),
        distinctEligibleBriefs: treatment.distinctEligibleBriefs - control.distinctEligibleBriefs,
        knownAntiSlopViolations: treatment.knownAntiSlopViolations - control.knownAntiSlopViolations,
      },
      treatmentPreferred,
    },
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
}
