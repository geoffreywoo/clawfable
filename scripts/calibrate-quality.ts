import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { compareEditorialReviewBundle, type EditorialReviewBundle } from '../lib/editorial-review-bundle';
import { getPublishingV2QualityPolicyVersion } from '../lib/publishing-quality-policy';
import { getModelChainForTask } from '../lib/ai';

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Supply the private frozen manifest, complete policy assessment rows, and factual safety evaluation.');
  if (process.argv.includes('--activate')) throw new Error('Automatic cutoff activation is retired. Review a complete held-out policy evaluation before a production release.');
  // Private bundle: { manifest, rows, safety, reviews?: FrozenOwnerReview[],
  //   supplements?: EditorialHoldoutSupplement[], supplementReviews?: FrozenOwnerReview[] }.
  // Each row/review retains its source manifest hash; scored rows require
  // evaluatorVersion 'durable-original-1', and supplemental rows require contextHash.
  // See lib/editorial-review-bundle.ts for the frozen schema.
  const input = JSON.parse(await readFile(filename, 'utf8')) as EditorialReviewBundle;
  if (!input.manifest || !input.rows || !input.safety) throw new Error('Full-policy evaluation required; two-cutoff score files are not activation evidence.');
  const baseline = { model: getModelChainForTask('copy_judgment', 'publishing_v2_astra')[0].model,
    promptVersion: process.env.AI_MODEL_POLICY === 'astra_all' ? 'budget-copy-judge-2-astra' : 'budget-copy-judge-1',
    policyVersion: getPublishingV2QualityPolicyVersion('original', 'geoffwoo') };
  const report = compareEditorialReviewBundle(input, baseline);
  await mkdir('.gstack/quality-calibration', { recursive: true, mode: 0o700 });
  await writeFile('.gstack/quality-calibration/result.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
