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

  // ─── Determine tone ───────────────────────────────────────────────────────
  const allText = soulMd.toLowerCase();

  const toneScores: Record<string, number> = {
    contrarian: 0,
    optimist: 0,
    analyst: 0,
    provocateur: 0,
    educator: 0,
  };

  if (allText.includes('contrarian')) toneScores.contrarian += 5;
  if (allText.includes('skeptic')) toneScores.contrarian += 4;
  if (allText.includes('challenge consensus')) toneScores.contrarian += 3;
  if (allText.includes('anti-hype')) toneScores.contrarian += 3;

  if (allText.includes('optimis')) toneScores.optimist += 5;
  if (allText.includes('bullish')) toneScores.optimist += 4;
  if (allText.includes('forward-looking')) toneScores.optimist += 4;
  if (allText.includes('positive')) toneScores.optimist += 3;
  if (allText.includes('encouraging')) toneScores.optimist += 3;
  if (allText.includes('enthusiastic')) toneScores.optimist += 4;
  if (allText.includes('celebrate')) toneScores.optimist += 3;

  if (allText.includes('analyst')) toneScores.analyst += 5;
  if (allText.includes('measured')) toneScores.analyst += 4;
  if (allText.includes('nuanced')) toneScores.analyst += 4;
  if (allText.includes('data-driven')) toneScores.analyst += 4;
  if (allText.includes('evidence')) toneScores.analyst += 2;

  if (allText.includes('provocat')) toneScores.provocateur += 5;
  if (allText.includes('controversial')) toneScores.provocateur += 4;
  if (allText.includes('hot take')) toneScores.provocateur += 4;

  if (allText.includes('educat')) toneScores.educator += 5;
  if (allText.includes('explain')) toneScores.educator += 3;
  if (allText.includes('teach')) toneScores.educator += 4;
  if (allText.includes('learn')) toneScores.educator += 2;

  if (allText.includes('question') && !allText.includes('without question')) toneScores.contrarian += 1;
  if (allText.includes('signal density')) toneScores.contrarian += 2;
  if (allText.includes('no filler')) toneScores.contrarian += 2;

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
    'ai', 'machine learning', 'crypto', 'tech', 'startup', 'vc', 'funding',
    'regulation', 'policy', 'agents', 'llm', 'openai', 'google', 'jobs',
    'productivity', 'economics', 'software', 'engineering',
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
    const items = antiSection
      .split(/\n|,|\d+\.|[-–—]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5 && s.length < 120);
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
  const commsSection = Object.entries(sections).find(([k]) =>
    k.includes('communication') || k.includes('protocol') || k.includes('style') || k.includes('voice')
  )?.[1] || '';

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
  const antiStr = antiGoals.length > 0
    ? antiGoals[0].replace(/^(do not|avoid|never)\s+/i, '').slice(0, 60)
    : 'optimizing for optics over outcomes';

  const summary =
    `You are ${agentName}. Your voice is ${tone}. You focus on ${topicStr}. ` +
    `You communicate with ${communicationStyle}. You never ${antiStr}.`;

  return {
    tone,
    topics: topics.slice(0, 8),
    antiGoals: antiGoals.slice(0, 4),
    communicationStyle,
    summary,
  };
}
