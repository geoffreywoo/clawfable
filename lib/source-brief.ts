/** KV may deserialize JSON hash values; callers always receive a stable string. */
export function normalizeSourceBrief(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value;
    try {
      const parsed = JSON.parse(text);
      // Preserve ordinary prose (including JSON scalar-looking text) verbatim.
      if (!parsed || typeof parsed !== 'object') return text;
      value = parsed;
    } catch { return text; }
  }
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(Object.keys(nested).sort().map(key => [key, nested[key]]));
  }) ?? null;
}
