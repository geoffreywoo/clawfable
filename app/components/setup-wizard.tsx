'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TweetPreview, TweetPreviewSkeleton } from './tweet-preview';

type Step = 'identity' | 'soul' | 'analyze' | 'preview';

const STEPS: { id: Step; label: string; num: number }[] = [
  { id: 'identity', label: 'IDENTITY + X', num: 1 },
  { id: 'soul', label: 'VOICE', num: 2 },
  { id: 'analyze', label: 'ANALYZE', num: 3 },
  { id: 'preview', label: 'PREVIEW', num: 4 },
];

const ARCHETYPES = [
  { id: 'contrarian', label: 'Contrarian' },
  { id: 'optimist', label: 'Optimist' },
  { id: 'analyst', label: 'Analyst' },
  { id: 'provocateur', label: 'Provocateur' },
  { id: 'educator', label: 'Educator' },
];

const TOPICS = ['AI', 'Tech', 'Crypto', 'Finance', 'Startups', 'Product', 'Career', 'Culture'];

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

interface PreviewTweet {
  id: string;
  content: string;
  format?: string;
  topic?: string;
}

export function SetupWizard({ open, onClose, onCreated }: SetupWizardProps) {
  const router = useRouter();

  // Identity
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');

  // Guided builder (soul step)
  const [exampleTweets, setExampleTweets] = useState('');
  const [archetype, setArchetype] = useState('');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [frequency, setFrequency] = useState('3x');

  // State
  const [step, setStep] = useState<Step>('identity');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);

  // Preview
  const [previewTweets, setPreviewTweets] = useState<PreviewTweet[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [regenerationsLeft, setRegenerationsLeft] = useState(2);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  // Resume from OAuth callback
  const searchParams = useSearchParams();
  useEffect(() => {
    const resumeId = searchParams.get('setup');
    const resumeStep = searchParams.get('step');
    if (resumeId) {
      setAgentId(resumeId);
      if (resumeStep === 'soul' || resumeStep === 'analyze' || resumeStep === 'preview') {
        setStep(resumeStep);
      } else {
        setStep('soul');
      }
    }
  }, [searchParams]);

  if (!open) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  // Step 1: Create agent, then redirect to Twitter OAuth
  const handleCreateAndAuth = async () => {
    if (!handle.trim() || !name.trim()) return;
    setLoading(true);
    setError(null);
    try {
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

      const authRes = await fetch('/api/auth/twitter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: newAgentId }),
      });
      const authData = await authRes.json();
      if (!authRes.ok) {
        await fetch(`/api/agents/${newAgentId}`, { method: 'DELETE' }).catch(() => {});
        throw new Error(authData.error || 'Failed to start OAuth');
      }

      window.location.href = authData.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setLoading(false);
    }
  };

  // Step 2: Submit guided builder to wizard API
  const handleGenerateVoice = async () => {
    if (!agentId || !archetype || selectedTopics.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const examples = exampleTweets
        .split('\n')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const res = await fetch(`/api/agents/${agentId}/wizard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exampleTweets: examples,
          archetype,
          topics: selectedTopics,
          frequency,
        }),
      });

      if (res.status === 429) {
        throw new Error('Too many attempts. Wait a few minutes and try again.');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice generation failed');

      setStep('analyze');
      runAnalysis();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice generation failed');
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

  // Transition to preview after analysis
  const handleGoToPreview = async () => {
    setStep('preview');
    await generatePreviewTweets();
  };

  // Step 4: Generate preview tweets
  const generatePreviewTweets = async () => {
    if (!agentId) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/generate-tweet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5, topic: 'general' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview generation failed');
      setPreviewTweets(data.tweets || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview generation failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Regenerate a single tweet
  const handleRegenerate = async (tweetId: string) => {
    if (!agentId || regenerationsLeft <= 0) return;
    setRegenerationsLeft(prev => prev - 1);
    try {
      const res = await fetch(`/api/agents/${agentId}/generate-tweet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1, topic: 'general' }),
      });
      const data = await res.json();
      if (data.tweets && data.tweets.length > 0) {
        setPreviewTweets(prev =>
          prev.map(t => t.id === tweetId ? data.tweets[0] : t)
        );
      }
    } catch {
      // Keep original tweet on failure
    }
  };

  // Final: Launch autopilot
  const handleLaunch = async () => {
    if (!agentId) return;
    setLaunching(true);
    try {
      // Enable autopilot protocol
      await fetch(`/api/agents/${agentId}/protocol/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, postsPerDay: frequency === '1x' ? 1 : frequency === '6x' ? 6 : 3 }),
      });

      // Update setup step to ready
      await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupStep: 'ready' }),
      });

      // Log funnel event
      await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'funnel_event', event: 'preview_approve' }),
      }).catch(() => {});

      setLaunched(true);
      setTimeout(() => {
        onCreated?.();
        onClose();
        router.push(`/agent/${agentId}`);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed');
      setLaunching(false);
    }
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  };

  const canGenerateVoice = archetype && selectedTopics.length > 0;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        {/* Progress bar */}
        <div className="wizard-progress">
          {STEPS.map((s, i) => (
            <div key={s.id} className={`wizard-step ${i < stepIndex ? 'done' : ''} ${s.id === step ? 'current' : ''}`}>
              <div className="wizard-step-num">{i < stepIndex ? '\u2713' : s.num}</div>
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
                  style={{ background: handle.trim() && name.trim() ? '#8b5cf6' : undefined }}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" style={{ marginRight: '2px' }}>
                    <path d="M9.3 2h2.5l-5.5 6.2L13 14h-4.1l-3.4-4.4L1.8 14H0l5.8-6.6L.3 2h4.2l3 4L9.3 2zm-.8 10.8h1.4L5.5 3.4H4L8.5 12.8z" fill="currentColor" />
                  </svg>
                  {loading ? 'REDIRECTING...' : 'AUTHORIZE WITH X'}
                </button>
              </div>
            </>
          )}

          {/* Step 2: Guided Voice Builder */}
          {step === 'soul' && (
            <>
              <div className="wizard-step-header">
                <h3>Build Your Voice</h3>
                <p>We&apos;ll generate your personality profile from these inputs.</p>
              </div>

              <div className="wizard-builder-sections">
                {/* Sub-section A: Example tweets (optional) */}
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

                {/* Sub-section B: Voice archetype */}
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

                {/* Sub-section C: Topics */}
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

                {/* Sub-section D: Posting frequency */}
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
                <button className="btn btn-outline" onClick={onClose}>CANCEL</button>
                <button
                  className="btn btn-primary"
                  disabled={!canGenerateVoice || loading}
                  onClick={handleGenerateVoice}
                  style={{ background: canGenerateVoice ? '#8b5cf6' : undefined }}
                >
                  {loading ? 'CRAFTING VOICE PROFILE...' : 'GENERATE VOICE'}
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

                  {analysis.contentFingerprint && (
                    <div className="wizard-fingerprint">
                      <p className="wizard-analysis-label">CONTENT FINGERPRINT</p>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.7' }}>
                        {analysis.contentFingerprint}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="wizard-actions">
                <button className="btn btn-outline" onClick={onClose}>CLOSE</button>
                <button
                  className="btn btn-primary"
                  disabled={!analysis || loading}
                  onClick={handleGoToPreview}
                  style={{ background: analysis ? '#8b5cf6' : undefined }}
                >
                  SEE PREVIEW TWEETS
                </button>
              </div>
            </>
          )}

          {/* Step 4: Preview & Feedback */}
          {step === 'preview' && (
            <>
              {launched ? (
                <div className="wizard-launch-success">
                  <div className="wizard-launch-check">&#10003;</div>
                  <h3>Your agent is live</h3>
                  <p>First post coming soon.</p>
                </div>
              ) : (
                <>
                  <div className="wizard-step-header">
                    <h3>Your Agent&apos;s Voice</h3>
                    <p>Here&apos;s what your agent will sound like. Approve the ones that hit.</p>
                  </div>

                  {previewLoading && previewTweets.length === 0 && (
                    <TweetPreviewSkeleton count={5} />
                  )}

                  {error && previewTweets.length === 0 && (
                    <div>
                      <p className="wizard-error">{error}</p>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button className="btn btn-outline btn-sm" onClick={generatePreviewTweets}>RETRY</button>
                        <button className="btn btn-outline btn-sm" onClick={handleLaunch}>SKIP TO LAUNCH</button>
                      </div>
                    </div>
                  )}

                  {previewTweets.length > 0 && (
                    <TweetPreview
                      tweets={previewTweets}
                      agentId={agentId!}
                      onAllReviewed={() => {}}
                      regenerationsLeft={regenerationsLeft}
                      onRegenerate={handleRegenerate}
                    />
                  )}

                  <div className="wizard-actions">
                    <button className="btn btn-outline" onClick={onClose}>CANCEL</button>
                    <button
                      className="btn btn-primary"
                      disabled={previewLoading || launching}
                      onClick={handleLaunch}
                      style={{ background: !previewLoading ? '#8b5cf6' : undefined }}
                    >
                      {launching ? 'LAUNCHING...' : 'START AUTOPILOT'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
