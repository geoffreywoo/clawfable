'use client';

import { useEffect, useState } from 'react';
import type { LearningSnapshot, LearningEventEntry, LearningBucket, LearningExperimentLane } from '@/lib/learning-snapshot';

interface LearningTabProps {
  agentId: string;
}

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

function deltaLabel(current: number, previous: number): string {
  const delta = current - previous;
  return `${delta >= 0 ? '+' : ''}${delta} pts`;
}

function toneClass(tone: 'positive' | 'neutral' | 'warning' | 'danger'): string {
  return `learning-tone-${tone}`;
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ').toUpperCase();
}

function bucketEffectLabel(bucketId: LearningBucket['id']): string {
  switch (bucketId) {
    case 'always':
      return 'Used as a positive prior in drafting and ranking';
    case 'never':
      return 'Applied as a negative prior and ranking penalty';
    case 'momentum':
      return 'Biases more surface area toward rising topics';
    case 'under-tested':
      return 'Keeps exploration open until confidence improves';
    case 'preferences':
      return 'Quietly nudges future wording and structure';
    case 'identity':
      return 'Acts like a durable boundary during generation';
    default:
      return 'Feeds the learning loop';
  }
}

function OverviewCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sublabel: string;
  tone?: 'positive' | 'neutral' | 'warning' | 'danger';
}) {
  return (
    <div className={`learning-kpi ${toneClass(tone)}`}>
      <div className="learning-kpi-label">{label}</div>
      <div className="learning-kpi-value">{value}</div>
      <div className="learning-kpi-sub">{sublabel}</div>
    </div>
  );
}

function BeliefBucket({ bucket }: { bucket: LearningBucket }) {
  return (
    <div className={`learning-bucket ${toneClass(bucket.tone)}`}>
      <div className="learning-bucket-header">
        <div>
          <p className="learning-bucket-title">{bucket.title}</p>
          <p className="learning-bucket-subtitle">{bucket.subtitle}</p>
        </div>
        <span className="learning-bucket-count">{bucket.items.length}</span>
      </div>
      <div className="learning-bucket-explainer">
        <p className="learning-bucket-how">{bucket.howToRead}</p>
        <p className="learning-bucket-effect">{bucketEffectLabel(bucket.id)}</p>
      </div>
      <div className="learning-bucket-items">
        {bucket.items.map((item) => (
          <div key={item.id} className="learning-memory-item">
            <div className="learning-memory-line">
              <div className="learning-memory-copy">
                <p className="learning-memory-kicker">Observed pattern</p>
                <p className="learning-memory-label">{item.label}</p>
              </div>
              <span className="learning-memory-confidence">{item.confidence}%</span>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentLane({ lane }: { lane: LearningExperimentLane }) {
  return (
    <div className="experiment-lane">
      <div className="experiment-lane-header">
        <p className="experiment-lane-title">{lane.title}</p>
        <p className="experiment-lane-copy">{lane.belief}</p>
      </div>
      <div className="learning-state-note">
        <p>{lane.provenance}</p>
      </div>
      <div className="experiment-hypothesis-card">
        <p className="experiment-hypothesis-label">HYPOTHESIS</p>
        <p className="experiment-hypothesis-copy">{lane.hypothesis}</p>
        <p className="experiment-hypothesis-next">{lane.nextCheck}</p>
      </div>
      <div className="experiment-stack">
        {lane.exploit && (
          <div className="experiment-card experiment-card-exploit">
            <div className="experiment-card-top">
              <span className="experiment-card-label">EXPLOIT</span>
              <span className="experiment-arm-name">{lane.exploit.arm}</span>
            </div>
            <div className="experiment-metrics">
              <span>{Math.round(lane.exploit.meanReward * 100)}% reward</span>
              <span>{Math.round(lane.exploit.pulls)} pulls</span>
            </div>
          </div>
        )}
        {lane.explore && (
          <div className="experiment-card experiment-card-explore">
            <div className="experiment-card-top">
              <span className="experiment-card-label">EXPLORE</span>
              <span className="experiment-arm-name">{lane.explore.arm}</span>
            </div>
            <div className="experiment-metrics">
              <span>{lane.explore.coldStart ? 'cold start' : `${Math.round(lane.explore.explorationBonus * 100)} bonus`}</span>
              <span>ucb {lane.explore.ucbScore.toFixed(2)}</span>
            </div>
          </div>
        )}
        {lane.caution && (
          <div className="experiment-card experiment-card-caution">
            <div className="experiment-card-top">
              <span className="experiment-card-label">CAUTION</span>
              <span className="experiment-arm-name">{lane.caution.arm}</span>
            </div>
            <div className="experiment-metrics">
              <span>{Math.round(lane.caution.failures)} misses</span>
              <span>{Math.round(lane.caution.meanReward * 100)}% reward</span>
            </div>
          </div>
        )}
        {lane.underTest.length > 0 && (
          <div className="experiment-under-test">
            <div className="experiment-under-label">UNDER TEST</div>
            <div className="experiment-chip-row">
              {lane.underTest.map((arm) => (
                <span key={`${lane.id}-${arm.arm}`} className="experiment-chip">
                  {arm.arm}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: LearningEventEntry }) {
  return (
    <div className={`learning-event ${toneClass(event.tone)}`}>
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
        {event.tweetPreview && <span className="learning-event-preview">{event.tweetPreview.slice(0, 88)}{event.tweetPreview.length > 88 ? '...' : ''}</span>}
      </div>
      <p className="learning-event-learned">{event.learned}</p>
    </div>
  );
}

export function LearningTab({ agentId }: LearningTabProps) {
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/agents/${agentId}/dashboard?sections=learning`, { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled && res.ok) setSnapshot(data.learning ?? null);
      } catch {
        if (!cancelled) setSnapshot(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void load();
    };

    void load();
    const interval = window.setInterval(refreshIfVisible, 30000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [agentId]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton" style={{ height: i === 1 ? '120px' : '96px', borderRadius: '10px' }} />
        ))}
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="learning-empty">
        <div className="learning-digest-header">
          <h2>LEARNING</h2>
        </div>
        <p className="learning-progress-label">
          No learning snapshot yet. Approve, edit, copy, or delete a few drafts and this room will start showing what changed.
        </p>
        <p className="learning-progress-hint">
          The learning view turns operator actions and live performance into visible rules, experiments, and trend shifts.
        </p>
      </div>
    );
  }

  const { overview } = snapshot;
  const explorePct = overview.activeMix.total > 0
    ? Math.round((overview.activeMix.explore / overview.activeMix.total) * 100)
    : overview.explorationRate;

  return (
    <div className="space-y-6">
      <div className="learning-hero">
        <div className="learning-hero-head">
          <div>
            <p className="learning-hero-label">LEARNING CONTROL ROOM</p>
            <h2 className="learning-hero-title">See what the system is learning, which bets it is making, and why future tweets are changing.</h2>
          </div>
          <div className="learning-hero-status">
            <span className={`learning-source-chip ${toneClass(overview.autonomyMode === 'safe' ? 'positive' : overview.autonomyMode === 'explore' ? 'warning' : 'neutral')}`}>
              MODE {overview.autonomyMode.toUpperCase()}
            </span>
            {overview.trainingSource && (
              <span className="learning-source-chip">
                TRAINING {sourceLabel(overview.trainingSource)}
              </span>
            )}
          </div>
        </div>

        <div className="learning-kpi-grid">
          <OverviewCard
            label="APPROVAL RATE"
            value={`${overview.approvalRate.currentWeek}%`}
            sublabel={`${deltaLabel(overview.approvalRate.currentWeek, overview.approvalRate.previousWeek)} vs last week`}
            tone={overview.approvalRate.currentWeek >= overview.approvalRate.previousWeek ? 'positive' : 'warning'}
          />
          <OverviewCard
            label="DELETE RATE"
            value={`${overview.deleteRate.currentWeek}%`}
            sublabel={`${deltaLabel(overview.deleteRate.currentWeek, overview.deleteRate.previousWeek)} vs last week`}
            tone={overview.deleteRate.currentWeek <= overview.deleteRate.previousWeek ? 'positive' : 'danger'}
          />
          <OverviewCard
            label="ENGAGEMENT LIFT"
            value={overview.engagementLiftPercent === null ? 'N/A' : `${overview.engagementLiftPercent >= 0 ? '+' : ''}${overview.engagementLiftPercent}%`}
            sublabel="vs historical baseline"
            tone={overview.engagementLiftPercent === null ? 'neutral' : overview.engagementLiftPercent >= 0 ? 'positive' : 'warning'}
          />
          <OverviewCard
            label="MODEL CONFIDENCE"
            value={overview.averageConfidencePercent === null ? 'N/A' : `${overview.averageConfidencePercent}%`}
            sublabel="avg across live drafts + queue"
            tone={overview.averageConfidencePercent !== null && overview.averageConfidencePercent >= 70 ? 'positive' : 'neutral'}
          />
          <OverviewCard
            label="EXPLORE MIX"
            value={`${explorePct}%`}
            sublabel={`${overview.activeMix.explore}/${Math.max(overview.activeMix.total, 1)} recent candidates`}
            tone={explorePct >= 35 ? 'warning' : 'neutral'}
          />
          <OverviewCard
            label="LEARNING EVENTS"
            value={String(overview.recentSignals)}
            sublabel={`${overview.trainingPulls} training pulls in policy`}
            tone="neutral"
          />
          <OverviewCard
            label="LOCAL EVIDENCE"
            value={`${Math.round(overview.localEvidenceWeight * 100)}%`}
            sublabel={`${Math.round(overview.globalPriorWeight * 100)}% still shared prior`}
            tone={overview.localEvidenceWeight >= 0.55 ? 'positive' : 'warning'}
          />
        </div>
      </div>

      <div className="learning-primer-grid">
        <div className="learning-primer-card">
          <p className="learning-primer-label">LEARNED BELIEFS</p>
          <p className="learning-primer-copy">
            These are the system&apos;s current working assumptions about voice, audience taste, and approval patterns. They are compressed memory, not permanent truth.
          </p>
        </div>
        <div className="learning-primer-card">
          <p className="learning-primer-label">ACTIVE EXPERIMENTS</p>
          <p className="learning-primer-copy">
            These are open hypotheses the bandit is still testing. Exploration means the system is intentionally spending reps to reduce uncertainty, not saying the idea already works.
          </p>
        </div>
        <div className="learning-primer-card">
          <p className="learning-primer-label">AVOID LIST</p>
          <p className="learning-primer-copy">
            Avoid items are translated into ranking penalties and prompt constraints. They are the system&apos;s current lesson about what to stop repeating, not just copied user text.
          </p>
        </div>
      </div>

      <div className="comparison-grid">
        <div className="learning-digest">
          <div className="learning-digest-header">
            <h2>WHAT CHANGED THIS WEEK</h2>
          </div>
          <ul className="learning-insights">
            {snapshot.weeklyChanges.map((change, index) => (
              <li key={index} className="learning-insight">{change}</li>
            ))}
          </ul>
        </div>

        <div className="learning-digest">
          <div className="learning-digest-header">
            <h2>TOP LEARNED RULES</h2>
          </div>
          <ul className="learning-insights">
            {snapshot.topRules.map((rule, index) => (
              <li key={index} className="learning-insight">{rule}</li>
            ))}
          </ul>
        </div>
      </div>

      {snapshot.beliefState.length > 0 && (
        <div>
          <div className="section-header">
            <div className="section-title">
              <h2>BELIEF STATE</h2>
              <span className="section-count">what the model currently believes about your voice and audience</span>
            </div>
          </div>
          <div className="learning-state-note">
            <p>
              Belief state is the compressed memory the system uses during generation and ranking. Positive buckets raise exposure, negative buckets lower it, and identity buckets act like hard guardrails.
            </p>
          </div>
          <div className="learning-buckets-grid">
            {snapshot.beliefState.map((bucket) => (
              <BeliefBucket key={bucket.id} bucket={bucket} />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="section-header">
          <div className="section-title">
            <h2>EXPERIMENT BOARD</h2>
            <span className="section-count">current bets, active hypotheses, and weak spots in confidence</span>
          </div>
        </div>
        <div className="learning-state-note">
          <p>
            Each lane shows the current winner, the challenger the system wants to test, and what evidence it still needs before widening or narrowing the policy.
          </p>
        </div>
        {snapshot.experiments.summary.length > 0 && (
          <div className="experiment-summary-row">
            {snapshot.experiments.summary.map((summary, index) => (
              <span key={index} className="experiment-summary-chip">{summary}</span>
            ))}
          </div>
        )}
        <div className="experiment-grid">
          {snapshot.experiments.lanes.map((lane) => (
            <ExperimentLane key={lane.id} lane={lane} />
          ))}
        </div>
      </div>

      <div>
        <div className="section-header">
          <div className="section-title">
            <h2>LEARNING EVENT LOG</h2>
            <span className="section-count">every meaningful interaction becomes a training breadcrumb</span>
          </div>
        </div>
        <div className="learning-event-log">
          {snapshot.recentEvents.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}
