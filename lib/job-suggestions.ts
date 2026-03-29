import type { AccountAnalysis, JobSuggestion, TweetJob } from './types';

function formatHour(h: number): string {
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
}

/**
 * Generate job suggestions based on account analysis.
 * Filters out suggestions that match already-active jobs.
 */
export function generateJobSuggestions(analysis: AccountAnalysis, activeJobs: TweetJob[] = []): JobSuggestion[] {
  const { engagementPatterns, followingProfile } = analysis;
  const suggestions: JobSuggestion[] = [];

  // Names of active jobs — used to skip redundant suggestions
  const activeNames = new Set(activeJobs.map((j) => j.name.toLowerCase()));

  // 1. Peak Hour Posts
  if (engagementPatterns.topHours.length > 0 && !activeNames.has('peak hour posts')) {
    const hours = engagementPatterns.topHours.slice(0, 3);
    const hoursStr = hours.map(formatHour).join(', ');
    suggestions.push({
      name: 'Peak Hour Posts',
      description: `Auto-post during your highest engagement windows: ${hoursStr} UTC.`,
      schedule: `daily ${hours[0]}:00`,
      postsPerRun: 1,
      topics: [],
      formats: [],
      reason: `Your tweets get ${Math.round(engagementPatterns.avgLikes * 1.5)}+ avg likes during these hours.`,
    });
  }

  // 2. Hot Take Blitz
  const aggressiveFormats = engagementPatterns.topFormats.filter(
    (f) => f === 'hot_take' || f === 'short_punch'
  );
  if (aggressiveFormats.length > 0 && !activeNames.has('hot take blitz')) {
    suggestions.push({
      name: 'Hot Take Blitz',
      description: `Fire off ${aggressiveFormats.join(' + ')} format tweets — your highest-performing style.`,
      schedule: 'every 6h',
      postsPerRun: 2,
      topics: [],
      formats: aggressiveFormats,
      reason: `${aggressiveFormats.join(', ')} tweets outperform your other formats.`,
    });
  }

  // 3. Quote Tweet Reactor
  if (!activeNames.has('quote tweet reactor')) {
    suggestions.push({
      name: 'Quote Tweet Reactor',
      description: 'React to trending posts from accounts you follow with sharp takes.',
      schedule: 'every 4h',
      postsPerRun: 1,
      topics: engagementPatterns.topTopics.slice(0, 2),
      formats: ['qt_contrarian', 'qt_reframe'],
      reason: 'Quote tweets get 2-3x more reach than originals.',
    });
  }

  // 4. Topic Deep Dive
  if (engagementPatterns.topTopics.length > 0) {
    const topTopic = engagementPatterns.topTopics[0];
    const jobName = `${topTopic} Alpha`;
    if (!activeNames.has(jobName.toLowerCase())) {
      suggestions.push({
        name: jobName,
        description: `Focused ${topTopic} content — your audience's #1 topic.`,
        schedule: '3x/day',
        postsPerRun: 1,
        topics: [topTopic],
        formats: engagementPatterns.topFormats.slice(0, 2),
        reason: `${topTopic} is your best-performing topic.`,
      });
    }
  }

  // 5. AM/PM Cadence
  if (engagementPatterns.topHours.length >= 2 && !activeNames.has('am/pm cadence')) {
    const sorted = [...engagementPatterns.topHours].sort((a, b) => a - b);
    const morning = sorted.find((h) => h < 12);
    const evening = sorted.find((h) => h >= 17);
    if (morning !== undefined && evening !== undefined) {
      suggestions.push({
        name: 'AM/PM Cadence',
        description: `Morning post at ${formatHour(morning)} + evening post at ${formatHour(evening)} UTC.`,
        schedule: `daily ${morning}:00,${evening}:00`,
        postsPerRun: 1,
        topics: [],
        formats: [],
        reason: 'Engagement peaks in both AM and PM. Consistent presence compounds growth.',
      });
    }
  }

  return suggestions;
}
