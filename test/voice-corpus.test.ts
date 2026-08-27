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

  it('keeps the corpus version stable when only generated mechanics evidence changes', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const first = build(history);
    const generated = performance(101, {
      tweetId: 'generated-mechanics',
      xTweetId: 'x-generated-mechanics',
      content: 'the winners will own the feedback loop and compound the real moat.',
      likes: 5000,
      retweets: 900,
      replies: 400,
      source: 'manual',
    });
    const second = build([...history, generated], [generatedTweet(generated)]);

    expect(second.entries).toHaveLength(first.entries.length + 1);
    expect(second.entries.find((entry) => entry.xTweetId === generated.xTweetId)?.dispositions)
      .toContain('mechanics_only');
    expect(second.snapshotId).toBe(first.snapshotId);
  });

  it('changes the corpus version when the diction anchors change', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const first = build(history);
    const second = buildVoiceCorpusSnapshot({
      agentId: 'agent-corpus',
      history,
      tweets: [],
      postLog: [],
      signals: [],
      curation: {
        pinnedXTweetIds: [],
        blockedXTweetIds: [history[0].xTweetId],
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      generatedAt: '2026-07-31T00:00:00.000Z',
    });

    expect(second.entries.find((entry) => entry.xTweetId === history[0].xTweetId)?.dispositions)
      .not.toContain('diction_anchor');
    expect(second.snapshotId).not.toBe(first.snapshotId);
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

  it('keeps sports out of Geoffrey diction and topic learning even when the post performs', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const sports = performance(120, {
      xTweetId: 'x-sports-winner',
      content: 'UFC needs to book this fight now because the matchup is too good to waste.',
      topic: 'UFC combat sports',
      likes: 5000,
      retweets: 500,
      replies: 300,
    });
    const snapshot = buildVoiceCorpusSnapshot({
      agentId: 'agent-geoffwoo',
      accountHandle: 'geoffwoo',
      history: [...history, sports],
      tweets: [],
      postLog: [],
      signals: [],
      curation: { pinnedXTweetIds: [], blockedXTweetIds: [], updatedAt: '2026-06-01T00:00:00.000Z' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    });
    const entry = snapshot.entries.find((candidate) => candidate.xTweetId === sports.xTweetId);

    expect(entry?.dispositions).not.toContain('topic_signal');
    expect(entry?.dispositions).not.toContain('diction_anchor');
    expect(entry?.dispositions).toContain('excluded');
    expect(entry?.exclusionReasons.join(' ')).toContain('excludes sports');
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
      performance(94, {
        xTweetId: 'x-context-dependent-link',
        content: 'the names are fine. only a few twitter nerds see the old association. everyone else gets the sci fi vibe https://t.co/context',
      }),
      performance(95, {
        xTweetId: 'x-media-attachment',
        content: 'robot field service gets expensive once actuator replacement starts eating the margin.',
        hasMedia: true,
      }),
      performance(96, {
        xTweetId: 'x-unresolved-pronoun-link',
        content: 'just accumulate more money and power than them. then implement your own philosophy with money and power. https://t.co/context',
      }),
      performance(97, {
        xTweetId: 'x-merch-promo',
        content: 'anti fund hats sold out because we actually know how to hype beast. get yours https://t.co/merch',
      }),
      performance(98, {
        xTweetId: 'x-full-pod',
        content: 'do more provocative things because everyone is too afraid of being canceled. full pod here https://t.co/pod',
      }),
      performance(99, {
        xTweetId: 'x-invest-promo',
        content: 'living legend. would love to invest and amplify your work with @antifund https://t.co/promo',
      }),
      performance(100, {
        xTweetId: 'x-investor-customer-promo',
        content: '@antifund very happy investor and customer. ultra strong team with a dope roadmap https://t.co/promo',
      }),
      performance(101, {
        xTweetId: 'x-in-action-caption',
        content: 'bro.. best bullshitter in the game in action. you cannot fake this level of confidence https://t.co/clip',
      }),
      performance(102, {
        xTweetId: 'x-trip-caption',
        content: 'i remember this trip. the founder was still meeting users every night after the team went home https://t.co/clip',
      }),
      performance(103, {
        xTweetId: 'x-model-output',
        content: 'i asked @ChatGPT to rate my startup pitch:\n\nOverall: 8.1/10\nStyle: 8.7\n\nThe assessment: unusually polished with a strong narrative and confident posture.',
      }),
    ];
    const snapshot = build([...history, ...questionable]);

    const promo = snapshot.entries.find((entry) => entry.xTweetId === 'x-promo');
    const media = snapshot.entries.find((entry) => entry.xTweetId === 'x-media');
    const truncated = snapshot.entries.find((entry) => entry.xTweetId === 'x-truncated');
    const clipped = snapshot.entries.find((entry) => entry.xTweetId === 'x-clipped-long-post');
    const contextual = snapshot.entries.find((entry) => entry.xTweetId === 'x-context-dependent-link');
    const attachment = snapshot.entries.find((entry) => entry.xTweetId === 'x-media-attachment');
    const unresolved = snapshot.entries.find((entry) => entry.xTweetId === 'x-unresolved-pronoun-link');
    const merch = snapshot.entries.find((entry) => entry.xTweetId === 'x-merch-promo');
    const fullPod = snapshot.entries.find((entry) => entry.xTweetId === 'x-full-pod');
    const investPromo = snapshot.entries.find((entry) => entry.xTweetId === 'x-invest-promo');
    const investorCustomerPromo = snapshot.entries.find((entry) => entry.xTweetId === 'x-investor-customer-promo');
    const inAction = snapshot.entries.find((entry) => entry.xTweetId === 'x-in-action-caption');
    const tripCaption = snapshot.entries.find((entry) => entry.xTweetId === 'x-trip-caption');
    const modelOutput = snapshot.entries.find((entry) => entry.xTweetId === 'x-model-output');

    expect(promo?.exclusionReasons).toContain('promotional post');
    expect(media?.exclusionReasons).toContain('media-dependent caption');
    expect(truncated?.exclusionReasons).toContain('possibly truncated or incomplete text');
    expect(clipped?.exclusionReasons).toContain('possibly truncated or incomplete text');
    expect(contextual?.exclusionReasons).toContain('media-dependent caption');
    expect(attachment?.exclusionReasons).toContain('media-dependent caption');
    expect(unresolved?.exclusionReasons).toContain('media-dependent caption');
    expect(merch?.exclusionReasons).toContain('promotional post');
    expect(fullPod?.exclusionReasons).toContain('media-dependent caption');
    expect(investPromo?.exclusionReasons).toContain('promotional post');
    expect(investorCustomerPromo?.exclusionReasons).toContain('promotional post');
    expect(inAction?.exclusionReasons).toContain('media-dependent caption');
    expect(tripCaption?.exclusionReasons).toContain('media-dependent caption');
    expect(modelOutput?.exclusionReasons).toContain('quoted model output rather than native prose');
    for (const entry of [
      promo,
      media,
      truncated,
      clipped,
      contextual,
      attachment,
      unresolved,
      merch,
      fullPod,
      investPromo,
      investorCustomerPromo,
      inAction,
      tripCaption,
      modelOutput,
    ]) {
      expect(entry?.dispositions).not.toContain('diction_anchor');
    }
  });

  it('does not let pinning override a diction-anchor exclusion', () => {
    const history = Array.from({ length: NATIVE_TEXTS.length }, (_, index) => performance(index));
    const pinnedMedia = performance(110, {
      xTweetId: 'x-pinned-media',
      content: 'this is the whole strategy https://t.co/context',
      hasMedia: true,
    });
    const snapshot = buildVoiceCorpusSnapshot({
      agentId: 'agent-corpus-pinned-media',
      history: [...history, pinnedMedia],
      tweets: [],
      postLog: [],
      signals: [],
      curation: {
        pinnedXTweetIds: [pinnedMedia.xTweetId],
        blockedXTweetIds: [],
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      generatedAt: '2026-07-31T00:00:00.000Z',
    });
    const entry = snapshot.entries.find((candidate) => candidate.xTweetId === pinnedMedia.xTweetId);

    expect(entry?.selectionReasons).toContain('explicitly pinned');
    expect(entry?.exclusionReasons).toContain('media-dependent caption');
    expect(entry?.dispositions).toContain('excluded');
    expect(entry?.dispositions).not.toContain('diction_anchor');
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
