import { describe, expect, it } from 'vitest';
import { getVoiceCorpusSnapshot, saveVoiceCorpusSnapshot } from '@/lib/kv-storage';
import {
  buildVoiceCorpusSnapshot,
  VOICE_CORPUS_MIN_ANCHORS,
  VOICE_CORPUS_TARGET_ANCHORS,
} from '@/lib/voice-corpus';
import type { Tweet, TweetPerformance } from '@/lib/types';

const NATIVE_TEXTS = [
  'hbm is expensive. idle hbm is criminal. inference teams should measure memory occupancy before buying another rack.',
  'fusion founders do not have a science problem every week. they have a component qualification calendar that moves one supplier at a time.',
  'rare earth mining gets the headlines. separation chemistry is where a new supplier can spend five years becoming real.',
  'robot demos keep getting better. actuator life at production duty cycles is still the part i want to see.',
  'a factory can buy ten robots before it finds one person who can keep the metrology stack honest across every shift.',
  'space companies are quietly becoming thermal-management companies with a launch vehicle attached.',
  'the interesting inference chip pitch is not peak tops. show me useful tokens per rack after memory and power are both constrained.',
  'nuclear timelines are mostly a supply-chain map wearing a regulatory hat. qualified forgings do not care about the deck.',
  'why are we still valuing humanoid companies on demo dexterity when field service hours will decide the gross margin?',
  'beryllium looks like a tiny market right until one qualified part holds up an entire aerospace program.',
  'the new industrial software winner may be the company that can tell a machinist which tolerance is about to drift, not summarize the shift.',
  'browser infrastructure is back to being a startup surface. servo is a rendering engine story, not a robotics story.',
  'one transformer can gate a data center longer than the gpu order. power equipment startups finally have pricing power and a clock.',
  'machine tools are the hidden denominator in re-industrialization. capital is available faster than precision capacity.',
  'inference pricing keeps falling while rack power keeps getting harder. that is a very good setup for weird new silicon.',
  'the best robotics founders talk about replacement intervals before autonomy. uptime is the product once the demo ends.',
  'launch cadence is not just rockets. valves, test stands, and range availability compound or block the whole schedule.',
  'critical mineral projects are financeable when buyers underwrite qualification time, not when another commodity chart goes up.',
  'ai coding made software labor cheaper. it also made the scarce hardware and energy layer much easier to see.',
  'manufacturing startups should brag about first-pass yield more and robot count less.',
  'if the supplier cannot hold the tolerance after the tenth thermal cycle, the prototype was a marketing expense.',
  'every inference asic deck has a throughput slide. the useful question is what happens after the memory controller gets hot.',
  'fission is having a capital moment. the companies that shorten component lead times may capture more value than another reactor concept.',
  'orbital compute sounds early until launch cost, radiation tolerance, and heat rejection land on the same spreadsheet.',
  'the american factory bottleneck is often a qualified process nobody has bothered to make legible enough to finance.',
  'robotics margins will look like service margins until hardware failure data gets boring.',
  'there are a lot of gpu substitutes and not enough transformer substitutes.',
  'the startup wedge in rare earths is often process control. ore is useless if recovery drifts every batch.',
  'a fast model on a slow interconnect is a very expensive way to discover queueing theory.',
  'industrial capacity gets built when someone signs the offtake, not when everyone agrees it is strategically important.',
];

function performance(index: number, overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: `internal-${index}`,
    xTweetId: `x-${index}`,
    content: NATIVE_TEXTS[index % NATIVE_TEXTS.length],
    format: index % 4 === 0 ? 'question' : index % 3 === 0 ? 'data_point' : 'observation',
    topic: [
      'inference', 'fusion', 'rare earths', 'robotics', 'manufacturing', 'space',
      'nuclear', 'materials', 'industrial capacity', 'browser infrastructure',
    ][index % 10],
    postedAt: new Date(Date.UTC(2026, 5, 1 + index)).toISOString(),
    checkedAt: new Date(Date.UTC(2026, 5, 2 + index)).toISOString(),
    likes: 20 + index,
    retweets: index % 8,
    replies: index % 5,
    impressions: 1000 + index * 100,
    engagementRate: 0.02,
    wasViral: index % 7 === 0,
    source: 'timeline',
    ...overrides,
  };
}

function generatedTweet(perf: TweetPerformance): Tweet {
  return {
    id: perf.tweetId,
    agentId: 'agent-corpus',
    content: perf.content,
    type: 'original',
    status: 'posted',
    format: perf.format,
    topic: perf.topic,
    xTweetId: perf.xTweetId,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    deletionReason: null,
    generationProvider: 'openai',
    generationModel: 'gpt-5.6',
    createdAt: perf.postedAt,
  };
}

function build(history: TweetPerformance[], tweets: Tweet[] = []) {
  return buildVoiceCorpusSnapshot({
    agentId: 'agent-corpus',
    history,
    tweets,
    postLog: [],
    signals: [],
    curation: { pinnedXTweetIds: [], blockedXTweetIds: [], updatedAt: '2026-06-01T00:00:00.000Z' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
}

describe('versioned voice corpus', () => {
  it('never uses known generated winners as diction anchors', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const generatedWinner = performance(100, {
      tweetId: 'generated-winner',
      xTweetId: 'x-generated-winner',
      content: 'the real moat is not compute. it is the feedback loop that compounds while everyone else sleeps.',
      likes: 5000,
      retweets: 900,
      replies: 400,
      source: 'manual',
    });
    const snapshot = build([...history, generatedWinner], [generatedTweet(generatedWinner)]);
    const entry = snapshot.entries.find((candidate) => candidate.xTweetId === generatedWinner.xTweetId);

    expect(snapshot.active).toBe(true);
    expect(snapshot.anchorCount).toBeGreaterThanOrEqual(VOICE_CORPUS_MIN_ANCHORS);
    expect(snapshot.anchorCount).toBeLessThanOrEqual(VOICE_CORPUS_TARGET_ANCHORS);
    expect(snapshot.knownGeneratedAnchorCount).toBe(0);
    expect(entry?.provenance).toBe('known_clawfable_generated');
    expect(entry?.dispositions).toContain('mechanics_only');
    expect(entry?.dispositions).not.toContain('diction_anchor');
  });

  it('matches known generated text even when an older record lacks its X id', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const timelineCopy = performance(101, {
      tweetId: '',
      xTweetId: 'x-unlinked-generated-copy',
      content: 'the winners will own the feedback loop and compound the real moat.',
      source: 'timeline',
    });
    const unlinkedGenerated = {
      ...generatedTweet({ ...timelineCopy, tweetId: 'internal-unlinked' }),
      id: 'internal-unlinked',
      xTweetId: null,
    };
    const snapshot = build([...history, timelineCopy], [unlinkedGenerated]);
    const entry = snapshot.entries.find((candidate) => candidate.xTweetId === timelineCopy.xTweetId);

    expect(entry?.provenance).toBe('known_clawfable_generated');
    expect(entry?.dispositions).toContain('mechanics_only');
    expect(entry?.dispositions).not.toContain('diction_anchor');
  });

  it('does not fill missing corpus capacity with uncertain authorship', () => {
    const uncertain = Array.from({ length: 60 }, (_, index) => performance(index, {
      xTweetId: `unknown-${index}`,
      tweetId: `unknown-internal-${index}`,
      source: 'manual',
    }));
    const snapshot = build(uncertain);

    expect(snapshot.active).toBe(false);
    expect(snapshot.anchorCount).toBe(0);
    expect(snapshot.entries.every((entry) => entry.provenance === 'unknown')).toBe(true);
    expect(snapshot.entries.every((entry) => entry.dispositions.includes('excluded'))).toBe(true);
  });

  it('lets an explicit block override an otherwise eligible native post', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const blockedId = history[0].xTweetId;
    const snapshot = buildVoiceCorpusSnapshot({
      agentId: 'agent-corpus-block',
      history,
      tweets: [],
      postLog: [],
      signals: [],
      curation: { pinnedXTweetIds: [], blockedXTweetIds: [blockedId], updatedAt: '2026-06-01T00:00:00.000Z' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    });
    const blocked = snapshot.entries.find((entry) => entry.xTweetId === blockedId);

    expect(blocked?.dispositions).toContain('negative');
    expect(blocked?.dispositions).not.toContain('diction_anchor');
    expect(blocked?.exclusionReasons).toContain('explicitly blocked example');
  });

  it('keeps promotions, media captions, and incomplete text out of diction anchors', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const questionable = [
      performance(90, {
        xTweetId: 'x-promo',
        content: 'congrats to @example on the new round. happy to support this team as they build the future of industrial automation.',
      }),
      performance(91, {
        xTweetId: 'x-media',
        content: 'new interview on hardware startups. watch the full conversation here https://example.com/video\n0:00 why now\n4:20 manufacturing',
      }),
      performance(92, {
        xTweetId: 'x-truncated',
        content: 'integrated codex with connectors and computer use changes how startups can ship software because the most important part of the product is',
      }),
      performance(93, {
        xTweetId: 'x-clipped-long-post',
        content: 'openai and claude will dominate applications, but a startup can still win with distribution, mindshare, proprietary data, and the mega https://t.co/clipped',
      }),
    ];
    const snapshot = build([...history, ...questionable]);

    const promo = snapshot.entries.find((entry) => entry.xTweetId === 'x-promo');
    const media = snapshot.entries.find((entry) => entry.xTweetId === 'x-media');
    const truncated = snapshot.entries.find((entry) => entry.xTweetId === 'x-truncated');
    const clipped = snapshot.entries.find((entry) => entry.xTweetId === 'x-clipped-long-post');

    expect(promo?.exclusionReasons).toContain('promotional post');
    expect(media?.exclusionReasons).toContain('media-dependent caption');
    expect(truncated?.exclusionReasons).toContain('possibly truncated or incomplete text');
    expect(clipped?.exclusionReasons).toContain('possibly truncated or incomplete text');
    for (const entry of [promo, media, truncated, clipped]) {
      expect(entry?.dispositions).not.toContain('diction_anchor');
    }
  });

  it('atomically replaces the stored snapshot', async () => {
    const first = build(Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index)));
    const second = { ...first, snapshotId: 'voice-corpus-v1-replacement', generatedAt: '2026-08-01T00:00:00.000Z' };

    await saveVoiceCorpusSnapshot('agent-corpus-atomic', { ...first, agentId: 'agent-corpus-atomic' });
    await saveVoiceCorpusSnapshot('agent-corpus-atomic', { ...second, agentId: 'agent-corpus-atomic' });

    expect(await getVoiceCorpusSnapshot('agent-corpus-atomic')).toEqual({
      ...second,
      agentId: 'agent-corpus-atomic',
    });
  });
});
