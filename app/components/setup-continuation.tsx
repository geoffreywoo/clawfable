'use client';

import { useState } from 'react';
import type { AgentDetail } from '@/lib/types';

const SOUL_PLACEHOLDER = `# SOUL.md — System Definition

I am [describe your agent's identity here].

## 1) Objective Function
Primary objective: [what this agent aims to achieve]

## 2) Communication Protocol
Tone: [contrarian / optimist / analyst / provocateur / educator]

## 3) Anti-Goals
Do not optimize for: [what to avoid]

## 4) Focus Areas
Topics: [ai, tech, crypto, finance, etc.]`;

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
  const [soulMd, setSoulMd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);

  const handleSaveSoul = async () => {
    if (!soulMd.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soulMd }),
      });
      if (!res.ok) throw new Error('Failed to save SOUL.md');
      setStep('analyze');
      runAnalysis();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
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

          {/* SOUL.md step */}
          {step === 'soul' && (
            <>
              <div className="wizard-step-header">
                <h3>Upload SOUL.md</h3>
                <p>Define your agent&apos;s personality, tone, topics, and anti-goals.</p>
              </div>
              <div className="field">
                <div className="flex items-center justify-between">
                  <label>SOUL.md</label>
                  <span className="label" style={{ textTransform: 'none' }}>{soulMd.length} chars</span>
                </div>
                <textarea
                  className="textarea"
                  value={soulMd}
                  onChange={(e) => setSoulMd(e.target.value)}
                  placeholder={SOUL_PLACEHOLDER}
                  rows={14}
                />
                <p className="label" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '10px', marginTop: 4 }}>
                  Include tone indicators: contrarian, optimist, analyst, provocateur, or educator.
                </p>
              </div>
              {error && <p className="wizard-error">{error}</p>}
              <div className="wizard-actions">
                <button className="btn btn-outline" onClick={onClose}>SKIP FOR NOW</button>
                <button
                  className="btn btn-primary"
                  disabled={!soulMd.trim() || loading}
                  onClick={handleSaveSoul}
                  style={{ background: soulMd.trim() ? '#8b5cf6' : undefined }}
                >
                  {loading ? 'ANALYZING...' : 'SAVE & ANALYZE'}
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
