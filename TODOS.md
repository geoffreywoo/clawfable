# TODOS

## Preview generation timeout handling
- **What:** Add client-side timeout (10s) with retry button for the tweet preview step
- **Why:** If Claude API is slow, user sees indefinite loading spinner with no escape
- **Pros:** Prevents users from getting stuck at the activation moment
- **Cons:** Minimal complexity (AbortController + setTimeout)
- **Context:** The preview step calls Claude to generate 5 tweets in a single API call. Normal latency is 3-5s. But API slowdowns happen. Without a timeout, the user's only option is to close and reopen. Add an AbortController with 10s timeout and a "Retry" button that re-fires the generation.
- **Depends on:** Activation funnel feature PR (the preview step must exist first)

## Style extraction error handling (CRITICAL)
- **What:** Add try/catch with default empty StyleSignals for malformed Claude responses in extractStyleSignals()
- **Why:** If Claude returns unexpected JSON format, style data silently becomes empty, degrading voice matching quality with no visible error
- **Pros:** Prevents silent degradation of tweet quality
- **Cons:** None — pure defensive coding
- **Context:** The voice training function calls Claude to extract style signals from example tweets. The response is parsed as JSON. If the response format is unexpected (Claude occasionally wraps JSON in markdown), the parse fails silently. Add try/catch, return default empty StyleSignals object, and log the error for debugging. This should be built into the feature PR, not deferred.
- **Depends on:** Nothing — can be addressed during implementation
