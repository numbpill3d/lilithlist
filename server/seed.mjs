'use strict';

// Fictional demo bulletins, inserted only when the reports table is empty so a
// fresh node has something to browse. These carry no receipt (not owner-editable)
// and are clearly marked as seed data.
const SEED = [
  { risk:'high', region:'northeast', idType:'platform handle fragment', identifier:'handle begins r0am…', title:'Threat after screening request was declined', details:'Contact became aggressive after a routine reference request. They used two different first names and sent repeated messages from a second account after being blocked. No appointment took place.', date:'2026-08', context:'screening / booking', tags:['threat / intimidation','identity mismatch'], corroborations:4, state:'reviewed', ageHours:0.3 },
  { risk:'medium', region:'west', idType:'phone fragment', identifier:'phone ending 4421', title:'Repeated attempt to change agreed boundaries', details:'Terms were confirmed in writing. During the appointment, the client repeatedly attempted to renegotiate a clearly stated boundary and became verbally hostile when the session ended early.', date:'2026-08', context:'in-person appointment', tags:['boundary pushing'], corroborations:7, state:'reviewed', ageHours:1 },
  { risk:'info', region:'online', idType:'venue alias', identifier:'alias traveler77', title:'Verification note: alias reused across platforms', details:'A booking alias appears across several platforms with inconsistent stated details. Not necessarily malicious, but worth independent verification before screening acceptance.', date:'2026-07', context:'screening / booking', tags:['identity mismatch'], corroborations:2, state:'reviewed', ageHours:26 },
  { risk:'safe', region:'midwest', idType:'no identifier / conduct-only', identifier:'', title:'Positive screening: respectful, followed agreed terms', details:'Screening was smooth, references checked out, and agreed terms were respected in full. Sharing as a positive counter-signal. Positive notes do not negate independent warnings.', date:'2026-08', context:'in-person appointment', tags:['positive screening'], corroborations:5, state:'reviewed', ageHours:50 },
  { risk:'medium', region:'south', idType:'phone fragment', identifier:'phone ending 0090', title:'Payment reversed after service completed', details:'Payment was confirmed up front and then reversed via chargeback after the appointment concluded. Documented the agreed terms beforehand. No further contact attempted.', date:'2026-07', context:'payment / chargeback', tags:['payment issue'], corroborations:3, state:'reviewed', ageHours:72 },
  { risk:'high', region:'withheld', idType:'other non-unique marker', identifier:'plate fragment 7XK', title:'Surveillance concern at agreed public meeting point', details:'Noticed the same vehicle circling an agreed public meeting point before contact and photographing the area. Left immediately. Sharing the broad pattern only; region withheld intentionally.', date:'2026-08', context:'transport / venue', tags:['surveillance concern','threat / intimidation'], corroborations:6, state:'review-pending', ageHours:5 }
];

export function seedIfEmpty(store) {
  if (store.stats().total > 0) return 0;
  const db = store.db;
  const now = Date.now();
  const DAY = 86400000;
  const insert = db.prepare(`
    INSERT INTO reports (id, risk, region, id_type, identifier, identifier_norm, title, details,
      date, context, tags, corroborations, state, source, published, receipt_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fictional seed', 1, NULL, ?, ?)
  `);
  let n = 0;
  for (const s of SEED) {
    const created = new Date(now - s.ageHours * 3600000);
    const expires = new Date(created.getTime() + 90 * DAY);
    const norm = String(s.identifier || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    insert.run(`LL-${1000 + n}`, s.risk, s.region, s.idType, s.identifier, norm, s.title, s.details,
      s.date, s.context, JSON.stringify(s.tags), s.corroborations, s.state,
      created.toISOString(), expires.toISOString());
    n++;
  }
  return n;
}
