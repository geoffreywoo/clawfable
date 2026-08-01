const DEFAULT_BASE_URL = 'https://www.clawfable.com';
const DEFAULT_BATCHES = 12;
const MAX_BATCHES = 12;
const MAX_LOCK_ATTEMPTS = 40;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

type JsonRecord = Record<string, any>;

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function readBatchCount(): number {
  const value = Number(readArg('--batches') || DEFAULT_BATCHES);
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCHES) {
    throw new Error(`--batches must be an integer from 1 to ${MAX_BATCHES}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(
  url: string,
  options: RequestInit = {},
  attempts = 5,
): Promise<{ response: Response; data: JsonRecord }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(330_000),
      });
      const raw = await response.text();
      let data: JsonRecord;
      try {
        data = JSON.parse(raw);
      } catch {
        data = { error: raw.slice(0, 500) };
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < attempts) {
        await sleep(attempt * 5_000);
        continue;
      }
      return { response, data };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.error(`transport retry ${attempt}: ${error instanceof Error ? error.message : error}`);
        await sleep(attempt * 5_000);
      }
    }
  }
  throw lastError || new Error('Request failed.');
}

function countBy(drafts: JsonRecord[], field: string): Record<string, number> {
  return Object.fromEntries(Object.entries(drafts.reduce<Record<string, number>>((counts, draft) => {
    const key = String(draft[field] || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {})).sort());
}

function sourceBriefKey(draft: JsonRecord): string {
  return String(draft.trendTopicId || draft.sourceBrief || draft.topic || 'unknown')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

async function waitForDeploymentAuth(base: string, headers: HeadersInit): Promise<void> {
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      const { response } = await requestJson(`${base}/audit`, { headers }, 2);
      if (response.status === 200) {
        console.error(`production auth ready after ${attempt} checks`);
        return;
      }
      if (attempt % 6 === 0) console.error(`waiting for production auth: status=${response.status}`);
    } catch (error) {
      if (attempt % 6 === 0) {
        console.error(`waiting for production auth: ${error instanceof Error ? error.message : error}`);
      }
    }
    await sleep(5_000);
  }
  throw new Error('Production authentication did not become ready within five minutes.');
}

async function main() {
  const secret = process.env.CLAWFABLE_INTERNAL_SECRET;
  if (!secret) throw new Error('CLAWFABLE_INTERNAL_SECRET is required.');
  const baseUrl = (process.env.CLAWFABLE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const agentId = readArg('--agent-id') || '13';
  const batchesRequested = readBatchCount();
  const base = `${baseUrl}/api/internal/agents/${encodeURIComponent(agentId)}/generation`;
  const auth = { authorization: `Bearer ${secret}` };
  await waitForDeploymentAuth(base, auth);

  const headers = { ...auth, 'content-type': 'application/json' };
  const batches: JsonRecord[] = [];
  for (let batch = 1; batch <= batchesRequested; batch++) {
    let result: Awaited<ReturnType<typeof requestJson>> | null = null;
    for (let lockAttempt = 1; lockAttempt <= MAX_LOCK_ATTEMPTS; lockAttempt++) {
      result = await requestJson(`${base}/preview`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ count: 2, includeDiagnostics: true }),
      });
      if (result.response.status !== 409) break;
      if (lockAttempt === 1 || lockAttempt % 4 === 0) {
        console.error(`shadow batch ${batch}: waiting for autopilot lock (${lockAttempt}/${MAX_LOCK_ATTEMPTS})`);
      }
      await sleep(15_000);
    }
    if (!result) throw new Error(`Shadow batch ${batch} did not run.`);
    batches.push({ batch, status: result.response.status, ...result.data });
    console.error(`shadow batch ${batch}: status=${result.response.status} generated=${result.data.generated || 0}`);
  }

  const { response: auditResponse, data: audit } = await requestJson(`${base}/audit`, { headers: auth });
  const drafts = batches.flatMap((batch) => (batch.drafts || []).map((draft: JsonRecord) => ({
    ...draft,
    batch: batch.batch,
  })));
  const eligible = drafts.filter((draft) => draft.qualityEligible === true);
  const antiSlopViolations = drafts.filter((draft) => (draft.qualityIssues || []).some((issue: string) => (
    /slop|cringe|stiffness|generated pattern|voice drift|source copy|anchor reskin/i.test(issue)
  )));
  const distinctBriefs = new Set(eligible.map(sourceBriefKey));
  const issueCounts: Record<string, number> = {};
  for (const draft of drafts) {
    for (const issue of draft.qualityIssues || []) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }
  const completedBatches = batches.filter((batch) => batch.status === 200).length;
  const activation = {
    allBatchesCompleted: completedBatches === batchesRequested,
    zeroKnownAntiSlopViolations: antiSlopViolations.length === 0,
    atLeastFourEligibleDrafts: eligible.length >= 4,
    atLeastFourDistinctBriefs: distinctBriefs.size >= 4,
  };
  const sourceRows = [...(audit.sources?.accepted || []), ...(audit.sources?.rejected || [])];
  const requestedDrafts = batchesRequested * 2;
  const diagnostics = batches.map((batch) => ({ batch: batch.batch, ...(batch.diagnostics || {}) }));
  const diagnosticIssueCounts: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    for (const [issue, count] of Object.entries(diagnostic.qualityIssueCounts || {})) {
      diagnosticIssueCounts[issue] = (diagnosticIssueCounts[issue] || 0) + Number(count || 0);
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    agentId,
    shadow: {
      requestedDrafts,
      completedBatches,
      httpErrors: batches.filter((batch) => batch.status !== 200).map((batch) => ({
        batch: batch.batch,
        status: batch.status,
        error: batch.error || null,
      })),
      generatedDrafts: drafts.length,
      eligibleDrafts: eligible.length,
      skippedSlots: requestedDrafts - eligible.length,
      distinctEligibleBriefs: distinctBriefs.size,
      knownAntiSlopViolations: antiSlopViolations.length,
      activation,
      passed: Object.values(activation).every(Boolean),
      providerModels: {
        generationProviders: countBy(drafts, 'generationProvider'),
        generationModels: countBy(drafts, 'generationModel'),
        judgeProviders: countBy(drafts, 'judgeProvider'),
        judgeModels: countBy(drafts, 'judgeModel'),
        finalCriticProviders: countBy(drafts, 'finalCriticProvider'),
        finalCriticModels: countBy(drafts, 'finalCriticModel'),
        finalCriticVerdicts: countBy(drafts, 'finalCriticVerdict'),
        policyVersions: countBy(drafts, 'qualityPolicyVersion'),
        corpusVersions: countBy(drafts, 'voiceCorpusVersion'),
      },
      sourceLanes: countBy(drafts, 'sourceLane'),
      topIssues: Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 12),
      generationDiagnostics: {
        exitReasons: diagnostics.reduce<Record<string, number>>((counts, diagnostic) => {
          const key = diagnostic.exitReason || 'unknown';
          counts[key] = (counts[key] || 0) + 1;
          return counts;
        }, {}),
        stageTotals: diagnostics.reduce<Record<string, number>>((totals, diagnostic) => {
          for (const [stage, count] of Object.entries(diagnostic.stages || {})) {
            totals[stage] = (totals[stage] || 0) + Number(count || 0);
          }
          return totals;
        }, {}),
        parseTotals: diagnostics.reduce<Record<string, number>>((totals, diagnostic) => {
          for (const [key, count] of Object.entries(diagnostic.parse || {})) {
            totals[key] = (totals[key] || 0) + Number(count || 0);
          }
          return totals;
        }, {}),
        topQualityIssues: Object.entries(diagnosticIssueCounts).sort((a, b) => b[1] - a[1]).slice(0, 20),
        judgeRuns: diagnostics.map((diagnostic) => ({
          batch: diagnostic.batch,
          judges: diagnostic.judges || null,
        })),
        samples: diagnostics.flatMap((diagnostic) => diagnostic.qualitySamples || []).slice(0, 12),
      },
      eligibleExamples: eligible.slice(0, 4).map((draft) => ({
        batch: draft.batch,
        topic: draft.topic,
        content: draft.content,
        sourceLane: draft.sourceLane,
        generation: `${draft.generationProvider || 'unknown'}:${draft.generationModel || 'unknown'}`,
        judge: `${draft.judgeProvider || 'unknown'}:${draft.judgeModel || 'unknown'}`,
        finalCritic: `${draft.finalCriticProvider || 'unknown'}:${draft.finalCriticModel || 'unknown'}`,
        finalCriticVerdict: draft.finalCriticVerdict,
        qualityScores: draft.qualityScores,
      })),
    },
    audit: {
      status: auditResponse.status,
      policy: audit.policy || null,
      corpus: audit.corpus ? {
        snapshotId: audit.corpus.snapshotId,
        active: audit.corpus.active,
        anchorCount: audit.corpus.anchorCount,
        targetAnchorCount: audit.corpus.targetAnchorCount,
        minimumAnchorCount: audit.corpus.minimumAnchorCount,
        corpusPurity: audit.corpus.corpusPurity,
        knownGeneratedAnchorCount: audit.corpus.knownGeneratedAnchorCount,
        dispositionCounts: audit.corpus.dispositionCounts,
        provenanceCounts: audit.corpus.provenanceCounts,
      } : null,
      queue: audit.queue ? {
        depth: audit.queue.depth,
        qualityEligibleCount: audit.queue.qualityEligibleCount,
        skippedByQualityCount: audit.queue.skippedByQualityCount,
        policyVersionCounts: audit.queue.policyVersionCounts,
        corpusVersionCounts: audit.queue.corpusVersionCounts,
        finalCriticVerdicts: audit.queue.finalCriticVerdicts,
      } : null,
      sources: audit.sources ? {
        laneCounts: audit.sources.laneCounts,
        acceptedCount: audit.sources.accepted.length,
        rejectedCount: audit.sources.rejected.length,
        servo: sourceRows.filter((row) => /servo/i.test(row.headline || '')),
      } : null,
      models: audit.models || null,
      complaints: audit.complaints || null,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
