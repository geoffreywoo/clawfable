/** Frozen synthetic trial only. Import the shared AI client after child isolation. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function probationChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, AI_MODEL_POLICY: 'standard', NODE_ENV: 'production', VITEST: 'false',
    AI_BUDGET_TEST_ENFORCE: 'true', ANTIHUNTER_PROBATION_CHILD: '1', ANTHROPIC_LOG: 'off' };
}
export async function probationCommand(args = process.argv.slice(2)) {
  const command = args[0];
  if (!['preflight', 'report', 'run'].includes(command)) throw new Error('Use preflight, report, or run; optional --output /absolute/new-result.json');
  const rest = args.slice(1);
  if (rest.length && (rest.length !== 2 || rest[0] !== '--output' || !path.isAbsolute(rest[1]))) throw new Error('Only --output /absolute/new-result.json is supported');
  if (rest[1] && fs.existsSync(rest[1])) throw new Error('Output path already exists; keep previous receipts');
  const { productionProbationRunner, PROBATION, PROBATION_ROUTES } = await import('../lib/antihunter-probation');
  const runner = productionProbationRunner();
  let result: unknown;
  if (command === 'preflight') {
    const checked = await runner.preflight();
    result = { id: PROBATION.id, ready: true, paidCalls: 0, accountId: '5',
      manifestSha256: PROBATION.manifestSha256, libraryCommit: PROBATION.libraryCommit,
      policy: 'standard', nodeEnv: 'production', routes: PROBATION_ROUTES,
      campaignCommittedUsd: checked.committedUsd, remainingAdmissionUsd: checked.remainingUsd,
      alreadyClaimedSlots: Object.keys(checked.state.slots).length };
  } else result = await runner[command]();
  const json = JSON.stringify(result, null, 2) + '\n';
  if (rest[1]) fs.writeFileSync(rest[1], json, { flag: 'wx', mode: 0o600 });
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.env.ANTIHUNTER_PROBATION_CHILD !== '1') {
    const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...process.argv.slice(2)],
      { env: probationChildEnvironment(process.env), stdio: 'inherit' });
    process.exitCode = child.status ?? 1;
  } else {
    probationCommand().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      // No SDK errors, account records, headers, or credentials are printed here.
      const allowed = new Set(['artifacts_changed', 'source_changed', 'identity_mismatch', 'runtime_mismatch', 'rates_changed',
        'input_limit', 'budget_exhausted', 'budget_unavailable', 'provider_error', 'timeout', 'incomplete', 'usage_missing',
        'route_mismatch', 'ledger_mismatch', 'receipt_unavailable', 'run_busy', 'run_halted', 'state_invalid']);
      console.error(JSON.stringify({ error: allowed.has(error?.code) ? error.code : 'runner_failed', paidRetryAllowed: false }));
      process.exitCode = 1;
    });
  }
}
