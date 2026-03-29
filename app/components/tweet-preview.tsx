'use client';

import { useState } from 'react';

interface PreviewTweet {
  id: string;
  content: string;
  format?: string;
  topic?: string;
}

interface TweetPreviewProps {
  tweets: PreviewTweet[];
  agentId: string;
  onAllReviewed: () => void;
  regenerationsLeft: number;
  onRegenerate: (tweetId: string) => void;
}

export function TweetPreview({ tweets, agentId, onAllReviewed, regenerationsLeft, onRegenerate }: TweetPreviewProps) {
  const [ratings, setRatings] = useState<Record<string, 'up' | 'down'>>({});
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const handleRate = async (tweetId: string, rating: 'up' | 'down') => {
    const tweet = tweets.find(t => t.id === tweetId);
    if (!tweet) return;

    setRatings(prev => ({ ...prev, [tweetId]: rating }));

    // Store feedback
    await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'feedback',
        feedback: { tweetText: tweet.content, rating, generatedAt: new Date().toISOString() },
      }),
    }).catch(() => {});

    // If thumbs down and regenerations left, trigger regeneration
    if (rating === 'down' && regenerationsLeft > 0) {
      setRegenerating(tweetId);
      onRegenerate(tweetId);
    }
  };

  // Check if all tweets have been reviewed
  const allReviewed = tweets.length > 0 && tweets.every(t => ratings[t.id]);

  return (
    <div className="tweet-preview-container">
      {/* Mobile carousel wrapper */}
      <div className="tweet-preview-scroll">
        {tweets.map((tweet, i) => (
          <div
            key={tweet.id}
            className={`tweet-preview-card ${ratings[tweet.id] === 'up' ? 'approved' : ''} ${ratings[tweet.id] === 'down' ? 'rejected' : ''}`}
            style={{ animationDelay: `${i * 300}ms` }}
          >
            {regenerating === tweet.id ? (
              <div className="tweet-preview-skeleton" />
            ) : (
              <>
                <p className="tweet-preview-content">{tweet.content}</p>
                <div className="tweet-preview-meta">
                  {tweet.format && (
                    <span className="tweet-preview-format">{tweet.format.replace(/_/g, ' ')}</span>
                  )}
                  <div className="tweet-preview-actions">
                    <button
                      className={`tweet-action ${ratings[tweet.id] === 'up' ? 'approved' : ''}`}
                      onClick={() => handleRate(tweet.id, 'up')}
                      aria-label="Approve this tweet"
                    >
                      +
                    </button>
                    <button
                      className={`tweet-action ${ratings[tweet.id] === 'down' ? 'rejected' : ''}`}
                      onClick={() => handleRate(tweet.id, 'down')}
                      aria-label="Reject this tweet"
                    >
                      -
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Mobile counter */}
      <div className="tweet-preview-counter">
        {Object.keys(ratings).length} of {tweets.length} reviewed
      </div>

      {regenerationsLeft < 2 && (
        <p className="tweet-preview-regen-count">{regenerationsLeft} regeneration{regenerationsLeft !== 1 ? 's' : ''} remaining</p>
      )}

      {allReviewed && (
        <div className="tweet-preview-ready">
          <p className="tweet-preview-ready-label">Your agent&apos;s voice is ready</p>
        </div>
      )}
    </div>
  );
}

export function TweetPreviewSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="tweet-preview-container">
      <div className="tweet-preview-scroll">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="tweet-preview-card skeleton" style={{ animationDelay: `${i * 100}ms` }}>
            <div className="tweet-preview-skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
