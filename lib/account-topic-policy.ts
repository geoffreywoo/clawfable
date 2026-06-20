import type { VoiceProfile } from './soul-parser';
import type { AgentLearnings } from './types';

const GEOFFREYWOO_FRONTIER_TOPICS = [
  'ai',
  'inference asics',
  'fusion',
  'fission',
  'rare earth minerals',
  'robotics',
  'automated manufacturing',
  're-industrialization',
  'space',
  'frontier tech',
  'deep tech',
];

function normalizeHandle(handle?: string | null): string {
  return (handle || '').trim().replace(/^@/, '').toLowerCase();
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
  if (normalizeHandle(handle) !== 'geoffreywoo') return false;
  return isCryptoOnlyTopic(topic || '');
}

export function applyAccountTopicPolicy(
  handle: string | null | undefined,
  voiceProfile: VoiceProfile,
): VoiceProfile {
  if (normalizeHandle(handle) !== 'geoffreywoo') return voiceProfile;

  const topics = dedupeTopics([
    ...voiceProfile.topics.filter((topic) => !isCryptoOnlyTopic(topic)),
    ...GEOFFREYWOO_FRONTIER_TOPICS,
  ]);

  return {
    ...voiceProfile,
    topics,
    antiGoals: dedupeTopics([
      ...voiceProfile.antiGoals,
      'crypto-first content unless it is directly tied to AI infrastructure, energy, compute, industrial capacity, or frontier technology',
    ]),
    communicationStyle: `${voiceProfile.communicationStyle}

## ACCOUNT TOPIC POLICY FOR @geoffreywoo
- Crypto is no longer a core content pillar. Do not generate standalone crypto/Web3 takes by default.
- Keep posting on AI, especially where AI touches real-world constraints: inference ASICs, datacenter power, robotics, automated manufacturing, energy, supply chains, and industrial capacity.
- Actively prefer frontier/deep tech themes: inference ASICs, fusion, fission, rare earth minerals, robotics, automated manufacturing, re-industrialization, space, and adjacent hard-technology ideas.
- A crypto angle is acceptable only when it is a supporting detail inside a stronger AI infrastructure, compute, energy, manufacturing, or frontier-tech thesis.`,
  };
}

export function applyAccountLearningPolicy(
  handle: string | null | undefined,
  learnings: AgentLearnings | null,
): AgentLearnings | null {
  if (normalizeHandle(handle) !== 'geoffreywoo' || !learnings) return learnings;

  return {
    ...learnings,
    topicRankings: learnings.topicRankings.filter((entry) => !isCryptoOnlyTopic(entry.topic)),
    manualTopicProfile: learnings.manualTopicProfile?.filter((entry) => !isCryptoOnlyTopic(entry.topic)),
    insights: learnings.insights.filter((insight) => !isCryptoOnlyTopic(insight)),
  };
}
