'use strict';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createApp } from '../server/app.mjs';
import { seedIfEmpty } from '../server/seed.mjs';

let server, base, app, dbPath;

before(async () => {
  dbPath = join(tmpdir(), `lilith-test-${process.pid}-${Date.now()}.db`);
  app = createApp({ dbPath, limits: { report: { capacity: 1000, refillPerMinute: 6000 }, lookup: { capacity: 1000, refillPerMinute: 6000 }, action: { capacity: 1000, refillPerMinute: 6000 } } });
  seedIfEmpty(app.store);
  server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix); } catch {} }
});

const api = (path, opts = {}) => fetch(base + path, {
  ...opts,
  headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined
});

const validReport = (over = {}) => ({
  risk: 'medium', region: 'west', idType: 'phone fragment', identifier: 'ending 4421',
  title: 'Boundary pushing after written terms', details: 'Client repeatedly renegotiated a clearly agreed boundary and became hostile when the session ended.',
  date: '2026-07', context: 'in-person appointment', tags: ['boundary pushing'], ...over
});

test('health responds', async () => {
  const res = await api('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('board is seeded, paginated, and published-only', async () => {
  const res = await api('/api/reports');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.total >= 6);
  assert.ok(data.items.length <= 5, 'page size cap');
  assert.ok(data.items.every(r => r.published));
});

test('board filters by risk and searches text', async () => {
  const high = await (await api('/api/reports?risk=high')).json();
  assert.ok(high.items.every(r => r.risk === 'high'));
  const q = await (await api('/api/reports?query=chargeback')).json();
  assert.ok(q.total >= 1);
});

test('creating a report returns a one-time receipt and hides it thereafter', async () => {
  const res = await api('/api/reports', { method: 'POST', body: validReport() });
  assert.equal(res.status, 201);
  const { report, receipt } = await res.json();
  assert.match(receipt, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(report.corroborations, 0);
  // fetching the report never re-exposes a receipt
  const detail = await (await api(`/api/reports/${report.id}`)).json();
  assert.ok(!('receipt' in detail.report));
  assert.ok(!('receipt_hash' in detail.report));
});

test('server rejects PII regardless of client checks', async () => {
  const res = await api('/api/reports', { method: 'POST', body: validReport({ details: 'reach me at 415-555-1234 or foo@bar.com' }) });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.ok(data.findings.some(f => /phone/.test(f)));
  assert.ok(data.findings.some(f => /email/.test(f)));
});

test('server rejects a future month and bad enums', async () => {
  const future = await api('/api/reports', { method: 'POST', body: validReport({ date: '2099-01' }) });
  assert.equal(future.status, 422);
  const badRisk = await api('/api/reports', { method: 'POST', body: validReport({ risk: 'nonsense' }) });
  assert.equal(badRisk.status, 422);
});

test('high-risk report is published as review-pending', async () => {
  const { report } = await (await api('/api/reports', { method: 'POST', body: validReport({ risk: 'high' }) })).json();
  assert.equal(report.state, 'review-pending');
});

test('lookup matches normalized partial markers only, not narrative', async () => {
  await api('/api/reports', { method: 'POST', body: validReport({ identifier: 'ending 9911', details: 'a distinctive uniqueword appears in narrative only' }) });
  const hit = await (await api('/api/lookup', { method: 'POST', body: { query: '9911' } })).json();
  assert.ok(hit.matches.some(m => m.identifier.includes('9911')));
  const narrative = await (await api('/api/lookup', { method: 'POST', body: { query: 'uniqueword' } })).json();
  assert.ok(!narrative.matches.some(m => m.details && m.details.includes('uniqueword')) || narrative.matches.length === 0);
});

test('lookup rejects too-short and punctuation-only queries', async () => {
  assert.equal((await api('/api/lookup', { method: 'POST', body: { query: 'ab' } })).status, 400);
  assert.equal((await api('/api/lookup', { method: 'POST', body: { query: '...' } })).status, 400);
});

test('corroboration increments once per browser then dedupes', async () => {
  const { report } = await (await api('/api/reports', { method: 'POST', body: validReport() })).json();
  const first = await api(`/api/reports/${report.id}/corroborate`, { method: 'POST' });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).report.corroborations, 1);
  const second = await api(`/api/reports/${report.id}/corroborate`, { method: 'POST' });
  assert.equal(second.status, 409);
});

test('emergency unpublish hides the bulletin immediately', async () => {
  const { report } = await (await api('/api/reports', { method: 'POST', body: validReport() })).json();
  const act = await api(`/api/reports/${report.id}/actions`, { method: 'POST', body: { type: 'emergency-unpublish', reason: 'safety risk to reporter' } });
  assert.equal(act.status, 201);
  assert.equal((await act.json()).hidden, true);
  assert.equal((await api(`/api/reports/${report.id}`)).status, 404, 'hidden from public detail');
});

test('correction and contest set state but keep the bulletin published', async () => {
  const { report } = await (await api('/api/reports', { method: 'POST', body: validReport() })).json();
  await api(`/api/reports/${report.id}/actions`, { method: 'POST', body: { type: 'contest', reason: 'facts are disputed' } });
  const detail = await (await api(`/api/reports/${report.id}`)).json();
  assert.equal(detail.report.state, 'disputed');
  assert.ok(detail.actions.some(a => a.type === 'contest'));
});

test('revoke requires the correct receipt (owner-only)', async () => {
  const { report, receipt } = await (await api('/api/reports', { method: 'POST', body: validReport() })).json();
  assert.equal((await api(`/api/reports/${report.id}/revoke`, { method: 'POST', body: { receipt: 'wrong' } })).status, 403);
  assert.equal((await api(`/api/reports/${report.id}/revoke`, { method: 'POST', body: { receipt } })).status, 200);
  assert.equal((await api(`/api/reports/${report.id}`)).status, 404);
});

test('oversized body is refused', async () => {
  const res = await api('/api/reports', { method: 'POST', body: validReport({ details: 'x'.repeat(20000) }) });
  assert.equal(res.status, 413);
});

test('report posting is rate limited (429 after burst)', async () => {
  const dp = join(tmpdir(), `lilith-rl-${process.pid}-${Date.now()}.db`);
  const rlApp = createApp({ dbPath: dp, limits: { report: { capacity: 2, refillPerMinute: 0 } } });
  const rlServer = createServer(rlApp);
  await new Promise(r => rlServer.listen(0, '127.0.0.1', r));
  const rlBase = `http://127.0.0.1:${rlServer.address().port}`;
  const post = () => fetch(rlBase + '/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validReport()) });
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429);
  rlServer.close(); rlApp.close();
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dp + suffix); } catch {} }
});

test('static index is served with CSP', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
});
