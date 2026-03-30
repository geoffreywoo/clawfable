import { describe, it, expect } from 'vitest';
import { parseSoulMd } from '@/lib/soul-parser';

describe('parseSoulMd', () => {
  describe('tone detection', () => {
    it('detects contrarian tone', () => {
      const soul = `# SOUL.md
I am a contrarian voice that challenges consensus.

## Objective Function
Question everything. Anti-hype takes only.`;
      const profile = parseSoulMd('TestBot', soul);
      expect(profile.tone).toBe('contrarian');
    });

    it('detects optimist tone', () => {
      const soul = `# SOUL.md
I am a bullish, optimistic voice.

## Communication Protocol
Forward-looking, enthusiastic takes. Celebrate wins.`;
      const profile = parseSoulMd('HappyBot', soul);
      expect(profile.tone).toBe('optimist');
    });

    it('detects analyst tone', () => {
      const soul = `# SOUL.md
I am a measured analyst.

## Communication Protocol
Data-driven, nuanced analysis with evidence.`;
      const profile = parseSoulMd('DataBot', soul);
      expect(profile.tone).toBe('analyst');
    });

    it('detects provocateur tone', () => {
      const soul = `# SOUL.md
I am a provocateur.

## Communication Protocol
Controversial hot takes that spark debate.`;
      const profile = parseSoulMd('SpicyBot', soul);
      expect(profile.tone).toBe('provocateur');
    });

    it('detects educator tone', () => {
      const soul = `# SOUL.md
I am an educator.

## Communication Protocol
Explain concepts clearly. Teach and help people learn.`;
      const profile = parseSoulMd('TeachBot', soul);
      expect(profile.tone).toBe('educator');
    });

    it('defaults to contrarian when no tone signals', () => {
      const profile = parseSoulMd('EmptyBot', '# SOUL.md\nJust some text.');
      expect(profile.tone).toBe('contrarian');
    });
  });

  describe('topic extraction', () => {
    it('extracts topics from keywords', () => {
      const soul = `# SOUL.md
I cover AI, crypto, and startup news.`;
      const profile = parseSoulMd('TopicBot', soul);
      expect(profile.topics).toContain('ai');
      expect(profile.topics).toContain('crypto');
      expect(profile.topics).toContain('startup');
    });

    it('extracts topics from objective section', () => {
      const soul = `# SOUL.md
## Objective Function
Primary objective: analyze blockchain infrastructure and decentralized protocols.`;
      const profile = parseSoulMd('ObjBot', soul);
      expect(profile.topics.length).toBeGreaterThan(0);
    });

    it('caps topics at 8', () => {
      const soul = `# SOUL.md
I cover ai, machine learning, crypto, tech, startup, vc, funding, regulation, policy, agents, llm.`;
      const profile = parseSoulMd('ManyTopics', soul);
      expect(profile.topics.length).toBeLessThanOrEqual(8);
    });
  });

  describe('anti-goals', () => {
    it('extracts anti-goals from dedicated section', () => {
      const soul = `# SOUL.md
## Anti-Goals
Do not optimize for: engagement bait, generic platitudes, thread spam`;
      const profile = parseSoulMd('AntiBot', soul);
      expect(profile.antiGoals.length).toBeGreaterThan(0);
      expect(profile.antiGoals.some(g => g.includes('engagement bait'))).toBe(true);
    });

    it('extracts anti-goals from inline avoid/never patterns', () => {
      const soul = `# SOUL.md
I am a bot. Never use hashtags. Avoid corporate speak. Do not post memes.`;
      const profile = parseSoulMd('InlineAnti', soul);
      expect(profile.antiGoals.length).toBeGreaterThan(0);
    });

    it('caps anti-goals at 4', () => {
      const soul = `# SOUL.md
## Anti-Goals
- engagement bait
- generic platitudes
- thread spam
- clickbait headlines
- corporate jargon
- emoji overuse`;
      const profile = parseSoulMd('ManyAnti', soul);
      expect(profile.antiGoals.length).toBeLessThanOrEqual(4);
    });
  });

  describe('communication style', () => {
    it('extracts style from communication section', () => {
      const soul = `# SOUL.md
## Communication Protocol
Terse, signal-dense dispatches. No filler.`;
      const profile = parseSoulMd('StyleBot', soul);
      expect(profile.communicationStyle).not.toBe('direct and concise');
      expect(profile.communicationStyle.length).toBeGreaterThan(0);
    });

    it('defaults to direct and concise when no section', () => {
      const profile = parseSoulMd('DefaultBot', '# SOUL.md\nJust text.');
      expect(profile.communicationStyle).toBe('direct and concise');
    });
  });

  describe('summary generation', () => {
    it('includes agent name in summary', () => {
      const profile = parseSoulMd('CoolBot', '# SOUL.md\nI am a contrarian AI voice.');
      expect(profile.summary).toContain('CoolBot');
    });

    it('includes tone in summary', () => {
      const profile = parseSoulMd('Bot', '# SOUL.md\nI am an educator who teaches AI.');
      expect(profile.summary).toContain(profile.tone);
    });

    it('includes topics in summary', () => {
      const profile = parseSoulMd('Bot', '# SOUL.md\nI cover crypto and ai news.');
      expect(profile.summary).toMatch(/ai|crypto/);
    });
  });

  describe('section parsing', () => {
    it('handles multiple heading levels', () => {
      const soul = `# SOUL.md — System Definition
I am a contrarian voice.

## 1) Objective Function
Primary: question AI hype.

### Communication Protocol
Terse dispatches.

## 3) Anti-Goals
Do not optimize for: engagement bait`;
      const profile = parseSoulMd('HeadingBot', soul);
      expect(profile.tone).toBe('contrarian');
      expect(profile.antiGoals.length).toBeGreaterThan(0);
    });

    it('handles empty SOUL.md gracefully', () => {
      const profile = parseSoulMd('EmptyBot', '');
      expect(profile.tone).toBe('contrarian');
      expect(profile.topics).toEqual([]);
      expect(profile.antiGoals).toEqual([]);
      expect(profile.communicationStyle).toBe('direct and concise');
      expect(profile.summary).toContain('EmptyBot');
    });
  });
});
