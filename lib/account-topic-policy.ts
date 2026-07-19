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

export function shouldSuppressTopicForAccount(handle: string | null | undefined, topic: string | null | undefined): boolean {
  if (!isGeoffreyHandle(handle)) return false;
  return isCryptoOnlyTopic(topic || '');
}

export function applyAccountTopicPolicy(
  handle: string | null | undefined,
  voiceProfile: VoiceProfile,
): VoiceProfile {
  if (!isGeoffreyHandle(handle)) return voiceProfile;

  // Account policy may narrow an identity, but it must not manufacture one.
  // Current subjects come from manual/SOUL evidence and live topic discovery.
  const topics = dedupeTopics(
    voiceProfile.topics.filter((topic) => !isCryptoOnlyTopic(topic)),
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
- A discovered subject is eligible only when it has a concrete bridge to the original SOUL topics or Geoffrey's own manually written posts.
- A crypto angle is acceptable only when it is a supporting detail inside a stronger AI infrastructure, compute, energy, manufacturing, or frontier-tech thesis.
- Follow-graph virality is a discovery signal, not an identity override. A live subject must connect concretely to this SOUL, a manual topic, or an operator-written post before it can enter generation.
- Politics and geopolitics are not default content lanes. Do not lead with politicians, elections, or ideological news unless Geoffrey's manual writing establishes that mode; attaching an industrial paragraph does not cure topic drift.
- Never inherit a source author's ideology, thesis, certainty, jargon, cadence, or social posture. Learn what happened; Geoffrey supplies what it means and how it sounds.
- Keep most output in proven native territory. At two original posts per day, use no more than one slot for a live followed-network subject unless the operator explicitly changes the mix.

## ACCOUNT ANTI-SLOP POLICY FOR @geoffwoo
- Treat public feedback that the account sounds like "AI slop" as a standing rejection of the current voice pattern.
- Do not write polished generic advice, engagement bait, founder-bro abstraction stacks, or posts that sound like a prompt output.
- Avoid template openings like "the real edge", "most people miss", "not X but Y", "the winners will be", "here's the thing", and neat numbered frameworks unless a concrete observed detail makes the sentence impossible to genericize.
- Avoid low-status SaaS-ops texture as the main anchor: Slack channels, support queues/tickets, calendar invites, dashboards, generic workflow handoffs, Looms, Zendesk, "renamed owner", and "who changed the workflow" are now considered weak proof.
- The account should sound more elevated, technical, and elite: write from the level of compute constraints, chip packaging, power delivery, grid interconnects, reactor/fuel-cycle bottlenecks, separation chemistry, tungsten carbide tooling, antimony processing, gallium/germanium byproduct refining, graphite purification, fluorine chemistry, metrology, factory tolerances, robotics exception handling, launch/radiation/thermal constraints, and industrial supply chains.
- Prefer the actual rhythm distribution in Geoffrey's manual posts. Blunt, compressed, slightly uneven phrasing is often right, but do not flatten every post into one synthetic technical cadence.
- Every draft needs at least one high-status technical anchor: a mechanism, constraint, bottleneck, number, material, factory/process detail, named technology, concrete failure mode, or technical/industrial operating observation.
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
    topicRankings: learnings.topicRankings.filter((entry) => !isCryptoOnlyTopic(entry.topic)),
    manualTopicProfile: learnings.manualTopicProfile?.filter((entry) => !isCryptoOnlyTopic(entry.topic)),
    insights: learnings.insights.filter((insight) => !isCryptoOnlyTopic(insight)),
  };
}
