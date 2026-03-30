'use client';

interface PreviewTweet {
  id: string;
  content: string;
  format?: string;
  topic?: string;
}

type Rating = 'up' | 'down';

interface TweetPreviewProps {
  tweets: PreviewTweet[];
  ratings: Record<string, Rating>;
  regeneratingId: string | null;
  regenerationsLeft: number;
  onRate: (tweetId: string, rating: Rating) => void | Promise<void>;
}

export function TweetPreview({
  tweets,
  ratings,
  regeneratingId,
  regenerationsLeft,
  onRate,
}: TweetPreviewProps) {
  const reviewedCount = tweets.filter((tweet) => ratings[tweet.id]).length;
  const allReviewed = tweets.length > 0 && reviewedCount === tweets.length;

  return (
    <div className="tweet-preview-container">
      <div className="tweet-preview-scroll">
        {tweets.map((tweet, index) => (
          <div
            key={tweet.id}
            className={`tweet-preview-card ${ratings[tweet.id] === 'up' ? 'approved' : ''} ${ratings[tweet.id] === 'down' ? 'rejected' : ''}`}
            style={{ animationDelay: `${index * 300}ms` }}
          >
            {regeneratingId === tweet.id ? (
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
                      onClick={() => void onRate(tweet.id, 'up')}
                      aria-label="Approve this tweet"
                      disabled={regeneratingId === tweet.id}
                    >
                      +
                    </button>
                    <button
                      className={`tweet-action ${ratings[tweet.id] === 'down' ? 'rejected' : ''}`}
                      onClick={() => void onRate(tweet.id, 'down')}
                      aria-label="Reject this tweet"
                      disabled={regeneratingId === tweet.id}
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

      <div className="tweet-preview-counter">
        {reviewedCount} of {tweets.length} reviewed
      </div>

      {regenerationsLeft < 2 && (
        <p className="tweet-preview-regen-count">{regenerationsLeft} regeneration{regenerationsLeft !== 1 ? 's' : ''} remaining</p>
      )}

      {allReviewed && (
        <div className="tweet-preview-ready">
          <p className="tweet-preview-ready-label">Preview batch reviewed</p>
        </div>
      )}
    </div>
  );
}

export function TweetPreviewSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="tweet-preview-container">
      <div className="tweet-preview-scroll">
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="tweet-preview-card skeleton" style={{ animationDelay: `${index * 100}ms` }}>
            <div className="tweet-preview-skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
