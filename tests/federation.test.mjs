'use strict';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createApp } from '../server/app.mjs';
import { stableStringify, verifyRecord } from '../server/federation.mjs';

let dir, appA, appB, serverA, serverB, baseA, baseB;

const validReport = (over = {}) => ({
  risk: 'medium', region: 'west', idType: 'phone fragment', identifier: 'ending 7788',
  title: 'Federated boundary report', details: 'Client repeatedly renegotiated an agreed boundary and became hostile.',
  date: '2026-07', context: 'in-person appointment', tags: ['boundary pushing'], ...over
});
const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', r));
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (base, path) => fetch(base + path);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lilith-fed-'));
  const genLimits = { report: { capacity: 1000, refillPerMinute: 6000 }, action: { capacity: 1000, refillPerMinute: 6000 } };

  appA = createApp({ dbPath: join(dir, 'a.db'), nodeKeyPath: join(dir, 'a-key.json'), peersPath: join(dir, 'a-peers.json'), limits: genLimits });
  serverA = createServer(appA); await listen(serverA); baseA = `http://127.0.0.1:${serverA.address().port}`;

  // Pin A as B's trusted peer.
  writeFileSync(join(dir, 'b-peers.json'), JSON.stringify([{ label: 'node-A', url: baseA, pubkey: appA.identity.publicKey }]));
  appB = createApp({ dbPath: join(dir, 'b.db'), nodeKeyPath: join(dir, 'b-key.json'), peersPath: join(dir, 'b-peers.json'), limits: genLimits });
  serverB = createServer(appB); await listen(serverB); baseB = `http://127.0.0.1:${serverB.address().port}`;
});

after(() => {
  serverA.close(); serverB.close(); appA.close(); appB.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('nodes have distinct signing identities', () => {
  assert.notEqual(appA.identity.publicKey, appB.identity.publicKey);
});

test('feed is signed and every record verifies against the node key', async () => {
  await post(baseA, '/api/reports', validReport());
  const feed = await (await get(baseA, '/api/federation/feed')).json();
  assert.equal(feed.node, appA.identity.publicKey);
  assert.ok(feed.bulletins.length >= 1);
  for (const entry of feed.bulletins) {
    assert.ok(verifyRecord(entry.record, entry.sig, appA.identity.publicKey), 'signature must verify');
  }
});

test('feed excludes fictional seeds (only node-authored bulletins federate)', async () => {
  const feed = await (await get(baseA, '/api/federation/feed')).json();
  assert.ok(feed.bulletins.every(e => !e.record.id.startsWith('LL-10')), 'seeds LL-100x must not federate');
});

test('B pulls, verifies, and mirrors A\'s bulletin (read-only)', async () => {
  const { report } = await (await post(baseA, '/api/reports', validReport({ title: 'Mirror me across nodes' }))).json();
  const results = await appB.syncAllPeers();
  assert.ok(results[0].added >= 1 && results[0].rejected === 0, JSON.stringify(results[0]));

  const board = await (await get(baseB, '/api/reports?query=Mirror me across nodes')).json();
  const mirrored = board.items.find(r => r.id === report.id);
  assert.ok(mirrored, 'mirror should appear on B board');
  assert.equal(mirrored.mirror, true);
  assert.equal(mirrored.origin, appA.identity.publicKey);

  // detail works and is read-only
  const detail = await (await get(baseB, `/api/reports/${report.id}`)).json();
  assert.equal(detail.mirror, true);
  assert.deepEqual(detail.actions, []);
  // local actions on a mirror are refused (not in B's reports table)
  assert.equal((await post(baseB, `/api/reports/${report.id}/corroborate`, {})).status, 404);
});

test('tombstone propagates: revoking on A removes the mirror on B', async () => {
  const { report, receipt } = await (await post(baseA, '/api/reports', validReport({ title: 'Temporary cross-node bulletin' }))).json();
  await appB.syncAllPeers();
  assert.ok((await (await get(baseB, `/api/reports/${report.id}`)).json()).report, 'mirror present after first sync');

  const rev = await post(baseA, `/api/reports/${report.id}/revoke`, { receipt });
  assert.equal(rev.status, 200);
  const results = await appB.syncAllPeers();
  assert.ok(results[0].removed >= 1, JSON.stringify(results[0]));
  assert.equal((await get(baseB, `/api/reports/${report.id}`)).status, 404, 'mirror removed after tombstone');
});

test('forged signatures are rejected (tamper + wrong key)', async () => {
  const feed = await (await get(baseA, '/api/federation/feed')).json();
  const entry = feed.bulletins[0];
  // tamper the record: signature no longer matches
  const tampered = { ...entry.record, title: entry.record.title + ' (injected)' };
  assert.equal(verifyRecord(tampered, entry.sig, appA.identity.publicKey), false);
  // valid record, wrong pinned key
  assert.equal(verifyRecord(entry.record, entry.sig, appB.identity.publicKey), false);
  // stableStringify is order-independent
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
});

test('sync requires a moderator; feed is public', async () => {
  assert.equal((await get(baseB, '/api/federation/feed')).status, 200);
  assert.equal((await post(baseB, '/api/federation/sync', {})).status, 401);
  assert.equal((await get(baseB, '/api/federation/status')).status, 401);
});
