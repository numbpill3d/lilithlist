'use strict';

import { privacyFindings } from './privacy.mjs';

export const RETENTION_DAYS = 90;
export const PAGE_SIZE = 5;

export const RISKS = ['high', 'medium', 'info', 'safe'];
export const REGIONS = ['withheld', 'northeast', 'midwest', 'south', 'west', 'online'];
export const CONTEXTS = ['screening / booking', 'in-person appointment', 'online session', 'payment / chargeback', 'transport / venue', 'other'];
export const ID_TYPES = ['no identifier / conduct-only', 'phone fragment', 'platform handle fragment', 'email fragment', 'venue alias', 'other non-unique marker'];
export const TAGS = ['boundary pushing', 'payment issue', 'threat / intimidation', 'surveillance concern', 'identity mismatch', 'positive screening'];
export const ACTION_TYPES = ['correction', 'contest', 'emergency-unpublish'];

export const RISK_ORDER = { high: 0, medium: 1, info: 2, safe: 3 };

function str(v) { return typeof v === 'string' ? v.trim() : ''; }

// Authoritative server-side validation of an inbound report submission.
// Returns { errors: string[], value } where value is a normalized draft when
// there are no errors. The browser validates too, but this is the real gate.
export function validateReportInput(body) {
  const errors = [];
  const value = {
    risk: str(body.risk),
    region: str(body.region),
    idType: str(body.idType),
    identifier: str(body.identifier),
    title: str(body.title),
    details: str(body.details),
    date: str(body.date),
    context: str(body.context),
    tags: Array.isArray(body.tags) ? body.tags.filter(t => TAGS.includes(t)) : []
  };

  if (!RISKS.includes(value.risk)) errors.push('Choose a valid safety level.');
  if (!REGIONS.includes(value.region)) errors.push('Choose a valid broad region.');
  if (!ID_TYPES.includes(value.idType)) errors.push('Choose a valid identifier type.');
  if (!CONTEXTS.includes(value.context)) errors.push('Choose a valid context.');
  if (!value.title) errors.push('A bulletin title is required.');
  if (value.title.length > 90) errors.push('Title must be 90 characters or fewer.');
  if (!value.details) errors.push('A description of what happened is required.');
  if (value.details.length > 1200) errors.push('Description must be 1200 characters or fewer.');
  if (value.identifier.length > 32) errors.push('Partial identifier must be 32 characters or fewer.');

  if (!/^\d{4}-\d{2}$/.test(value.date)) {
    errors.push('Provide an approximate month.');
  } else if (value.date > new Date().toISOString().slice(0, 7)) {
    errors.push('Approximate month cannot be in the future.');
  }

  for (const finding of privacyFindings(value)) {
    errors.push(`Remove or further redact the detected ${finding}.`);
  }

  return { errors, value };
}

export function validateAction(body) {
  const errors = [];
  const type = str(body.type);
  const reason = str(body.reason);
  if (!ACTION_TYPES.includes(type)) errors.push('Unknown lifecycle action.');
  if (!reason) errors.push('A reason is required.');
  if (reason.length > 500) errors.push('Reason must be 500 characters or fewer.');
  return { errors, value: { type, reason } };
}
