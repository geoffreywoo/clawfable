/**
 * SOUL.md parser
 * Takes raw SOUL.md text and extracts a structured voice profile.
 */

export interface VoiceProfile {
  tone: string;
  topics: string[];
  antiGoals: string[];
  communicationStyle: string;
  summary: string;
}

/**
 * Parse a SOUL.md document and return a structured voice profile.
 */
export function parseSoulMd(agentName: string, soulMd: string): VoiceProfile {
  const lines = soulMd.split('\n');

  // ─── Extract sections ────────────────────────────────────────────────────
  const sections: Record<string, string> = {};
  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      if (currentSection) {
        sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
      }
      currentSection = heading[1].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection.toLowerCase()] = currentContent.join('\n').trim();
  }

  const sectionContaining = (...needles: string[]): string => (
    Object.entries(sections).find(([key]) => needles.some((needle) => key.includes(needle)))?.[1] || ''
  );
  const identitySection = sectionContaining('identity');
  const commsSection = sectionContaining('communication', 'protocol', 'style', 'voice');

  // ─── Determine tone ───────────────────────────────────────────────────────
  const allText = soulMd.toLowerCase();
  const toneText = `${identitySection}\n${commsSection}`.trim().toLowerCase() || allText;

  const toneScores: Record<string, number> = {
    contrarian: 0,
    optimist: 0,
    analyst: 0,
    provocateur: 0,
    educator: 0,
  };

  if (toneText.includes('contrarian')) toneScores.contrarian += 5;
  if (toneText.includes('skeptic')) toneScores.contrarian += 4;
  if (toneText.includes('challenge consensus')) toneScores.contrarian += 3;
  if (toneText.includes('anti-hype')) toneScores.contrarian += 3;

  if (toneText.includes('optimis')) toneScores.optimist += 5;
  if (toneText.includes('bullish')) toneScores.optimist += 4;
  if (toneText.includes('forward-looking')) toneScores.optimist += 4;
  if (toneText.includes('positive')) toneScores.optimist += 3;
  if (toneText.includes('encouraging')) toneScores.optimist += 3;
  if (toneText.includes('enthusiastic')) toneScores.optimist += 4;
  if (toneText.includes('celebrate')) toneScores.optimist += 3;

  if (/\banalyst\b/.test(toneText) && !/\b(?:not|never|avoid)\s+(?:an?\s+)?analyst\b/.test(toneText)) toneScores.analyst += 5;
  if (toneText.includes('measured')) toneScores.analyst += 4;
  if (toneText.includes('nuanced')) toneScores.analyst += 4;
  if (toneText.includes('data-driven')) toneScores.analyst += 4;
  if (toneText.includes('evidence')) toneScores.analyst += 2;

  if (toneText.includes('provocat')) toneScores.provocateur += 5;
  if (toneText.includes('controversial')) toneScores.provocateur += 4;
  if (toneText.includes('hot take')) toneScores.provocateur += 4;
  if (toneText.includes('casual')) toneScores.provocateur += 3;
  if (toneText.includes('high-context')) toneScores.provocateur += 2;

  if (toneText.includes('educat')) toneScores.educator += 5;
  if (toneText.includes('explain')) toneScores.educator += 3;
  if (toneText.includes('teach')) toneScores.educator += 4;
  if (toneText.includes('learn')) toneScores.educator += 2;

  if (toneText.includes('question') && !toneText.includes('without question')) toneScores.contrarian += 1;
  if (toneText.includes('signal density')) toneScores.contrarian += 2;
  if (toneText.includes('no filler')) toneScores.contrarian += 2;

  let tone = 'contrarian';
  let maxScore = 0;
  for (const [t, score] of Object.entries(toneScores)) {
    if (score > maxScore) {
      maxScore = score;
      tone = t;
    }
  }

  // ─── Extract topics ───────────────────────────────────────────────────────
  const topics: string[] = [];
  const topicKeywords = [
    'ai', 'startup', 'vc', 'software', 'agents', 'openai', 'robotics', 'energy',
    'hardware', 'manufacturing', 'compute', 'biotech', 'defense', 'space',
    'nuclear', 'health', 'culture', 'investing', 'capital markets', 'tech',
    'machine learning', 'crypto', 'funding', 'regulation', 'policy', 'google',
    'jobs', 'productivity', 'economics', 'engineering', 'llm',
  ];
  for (const kw of topicKeywords) {
    if (allText.includes(kw)) {
      topics.push(kw);
    }
  }

  const objectiveSection = Object.entries(sections).find(([k]) =>
    k.includes('objective') || k.includes('goal')
  )?.[1] || '';
  if (objectiveSection) {
    const words = objectiveSection.split(/\s+/);
    for (const word of words) {
      const cleaned = word.replace(/[^a-z]/gi, '').toLowerCase();
      if (
        cleaned.length > 4 &&
        !['that', 'this', 'with', 'from', 'into', 'have', 'will', 'their', 'these', 'those', 'which', 'where', 'about', 'would', 'could', 'should', 'being', 'other', 'every', 'under', 'never', 'primary', 'spread', 'value', 'improve', 'state', 'default'].includes(cleaned)
      ) {
        if (!topics.includes(cleaned)) topics.push(cleaned);
        if (topics.length >= 10) break;
      }
    }
  }

  // ─── Extract anti-goals ───────────────────────────────────────────────────
  const antiGoals: string[] = [];
  const antiSection = Object.entries(sections).find(([k]) =>
    k.includes('anti-goal') || k.includes('antigoal') || k.includes('anti goal') || k.includes('avoid')
  )?.[1] || '';

  if (antiSection) {
    const bulletItems = antiSection
      .split('\n')
      .map((line) => line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/)?.[1]?.trim() || '')
      .filter(Boolean);
    const paragraphItems = antiSection
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const explicitNegativeParagraphs = paragraphItems.filter((item) => /^(?:do not|avoid|never)\b/i.test(item));
    const items = (explicitNegativeParagraphs.length > 0
      ? explicitNegativeParagraphs
      : bulletItems.length > 0 ? bulletItems : paragraphItems)
      .map((item) => item.slice(0, 320))
      .filter((item) => item.length > 5);
    antiGoals.push(...items.slice(0, 5));
  }

  if (antiGoals.length === 0) {
    const avoidMatches = soulMd.match(/(?:do not|avoid|never)\s+[^.]+/gi) || [];
    for (const m of avoidMatches.slice(0, 4)) {
      antiGoals.push(m.trim());
    }
  }

  // ─── Extract communication style ──────────────────────────────────────────
  let communicationStyle = 'direct and concise';
  if (commsSection) {
    const styleWords = [
      'terse', 'verbose', 'concise', 'detailed', 'brief', 'direct',
      'dense', 'signal', 'clear', 'structured', 'conversational',
    ];
    for (const word of styleWords) {
      if (commsSection.toLowerCase().includes(word)) {
        communicationStyle = word;
        break;
      }
    }
    const firstSentence = commsSection.split(/[.!?]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 10 && firstSentence.length < 120) {
      communicationStyle = firstSentence.toLowerCase();
    }
  }

  // ─── Build summary ────────────────────────────────────────────────────────
  const topicStr = topics.slice(0, 3).join(', ') || 'technology and AI';
  const antiSummary = antiGoals.length > 0
    ? antiGoals[0].split(/[.!?]/)[0].slice(0, 120)
    : 'Avoid optimizing for optics over outcomes';
  const communicationSummary = /^write\b/i.test(communicationStyle)
    ? `You ${communicationStyle}`
    : `Your communication style is ${communicationStyle}`;

  const summary =
    `You are ${agentName}. Your voice is ${tone}. You focus on ${topicStr}. ` +
    `${communicationSummary}. ${antiSummary}.`;

  return {
    tone,
    topics: topics.slice(0, 8),
    antiGoals: antiGoals.slice(0, 4),
    communicationStyle,
    summary,
  };
}
