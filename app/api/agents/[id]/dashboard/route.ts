import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import {
  buildAgentDetail,
  getAgentLearningSnapshot,
  getAgentQueueFeed,
  getAgentSummariesForUser,
  getAgentTopics,
  getProtocolSnapshot,
} from '@/lib/dashboard-data';
import { getAnalysis, getMetricsArray } from '@/lib/kv-storage';

const VALID_SECTIONS = new Set([
  'agent',
  'otherAgents',
  'protocol',
  'metrics',
  'queue',
  'learning',
  'analysis',
  'topics',
] as const);

type DashboardSection =
  | 'agent'
  | 'otherAgents'
  | 'protocol'
  | 'metrics'
  | 'queue'
  | 'learning'
  | 'analysis'
  | 'topics';

function parseSections(searchParams: URLSearchParams): DashboardSection[] {
  const raw = searchParams.get('sections');
  if (!raw) return ['agent'];

  return raw
    .split(',')
    .map((section) => section.trim())
    .filter((section): section is DashboardSection => VALID_SECTIONS.has(section as DashboardSection));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user, agent } = await requireAgentAccess(id);
    const sections = parseSections(request.nextUrl.searchParams);

    const response: Record<string, unknown> = {};
    const tasks = sections.map(async (section) => {
      switch (section) {
        case 'agent':
          response.agent = await buildAgentDetail(agent);
          return;
        case 'otherAgents':
          response.otherAgents = (await getAgentSummariesForUser(user)).filter((candidate) => candidate.id !== agent.id);
          return;
        case 'protocol':
          response.protocol = await getProtocolSnapshot(user, agent.id);
          return;
        case 'metrics':
          response.metrics = await getMetricsArray(agent.id);
          return;
        case 'queue':
          response.queue = await getAgentQueueFeed(agent.id);
          return;
        case 'learning':
          response.learning = await getAgentLearningSnapshot(agent);
          return;
        case 'analysis':
          response.analysis = await getAnalysis(agent.id);
          return;
        case 'topics':
          response.topics = await getAgentTopics(agent);
          return;
      }
    });

    await Promise.all(tasks);
    return NextResponse.json(response);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 });
  }
}
