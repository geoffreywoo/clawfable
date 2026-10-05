import type { TweetPerformance } from './types';
// Metric history contains repeated observations, not distinct posts. Keep latest
// verified observation before ranking; never pick a stale high-water mark.
export function uniqueAntiHunterPerformance(rows: TweetPerformance[]): TweetPerformance[] {
 const posts = new Map<string,TweetPerformance>();
 for(const row of rows){const id=row.xTweetId||row.tweetId;if(!id)continue;const prev=posts.get(id);if(!prev || Date.parse(row.checkedAt)>Date.parse(prev.checkedAt))posts.set(id,row);}
 return [...posts.values()];
}
