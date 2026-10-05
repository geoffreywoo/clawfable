import {it,expect} from 'vitest';
import {uniqueAntiHunterPerformance} from '../lib/antihunter-public-performance';
import type {TweetPerformance} from '../lib/types';
it('ranks distinct posts using latest observation rather than largest stale snapshot',()=>{
 const rows=[{xTweetId:'1',checkedAt:'2026-10-01T00:00:00Z',likes:9},{xTweetId:'1',checkedAt:'2026-10-02T00:00:00Z',likes:3},{xTweetId:'2',checkedAt:'2026-10-01T00:00:00Z',likes:7},{xTweetId:'',tweetId:'local',checkedAt:'2026-10-01T00:00:00Z',likes:2},{xTweetId:'',tweetId:'',checkedAt:'2026-10-01T00:00:00Z',likes:99}] as TweetPerformance[];
 const result=uniqueAntiHunterPerformance(rows);expect(result).toHaveLength(3);expect(result[0].likes).toBe(3);expect(rows).toHaveLength(5);
});
