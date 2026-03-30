'use client';

import { useState } from 'react';
import type { AgentDetail } from '@/lib/types';

const ARCHETYPES = [
  { id: 'contrarian', label: 'Contrarian' },
  { id: 'optimist', label: 'Optimist' },
  { id: 'analyst', label: 'Analyst' },
  { id: 'provocateur', label: 'Provocateur' },
  { id: 'educator', label: 'Educator' },
];

const TOPICS = ['AI', 'Tech', 'Crypto', 'Finance', 'Startups', 'Product', 'Career', 'Culture'];

interface AnalysisData {
  tweetCount: number;
  viralTweets: Array<{ text: string; likes: number; retweets: number; engagementRate: number }>;
  engagementPatterns: {
    avgLikes: number;
    avgRetweets: number;
    topFormats: string[];
    topTopics: string[];
    viralThreshold: number;
  };
  followingProfile: {
    totalFollowing: number;
    categories: Array<{ label: string; count: number }>;
  };
  contentFingerprint: string;
}

interface Props {
  agentId: string;
  agent: AgentDetail;
  onComplete: () => void;
  onClose: () => void;
}

export function SetupContinuation({ agentId, agent, onComplete, onClose }: Props) {
  const needsSoul = agent.setupStep === 'soul' || agent.soulMd === '# Pending SOUL.md setup';
  const [step, setStep] = useState<'soul' | 'analyze'>(needsSoul ? 'soul' : 'analyze');

  // Guided builder state
  const [archetype, setArchetype] = useState('');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [exampleTweets, setExampleTweets] = useState('');
  const [frequency, setFrequency] = useState('3x');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  };

  const canGenerate = archetype && selectedTopics.length > 0;

  const handleGenerateVoice = async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    try {
      const examples = exampleTweets
        .split('\n')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res = await fetch(`/api/agents/${agentId}/wizard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exampleTweets: examples, archetype, topics: selectedTopics, frequency }),
      });

      if (res.status === 429) throw new Error('Too many attempts. Wait a few minutes and try again.');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice generation failed');

      setStep('analyze');
      runAnalysis();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice generation failed');
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        <div className="wizard-body">
          {/* Connected banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 12px', marginBottom: '16px',
            background: 'var(--green-dim)', border: '1px solid var(--green-border)',
            borderRadius: 'var(--radius)',
          }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#22c55e" strokeWidth="1.5" />
              <polyline points="4,8 7,11 12,5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: '#22c55e' }}>
              X API CONNECTED
            </span>
          </div>

          {/* Voice builder step */}
          {step === 'soul' && (
            <>
              <div className="wizard-step-header">
                <h3>Build Your Voice</h3>
                <p>Auto-generate from your tweet history, or build manually below.</p>
              </div>

              {/* Quick path: generate from tweets */}
              <div style={{
                padding: '14px', marginBottom: '16px',
                background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)',
                borderRadius: 'var(--radius-lg)',
              }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: '#8b5cf6' }}>
                      RECOMMENDED: GENERATE FROM YOUR TWEETS
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Analyzes up to 500 of your tweets to reverse-engineer your voice, tone, topics, and style.
                    </p>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ background: '#8b5cf6', flexShrink: 0 }}
                    disabled={loading}
                    onClick={async () => {
                      setLoading(true);
                      setError(null);
                      try {
                        const res = await fetch(`/api/agents/${agentId}/generate-soul`, { method: 'POST' });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        setStep('analyze');
                        runAnalysis();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to generate');
                        setLoading(false);
                      }
                    }}
                  >
                    {loading ? 'ANALYZING...' : 'AUTO-GENERATE'}
                  </button>
                </div>
              </div>

              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', textAlign: 'center', marginBottom: '12px' }}>
                — or build manually —
              </p>

              <div className="wizard-builder-sections">
                <div className="wizard-builder-section">
                  <div className="wizard-section-label">EXAMPLE TWEETS (OPTIONAL)</div>
                  <textarea
                    className="textarea"
                    value={exampleTweets}
                    onChange={(e) => setExampleTweets(e.target.value)}
                    placeholder="Paste 3-5 tweets you admire or your own best tweets, one per line..."
                    rows={4}
                  />
                  <p className="wizard-section-hint">
                    Skip if you don&apos;t have examples. We&apos;ll use archetype + topics.
                  </p>
                </div>

                <div className="wizard-builder-section">
                  <div className="wizard-section-label">VOICE ARCHETYPE</div>
                  <div className="wizard-tags" role="radiogroup" aria-label="Voice archetype">
                    {ARCHETYPES.map((a) => (
                      <button
                        key={a.id}
                        className={`wizard-tag wizard-tag-selectable ${archetype === a.id ? 'tag-selected' : ''}`}
                        onClick={() => setArchetype(a.id)}
                        role="radio"
                        aria-checked={archetype === a.id}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wizard-builder-section">
                  <div className="wizard-section-label">TOPICS (PICK 2-3)</div>
                  <div className="wizard-tags" role="group" aria-label="Topics">
                    {TOPICS.map((topic) => (
                      <button
                        key={topic}
                        className={`wizard-tag wizard-tag-selectable ${selectedTopics.includes(topic) ? 'tag-selected' : ''}`}
                        onClick={() => toggleTopic(topic)}
                        role="checkbox"
                        aria-checked={selectedTopics.includes(topic)}
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wizard-builder-section">
                  <div className="wizard-section-label">POSTING FREQUENCY</div>
                  <select
                    className="input"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    style={{ width: '180px' }}
                  >
                    <option value="1x">1x per day</option>
                    <option value="3x">3x per day</option>
                    <option value="6x">6x per day</option>
                  </select>
                </div>
              </div>

              {error && <p className="wizard-error">{error}</p>}
              <div className="wizard-actions">
                <button className="btn btn-outline" onClick={onClose}>SKIP FOR NOW</button>
                <button
                  className="btn btn-primary"
                  disabled={!canGenerate || loading}
                  onClick={handleGenerateVoice}
                  style={{ background: canGenerate ? '#8b5cf6' : undefined }}
                >
                  {loading ? 'CRAFTING VOICE PROFILE...' : 'GENERATE VOICE'}
                </button>
              </div>
            </>
          )}

          {/* Analysis step */}
          {step === 'analyze' && (
            <>
              <div className="wizard-step-header">
                <h3>Account Analysis</h3>
                <p>Studying posting history, engagement patterns, and following graph.</p>
              </div>

              {loading && !analysis && (
                <div className="wizard-analyzing">
                  <div className="wizard-spinner" />
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                    Fetching timeline, analyzing engagement, mapping following...
                  </p>
                </div>
              )}

              {error && !analysis && (
                <div>
                  <p className="wizard-error">{error}</p>
                  <button className="btn btn-outline btn-sm" onClick={runAnalysis} style={{ marginTop: '8px' }}>
                    RETRY
                  </button>
                </div>
              )}

              {analysis && (
                <div className="wizard-analysis-results">
                  <div className="wizard-stats-grid">
                    <div className="wizard-stat">
                      <span className="wizard-stat-value">{analysis.tweetCount}</span>
                      <span className="wizard-stat-label">TWEETS</span>
                    </div>
                    <div className="wizard-stat">
                      <span className="wizard-stat-value">{analysis.viralTweets.length}</span>
                      <span className="wizard-stat-label">VIRAL</span>
                    </div>
                    <div className="wizard-stat">
                      <span className="wizard-stat-value">{analysis.engagementPatterns.avgLikes}</span>
                      <span className="wizard-stat-label">AVG LIKES</span>
                    </div>
                    <div className="wizard-stat">
                      <span className="wizard-stat-value">{analysis.followingProfile.totalFollowing}</span>
                      <span className="wizard-stat-label">FOLLOWING</span>
                    </div>
                  </div>

                  {analysis.engagementPatterns.topTopics.length > 0 && (
                    <div className="wizard-analysis-section">
                      <p className="wizard-analysis-label">TOP TOPICS</p>
                      <div className="wizard-tags">
                        {analysis.engagementPatterns.topTopics.map((t) => (
                          <span key={t} className="wizard-tag tag-topic">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="wizard-fingerprint">
                    <p className="wizard-analysis-label">CONTENT FINGERPRINT</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7' }}>
                      {analysis.contentFingerprint}
                    </p>
                  </div>
                </div>
              )}

              <div className="wizard-actions">
                <button className="btn btn-outline" onClick={onClose}>CLOSE</button>
                <button
                  className="btn btn-primary"
                  disabled={!analysis || loading}
                  onClick={onComplete}
                  style={{ background: analysis ? '#8b5cf6' : undefined }}
                >
                  LAUNCH PROTOCOL
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
