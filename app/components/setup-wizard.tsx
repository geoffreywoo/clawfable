'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const SOUL_PLACEHOLDER = `# SOUL.md — System Definition

I am [describe your agent's identity here].

## 1) Objective Function
Primary objective: [what this agent aims to achieve]

## 2) Communication Protocol
Default output: [how this agent communicates]
Tone: [contrarian / optimist / analyst / provocateur / educator]

## 3) Anti-Goals
Do not optimize for: [what to avoid]

## 4) Focus Areas
Topics: [ai, tech, crypto, finance, etc.]`;

type Step = 'identity' | 'soul' | 'analyze' | 'ready';

const STEPS: { id: Step; label: string; num: number }[] = [
  { id: 'identity', label: 'IDENTITY + X', num: 1 },
  { id: 'soul', label: 'SOUL.MD', num: 2 },
  { id: 'analyze', label: 'ANALYZE', num: 3 },
];

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

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

export function SetupWizard({ open, onClose, onCreated }: SetupWizardProps) {
  const router = useRouter();

  // Identity
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');

  // Soul
  const [soulMd, setSoulMd] = useState('');

  // State
  const [step, setStep] = useState<Step>('identity');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);

  if (!open) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  // Step 1: Create agent, then redirect to Twitter OAuth
  const handleCreateAndAuth = async () => {
    if (!handle.trim() || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Create the agent first
      const createRes = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.replace(/^@/, '').trim(),
          name: name.trim(),
          soulMd: '# Pending SOUL.md setup',
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || 'Failed to create agent');
      const newAgentId = createData.id;

      // Start OAuth flow — get the Twitter auth URL
      const authRes = await fetch('/api/auth/twitter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: newAgentId }),
      });
      const authData = await authRes.json();
      if (!authRes.ok) {
        // Clean up agent on OAuth failure
        await fetch(`/api/agents/${newAgentId}`, { method: 'DELETE' }).catch(() => {});
        throw new Error(authData.error || 'Failed to start OAuth');
      }

      // Redirect to Twitter
      window.location.href = authData.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setLoading(false);
    }
  };

  // Step 2: Save SOUL.md then auto-trigger analysis
  const handleSaveSoul = async () => {
    if (!agentId || !soulMd.trim()) return;
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

  // Step 3: Run analysis
  const runAnalysis = async () => {
    if (!agentId) return;
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

  // Final: Launch
  const handleLaunch = () => {
    onCreated?.();
    onClose();
    if (agentId) router.push(`/agent/${agentId}`);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        {/* Progress bar */}
        <div className="wizard-progress">
          {STEPS.map((s, i) => (
            <div key={s.id} className={`wizard-step ${i <= stepIndex ? 'active' : ''} ${s.id === step ? 'current' : ''}`}>
              <div className="wizard-step-num">{s.num}</div>
              <span className="wizard-step-label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="wizard-body">
          {/* Step 1: Identity + OAuth redirect */}
          {step === 'identity' && (
            <>
              <div className="wizard-step-header">
                <h3>Agent Identity</h3>
                <p>Name your agent, then authorize with X. You&apos;ll be redirected to X to grant access.</p>
              </div>
              <div className="space-y-5">
                <div className="field">
                  <label>Twitter Handle</label>
                  <div className="input-with-prefix">
                    <span className="prefix">@</span>
                    <input
                      type="text"
                      className="input"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
                      placeholder="agenthandle"
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Display Name</label>
                  <input
                    type="text"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Agent Name"
                  />
                </div>
              </div>
              {error && <p className="wizard-error">{error}</p>}
              <div className="wizard-actions">
                <button className="btn btn-outline" onClick={onClose}>CANCEL</button>
                <button
                  className="btn btn-primary"
                  disabled={!handle.trim() || !name.trim() || loading}
                  onClick={handleCreateAndAuth}
                  style={{ background: handle.trim() && name.trim() ? '#dc2626' : undefined }}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" style={{ marginRight: '2px' }}>
                    <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                  </svg>
                  {loading ? 'REDIRECTING...' : 'AUTHORIZE WITH X'}
                </button>
              </div>
            </>
          )}

          {/* Step 2: SOUL.md */}
          {step === 'soul' && (
            <>
              <div className="wizard-step-header">
                <h3>Upload SOUL.md</h3>
                <p>
                  Define your agent&apos;s personality, tone, topics, and anti-goals.
                </p>
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
                <button className="btn btn-outline" onClick={onClose}>CANCEL</button>
                <button
                  className="btn btn-primary"
                  disabled={!soulMd.trim() || loading}
                  onClick={handleSaveSoul}
                  style={{ background: soulMd.trim() ? '#dc2626' : undefined }}
                >
                  {loading ? 'ANALYZING ACCOUNT...' : 'SAVE & ANALYZE ACCOUNT'}
                </button>
              </div>
            </>
          )}

          {/* Step 3: Analysis */}
          {step === 'analyze' && (
            <>
              <div className="wizard-step-header">
                <h3>Account Analysis</h3>
                <p>Studying your account&apos;s posting history, engagement patterns, and following graph.</p>
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
                    RETRY ANALYSIS
                  </button>
                </div>
              )}

              {analysis && (
                <div className="wizard-analysis-results">
                  <div className="wizard-stats-grid">
                    <div className="wizard-stat">
                      <span className="wizard-stat-value">{analysis.tweetCount}</span>
                      <span className="wizard-stat-label">TWEETS ANALYZED</span>
                    </div>
                    <div className="wizard-stat">
                      <span className="wizard-stat-value">{analysis.viralTweets.length}</span>
                      <span className="wizard-stat-label">VIRAL POSTS</span>
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

                  {analysis.engagementPatterns.topFormats.length > 0 && (
                    <div className="wizard-analysis-section">
                      <p className="wizard-analysis-label">TOP PERFORMING FORMATS</p>
                      <div className="wizard-tags">
                        {analysis.engagementPatterns.topFormats.map((f) => (
                          <span key={f} className="wizard-tag">{f.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.engagementPatterns.topTopics.length > 0 && (
                    <div className="wizard-analysis-section">
                      <p className="wizard-analysis-label">HIGHEST ENGAGEMENT TOPICS</p>
                      <div className="wizard-tags">
                        {analysis.engagementPatterns.topTopics.map((t) => (
                          <span key={t} className="wizard-tag tag-topic">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.followingProfile.categories.length > 0 && (
                    <div className="wizard-analysis-section">
                      <p className="wizard-analysis-label">FOLLOWING GRAPH</p>
                      <div className="wizard-categories">
                        {analysis.followingProfile.categories.slice(0, 5).map((c) => (
                          <div key={c.label} className="wizard-category">
                            <span className="wizard-category-label">{c.label}</span>
                            <span className="wizard-category-count">{c.count}</span>
                          </div>
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

                  {analysis.viralTweets.length > 0 && (
                    <div className="wizard-analysis-section">
                      <p className="wizard-analysis-label">TOP VIRAL POST</p>
                      <div className="wizard-viral-preview">
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text)', lineHeight: '1.6' }}>
                          {analysis.viralTweets[0].text}
                        </p>
                        <div className="wizard-viral-stats">
                          <span>{analysis.viralTweets[0].likes} likes</span>
                          <span>{analysis.viralTweets[0].retweets} RTs</span>
                          <span>{analysis.viralTweets[0].engagementRate}% rate</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="wizard-actions">
                <button className="btn btn-outline" onClick={onClose}>CLOSE</button>
                <button
                  className="btn btn-primary"
                  disabled={!analysis || loading}
                  onClick={handleLaunch}
                  style={{ background: analysis ? '#dc2626' : undefined }}
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
