import { NextRequest, NextResponse } from 'next/server';
import { handleAuthError, requireAgentAccess } from '@/lib/auth';
import { buildResearchAgenda } from '@/lib/research-pipeline';
import { getResearchFeedUrlIssue } from '@/lib/research-adapters';
import {
  getFeedback,
  getLearnings,
  getPerformanceHistory,
  getResearchAgenda,
  getTweets,
  saveResearchAgenda,
} from '@/lib/kv-storage';
import type { ResearchAgenda, ResearchFeedConfig } from '@/lib/types';

function strings(value: unknown, limit: number, maxLength = 220): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.replace(/\s+/g, ' ').trim().slice(0, maxLength))
    .filter((entry) => entry.length >= 3))].slice(0, limit);
}

function feeds(value: unknown): { feeds: ResearchFeedConfig[]; error: string | null } {
  if (!Array.isArray(value)) return { feeds: [], error: 'rssFeeds must be an array' };
  const parsed: ResearchFeedConfig[] = [];
  for (const entry of value.slice(0, 20)) {
    if (!entry || typeof entry !== 'object') return { feeds: [], error: 'Invalid RSS feed entry' };
    const raw = entry as Record<string, unknown>;
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    const publisher = typeof raw.publisher === 'string' ? raw.publisher.trim().slice(0, 120) : '';
    const sourceType = raw.sourceType === 'official' ? 'official' as const : 'rss_atom' as const;
    const trustTier = sourceType === 'official' ? 'primary' as const : 'trusted' as const;
    const config: ResearchFeedConfig = {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : `feed-${parsed.length + 1}`,
      url,
      publisher,
      trustTier,
      topics: strings(raw.topics, 12, 80) || [],
      sourceType,
    };
    if (!url || !publisher) return { feeds: [], error: 'Each RSS feed requires url and publisher' };
    const issue = getResearchFeedUrlIssue(config);
    if (issue) return { feeds: [], error: `${config.id}: ${issue}` };
    parsed.push(config);
  }
  return { feeds: parsed, error: null };
}

async function currentAgenda(agent: Awaited<ReturnType<typeof requireAgentAccess>>['agent']): Promise<ResearchAgenda> {
  const [current, learnings, performance, feedback, tweets] = await Promise.all([
    getResearchAgenda(agent.id),
    getLearnings(agent.id),
    getPerformanceHistory(agent.id, 250),
    getFeedback(agent.id),
    getTweets(agent.id),
  ]);
  return buildResearchAgenda({ agent, learnings, performance, feedback, tweets, current });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    return NextResponse.json(await currentAgenda(agent));
  } catch (error) {
    try { return handleAuthError(error); } catch {}
    return NextResponse.json({ error: 'Failed to load research agenda' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const updates = body as Record<string, unknown>;
    const agenda = await currentAgenda(agent);
    const operatorTopics = updates.operatorTopics === undefined ? agenda.operatorTopics || [] : strings(updates.operatorTopics, 30);
    const pinnedQuestions = updates.pinnedQuestions === undefined ? agenda.pinnedQuestions : strings(updates.pinnedQuestions, 30);
    const blockedTopics = updates.blockedTopics === undefined ? agenda.blockedTopics : strings(updates.blockedTopics, 40);
    const blockedStoryKeys = updates.blockedStoryKeys === undefined ? agenda.blockedStoryKeys : strings(updates.blockedStoryKeys, 80);
    const githubRepositories = updates.githubRepositories === undefined
      ? agenda.githubRepositories
      : strings(updates.githubRepositories, 20, 120)?.map((repository) => repository
          .replace(/^https?:\/\/github\.com\//i, '')
          .replace(/\/$/, '')) || null;
    if (!operatorTopics || !pinnedQuestions || !blockedTopics || !blockedStoryKeys || !githubRepositories) {
      return NextResponse.json({ error: 'Agenda list fields must be arrays of strings' }, { status: 400 });
    }
    if (githubRepositories.some((repository) => !/^[\w.-]+\/[\w.-]+$/.test(repository))) {
      return NextResponse.json({ error: 'GitHub repositories must use owner/repository format' }, { status: 400 });
    }
    let rssFeeds = agenda.rssFeeds;
    if (updates.rssFeeds !== undefined) {
      const parsedFeeds = feeds(updates.rssFeeds);
      if (parsedFeeds.error) return NextResponse.json({ error: parsedFeeds.error }, { status: 400 });
      rssFeeds = parsedFeeds.feeds;
    }
    const [learnings, performance, feedback, tweets] = await Promise.all([
      getLearnings(id),
      getPerformanceHistory(id, 250),
      getFeedback(id),
      getTweets(id),
    ]);
    const updated = buildResearchAgenda({
      agent,
      learnings,
      performance,
      feedback,
      tweets,
      current: {
        ...agenda,
        operatorTopics,
        pinnedQuestions,
        blockedTopics,
        blockedStoryKeys,
        rssFeeds,
        githubRepositories,
      },
    });
    await saveResearchAgenda(id, updated);
    return NextResponse.json(updated);
  } catch (error) {
    try { return handleAuthError(error); } catch {}
    return NextResponse.json({ error: 'Failed to update research agenda' }, { status: 500 });
  }
}
