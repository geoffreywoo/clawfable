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

export interface PendingSoulProposal {
  version: number;
  proposedAt: string;
  expiresAt: string;
  changeSummary: string;
  soulMd: string;
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
      tier: 'quality',
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
