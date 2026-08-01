import type { VoiceProfile } from './soul-parser';
import type { AgentLearnings } from './types';

const GEOFFREY_HANDLES = new Set(['geoffwoo', 'geoffreywoo']);

function normalizeHandle(handle?: string | null): string {
  return (handle || '').trim().replace(/^@/, '').toLowerCase();
}

function isGeoffreyHandle(handle?: string | null): boolean {
  return GEOFFREY_HANDLES.has(normalizeHandle(handle));
}

function dedupeTopics(topics: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const topic of topics) {
    const normalized = topic.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isCryptoOnlyTopic(topic: string): boolean {
  return /\b(crypto|web3|defi|nft|token|blockchain|bitcoin|ethereum)\b/i.test(topic);
}

const GEOFFREY_GENERIC_DRIFT_TOPICS = new Set([
  'general',
  'humor',
  'policy',
  'politics',
  'tech',
]);

function isGenericDriftTopic(topic: string): boolean {
  const normalized = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return GEOFFREY_GENERIC_DRIFT_TOPICS.has(normalized);
}

export function shouldSuppressTopicForAccount(handle: string | null | undefined, topic: string | null | undefined): boolean {
  if (!isGeoffreyHandle(handle)) return false;
  return isCryptoOnlyTopic(topic || '') || isGenericDriftTopic(topic || '');
}

export function applyAccountTopicPolicy(
  handle: string | null | undefined,
  voiceProfile: VoiceProfile,
): VoiceProfile {
  if (!isGeoffreyHandle(handle)) return voiceProfile;

  // Account policy may narrow an identity, but it must not manufacture one.
  // Current subjects come from manual/SOUL evidence and live topic discovery.
  const topics = dedupeTopics(
    voiceProfile.topics.filter((topic) => !shouldSuppressTopicForAccount(handle, topic)),
  );

  return {
    ...voiceProfile,
    topics,
    antiGoals: dedupeTopics([
      ...voiceProfile.antiGoals,
      'crypto-first content unless it is directly tied to AI infrastructure, energy, compute, industrial capacity, or frontier technology',
      'AI slop: polished generic advice, consultant cadence, template hooks, symmetrical abstraction stacks, and posts that sound generated',
      'low-status SaaS operations texture: Slack channels, calendar invites, support tickets, dashboards, generic workflows, and "who owns the handoff" as proof of depth',
    ]),
    communicationStyle: `${voiceProfile.communicationStyle}

## ACCOUNT TOPIC POLICY FOR @geoffwoo
- Crypto is no longer a core content pillar. Do not generate standalone crypto/Web3 takes by default.
- Discover current subjects dynamically from the followed network. Do not promote a fixed editorial topic menu into the account identity.
- Geoffrey's demonstrated range includes startups and venture, AI and software, investing and capital markets, culture/status/ambition, company and people reactions, selective health/performance and sports, plus frontier technology. Historical native posts and recent operator likes decide the live mix.
- A discovered subject is eligible only when it has a concrete bridge to the original SOUL topics, Geoffrey's own manually written posts, or a filtered recent operator-like signal. Likes teach topic taste only, never diction or factual certainty.
- A crypto angle is acceptable only when it is a supporting detail inside a stronger AI infrastructure, compute, energy, manufacturing, or frontier-tech thesis.
- Follow-graph virality is a discovery signal, not an identity override. A live subject must connect concretely to this SOUL, a manual topic, or an operator-written post before it can enter generation.
- Politics and geopolitics are not default content lanes. Do not lead with politicians, elections, or ideological news unless Geoffrey's manual writing establishes that mode; attaching an industrial paragraph does not cure topic drift.
- Never inherit a source author's ideology, thesis, certainty, jargon, cadence, or social posture. Learn what happened; Geoffrey supplies what it means and how it sounds.
- Keep most output in proven native territory. Frontier technology remains one lane, not the account's entire identity. Cap deep industrial topics at one of five originals and materials/manufacturing topics at one of eight.

## ACCOUNT ANTI-SLOP POLICY FOR @geoffwoo
- Treat public feedback that the account sounds like "AI slop" as a standing rejection of the current voice pattern.
- Do not write polished generic advice, engagement bait, founder-bro abstraction stacks, or posts that sound like a prompt output.
- Avoid template openings like "the real edge", "most people miss", "not X but Y", "the winners will be", "here's the thing", and neat numbered frameworks unless a concrete observed detail makes the sentence impossible to genericize.
- Avoid low-status SaaS-ops texture as the main anchor: Slack channels, support queues/tickets, calendar invites, dashboards, generic workflow handoffs, Looms, Zendesk, "renamed owner", and "who changed the workflow" are now considered weak proof.
- Elevated means sharp taste and high-context judgment, not mandatory technical density. A culture, VC, market, sports, or company reaction should not be translated into a manufacturing analogy.
- Geoffrey's native diction is casual, direct, socially situated, and comfortable with shorthand. Technical detail should appear only when the subject genuinely needs it, support a judgment, and never become an analyst memo.
- Prefer the actual rhythm distribution in Geoffrey's manual posts. Blunt, compressed, slightly uneven phrasing is often right, but do not flatten every post into one synthetic technical cadence.
- Frontier-tech drafts still need a high-status technical anchor: a mechanism, constraint, number, material/process detail, named technology, or concrete failure mode. Non-technical native lanes need an equally concrete social object, named event, incentive, tradeoff, or observable behavior instead.
- A generic "workflow changed" or "support queue got quieter" does not count as a sufficient anchor for @geoffwoo.
- If a commenter could plausibly say "this sounds like ChatGPT wrote it", reject the draft before it reaches the queue.`,
  };
}

export function applyAccountLearningPolicy(
  handle: string | null | undefined,
  learnings: AgentLearnings | null,
): AgentLearnings | null {
  if (!isGeoffreyHandle(handle) || !learnings) return learnings;

  return {
    ...learnings,
    topicRankings: learnings.topicRankings.filter((entry) => !shouldSuppressTopicForAccount(handle, entry.topic)),
    manualTopicProfile: learnings.manualTopicProfile?.filter((entry) => !shouldSuppressTopicForAccount(handle, entry.topic)),
    insights: learnings.insights.filter((insight) => !isCryptoOnlyTopic(insight) && !isGenericDriftTopic(insight)),
  };
}
