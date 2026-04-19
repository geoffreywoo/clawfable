'use client';

import type { LearningSnapshot, LearningStatusState } from '@/lib/learning-snapshot';
import type { Tweet } from '@/lib/types';

interface TweetDecisionPanelProps {
  tweet: Pick<
    Tweet,
    | 'id'
    | 'candidateScore'
    | 'confidenceScore'
    | 'voiceScore'
    | 'noveltyScore'
    | 'predictedEngagementScore'
    | 'freshnessScore'
    | 'repetitionRiskScore'
    | 'policyRiskScore'
    | 'generationMode'
    | 'format'
    | 'topic'
    | 'rationale'
    | 'content'
    | 'hookType'
    | 'toneType'
    | 'specificityType'
    | 'structureType'
    | 'coverageCluster'
    | 'judgeScore'
    | 'judgeNotes'
    | 'mutationRound'
    | 'rewardPrediction'
    | 'globalPriorWeight'
    | 'localPriorWeight'
    | 'scoreProvenance'
    | 'rewardBreakdown'
  >;
  snapshot: LearningSnapshot | null;
}

type DecisionTone = 'positive' | 'neutral' | 'warning' | 'danger';

function pct(value: number | null | undefined): string {
  if (typeof value !== 'number') return 'N/A';
  return `${Math.round(value * 100)}%`;
}

function toneClass(tone: DecisionTone): string {
  return `learning-tone-${tone}`;
}

function statusMeta(state: LearningStatusState): { label: string; tone: DecisionTone } {
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

function buildSignals(tweet: TweetDecisionPanelProps['tweet'], snapshot: LearningSnapshot | null): Array<{ label: string; tone: DecisionTone }> {
  const signals: Array<{ label: string; tone: DecisionTone }> = [];

  if (tweet.generationMode === 'safe') signals.push({ label: 'Exploit bet', tone: 'positive' });
  if (tweet.generationMode === 'explore') signals.push({ label: 'Explore bet', tone: 'warning' });
  if ((tweet.candidateScore ?? 0) >= 80) signals.push({ label: 'Top-ranked candidate', tone: 'positive' });
  if ((tweet.predictedEngagementScore ?? 0) >= 0.7) signals.push({ label: 'Above-baseline engagement forecast', tone: 'positive' });
  if ((tweet.repetitionRiskScore ?? 1) <= 0.2) signals.push({ label: 'Low repetition risk', tone: 'positive' });
  if ((tweet.policyRiskScore ?? 0) >= 0.35) signals.push({ label: 'Higher posting risk', tone: 'danger' });

  if (snapshot?.memory.topicsWithMomentum.some((topic) => topic.toLowerCase() === (tweet.topic || '').toLowerCase())) {
    signals.push({ label: 'Momentum topic', tone: 'positive' });
  }

  if (snapshot?.memory.formatsUnderTested.some((item) => item.toLowerCase().includes((tweet.format || '').toLowerCase()))) {
    signals.push({ label: 'Under-tested format', tone: 'warning' });
  }

  if (snapshot?.memory.neverDoThisAgain.some((item) => item.toLowerCase().includes((tweet.topic || '').toLowerCase()))) {
    signals.push({ label: 'Touches avoid list', tone: 'danger' });
  }

  return signals.slice(0, 6);
}

function ScoreRow({
  label,
  value,
  invert = false,
}: {
  label: string;
  value: number | null | undefined;
  invert?: boolean;
}) {
  const safeValue = typeof value === 'number' ? value : 0;
  const score = invert ? 1 - safeValue : safeValue;

  return (
    <div className="decision-score-row">
      <div className="decision-score-head">
        <span>{label}</span>
        <span>{pct(invert ? 1 - safeValue : safeValue)}</span>
      </div>
      <div className="decision-score-track">
        <div className="decision-score-fill" style={{ width: `${Math.round(score * 100)}%` }} />
      </div>
    </div>
  );
}

export function TweetDecisionPanel({ tweet, snapshot }: TweetDecisionPanelProps) {
  const signals = buildSignals(tweet, snapshot);
  const insight = snapshot?.decisionInsights?.[tweet.id] ?? null;
  const insightState = statusMeta(insight?.state || 'waiting');
  const predictedScore = typeof tweet.rewardPrediction === 'number'
    ? Math.round(tweet.rewardPrediction * 100)
    : typeof tweet.confidenceScore === 'number'
      ? Math.round(tweet.confidenceScore * 100)
      : null;
  const actualScore = insight?.actualScore ?? null;
  const betLabel = tweet.generationMode === 'explore'
    ? 'Explore'
    : tweet.generationMode === 'safe'
      ? 'Exploit'
      : 'Balanced';

  return (
    <div className="decision-panel">
      <div className="decision-panel-top">
        <div className="decision-summary-grid decision-summary-grid-modern">
          <div className="decision-summary-card">
            <span className="decision-summary-label">Candidate score</span>
            <span className="decision-summary-value">{tweet.candidateScore ?? 'N/A'}</span>
          </div>
          <div className="decision-summary-card">
            <span className="decision-summary-label">Confidence</span>
            <span className="decision-summary-value">{pct(tweet.confidenceScore)}</span>
          </div>
          <div className="decision-summary-card">
            <span className="decision-summary-label">Bet type</span>
            <span className="decision-summary-value">{betLabel}</span>
          </div>
          <div className="decision-summary-card">
            <span className="decision-summary-label">Learning state</span>
            <span className={`decision-summary-badge ${toneClass(insightState.tone)}`}>{insightState.label}</span>
          </div>
        </div>

        <div className="decision-explainer">
          <p className="decision-explainer-label">Why this draft</p>
          <p className="decision-explainer-copy">
            {tweet.rationale || 'This candidate won the current ranking stack after voice, novelty, reward prediction, and risk were combined.'}
          </p>
          <div className="decision-explainer-meta">
            <span className="learning-source-chip">PREDICTED {predictedScore !== null ? `${predictedScore}%` : 'N/A'}</span>
            {actualScore !== null && <span className="learning-source-chip">ACTUAL {actualScore}%</span>}
            {insight?.learningDelta !== null && insight?.learningDelta !== undefined && (
              <span className={`learning-source-chip ${toneClass(insight.learningDelta >= 0 ? 'positive' : 'danger')}`}>
                DELTA {insight.learningDelta >= 0 ? '+' : ''}{insight.learningDelta}
              </span>
            )}
          </div>
        </div>
      </div>

      {signals.length > 0 && (
        <div className="decision-signal-row">
          {signals.map((signal) => (
            <span key={signal.label} className={`decision-signal-chip ${toneClass(signal.tone)}`}>
              {signal.label}
            </span>
          ))}
        </div>
      )}

      <div className="decision-insight-grid">
        <div className="decision-explainer">
          <p className="decision-explainer-label">Winning path</p>
          <p className="decision-explainer-copy">
            {tweet.scoreProvenance
              ? `Local prior ${Math.round(tweet.scoreProvenance.localPrior * 100)} · shared prior ${Math.round(tweet.scoreProvenance.globalPrior * 100)} · judge ${Math.round(tweet.scoreProvenance.judge * 100)} · predicted reward ${Math.round(tweet.scoreProvenance.predictedReward * 100)}.`
              : 'This draft won on the current ensemble ranking and learning memory.'}
          </p>
        </div>

        <div className="decision-explainer">
          <p className="decision-explainer-label">Predicted vs actual</p>
          <div className="decision-outcome-grid">
            <div className="decision-outcome-card">
              <span className="decision-outcome-label">Predicted</span>
              <strong>{insight?.predictedLabel || 'No prediction yet'}</strong>
            </div>
            <div className="decision-outcome-card">
              <span className="decision-outcome-label">Actual</span>
              <strong>{insight?.actualLabel || 'Waiting for result'}</strong>
            </div>
          </div>
          <p className="decision-explainer-copy">
            {insight?.learned || 'When approval and live performance arrive, this panel will show how the prediction compared with reality.'}
          </p>
        </div>
      </div>

      <div className="decision-insight-grid">
        <div className="decision-explainer">
          <p className="decision-explainer-label">Lessons influencing this draft</p>
          {insight?.influencingLessons?.length ? (
            <ul className="decision-list">
              {insight.influencingLessons.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="decision-explainer-copy">No explicit lesson was strong enough to surface above the baseline ranking stack.</p>
          )}
        </div>

        <div className="decision-explainer">
          <p className="decision-explainer-label">Hypotheses in play</p>
          {insight?.influencingHypotheses?.length ? (
            <ul className="decision-list">
              {insight.influencingHypotheses.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="decision-explainer-copy">This draft mostly followed the existing policy rather than carrying a prominent experimental hypothesis.</p>
          )}
        </div>
      </div>

      <div className="decision-score-grid">
        <ScoreRow label="Voice match" value={tweet.voiceScore} />
        <ScoreRow label="Novelty" value={tweet.noveltyScore} />
        <ScoreRow label="Predicted engagement" value={tweet.predictedEngagementScore} />
        <ScoreRow label="Freshness" value={tweet.freshnessScore} />
        <ScoreRow label="Repetition safety" value={tweet.repetitionRiskScore} invert />
        <ScoreRow label="Policy safety" value={tweet.policyRiskScore} invert />
      </div>

      {(typeof tweet.judgeScore === 'number' || tweet.judgeNotes) && (
        <div className="decision-explainer">
          <p className="decision-explainer-label">Critic pass</p>
          <p className="decision-explainer-copy">
            {typeof tweet.judgeScore === 'number' ? `Judge ${Math.round(tweet.judgeScore * 100)}%. ` : ''}
            {tweet.judgeNotes || 'A critique pass reviewed voice fit, clarity, novelty, audience fit, and policy safety.'}
          </p>
        </div>
      )}

      {insight?.evidence?.length ? (
        <details className="learning-evidence-drawer">
          <summary>Show decision trace evidence</summary>
          <ul className="learning-evidence-list">
            {insight.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="decision-footer-meta">
        {tweet.format && <span className="learning-source-chip">FORMAT {tweet.format.replace(/_/g, ' ').toUpperCase()}</span>}
        {tweet.topic && <span className="learning-source-chip">TOPIC {tweet.topic.toUpperCase()}</span>}
        {tweet.hookType && <span className="learning-source-chip">HOOK {tweet.hookType.replace(/_/g, ' ').toUpperCase()}</span>}
        {tweet.toneType && <span className="learning-source-chip">TONE {tweet.toneType.replace(/_/g, ' ').toUpperCase()}</span>}
        {tweet.specificityType && <span className="learning-source-chip">SPECIFICITY {tweet.specificityType.replace(/_/g, ' ').toUpperCase()}</span>}
        {tweet.structureType && <span className="learning-source-chip">STRUCTURE {tweet.structureType.replace(/_/g, ' ').toUpperCase()}</span>}
        {typeof tweet.rewardPrediction === 'number' && <span className="learning-source-chip">REWARD {Math.round(tweet.rewardPrediction * 100)}%</span>}
        {typeof tweet.localPriorWeight === 'number' && <span className="learning-source-chip">LOCAL {Math.round(tweet.localPriorWeight * 100)}%</span>}
        {typeof tweet.globalPriorWeight === 'number' && <span className="learning-source-chip">GLOBAL {Math.round(tweet.globalPriorWeight * 100)}%</span>}
        {typeof tweet.mutationRound === 'number' && tweet.mutationRound > 0 && <span className="learning-source-chip">MUTATION {tweet.mutationRound}</span>}
        {tweet.coverageCluster && <span className="learning-source-chip">CLUSTER {tweet.coverageCluster.toUpperCase()}</span>}
        <span className="learning-source-chip">{tweet.content.length} CHARS</span>
      </div>
    </div>
  );
}
