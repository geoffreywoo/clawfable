/**
 * Soul evolution engine.
 * Periodically updates the SOUL.md based on what the learning loop discovers.
 * The soul is the agent's identity — it should grow, not stay frozen.
 */

import type { Agent, AgentLearnings } from './types';
import {
  getAgent,
  getLearnings,
  getProtocolSettings,
  updateProtocolSettings,
  updateAgent,
  pushSoulVersion,
  getVoiceDirectiveRules,
  getRecentNegativeFeedback,
  addPostLogEntry,
} from './kv-storage';
import { parseSoulMd } from './soul-parser';
import { generateText } from './ai';
import { formatVoiceDirectiveRule, getActiveVoiceDirectiveRules } from './voice-directives';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TRACKED_FOR_EVOLUTION = 50;

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

    // Gather operator signals that soul evolution should respect
    const [directiveRules, negFeedback] = await Promise.all([
      getVoiceDirectiveRules(agent.id),
      getRecentNegativeFeedback(agent.id, 5),
    ]);
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
      tier: 'quality',
      maxTokens: 4096,
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
${currentSoul}

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
      // Approval mode — store the proposed evolution for operator review
      await pushSoulVersion(agent.id, newSoul, `PENDING: ${changeSummary}`);

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
