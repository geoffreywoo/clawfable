'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  LearningBucket,
  LearningEventEntry,
  LearningExperimentLane,
  LearningNarrativeItem,
  LearningScoreboardCard,
  LearningSnapshot,
  LearningStatusState,
  LearningWeekPoint,
} from '@/lib/learning-snapshot';

interface LearningTabProps {
  agentId: string;
}

type LearningTone = 'positive' | 'neutral' | 'warning' | 'danger';

function getTimeAgo(ts: string): string {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toneClass(tone: LearningTone): string {
  return `learning-tone-${tone}`;
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ').toUpperCase();
}

function formatMetricValue(card: LearningScoreboardCard): string {
  const rounded = Math.round(card.currentValue);

  if (card.id === 'engagement_lift') {
    return `${rounded >= 0 ? '+' : ''}${rounded}%`;
  }

  if (card.unit === 'percent') {
    return `${rounded}%`;
  }

  return String(rounded);
}

function formatMetricDelta(card: LearningScoreboardCard): string {
  const rounded = Math.round(card.delta);
  if (card.unit === 'count') {
    return `${rounded >= 0 ? '+' : ''}${rounded}`;
  }
  return `${rounded >= 0 ? '+' : ''}${rounded} pts`;
}

function formatCompactDelta(delta: number): string {
  const rounded = Math.round(delta);
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'N/A';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function stateMeta(state: LearningStatusState): { label: string; tone: LearningTone } {
  switch (state) {
    case 'improving':
      return { label: 'Improving', tone: 'positive' };
    case 'stable':
      return { label: 'Stable', tone: 'neutral' };
    case 'regressing':
      return { label: 'Regressing', tone: 'danger' };
    case 'under_test':
      return { label: 'Under test', tone: 'warning' };
    case 'low_confidence':
      return { label: 'Low confidence', tone: 'warning' };
    case 'waiting':
    default:
      return { label: 'Waiting for outcome', tone: 'neutral' };
  }
}

function bucketLabel(bucketId: LearningBucket['id']): string {
  switch (bucketId) {
    case 'always':
      return 'Do more of this';
    case 'never':
      return 'Avoid this';
    case 'momentum':
      return 'Topics with momentum';
    case 'identity':
      return 'Identity guardrails';
    default:
      return 'Current lessons';
  }
}

function formatPlannerLane(lane: string): string {
  return lane.replace(/_/g, ' ');
}

function buildSparklinePoints(values: number[]): string {
  if (values.length === 0) return '';

  const width = 100;
  const height = 28;
  const padding = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = padding + ((width - (padding * 2)) * index) / Math.max(values.length - 1, 1);
      const y = height - padding - (((value - min) / range) * (height - (padding * 2)));
      return `${x},${y}`;
    })
    .join(' ');
}

function Sparkline({ values, tone }: { values: number[]; tone: LearningTone }) {
  return (
    <svg className={`learning-sparkline ${toneClass(tone)}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline className="learning-sparkline-line" points={buildSparklinePoints(values)} />
    </svg>
  );
}

function ScoreboardCard({ card }: { card: LearningScoreboardCard }) {
  return (
    <article className={`learning-score-card ${toneClass(card.tone)}`}>
      <div className="learning-score-card-head">
        <span className="learning-score-card-label">{card.label}</span>
        <span className={`learning-state-chip ${toneClass(card.tone)}`}>{card.tone === 'positive' ? 'Improving' : card.tone === 'danger' ? 'Regressing' : 'Stable'}</span>
      </div>
      <div className="learning-score-card-value">{formatMetricValue(card)}</div>
      <div className="learning-score-card-delta">{formatMetricDelta(card)} vs last week</div>
      <p className="learning-score-card-copy">{card.interpretation}</p>
      <Sparkline values={card.series} tone={card.tone} />
    </article>
  );
}

function EvidenceDrawer({ evidence }: { evidence: string[] }) {
  if (evidence.length === 0) return null;

  return (
    <details className="learning-evidence-drawer">
      <summary>Show more evidence</summary>
      <ul className="learning-evidence-list">
        {evidence.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function NarrativePanel({
  title,
  subtitle,
  items,
  emptyCopy,
}: {
  title: string;
  subtitle: string;
  items: LearningNarrativeItem[];
  emptyCopy: string;
}) {
  return (
    <section className="learning-story-panel">
      <div className="learning-story-head">
        <div>
          <p className="learning-story-kicker">{title}</p>
          <h3 className="learning-story-title">{subtitle}</h3>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="learning-story-empty">{emptyCopy}</p>
      ) : (
        <div className="learning-story-list">
          {items.map((item) => {
            const state = stateMeta(item.state);
            return (
              <article key={item.id} className={`learning-story-item ${toneClass(item.tone)}`}>
                <div className="learning-story-item-head">
                  <p className="learning-story-item-title">{item.title}</p>
                  <span className={`learning-state-chip ${toneClass(state.tone)}`}>{state.label}</span>
                </div>
                <p className="learning-story-item-summary">{item.summary}</p>
                <div className="learning-story-item-meta">
                  <span className={`learning-impact-chip ${toneClass(item.tone)}`}>Impact {Math.round(item.impact)}</span>
                </div>
                <EvidenceDrawer evidence={item.evidence} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LessonBucket({ bucket }: { bucket: LearningBucket }) {
  return (
    <section className={`learning-bucket learning-bucket-modern ${toneClass(bucket.tone)}`}>
      <div className="learning-bucket-header">
        <div>
          <p className="learning-bucket-title">{bucketLabel(bucket.id)}</p>
          <p className="learning-bucket-subtitle">{bucket.subtitle}</p>
        </div>
        <span className="learning-bucket-count">{bucket.items.length}</span>
      </div>
      <div className="learning-bucket-explainer">
        <p className="learning-bucket-how">{bucket.howToRead}</p>
      </div>
      <div className="learning-bucket-items">
        {bucket.items.map((item) => (
          <article key={item.id} className="learning-memory-item">
            <div className="learning-memory-line">
              <div className="learning-memory-copy">
                <p className="learning-memory-kicker">Observed pattern</p>
                <p className="learning-memory-label">{item.label}</p>
              </div>
              <span className={`learning-confidence-pill ${toneClass(item.tone)}`}>{item.confidence}%</span>
            </div>
            <div className="learning-memory-takeaway">
              <p className="learning-memory-kicker">System takeaway</p>
              <p className="learning-memory-lesson">{item.lesson}</p>
            </div>
            <div className="learning-memory-impact-block">
              <p className="learning-memory-kicker">What changes now</p>
              <p className="learning-memory-impact">{item.impact}</p>
            </div>
            <div className="learning-memory-meta">
              <span className={`learning-source-chip ${toneClass(item.tone)}`}>{sourceLabel(item.source)}</span>
              {item.note && <span className="learning-memory-note">{item.note}</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ArmEvidence({
  label,
  arm,
  tone,
}: {
  label: string;
  arm: LearningExperimentLane['exploit'] | LearningExperimentLane['explore'] | LearningExperimentLane['caution'];
  tone: LearningTone;
}) {
  if (!arm) return null;

  return (
    <div className={`experiment-card ${toneClass(tone)}`}>
      <div className="experiment-card-top">
        <span className="experiment-card-label">{label}</span>
        <span className="experiment-arm-name">{arm.arm.replace(/_/g, ' ')}</span>
      </div>
      <div className="experiment-metrics">
        <span>{Math.round(arm.meanReward * 100)}% reward</span>
        <span>{Math.round(arm.pulls)} pulls</span>
      </div>
      <div className="experiment-metrics">
        <span>{Math.round(arm.uncertainty * 100)}% uncertainty</span>
        <span>{Math.round(arm.localShare * 100)}% local</span>
      </div>
    </div>
  );
}

function ExperimentLaneCard({ lane }: { lane: LearningExperimentLane }) {
  const laneState = lane.confidence >= 68 ? stateMeta('stable') : stateMeta('under_test');

  return (
    <article className="experiment-lane experiment-lane-modern">
      <div className="experiment-lane-headline">
        <div>
          <p className="experiment-lane-title">{lane.title}</p>
          <p className="experiment-lane-copy">{lane.provenance}</p>
        </div>
        <div className="experiment-lane-status">
          <span className={`learning-state-chip ${toneClass(laneState.tone)}`}>{laneState.label}</span>
          <span className="experiment-confidence">{lane.confidence}% confidence</span>
        </div>
      </div>

      <div className="experiment-summary-grid-modern">
        <div className="experiment-summary-cell">
          <span className="experiment-summary-label">Current winner</span>
          <strong>{lane.exploit ? lane.exploit.arm.replace(/_/g, ' ') : 'No clear winner yet'}</strong>
        </div>
        <div className="experiment-summary-cell">
          <span className="experiment-summary-label">Challenger</span>
          <strong>{lane.explore ? lane.explore.arm.replace(/_/g, ' ') : 'No challenger yet'}</strong>
        </div>
      </div>

      <div className="experiment-hypothesis-card">
        <p className="experiment-hypothesis-label">What the system is testing</p>
        <p className="experiment-hypothesis-copy">{lane.hypothesis}</p>
        <p className="experiment-hypothesis-next">{lane.nextCheck}</p>
      </div>

      {lane.underTest.length > 0 && (
        <div className="experiment-under-test">
          <div className="experiment-under-label">Under test</div>
          <div className="experiment-chip-row">
            {lane.underTest.map((arm) => (
              <span key={`${lane.id}-${arm.arm}`} className="experiment-chip">
                {arm.arm.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      <details className="learning-evidence-drawer experiment-evidence-drawer">
        <summary>Show arm metrics</summary>
        <div className="experiment-stack">
          <ArmEvidence label="Winner" arm={lane.exploit} tone="positive" />
          <ArmEvidence label="Challenger" arm={lane.explore} tone="warning" />
          <ArmEvidence label="Caution" arm={lane.caution} tone="danger" />
        </div>
      </details>
    </article>
  );
}

function EventRow({ event }: { event: LearningEventEntry }) {
  return (
    <article className={`learning-event learning-event-compact ${toneClass(event.tone)}`}>
      <div className="learning-event-head">
        <div>
          <p className="learning-event-title">{event.title}</p>
          <p className="learning-event-summary">{event.summary}</p>
        </div>
        <div className="learning-event-topline">
          <span className="learning-event-time">{getTimeAgo(event.createdAt)}</span>
          <span className="learning-event-reward">{event.rewardDelta >= 0 ? '+' : ''}{event.rewardDelta.toFixed(2)}</span>
        </div>
      </div>
      <div className="learning-event-meta">
        <span className="learning-source-chip">{sourceLabel(event.source)}</span>
        <span className="learning-source-chip">{sourceLabel(event.surface)}</span>
      </div>
      <p className="learning-event-learned">{event.learned}</p>
    </article>
  );
}

function TrendMetricCard({
  label,
  value,
  sublabel,
  series,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  series: number[];
  tone: LearningTone;
}) {
  return (
    <article className={`learning-performance-card ${toneClass(tone)}`}>
      <div className="learning-performance-label">{label}</div>
      <div className="learning-performance-value">{value}</div>
      <p className="learning-performance-sub">{sublabel}</p>
      <Sparkline values={series} tone={tone} />
    </article>
  );
}

function FunnelStage({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const width = max > 0 ? Math.max(8, Math.round((value / max) * 100)) : 0;

  return (
    <div className="learning-funnel-row">
      <div className="learning-funnel-head">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="learning-funnel-track">
        <div className="learning-funnel-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function LearningTab({ agentId }: LearningTabProps) {
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingExampleId, setPendingExampleId] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/dashboard?sections=learning`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error('Failed to load learning snapshot');
    setSnapshot(data.learning ?? null);
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;

    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void loadSnapshot().catch(() => {
        if (!cancelled) setSnapshot(null);
      });
    };

    void loadSnapshot()
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    const interval = window.setInterval(refreshIfVisible, 30000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadSnapshot]);

  const updateManualExample = useCallback(async (
    xTweetId: string,
    action: 'pin' | 'unpin' | 'block' | 'unblock',
  ) => {
    setPendingExampleId(xTweetId);
    try {
      const body = action === 'pin'
        ? { pin: [xTweetId] }
        : action === 'unpin'
          ? { unpin: [xTweetId] }
          : action === 'block'
            ? { block: [xTweetId] }
            : { unblock: [xTweetId] };

      const res = await fetch(`/api/agents/${agentId}/learning/manual-examples`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update manual example curation');
      await loadSnapshot();
    } catch {
      // Keep the existing snapshot if the update fails.
    } finally {
      setPendingExampleId(null);
    }
  }, [agentId, loadSnapshot]);

  const groupedEvents = useMemo(() => {
    const groups = {
      approvals: [] as LearningEventEntry[],
      misses: [] as LearningEventEntry[],
      performance: [] as LearningEventEntry[],
      policy: [] as LearningEventEntry[],
    };

    if (!snapshot) return groups;

    for (const event of snapshot.recentEvents) {
      groups[event.group].push(event);
    }

    return groups;
  }, [snapshot]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: i === 1 ? '148px' : '110px', borderRadius: '16px' }} />
        ))}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="learning-empty">
        <div className="learning-digest-header">
          <h2>Learning</h2>
        </div>
        <p className="learning-progress-label">
          No learning snapshot yet. Approve, edit, copy, or delete a few drafts and this room will start showing what changed.
        </p>
        <p className="learning-progress-hint">
          The learning view turns operator actions and live performance into a readable scoreboard, active lessons, and experiment traces.
        </p>
      </div>
    );
  }

  const currentWeek = snapshot.weeklySeries[snapshot.weeklySeries.length - 1];
  const previousWeek = snapshot.weeklySeries[snapshot.weeklySeries.length - 2] || currentWeek;
  const scoreboardState = stateMeta(snapshot.scoreboard.state);
  const funnelMax = Math.max(
    snapshot.funnel.generated,
    snapshot.funnel.approved,
    snapshot.funnel.posted,
    snapshot.funnel.keptLive,
    snapshot.funnel.outperformedBaseline,
    1,
  );

  return (
    <div className="learning-surface">
      <section className="learning-scoreboard-shell">
        <div className="learning-scoreboard">
          <div className="learning-scoreboard-top">
            <div>
              <p className="learning-hero-label">Learning scoreboard</p>
              <h2 className="learning-scoreboard-title">Is this agent getting better?</h2>
              <p className="learning-scoreboard-copy">
                This view defaults to this week vs last week, then lets you drill into what changed, what is under test, and which lessons are actively shaping drafts.
              </p>
            </div>
            <div className="learning-scoreboard-meta">
              <span className={`learning-state-chip ${toneClass(scoreboardState.tone)}`}>{scoreboardState.label}</span>
              <span className="learning-source-chip">THIS WEEK VS LAST WEEK</span>
              <span className="learning-source-chip">MODE {snapshot.overview.autonomyMode.toUpperCase()}</span>
              {snapshot.overview.trainingSource && (
                <span className="learning-source-chip">TRAINING {sourceLabel(snapshot.overview.trainingSource)}</span>
              )}
            </div>
          </div>

          <div className={`learning-status-banner ${toneClass(scoreboardState.tone)}`}>
            <div>
              <p className="learning-status-banner-label">{snapshot.scoreboard.headline}</p>
              <p className="learning-status-banner-copy">{snapshot.scoreboard.explanation}</p>
            </div>
          </div>

          <div className="learning-scoreboard-grid">
            {snapshot.scoreboard.cards.map((card) => (
              <ScoreboardCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="section-header">
          <div className="section-title">
            <h2>What changed</h2>
            <span className="section-count">plain-language explanations backed by real weekly movement</span>
          </div>
        </div>
        <div className="learning-story-grid">
          <NarrativePanel
            title="What improved"
            subtitle="Where the learning loop got stronger"
            items={snapshot.topImprovements}
            emptyCopy="No meaningful positive movement stood out yet this week."
          />
          <NarrativePanel
            title="What got worse"
            subtitle="Where quality is slipping"
            items={snapshot.topRegressions}
            emptyCopy="No meaningful regression stood out yet this week."
          />
          <NarrativePanel
            title="What the system changed because of that"
            subtitle="How the chooser and memory adapted"
            items={snapshot.policyChanges}
            emptyCopy="No policy shift is large enough to call out yet."
          />
        </div>
      </section>

      <section>
        <div className="section-header">
          <div className="section-title">
            <h2>Current lessons</h2>
            <span className="section-count">what the system believes right now, in operator language</span>
          </div>
        </div>
        <div className="learning-section-copy">
          These are the active lessons shaping draft generation and ranking. They are not raw notes. Each one shows the observed pattern, the system takeaway, and the behavior that changes now.
        </div>
        <div className="learning-buckets-grid learning-buckets-grid-modern">
          {snapshot.beliefState.map((bucket) => (
            <LessonBucket key={bucket.id} bucket={bucket} />
          ))}
        </div>
      </section>

      <section>
        <div className="section-header">
          <div className="section-title">
            <h2>Source planner</h2>
            <span className="section-count">how the next batch balances manual voice against network trends</span>
          </div>
        </div>
        <div className="learning-section-copy">
          This planner sets the next batch mix before candidate generation. It decides how many slots should exploit proven manual voice, how many should ride aligned trends, and how many should be controlled exploration bets.
        </div>

        <div className="learning-story-grid">
          <section className="learning-story-panel">
            <div className="learning-story-head">
              <div>
                <p className="learning-story-kicker">Next batch mix</p>
                <h3 className="learning-story-title">
                  Trend target {snapshot.planner.trendMixTarget}% · tolerance {snapshot.planner.trendTolerance}
                </h3>
              </div>
            </div>
            <div className="learning-story-list">
              {snapshot.planner.nextBatchMix.map((lane) => (
                <article key={lane.lane} className="learning-story-item">
                  <div className="learning-story-item-head">
                    <p className="learning-story-item-title">{formatPlannerLane(lane.lane)}</p>
                    <span className="learning-source-chip">{lane.plannedSlots} planned</span>
                  </div>
                  <p className="learning-story-item-summary">
                    {lane.posts > 0
                      ? `${lane.posts} shipped posts, avg ${lane.avgEngagement} engagement, ${lane.wins} wins.`
                      : 'No shipped evidence yet for this lane.'}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="learning-story-panel">
            <div className="learning-story-head">
              <div>
                <p className="learning-story-kicker">Accepted trends</p>
                <h3 className="learning-story-title">Hot topics the planner will allow into the queue</h3>
              </div>
            </div>
            {snapshot.planner.acceptedTrends.length === 0 ? (
              <p className="learning-story-empty">No current trend candidate passed the planner filters.</p>
            ) : (
              <div className="learning-story-list">
                {snapshot.planner.acceptedTrends.map((trend) => (
                  <article key={trend.id} className="learning-story-item">
                    <div className="learning-story-item-head">
                      <p className="learning-story-item-title">{trend.category}</p>
                      <span className="learning-source-chip">{trend.lane} · {trend.fit}%</span>
                    </div>
                    <p className="learning-story-item-summary">{trend.headline}</p>
                    <div className="learning-story-item-meta">
                      <span className="learning-impact-chip learning-tone-positive">{trend.reason}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="learning-story-panel">
            <div className="learning-story-head">
              <div>
                <p className="learning-story-kicker">Rejected trends</p>
                <h3 className="learning-story-title">Topics the planner explicitly kept out</h3>
              </div>
            </div>
            {snapshot.planner.rejectedTrends.length === 0 ? (
              <p className="learning-story-empty">No obvious off-brand trends were rejected in the current window.</p>
            ) : (
              <div className="learning-story-list">
                {snapshot.planner.rejectedTrends.map((trend) => (
                  <article key={trend.id} className="learning-story-item">
                    <div className="learning-story-item-head">
                      <p className="learning-story-item-title">{trend.category}</p>
                      <span className="learning-source-chip">{trend.fit}% fit</span>
                    </div>
                    <p className="learning-story-item-summary">{trend.headline}</p>
                    <div className="learning-story-item-meta">
                      <span className="learning-impact-chip learning-tone-warning">{trend.reason}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <section>
        <div className="section-header">
          <div className="section-title">
            <h2>Manual exemplar curation</h2>
            <span className="section-count">pin the human-written winners you want the planner to trust most</span>
          </div>
        </div>
        <div className="learning-section-copy">
          Auto-pick works by default. Use pin when a tweet is a canonical example of your voice or topic judgment. Use block when a tweet performed well but should not steer future generations.
        </div>

        <div className="learning-story-grid">
          <section className="learning-story-panel">
            <div className="learning-story-head">
              <div>
                <p className="learning-story-kicker">Manual topic priors</p>
                <h3 className="learning-story-title">What the planner learned from human-written winners</h3>
              </div>
            </div>
            {snapshot.planner.manualExamples.topicClusters.length === 0 ? (
              <p className="learning-story-empty">No stable manual topic clusters yet.</p>
            ) : (
              <div className="learning-story-list">
                {snapshot.planner.manualExamples.topicClusters.map((cluster) => (
                  <article key={`${cluster.topic}-${cluster.angle}`} className="learning-story-item">
                    <div className="learning-story-item-head">
                      <p className="learning-story-item-title">{cluster.topic}</p>
                      <span className="learning-source-chip">{cluster.sampleCount} examples</span>
                    </div>
                    <p className="learning-story-item-summary">{cluster.angle}</p>
                    <div className="learning-story-item-meta">
                      <span className="learning-impact-chip learning-tone-neutral">avg {cluster.avgEngagement} engagement</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="learning-story-panel">
            <div className="learning-story-head">
              <div>
                <p className="learning-story-kicker">Curate examples</p>
                <h3 className="learning-story-title">
                  {snapshot.planner.manualExamples.pinnedCount} pinned · {snapshot.planner.manualExamples.blockedCount} blocked
                </h3>
              </div>
            </div>
            {snapshot.planner.manualExamples.examples.length === 0 ? (
              <p className="learning-story-empty">No manual examples available to curate yet.</p>
            ) : (
              <div className="learning-story-list">
                {snapshot.planner.manualExamples.examples.map((example) => (
                  <article key={example.xTweetId} className="learning-story-item">
                    <div className="learning-story-item-head">
                      <p className="learning-story-item-title">{example.likes} likes</p>
                      <div className="learning-story-item-meta">
                        {example.pinned && <span className="learning-source-chip">PINNED</span>}
                        {example.blocked && <span className="learning-source-chip">BLOCKED</span>}
                      </div>
                    </div>
                    <p className="learning-story-item-summary">{example.content}</p>
                    <div className="learning-story-item-meta" style={{ gap: '8px' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={pendingExampleId === example.xTweetId}
                        onClick={() => updateManualExample(example.xTweetId, example.pinned ? 'unpin' : 'pin')}
                      >
                        {example.pinned ? 'Unpin' : 'Pin'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={pendingExampleId === example.xTweetId}
                        onClick={() => updateManualExample(example.xTweetId, example.blocked ? 'unblock' : 'block')}
                      >
                        {example.blocked ? 'Unblock' : 'Block'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      <section>
        <div className="section-header">
          <div className="section-title">
            <h2>Active experiments</h2>
            <span className="section-count">which feature bets are still competing for policy weight</span>
          </div>
        </div>
        <div className="learning-section-copy">
          Each lane shows the current winner, the challenger, what the system is testing, and what result would be strong enough to change the winner.
        </div>
        {snapshot.experiments.summary.length > 0 && (
          <div className="experiment-summary-row">
            {snapshot.experiments.summary.map((summary) => (
              <span key={summary} className="experiment-summary-chip">{summary}</span>
            ))}
          </div>
        )}
        <div className="experiment-grid experiment-grid-modern">
          {snapshot.experiments.lanes.map((lane) => (
            <ExperimentLaneCard key={lane.id} lane={lane} />
          ))}
        </div>
      </section>

      <section className="learning-performance-panel">
        <div className="section-header">
          <div className="section-title">
            <h2>Performance of learning</h2>
            <span className="section-count">is the learning loop actually producing better behavior</span>
          </div>
        </div>
        <div className="learning-section-copy">
          This is the clearest read on whether Clawfable is learning something useful or just producing more activity.
        </div>

        <div className="learning-performance-grid">
          <TrendMetricCard
            label="Approval rate trend"
            value={`${currentWeek.approvalRate}%`}
            sublabel={`${formatCompactDelta(currentWeek.approvalRate - previousWeek.approvalRate)} pts vs last week`}
            series={snapshot.weeklySeries.map((point) => point.approvalRate)}
            tone={currentWeek.approvalRate >= previousWeek.approvalRate ? 'positive' : 'warning'}
          />
          <TrendMetricCard
            label="Avg edits per approved draft"
            value={currentWeek.editBurden > 0 ? currentWeek.editBurden.toFixed(1) : '0.0'}
            sublabel="Lower is better"
            series={snapshot.weeklySeries.map((point) => point.editBurden)}
            tone={currentWeek.editBurden <= previousWeek.editBurden ? 'positive' : 'warning'}
          />
          <TrendMetricCard
            label="Median time to approval"
            value={formatDuration(currentWeek.medianTimeToApproval)}
            sublabel="Lower means the drafts feel more ready"
            series={snapshot.weeklySeries.map((point) => point.medianTimeToApproval)}
            tone={currentWeek.medianTimeToApproval <= previousWeek.medianTimeToApproval ? 'positive' : 'warning'}
          />
          <TrendMetricCard
            label="Delete-from-X trend"
            value={String(currentWeek.deleteFromX)}
            sublabel="Live posts later removed from X"
            series={snapshot.weeklySeries.map((point) => point.deleteFromX)}
            tone={currentWeek.deleteFromX <= previousWeek.deleteFromX ? 'positive' : 'danger'}
          />
          <TrendMetricCard
            label="Engagement lift vs baseline"
            value={`${currentWeek.engagementLift >= 0 ? '+' : ''}${currentWeek.engagementLift}%`}
            sublabel="Relative to this account's own baseline"
            series={snapshot.weeklySeries.map((point) => point.engagementLift)}
            tone={currentWeek.engagementLift >= previousWeek.engagementLift ? 'positive' : 'warning'}
          />
          <TrendMetricCard
            label="Confidence calibration quality"
            value={`${snapshot.calibration.currentWeek}%`}
            sublabel={snapshot.calibration.interpretation}
            series={snapshot.weeklySeries.map((point) => point.calibration)}
            tone={snapshot.calibration.delta >= 0 ? 'positive' : 'warning'}
          />
        </div>

        <div className="learning-funnel-card">
          <div className="learning-funnel-headline">
            <div>
              <p className="learning-story-kicker">Learning funnel</p>
              <h3 className="learning-story-title">From generated draft to baseline-beating post</h3>
            </div>
            <span className="learning-source-chip">4 WEEK WINDOW</span>
          </div>
          <div className="learning-funnel-grid">
            <FunnelStage label="Generated" value={snapshot.funnel.generated} max={funnelMax} />
            <FunnelStage label="Approved" value={snapshot.funnel.approved} max={funnelMax} />
            <FunnelStage label="Posted" value={snapshot.funnel.posted} max={funnelMax} />
            <FunnelStage label="Kept live" value={snapshot.funnel.keptLive} max={funnelMax} />
            <FunnelStage label="Outperformed baseline" value={snapshot.funnel.outperformedBaseline} max={funnelMax} />
          </div>
        </div>
      </section>

      <section>
        <div className="section-header">
          <div className="section-title">
            <h2>Recent learning events</h2>
            <span className="section-count">grouped by the kind of evidence the system just received</span>
          </div>
        </div>
        <div className="learning-events-grid">
          {[
            { key: 'approvals', title: 'Approvals and edits', events: groupedEvents.approvals },
            { key: 'misses', title: 'Deletes and misses', events: groupedEvents.misses },
            { key: 'performance', title: 'Post-performance updates', events: groupedEvents.performance },
            { key: 'policy', title: 'System rule changes', events: groupedEvents.policy },
          ].map((group) => (
            <section key={group.key} className="learning-event-group">
              <div className="learning-event-group-head">
                <p className="learning-story-kicker">{group.title}</p>
                <span className="learning-source-chip">{group.events.length}</span>
              </div>
              {group.events.length === 0 ? (
                <p className="learning-story-empty">No recent events in this lane.</p>
              ) : (
                <div className="learning-event-log">
                  {group.events.slice(0, 4).map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
