'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TweetPreview, TweetPreviewSkeleton } from './tweet-preview';

type Step = 'identity' | 'soul' | 'analyze' | 'preview';
type ResumeStep = Exclude<Step, 'identity'>;

const STEPS: { id: Step; label: string; num: number }[] = [
  { id: 'identity', label: 'NAME + CONNECT', num: 1 },
  { id: 'soul', label: 'VOICE CONTRACT', num: 2 },
  { id: 'analyze', label: 'LEARN ACCOUNT', num: 3 },
  { id: 'preview', label: 'APPROVE BATCH', num: 4 },
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
  resumeAgentId?: string | null;
  initialStep?: ResumeStep | null;
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

type Rating = 'up' | 'down';

function frequencyToPostsPerDay(frequency: string): number {
  if (frequency === '1x') return 1;
  if (frequency === '6x') return 6;
  return 3;
}

export function SetupWizard({
  open,
  onClose,
  onCreated,
  resumeAgentId = null,
  initialStep = null,
}: SetupWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoRunRef = useRef<{ analyze: string; preview: string }>({ analyze: '', preview: '' });

  // Identity
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');

  // Guided builder
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
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    if (!open) return;

    const searchResumeId = searchParams.get('setup');
    const searchResumeStep = searchParams.get('step');
    const resolvedResumeId = resumeAgentId || searchResumeId;
    const resolvedResumeStep = initialStep || searchResumeStep;
    const nextStep: ResumeStep | null =
      resolvedResumeStep === 'soul' || resolvedResumeStep === 'analyze' || resolvedResumeStep === 'preview'
        ? resolvedResumeStep
        : null;

    autoRunRef.current = { analyze: '', preview: '' };
    setError(null);
    setLoading(false);
    setAnalysis(null);
    setPreviewLoading(false);
    setPreviewTweets([]);
    setRatings({});
    setRegeneratingId(null);
    setRegenerationsLeft(2);
    setLaunching(false);
    setLaunched(false);
    setExampleTweets('');
    setArchetype('');
    setSelectedTopics([]);
    setFrequency('3x');

    if (resolvedResumeId) {
      setAgentId(resolvedResumeId);
      setStep(nextStep ?? 'soul');
      return;
    }

    setAgentId(null);
    setStep('identity');
    setHandle('');
    setName('');
  }, [open, resumeAgentId, initialStep, searchParams]);

  useEffect(() => {
    if (!previewTweets.length) {
      if (regeneratingId) setRegeneratingId(null);
      return;
    }

    const liveIds = new Set(previewTweets.map((tweet) => tweet.id));
    setRatings((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([tweetId]) => liveIds.has(tweetId))
      ) as Record<string, Rating>;
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });

    if (regeneratingId && !liveIds.has(regeneratingId)) {
      setRegeneratingId(null);
    }
  }, [previewTweets, regeneratingId]);

  useEffect(() => {
    if (!open || !agentId) return;

    const runKey = `${agentId}:${step}`;
    if (step === 'analyze' && !analysis && !loading && autoRunRef.current.analyze !== runKey) {
      autoRunRef.current.analyze = runKey;
      void runAnalysis();
    }

    if (step === 'preview' && previewTweets.length === 0 && !previewLoading && autoRunRef.current.preview !== runKey) {
      autoRunRef.current.preview = runKey;
      void generatePreviewTweets();
    }
  }, [open, agentId, step, analysis, loading, previewTweets.length, previewLoading]);

  if (!open) return null;

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canGenerateVoice = archetype && selectedTopics.length > 0;
  const approvedTweetIds = previewTweets
    .filter((tweet) => ratings[tweet.id] === 'up')
    .map((tweet) => tweet.id);
  // Unrated tweets are treated as rejected on launch — user only needs to approve ≥1
  const canLaunch =
    previewTweets.length > 0 &&
    approvedTweetIds.length > 0 &&
    !previewLoading &&
    !launching;

  async function handleCreateAndAuth() {
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
  }

  async function handleGenerateSoulFromTweets() {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/generate-soul`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate voice');
      autoRunRef.current.analyze = `${agentId}:analyze`;
      setStep('analyze');
      await runAnalysis();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate voice');
      setLoading(false);
    }
  }

  async function handleGenerateVoice() {
    if (!agentId || !canGenerateVoice) return;
    setLoading(true);
    setError(null);
    try {
      const examples = exampleTweets
        .split('\n')
        .map((tweet) => tweet.trim())
        .filter((tweet) => tweet.length > 0);

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

      autoRunRef.current.analyze = `${agentId}:analyze`;
      setStep('analyze');
      await runAnalysis();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice generation failed');
      setLoading(false);
    }
  }

  async function runAnalysis() {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoToPreview() {
    if (!agentId) return;
    autoRunRef.current.preview = `${agentId}:preview`;
    setStep('preview');
    await generatePreviewTweets();
  }

  async function generatePreviewTweets() {
    if (!agentId) return;
    setPreviewLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(`/api/agents/${agentId}/generate-tweet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview generation failed');

      setPreviewTweets(Array.isArray(data.tweets) ? data.tweets : []);
      setRatings({});
      setRegeneratingId(null);
      setRegenerationsLeft(2);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Preview timed out. Claude is slow right now. Click Retry.');
      } else {
        setError(err instanceof Error ? err.message : 'Preview generation failed');
      }
    } finally {
      clearTimeout(timeout);
      setPreviewLoading(false);
    }
  }

  async function handleRegenerate(tweetId: string) {
    if (!agentId || regenerationsLeft <= 0) return;

    const res = await fetch(`/api/agents/${agentId}/generate-tweet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, replaceTweetId: tweetId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Regeneration failed');

    const replacement = Array.isArray(data.tweets) ? data.tweets[0] : null;
    if (!replacement) {
      throw new Error('Regeneration returned no replacement tweet');
    }

    setPreviewTweets((prev) => prev.map((tweet) => (tweet.id === tweetId ? replacement : tweet)));
    setRegenerationsLeft((prev) => prev - 1);
    setError(null);
  }

  async function handlePreviewRating(tweetId: string, rating: Rating) {
    const tweet = previewTweets.find((item) => item.id === tweetId);
    if (!tweet || !agentId) return;

    setRatings((prev) => ({ ...prev, [tweetId]: rating }));

    await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'feedback',
        feedback: {
          tweetText: tweet.content,
          rating,
          generatedAt: new Date().toISOString(),
          source: 'preview_feedback',
        },
      }),
    }).catch(() => {});

    if (rating === 'down' && regenerationsLeft > 0) {
      setRegeneratingId(tweetId);
      try {
        await handleRegenerate(tweetId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Regeneration failed');
        setRegeneratingId(null);
      }
    }
  }

  async function handleLaunch() {
    if (!agentId || !canLaunch) return;
    setLaunching(true);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${agentId}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewedTweetIds: previewTweets.map((t) => t.id),
          approvedTweetIds,
          postsPerDay: frequencyToPostsPerDay(frequency),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Launch failed');

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
  }

  function toggleTopic(topic: string) {
    setSelectedTopics((prev) =>
      prev.includes(topic) ? prev.filter((item) => item !== topic) : [...prev, topic]
    );
  }

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        <div className="wizard-progress">
          {STEPS.map((item, index) => (
            <div
              key={item.id}
              className={`wizard-step ${index < stepIndex ? 'done active' : ''} ${item.id === step ? 'current' : ''}`}
            >
              <div className="wizard-step-num">{index < stepIndex ? '\u2713' : item.num}</div>
              <span className="wizard-step-label">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="wizard-body">
          {step === 'identity' && (
            <>
              <div className="wizard-step-header">
                <h3>Create the agent shell</h3>
                <p>Start with the X account this agent will represent. After you connect X, Clawfable can learn the account and draft the first safe batch. Nothing posts during setup.</p>
              </div>
              <div className="wizard-callout">
                <p className="wizard-callout-label">SETUP SAFETY</p>
                <p className="wizard-callout-text">
                  Connection only unlocks analysis and drafting. You will still review the first batch before anything can go live.
                </p>
              </div>
              <div className="space-y-5">
                <div className="field">
                  <label>X HANDLE</label>
                  <div className="input-with-prefix">
                    <span className="prefix">@</span>
                    <input
                      type="text"
                      className="input"
                      value={handle}
                      onChange={(event) => setHandle(event.target.value.replace(/^@/, ''))}
                      placeholder="agenthandle"
                    />
                  </div>
                </div>
                <div className="field">
                  <label>AGENT NAME</label>
                  <input
                    type="text"
                    className="input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
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
                  {loading ? 'REDIRECTING...' : 'CREATE AGENT + CONNECT X'}
                </button>
              </div>
            </>
          )}

          {step === 'soul' && (
            <>
              <div className="wizard-step-header">
                <h3>Define the voice contract</h3>
                <p>Start from the real account if you can. That gives Clawfable a stronger first read on tone, topics, and anti-goals before you tune it manually.</p>
              </div>

              {agentId && (
                <div className="wizard-callout">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="wizard-callout-label">FASTEST START: LEARN FROM THE REAL ACCOUNT</p>
                      <p className="wizard-callout-text">
                        Pulling from real posts gives the first voice contract a stronger baseline than starting from scratch.
                      </p>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ background: '#8b5cf6', flexShrink: 0 }}
                      disabled={loading}
                      onClick={handleGenerateSoulFromTweets}
                    >
                      {loading ? 'ANALYZING...' : 'DRAFT FROM X HISTORY'}
                    </button>
                  </div>
                </div>
              )}

              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-dim)', textAlign: 'center', marginBottom: '12px' }}>
                — or shape it manually —
              </p>

              <div className="wizard-builder-sections">
                <div className="wizard-builder-section">
                  <div className="wizard-section-label">REFERENCE TWEETS (OPTIONAL)</div>
                  <textarea
                    className="textarea"
                    value={exampleTweets}
                    onChange={(event) => setExampleTweets(event.target.value)}
                    placeholder="Paste 3-5 tweets you admire or your own best tweets, one per line..."
                    rows={4}
                  />
                  <p className="wizard-section-hint">
                    Paste examples you want this voice to feel close to. Skip if you want archetype + topics to do the shaping.
                  </p>
                </div>

                <div className="wizard-builder-section">
                  <div className="wizard-section-label">BASE VOICE</div>
                  <div className="wizard-tags" role="radiogroup" aria-label="Voice archetype">
                    {ARCHETYPES.map((item) => (
                      <button
                        key={item.id}
                        className={`wizard-tag wizard-tag-selectable ${archetype === item.id ? 'tag-selected' : ''}`}
                        onClick={() => setArchetype(item.id)}
                        role="radio"
                        aria-checked={archetype === item.id}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wizard-builder-section">
                  <div className="wizard-section-label">HOME TOPICS (PICK 2-3)</div>
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
                  <div className="wizard-section-label">STARTING CADENCE</div>
                  <select
                    className="input"
                    value={frequency}
                    onChange={(event) => setFrequency(event.target.value)}
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
                  {loading ? 'DRAFTING VOICE CONTRACT...' : 'DRAFT VOICE CONTRACT'}
                </button>
              </div>
            </>
          )}

          {step === 'analyze' && (
            <>
              <div className="wizard-step-header">
                <h3>Learn the account</h3>
                <p>Clawfable is reading posting history, engagement patterns, and network context so the first batch is grounded in what already works.</p>
              </div>

              {loading && !analysis && (
                <div className="wizard-analyzing">
                  <div className="wizard-spinner" />
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                    Reading timeline, ranking engagement, and mapping audience signals...
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
                        {analysis.engagementPatterns.topFormats.map((format) => (
                          <span key={format} className="wizard-tag">{format.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.engagementPatterns.topTopics.length > 0 && (
                    <div className="wizard-analysis-section">
                      <p className="wizard-analysis-label">HIGHEST ENGAGEMENT TOPICS</p>
                      <div className="wizard-tags">
                        {analysis.engagementPatterns.topTopics.map((topic) => (
                          <span key={topic} className="wizard-tag tag-topic">{topic}</span>
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
                  SHOW FIRST BATCH
                </button>
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              {launched ? (
                <div className="wizard-launch-success">
                  <div className="wizard-launch-check">&#10003;</div>
                  <h3>Your agent is ready</h3>
                  <p>Approved tweets are in queue and automation can now work from them. You can tune anything from the control room.</p>
                </div>
              ) : (
                <>
                  <div className="wizard-step-header">
                    <h3>Approve the first batch</h3>
                    <p>Keep the tweets that feel true to the voice. Rejections also teach the system, so the first review cycle improves future drafts immediately.</p>
                  </div>

                  {previewLoading && previewTweets.length === 0 && <TweetPreviewSkeleton count={5} />}

                  {error && previewTweets.length === 0 && (
                    <div>
                      <p className="wizard-error">{error}</p>
                      <button className="btn btn-outline btn-sm" onClick={generatePreviewTweets} style={{ marginTop: '8px' }}>
                        RETRY
                      </button>
                    </div>
                  )}

                  {previewTweets.length > 0 && (
                    <>
                      <TweetPreview
                        tweets={previewTweets}
                        ratings={ratings}
                        regeneratingId={regeneratingId}
                        regenerationsLeft={regenerationsLeft}
                        onRate={handlePreviewRating}
                      />

                      {!canLaunch && previewTweets.length > 0 && !previewLoading && (
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '12px' }}>
                          Approve at least one tweet to let the agent go live. Everything else will be discarded and used as feedback.
                        </p>
                      )}
                    </>
                  )}

                  {error && previewTweets.length > 0 && <p className="wizard-error">{error}</p>}

                  <div className="wizard-actions">
                    <button className="btn btn-outline" onClick={onClose}>CANCEL</button>
                    <button
                      className="btn btn-primary"
                      disabled={!canLaunch}
                      onClick={handleLaunch}
                      style={{ background: canLaunch ? '#8b5cf6' : undefined }}
                    >
                      {launching ? 'GOING LIVE...' : 'APPROVE SELECTED + GO LIVE'}
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
