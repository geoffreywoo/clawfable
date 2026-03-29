import type { AccountAnalysis, JobSuggestion } from './types';

function formatHour(h: number): string {
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
}

/**
 * Generate job suggestions based on account analysis.
 * Returns 3-5 suggestions tailored to the account's engagement patterns.
 */
export function generateJobSuggestions(analysis: AccountAnalysis): JobSuggestion[] {
  const { engagementPatterns, followingProfile } = analysis;
  const suggestions: JobSuggestion[] = [];

  // 1. Peak Hour Posts — always suggest if we have top hours
  if (engagementPatterns.topHours.length > 0) {
    const hours = engagementPatterns.topHours.slice(0, 3);
    const hoursStr = hours.map(formatHour).join(', ');
    suggestions.push({
      name: 'Peak Hour Posts',
      description: `Auto-post during your highest engagement windows: ${hoursStr} UTC.`,
      schedule: `daily ${hours[0]}:00`,
      postsPerRun: 1,
      topics: [],
      formats: [],
      reason: `Your tweets get ${Math.round(engagementPatterns.avgLikes * 1.5)}+ avg likes during these hours — ${Math.round(engagementPatterns.avgLikes * 0.5)} more than off-peak.`,
    });
  }

  // 2. Hot Take Blitz — if hot_take or short_punch is a top format
  const aggressiveFormats = engagementPatterns.topFormats.filter(
    (f) => f === 'hot_take' || f === 'short_punch'
  );
  if (aggressiveFormats.length > 0) {
    suggestions.push({
      name: 'Hot Take Blitz',
      description: `Fire off ${aggressiveFormats.join(' + ')} format tweets — your highest-performing style.`,
      schedule: 'every 6h',
      postsPerRun: 2,
      topics: [],
      formats: aggressiveFormats,
      reason: `${aggressiveFormats.join(', ')} tweets outperform your other formats. Lean into what works.`,
    });
  }

  // 3. Quote Tweet Reactor — always useful for engagement
  suggestions.push({
    name: 'Quote Tweet Reactor',
    description: 'React to trending posts from accounts you follow with contrarian takes.',
    schedule: 'every 4h',
    postsPerRun: 1,
    topics: engagementPatterns.topTopics.slice(0, 2),
    formats: ['qt_contrarian', 'qt_reframe'],
    reason: 'Quote tweets get 2-3x more reach than originals. Piggyback off trending conversations.',
  });

  // 4. Topic Deep Dive — for the #1 top topic
  if (engagementPatterns.topTopics.length > 0) {
    const topTopic = engagementPatterns.topTopics[0];
    suggestions.push({
      name: `${topTopic} Alpha`,
      description: `Focused ${topTopic} content — your audience's #1 topic.`,
      schedule: '3x/day',
      postsPerRun: 1,
      topics: [topTopic],
      formats: engagementPatterns.topFormats.slice(0, 2),
      reason: `${topTopic} is your best-performing topic. ${followingProfile.categories[0]?.count || 'Most'} of the accounts you follow are in this space.`,
    });
  }

  // 5. Morning/Evening Routine — based on peak hours spread
  if (engagementPatterns.topHours.length >= 2) {
    const sorted = [...engagementPatterns.topHours].sort((a, b) => a - b);
    const morning = sorted.find((h) => h < 12);
    const evening = sorted.find((h) => h >= 17);
    if (morning !== undefined && evening !== undefined) {
      suggestions.push({
        name: 'AM/PM Cadence',
        description: `Morning post at ${formatHour(morning)} + evening post at ${formatHour(evening)} UTC — bracket the day.`,
        schedule: `daily ${morning}:00,${evening}:00`,
        postsPerRun: 1,
        topics: [],
        formats: [],
        reason: `You have engagement peaks in both AM and PM. Consistent presence compounds follower growth.`,
      });
    }
  }

  return suggestions;
}
