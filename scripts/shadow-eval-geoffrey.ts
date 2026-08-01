import {
  getAgent,
  getAgentByHandle,
  getAnalysis,
  getTrendingCache,
} from '../lib/kv-storage';
import { buildGenerationContext } from '../lib/generation-context';
import { generateViralBatch } from '../lib/viral-generator';
import { assessGeoffreyQualityPolicy } from '../lib/quality-policy';
import type { TrendingTopic } from '../lib/trending';

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function readBatchCount(): number {
  const value = Number(readArg('--batches') || 12);
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    throw new Error('--batches must be an integer from 1 to 12');
  }
  return value;
}

function sourceBriefKey(draft: {
  sourceBrief?: string | null;
  trendTopicId?: string | null;
  targetTopic?: string | null;
}): string {
  return String(draft.trendTopicId || draft.sourceBrief || draft.targetTopic || 'unknown')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

async function findAgent(agentId: string | null) {
  if (agentId) return getAgent(agentId);
  return await getAgentByHandle('geoffwoo') || getAgentByHandle('geoffreywoo');
}

async function main() {
  const batches = readBatchCount();
  const agent = await findAgent(readArg('--agent-id'));
  if (!agent) throw new Error('No @geoffwoo agent found.');
  const analysis = await getAnalysis(agent.id);
  if (!analysis) throw new Error('Account analysis is unavailable.');
  const context = await buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 });
  if (!context.learnings?.voiceCorpus?.active) {
    throw new Error(`Voice corpus is inactive (${context.learnings?.voiceCorpus?.anchorCount || 0} anchors).`);
  }
  const trendingValue = await getTrendingCache(agent.id);
  const trending = Array.isArray(trendingValue) ? trendingValue as TrendingTopic[] : [];
  const drafts: Array<{
    batch: number;
    content: string;
    topic: string;
    sourceBriefKey: string;
    eligible: boolean;
    issues: string[];
    scores: ReturnType<typeof assessGeoffreyQualityPolicy>['scores'];
    generationProvider: string | null;
    generationModel: string | null;
    judgeProvider: string | null;
    judgeModel: string | null;
    finalCriticProvider: string | null;
    finalCriticModel: string | null;
  }> = [];
  const rollingRecentPosts = [...context.recentPosts];

  for (let batch = 1; batch <= batches; batch++) {
    const generated = await generateViralBatch(
      context.voiceProfile,
      analysis,
      2,
      trending,
      context.learnings,
      agent.soulMd,
      context.style,
      rollingRecentPosts,
      context.allTweets,
      context.memory,
      context.ideaAtoms,
      context.signals,
    );
    for (const draft of generated) {
      const assessment = assessGeoffreyQualityPolicy(draft, {
        voiceProfile: context.voiceProfile,
        learnings: context.learnings,
        memory: context.memory,
        stage: 'queue',
      });
      drafts.push({
        batch,
        content: draft.content,
        topic: draft.targetTopic,
        sourceBriefKey: sourceBriefKey(draft),
        eligible: assessment.eligible,
        issues: assessment.issues,
        scores: assessment.scores,
        generationProvider: draft.generationProvider || null,
        generationModel: draft.generationModel || null,
        judgeProvider: draft.judgeProvider || null,
        judgeModel: draft.judgeModel || null,
        finalCriticProvider: draft.finalCriticProvider || null,
        finalCriticModel: draft.finalCriticModel || null,
      });
      rollingRecentPosts.unshift(draft.content);
    }
  }

  const eligible = drafts.filter((draft) => draft.eligible);
  const distinctBriefs = new Set(eligible.map((draft) => draft.sourceBriefKey));
  const knownAntiSlopViolations = drafts.filter((draft) => draft.issues.some((issue) => (
    /slop|cringe|stiffness|generated pattern|voice drift|source copy|anchor reskin/i.test(issue)
  )));
  const activation = {
    zeroKnownAntiSlopViolations: knownAntiSlopViolations.length === 0,
    atLeastFourEligibleDrafts: eligible.length >= 4,
    atLeastFourDistinctBriefs: distinctBriefs.size >= 4,
  };
  const passed = Object.values(activation).every(Boolean);
  const report = {
    generatedAt: new Date().toISOString(),
    agentId: agent.id,
    handle: `@${agent.handle}`,
    requestedDrafts: batches * 2,
    generatedDrafts: drafts.length,
    eligibleDrafts: eligible.length,
    skippedSlots: batches * 2 - eligible.length,
    distinctEligibleBriefs: distinctBriefs.size,
    knownAntiSlopViolations: knownAntiSlopViolations.length,
    activation,
    passed,
    corpusVersion: context.learnings.voiceCorpus.snapshotId,
    drafts,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
