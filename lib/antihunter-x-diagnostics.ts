/** Safe private diagnostics: never persist response messages, values, headers or URLs. */
export interface OperatorXFailure {
  kind: 'transport' | 'response';
  status?: number;
  parameters: string[];
}
const parameterNames = new Set([
  'text', 'reply', 'reply.in_reply_to_tweet_id', 'in_reply_to_tweet_id',
  'media', 'media.media_ids', 'media_ids', 'quote_tweet_id', 'poll',
  'reply_settings', 'direct_message_deep_link', 'for_super_followers_only',
  'geo', 'card_uri', 'max_results', 'tweet.fields', 'expansions', 'ids',
]);
export function operatorXFailure(error: unknown, kind: OperatorXFailure['kind']): OperatorXFailure {
  const result: OperatorXFailure = { kind, parameters: [] };
  if (kind === 'transport' || !error || typeof error !== 'object') return result;
  const record = error as Record<string, any>;
  if (Number.isInteger(record.code) && record.code >= 400 && record.code <= 599) result.status = record.code;
  const data = record.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.errors)) return result;
  for (const item of data.errors.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const names = [item.parameter, ...(item.parameters && typeof item.parameters === 'object'
      && !Array.isArray(item.parameters) ? Object.keys(item.parameters) : [])];
    for (const name of names) if (parameterNames.has(name) && !result.parameters.includes(name)) result.parameters.push(name);
  }
  return result;
}
