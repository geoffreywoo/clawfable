'use client';

import type { LearningSnapshot } from '@/lib/learning-snapshot';
import type { Tweet } from '@/lib/types';

interface TweetDecisionPanelProps {
  tweet: Pick<
    Tweet,
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
  >;
  snapshot: LearningSnapshot | null;
}

function pct(value: number | null | undefined): string {
  if (typeof value !== 'number') return 'N/A';
  return `${Math.round(value * 100)}%`;
}

function toneClass(tone: 'positive' | 'neutral' | 'warning' | 'danger'): string {
  return `learning-tone-${tone}`;
}

function buildSignals(tweet: TweetDecisionPanelProps['tweet'], snapshot: LearningSnapshot | null): Array<{ label: string; tone: 'positive' | 'neutral' | 'warning' | 'danger' }> {
  const signals: Array<{ label: string; tone: 'positive' | 'neutral' | 'warning' | 'danger' }> = [];

  if (tweet.generationMode === 'safe') signals.push({ label: 'High-confidence exploit', tone: 'positive' });
  if (tweet.generationMode === 'explore') signals.push({ label: 'Deliberate exploration bet', tone: 'warning' });
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
    signals.push({ label: 'Topic conflicts with avoid list', tone: 'danger' });
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

  return (
    <div className="decision-panel">
      <div className="decision-panel-top">
        <div className="decision-summary-grid">
          <div className="decision-summary-card">
            <span className="decision-summary-label">CANDIDATE SCORE</span>
            <span className="decision-summary-value">{tweet.candidateScore ?? 'N/A'}</span>
          </div>
          <div className="decision-summary-card">
            <span className="decision-summary-label">CONFIDENCE</span>
            <span className="decision-summary-value">{pct(tweet.confidenceScore)}</span>
          </div>
          <div className="decision-summary-card">
            <span className="decision-summary-label">MODE</span>
            <span className="decision-summary-value">{tweet.generationMode ? tweet.generationMode.toUpperCase() : 'N/A'}</span>
          </div>
        </div>
        <div className="decision-explainer">
          <p className="decision-explainer-label">WHY THIS TWEET</p>
          <p className="decision-explainer-copy">
            {tweet.rationale || 'This candidate was selected from the current ranking policy and learning memory.'}
          </p>
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

      <div className="decision-explainer">
        <p className="decision-explainer-label">WINNING PATH</p>
        <p className="decision-explainer-copy">
          {tweet.scoreProvenance
            ? `Local prior ${Math.round(tweet.scoreProvenance.localPrior * 100)} · shared prior ${Math.round(tweet.scoreProvenance.globalPrior * 100)} · judge ${Math.round(tweet.scoreProvenance.judge * 100)} · predicted reward ${Math.round(tweet.scoreProvenance.predictedReward * 100)}.`
            : 'This draft won on the current ensemble ranking and learning memory.'}
        </p>
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
          <p className="decision-explainer-label">CRITIC PASS</p>
          <p className="decision-explainer-copy">
            {typeof tweet.judgeScore === 'number' ? `Judge ${Math.round(tweet.judgeScore * 100)}%. ` : ''}
            {tweet.judgeNotes || 'A critique pass reviewed voice fit, clarity, novelty, audience fit, and policy safety.'}
          </p>
        </div>
      )}

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
