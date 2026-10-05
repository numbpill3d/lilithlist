'use strict';

import { existsSync, readFileSync } from 'node:fs';

// Community crisis resources shown in the guide's "urgent support" section.
// Operators MUST localize this file: copy docs/resources.json.example to the
// LILITH_RESOURCES path and replace entries with verified local resources,
// keeping a `verified` (YYYY-MM) date on each. Built-ins are US defaults.
const BUILTINS = [
  { name: 'US Suicide & Crisis Lifeline', contact: 'Call or text 988', url: 'https://988lifeline.org', verified: '2026-01' },
  { name: 'Crisis Text Line (US)', contact: 'Text HOME to 741741', url: 'https://crisistextline.org', verified: '2026-01' },
  { name: 'RAINN National Sexual Assault Hotline', contact: '1-800-656-4673', url: 'https://rainn.org', verified: '2026-01' }
];

export function loadResources(path) {
  const file = path || process.env.LILITH_RESOURCES || 'data/resources.json';
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(parsed) && parsed.every(r => r && typeof r.name === 'string')) {
        return parsed.map(r => ({
          name: String(r.name).slice(0, 80),
          contact: String(r.contact || '').slice(0, 120),
          url: String(r.url || '').slice(0, 200),
          verified: String(r.verified || 'unverified').slice(0, 20)
        }));
      }
    } catch { /* fall through to built-ins */ }
  }
  return BUILTINS;
}
