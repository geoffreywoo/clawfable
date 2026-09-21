/** Frozen deterministic scorer. No network, model judge, repairs, or execution of output. */
export const FIELDS = ['supplier', 'invoice_number', 'invoice_date', 'due_date', 'currency', 'invoice_total'];
const KEYS = [...FIELDS, 'review_fields'].sort();
const normalizeSupplier = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ') : value;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// JSON.parse accepts duplicate keys. Reject them rather than silently choosing a value.
function hasDuplicateKeys(text) {
  let depth = 0;
  const keys = new Set();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') depth++;
    else if (text[i] === '}' || text[i] === ']') depth--;
    else if (text[i] === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(text[next] || '') && next < text.length) next++;
      if (depth === 1 && text[next] === ':') {
        const key = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return false;
}

export function scoreResponse(expected, raw) {
  const invalid = reason => ({ accepted: false, schemaValid: false, fieldsCorrect: 0, reviewCorrect: false, fieldMatches: Object.fromEntries(FIELDS.map(key => [key, false])), reason });
  if (typeof raw !== 'string') return invalid('No text response');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return invalid('Not one JSON value'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('Not an object');
  if (hasDuplicateKeys(raw)) return invalid('Duplicate keys');
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(KEYS)) return invalid('Missing or extra keys');
  if (FIELDS.some(key => parsed[key] !== null && (typeof parsed[key] !== 'string' || !parsed[key].trim()))) return invalid('Fields must be nonempty strings or null');
  if (['invoice_date', 'due_date'].some(key => parsed[key] !== null && !validDate(parsed[key]))) return invalid('Noncanonical or impossible date');
  if (parsed.currency !== null && !['USD', 'GBP', 'EUR'].includes(parsed.currency)) return invalid('Noncanonical currency');
  if (parsed.invoice_total !== null && !/^(?:0|[1-9]\d*)\.\d{2}$/.test(parsed.invoice_total)) return invalid('Noncanonical invoice total');
  if (!Array.isArray(parsed.review_fields) || parsed.review_fields.some(key => !FIELDS.includes(key))
    || JSON.stringify(parsed.review_fields) !== JSON.stringify([...new Set(parsed.review_fields)].sort())) return invalid('Review fields must be sorted and unique');
  const fieldMatches = Object.fromEntries(FIELDS.map(key => [key,
    key === 'supplier' ? normalizeSupplier(parsed[key]) === normalizeSupplier(expected[key]) : parsed[key] === expected[key]]));
  const fieldsCorrect = Object.values(fieldMatches).filter(Boolean).length;
  const reviewCorrect = JSON.stringify(parsed.review_fields) === JSON.stringify(expected.review_fields);
  const reviewConsistent = JSON.stringify(parsed.review_fields) === JSON.stringify(FIELDS.filter(key => parsed[key] === null).sort());
  return { accepted: fieldsCorrect === FIELDS.length && reviewCorrect && reviewConsistent, schemaValid: true, fieldsCorrect, reviewCorrect, reviewConsistent, fieldMatches, reason: null };
}
