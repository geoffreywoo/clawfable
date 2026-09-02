/**
 * Soul evolution engine.
 * Periodically updates the SOUL.md based on what the learning loop discovers.
 * The soul is the agent's identity — it should grow, not stay frozen.
 */

import type { Agent, AgentLearnings, ProtocolSettings, SoulVersion } from './types';
import {
  getAgent,
  getFeedback,
  getLearnings,
  getProtocolSettings,
  getSoulVersions,
  updateProtocolSettings,
  updateAgent,
  pushSoulVersion,
  getVoiceDirectiveRules,
  addPostLogEntry,
} from './kv-storage';
import { parseSoulMd } from './soul-parser';
import { generateText } from './ai';
import { formatVoiceDirectiveRule, getActiveVoiceDirectiveRules } from './voice-directives';
import { selectRecentRejectionLines } from './learning-loop';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TRACKED_FOR_EVOLUTION = 50;
const SOUL_EVOLUTION_PROMPT_SOUL_LIMIT = 6000;
/** Approval mode: no new proposal for a day after the last one, even if it was resolved. */
export const SOUL_PROPOSAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Approval mode: an unreviewed proposal blocks regeneration for one evolution cycle, then lapses. */
export const SOUL_PROPOSAL_REVIEW_WINDOW_MS = SEVEN_DAYS_MS;
const PENDING_PROPOSAL_PREFIX = 'PENDING: ';

/**
 * Bounded before/after of a proposed SOUL.md so the operator can see what the
 * change actually does without reading the whole file. Totals are kept next to
 * the truncated samples so the UI never implies the diff is complete when it
 * is not.
 */
export interface SoulProposalDiff {
  added: string[];
  removed: string[];
  addedCount: number;
  removedCount: number;
}

export interface PendingSoulProposal {
  version: number;
  proposedAt: string;
  expiresAt: string;
  changeSummary: string;
  soulMd: string;
  diff: SoulProposalDiff;
}

export interface SoulEvolutionState {
  mode: ProtocolSettings['soulEvolutionMode'];
  lastEvolvedAt: string | null;
  lastProposedAt: string | null;
  pendingProposal: PendingSoulProposal | null;
  cooldownUntil: string | null;
  /** Why approval-mode regeneration is currently skipped; null when eligible. */
  holdReason: string | null;
}

const SOUL_DIFF_LINE_LIMIT = 8;
const SOUL_DIFF_LINE_CHARS = 240;

function significantSoulLines(soulMd: string): string[] {
  return soulMd.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Line-level diff between the live soul and a proposed one. Identical lines are
 * consumed pairwise so a repeated line is not reported as both added and
 * removed. Line order follows each document, and the samples are capped for
 * display while the true counts are preserved.
 */
export function diffSoulLines(currentSoulMd: string, proposedSoulMd: string): SoulProposalDiff {
  const unmatched = new Map<string, number>();
  for (const line of significantSoulLines(currentSoulMd)) {
    unmatched.set(line, (unmatched.get(line) ?? 0) + 1);
  }

  const added: string[] = [];
  for (const line of significantSoulLines(proposedSoulMd)) {
    const remaining = unmatched.get(line) ?? 0;
    if (remaining > 0) unmatched.set(line, remaining - 1);
    else added.push(line);
  }

  const removed: string[] = [];
  for (const [line, count] of unmatched) {
    for (let i = 0; i < count; i += 1) removed.push(line);
  }

  const sample = (lines: string[]): string[] => lines
    .slice(0, SOUL_DIFF_LINE_LIMIT)
    .map((line) => (line.length > SOUL_DIFF_LINE_CHARS ? `${line.slice(0, SOUL_DIFF_LINE_CHARS)}\u2026` : line));

  return {
    added: sample(added),
    removed: sample(removed),
    addedCount: added.length,
    removedCount: removed.length,
  };
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Derive approval-mode state from the persisted soul version stack. The
 * pending proposal is the newest `PENDING:` version (it carries its own
 * timestamp) as long as it has not been applied to the agent, superseded by a
 * later version, evolved past, or left unreviewed for a full cycle.
 */
export function resolveSoulEvolutionState({
  settings,
  versions,
  currentSoulMd,
  now = Date.now(),
}: {
  settings: Pick<ProtocolSettings, 'soulEvolutionMode' | 'lastEvolvedAt'>;
  versions: SoulVersion[];
  currentSoulMd: string;
  now?: number;
}): SoulEvolutionState {
  const ordered = [...versions].sort((a, b) => (parseTime(b.updatedAt) ?? 0) - (parseTime(a.updatedAt) ?? 0) || b.version - a.version);
  const newest = ordered[0] || null;
  const proposal = ordered.find((version) => version.reason.startsWith(PENDING_PROPOSAL_PREFIX)) || null;
  const proposedMs = parseTime(proposal?.updatedAt);
  const lastEvolvedMs = parseTime(settings.lastEvolvedAt);

  const cooldownUntilMs = proposedMs !== null && proposedMs + SOUL_PROPOSAL_COOLDOWN_MS > now
    ? proposedMs + SOUL_PROPOSAL_COOLDOWN_MS
    : null;

  const isPending = Boolean(
    proposal
    && proposedMs !== null
    && newest === proposal
    && proposal.soulMd.trim() !== currentSoulMd.trim()
    && (lastEvolvedMs === null || lastEvolvedMs < proposedMs)
    && now - proposedMs < SOUL_PROPOSAL_REVIEW_WINDOW_MS,
  );

  const pendingProposal: PendingSoulProposal | null = isPending && proposal && proposedMs !== null
    ? {
      version: proposal.version,
      proposedAt: proposal.updatedAt,
      expiresAt: new Date(proposedMs + SOUL_PROPOSAL_REVIEW_WINDOW_MS).toISOString(),
      changeSummary: proposal.reason.slice(PENDING_PROPOSAL_PREFIX.length).trim(),
      soulMd: proposal.soulMd,
      diff: diffSoulLines(currentSoulMd, proposal.soulMd),
    }
    : null;

  let holdReason: string | null = null;
  if (settings.soulEvolutionMode === 'approval') {
    if (pendingProposal) {
      holdReason = `Soul evolution proposal v${pendingProposal.version} (proposed ${pendingProposal.proposedAt}) is awaiting operator review`;
    } else if (cooldownUntilMs !== null) {
      const hoursLeft = Math.max(1, Math.ceil((cooldownUntilMs - now) / (60 * 60 * 1000)));
      holdReason = `Soul evolution proposal cooldown: next proposal in ${hoursLeft}h`;
    }
  }

  return {
    mode: settings.soulEvolutionMode,
    lastEvolvedAt: settings.lastEvolvedAt || null,
    lastProposedAt: proposal?.updatedAt || null,
    pendingProposal,
    cooldownUntil: cooldownUntilMs !== null ? new Date(cooldownUntilMs).toISOString() : null,
    holdReason,
  };
}

export async function getSoulEvolutionState(agent: Agent): Promise<SoulEvolutionState> {
  const [settings, versions] = await Promise.all([
    getProtocolSettings(agent.id),
    getSoulVersions(agent.id),
  ]);
  return resolveSoulEvolutionState({ settings, versions, currentSoulMd: agent.soulMd || '' });
}

export function formatSoulForEvolutionPrompt(soulMd: string): string {
  const trimmed = soulMd.trim();
  if (trimmed.length <= SOUL_EVOLUTION_PROMPT_SOUL_LIMIT) return trimmed;
  return `${trimmed.slice(0, SOUL_EVOLUTION_PROMPT_SOUL_LIMIT).trimEnd()}\n\n[SOUL.md trimmed for evolution prompt; preserve the existing structure and identity.]`;
}

export function getSoulEvolutionMaxTokens(currentSoulLength: number): number {
  if (currentSoulLength <= 2500) return 2048;
  if (currentSoulLength <= SOUL_EVOLUTION_PROMPT_SOUL_LIMIT) return 3072;
  return 4096;
}

export interface EvolutionResult {
  evolved: boolean;
  reason: string;
  changeSummary?: string;
}

/**
 * Check if an agent's soul should evolve, and if so, evolve it.
 * Called from the cron alongside the learning rebuild.
 */
export async function maybeEvolveSoul(agent: Agent): Promise<EvolutionResult> {
  const settings = await getProtocolSettings(agent.id);

  // Check if evolution is enabled
  if (settings.soulEvolutionMode === 'off') {
    return { evolved: false, reason: 'Evolution disabled' };
  }

  // Check if enough time has passed since last evolution
  if (settings.lastEvolvedAt) {
    const elapsed = Date.now() - new Date(settings.lastEvolvedAt).getTime();
    if (elapsed < SEVEN_DAYS_MS) {
      const daysLeft = Math.ceil((SEVEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000));
      return { evolved: false, reason: `Next evolution in ${daysLeft} days` };
    }
  }

  // Approval mode: a proposal that is still awaiting review, or one made
  // within the last day, must not be regenerated on every cron tick.
  if (settings.soulEvolutionMode === 'approval') {
    const versions = await getSoulVersions(agent.id);
    const state = resolveSoulEvolutionState({ settings, versions, currentSoulMd: agent.soulMd || '' });
    if (state.holdReason) {
      return {
        evolved: false,
        reason: state.holdReason,
        changeSummary: state.pendingProposal?.changeSummary,
      };
    }
  }

  // Check if we have enough data
  const learnings = await getLearnings(agent.id);
  if (!learnings || learnings.totalTracked < MIN_TRACKED_FOR_EVOLUTION) {
    return { evolved: false, reason: `Need ${MIN_TRACKED_FOR_EVOLUTION} tracked tweets (have ${learnings?.totalTracked ?? 0})` };
  }

  // Check if learnings are fresh
  if (learnings.updatedAt) {
    const learningsAge = Date.now() - new Date(learnings.updatedAt).getTime();
    if (learningsAge > 48 * 60 * 60 * 1000) {
      return { evolved: false, reason: 'Learnings are stale (>48h old)' };
    }
  }

  // Ready to evolve
  const result = await evolveSoul(agent, learnings, settings.soulEvolutionMode);
  return result;
}

async function evolveSoul(
  agent: Agent,
  learnings: AgentLearnings,
  mode: 'auto' | 'approval',
): Promise<EvolutionResult> {
  try {
    const currentSoul = agent.soulMd;
    if (!currentSoul || currentSoul.length < 50) {
      return { evolved: false, reason: 'No SOUL.md to evolve' };
    }
    const promptSoul = formatSoulForEvolutionPrompt(currentSoul);

    // Gather operator signals that soul evolution should respect
    const [directiveRules, feedback] = await Promise.all([
      getVoiceDirectiveRules(agent.id),
      getFeedback(agent.id),
    ]);
    const negFeedback = selectRecentRejectionLines(feedback, 5);
    const activeDirectiveRules = getActiveVoiceDirectiveRules(directiveRules);

    // Build the evolution prompt
    const fp = learnings.styleFingerprint;
    const topTweets = learnings.bestPerformers.slice(0, 5)
      .map((t) => `[${t.likes} likes] "${t.content.slice(0, 200)}"`)
      .join('\n');
    const worstTweets = learnings.worstPerformers.slice(0, 3)
      .map((t) => `[${t.likes} likes] "${t.content.slice(0, 200)}"`)
      .join('\n');

    const response = await generateText({
      task: 'learning',
      maxTokens: getSoulEvolutionMaxTokens(currentSoul.length),
      system: `You are updating a SOUL.md personality contract for an X (Twitter) agent based on real performance data. The soul defines WHO the agent is and HOW it communicates. Your job is to evolve it — not replace it.

RULES:
- Preserve the core identity (who they are, what they stand for)
- Strengthen sections that align with what actually performs
- Add anti-goals based on detected anti-patterns
- Update communication patterns with concrete examples from top tweets
- Make the soul MORE specific, not more generic
- Keep the same markdown structure and section headings
- Output the COMPLETE updated SOUL.md — not a diff, not instructions

After the SOUL.md, output one line starting with "CHANGES:" summarizing what you changed in under 50 words.`,
      prompt: `CURRENT SOUL.md:
${promptSoul}

PERFORMANCE DATA (${learnings.totalTracked} tweets tracked):
Avg likes: ${learnings.avgLikes}, Avg RTs: ${learnings.avgRetweets}

FORMAT RANKINGS:
${learnings.formatRankings.slice(0, 5).map((f) => `- ${f.format}: avg ${f.avgEngagement} engagement (${f.count} tweets)`).join('\n')}

TOPIC RANKINGS:
${learnings.topicRankings.slice(0, 5).map((t) => `- ${t.topic}: avg ${t.avgEngagement} engagement (${t.count} tweets)`).join('\n')}

${fp ? `STYLE FINGERPRINT (from top 30 tweets):
- Avg length: ${fp.avgLength} chars (${fp.shortPct}% short, ${fp.mediumPct}% medium, ${fp.longPct}% long)
- Questions: ${fp.questionRatio}%
- Line breaks: ${fp.usesLineBreaks}, Emojis: ${fp.usesEmojis}, Numbers: ${fp.usesNumbers}
- Best hooks: ${fp.topHooks?.join(', ') || 'varied'}
- Best tones: ${fp.topTones?.join(', ') || 'varied'}
- Anti-patterns: ${fp.antiPatterns?.join('; ') || 'none'}` : ''}

PRESCRIPTIVE RULES:
${learnings.insights.map((i) => `- ${i}`).join('\n')}

TOP 5 TWEETS (do MORE like these):
${topTweets}

WORST 3 TWEETS (do LESS like these):
${worstTweets}

${activeDirectiveRules.length > 0 ? `OPERATOR VOICE DIRECTIVES (from coaching sessions — these MUST be respected in the evolved soul):
${activeDirectiveRules.map((rule, i) => formatVoiceDirectiveRule(rule, i)).join('\n')}` : ''}

${negFeedback.length > 0 ? `CONTENT THE OPERATOR REJECTED (the soul should steer AWAY from these patterns):
${negFeedback.map((f) => `- ${f}`).join('\n')}` : ''}

Evolve this SOUL.md to incorporate what actually works. Respect operator directives. Output the complete updated SOUL.md, then a CHANGES: line.`,
    });

    const text = response.text;

    // Split the response into new soul + change summary
    const changesIdx = text.lastIndexOf('CHANGES:');
    let newSoul: string;
    let changeSummary: string;

    if (changesIdx !== -1) {
      newSoul = text.slice(0, changesIdx).trim();
      changeSummary = text.slice(changesIdx + 8).trim();
    } else {
      newSoul = text.trim();
      changeSummary = 'Soul evolved based on performance data';
    }

    // Validate the new soul is reasonable
    if (newSoul.length < 100 || newSoul.length > 20000) {
      return { evolved: false, reason: `Generated soul has invalid length (${newSoul.length})` };
    }

    // Don't evolve if the soul barely changed
    if (newSoul === currentSoul) {
      return { evolved: false, reason: 'No meaningful changes detected' };
    }

    if (mode === 'auto') {
      // Save current soul to version stack
      await pushSoulVersion(agent.id, currentSoul, 'Pre-evolution backup');

      // Apply the new soul
      const voiceProfile = parseSoulMd(agent.name, newSoul);
      await updateAgent(agent.id, {
        soulMd: newSoul,
        soulSummary: voiceProfile.summary,
      });

      // Update last evolved timestamp
      await updateProtocolSettings(agent.id, {
        lastEvolvedAt: new Date().toISOString(),
      });

      // Log it
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: `Soul evolved: ${changeSummary}`,
        format: 'soul_evolution',
        topic: 'soul',
        postedAt: new Date().toISOString(),
        source: 'cron',
        action: 'mentions_refreshed', // reusing as system event
        reason: changeSummary,
      });

      return { evolved: true, reason: 'Soul evolved automatically', changeSummary };
    } else {
      // Approval mode — store the proposed evolution for operator review.
      // The version entry is the persisted proposal (timestamped); it is
      // surfaced through resolveSoulEvolutionState until applied or lapsed.
      await pushSoulVersion(agent.id, newSoul, `${PENDING_PROPOSAL_PREFIX}${changeSummary}`);

      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: `Soul evolution proposed (pending approval): ${changeSummary}`,
        format: 'soul_evolution',
        topic: 'soul',
        postedAt: new Date().toISOString(),
        source: 'cron',
        action: 'skipped',
        reason: 'Pending operator approval',
      });

      return { evolved: false, reason: 'Evolution proposed, awaiting approval', changeSummary };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { evolved: false, reason: `Evolution failed: ${msg}` };
  }
}

// ─── Operator review of a pending proposal ──────────────────────────────────

export type SoulProposalDecision = 'approve' | 'dismiss';

export type SoulProposalResolutionStatus = 'applied' | 'dismissed' | 'no_pending_proposal';

export interface SoulProposalResolution {
  decision: SoulProposalDecision;
  status: SoulProposalResolutionStatus;
  applied: boolean;
  version: number | null;
  changeSummary: string | null;
  reason: string;
  state: SoulEvolutionState;
}

const MAX_DECISION_REASON_CHARS = 300;
const DEFAULT_DISMISS_REASON = 'Operator kept the current voice';

async function readSoulEvolutionState(agent: Agent, currentSoulMd: string): Promise<SoulEvolutionState> {
  const [settings, versions] = await Promise.all([
    getProtocolSettings(agent.id),
    getSoulVersions(agent.id),
  ]);
  return resolveSoulEvolutionState({ settings, versions, currentSoulMd });
}

/**
 * Apply or dismiss the proposal the approval-mode loop is holding.
 *
 * Applying writes the proposed SOUL.md onto the agent and records two honest
 * version entries: the soul it replaced, then the applied soul under an
 * approved (not `PENDING:`) reason. Dismissing leaves the soul alone and
 * records the current soul under a dismissal reason. Either way the proposal
 * stops being the newest version, so `resolveSoulEvolutionState` no longer
 * reports it as pending and the next cooldown window can propose again.
 *
 * Both paths are idempotent: once a proposal has been applied, dismissed, or
 * left to lapse there is nothing pending, so a repeated decision reports
 * `no_pending_proposal` and changes nothing.
 */
export async function resolvePendingSoulProposal(
  agent: Agent,
  decision: SoulProposalDecision,
  options: { reason?: string } = {},
): Promise<SoulProposalResolution> {
  const currentSoulMd = agent.soulMd || '';
  const state = await readSoulEvolutionState(agent, currentSoulMd);
  const pending = state.pendingProposal;

  if (!pending) {
    return {
      decision,
      status: 'no_pending_proposal',
      applied: false,
      version: null,
      changeSummary: null,
      reason: 'No voice change is waiting for review',
      state,
    };
  }

  const operatorReason = (options.reason || '').trim().slice(0, MAX_DECISION_REASON_CHARS);
  const changeSummary = pending.changeSummary || 'Soul evolved based on performance data';
  const decidedAt = new Date().toISOString();

  if (decision === 'approve') {
    if (currentSoulMd.trim()) {
      await pushSoulVersion(agent.id, currentSoulMd, `Replaced by approved proposal v${pending.version}`);
    }
    await pushSoulVersion(agent.id, pending.soulMd, `Approved by operator: ${changeSummary}`);

    const voiceProfile = parseSoulMd(agent.name, pending.soulMd);
    await updateAgent(agent.id, {
      soulMd: pending.soulMd,
      soulSummary: voiceProfile.summary,
    });
    await updateProtocolSettings(agent.id, { lastEvolvedAt: decidedAt });

    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: `Soul evolution approved: ${changeSummary}`,
      format: 'soul_evolution',
      topic: 'soul',
      postedAt: decidedAt,
      source: 'manual',
      action: 'mentions_refreshed', // reusing as system event
      reason: operatorReason || `Operator approved proposal v${pending.version}`,
    });

    return {
      decision,
      status: 'applied',
      applied: true,
      version: pending.version,
      changeSummary,
      reason: operatorReason || `Operator approved proposal v${pending.version}`,
      state: await readSoulEvolutionState(agent, pending.soulMd),
    };
  }

  const dismissReason = operatorReason || DEFAULT_DISMISS_REASON;
  await pushSoulVersion(agent.id, currentSoulMd, `Dismissed proposal v${pending.version}: ${dismissReason}`);

  await addPostLogEntry(agent.id, {
    agentId: agent.id,
    tweetId: '',
    xTweetId: '',
    content: `Soul evolution dismissed: ${changeSummary}`,
    format: 'soul_evolution',
    topic: 'soul',
    postedAt: decidedAt,
    source: 'manual',
    action: 'skipped',
    reason: dismissReason,
  });

  return {
    decision,
    status: 'dismissed',
    applied: false,
    version: pending.version,
    changeSummary,
    reason: dismissReason,
    state: await readSoulEvolutionState(agent, currentSoulMd),
  };
}
