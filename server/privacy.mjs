'use strict';

// Shared privacy / PII detection. The browser runs an equivalent check for
// fast feedback, but the server re-runs this authoritatively and rejects any
// submission that trips a pattern. Never trust the client with de-identification.

const PATTERNS = [
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['full or formatted phone number', /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/],
  ['web address', /\b(?:https?:\/\/|www\.)\S+/i],
  ['direct social handle', /(^|\s)@[a-z0-9_.-]{3,}/i],
  ['street address', /\b\d{1,5}\s+[a-z0-9.' -]+\s(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive)\b/i],
  ['exact date', /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/],
  ['likely room number', /\b(?:room|rm|suite)\s*#?\d{2,5}\b/i]
];

// Returns an array of human-readable labels for every pattern found in the
// combined free-text fields of a report.
export function privacyFindings(fields) {
  const haystack = [fields.title, fields.identifier, fields.details]
    .map(v => String(v || ''))
    .join(' ');
  return PATTERNS.filter(([, regex]) => regex.test(haystack)).map(([label]) => label);
}

export { PATTERNS };
