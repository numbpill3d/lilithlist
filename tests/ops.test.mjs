'use strict';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createApp } from '../server/app.mjs';

let server, base, app, dbPath, modToken;

before(async () => {
  dbPath = join(tmpdir(), `lilith-ops-${process.pid}-${Date.now()}.db`);
  app = createApp({ dbPath });
  app.store.ensureBootstrapModerator('test-ops-key-abcdefghij');
  server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/mod/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'test-ops-key-abcdefghij' })
  });
  modToken = (await login.json()).token;
});

after(() => {
  server.close();
  app.close();
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix); } catch {} }
});

const mod = (path, opts = {}) => fetch(base + path, {
  ...opts,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${modToken}`, ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined
});

test('meta reports demo mode outside production', async () => {
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.equal(meta.demo, true);
});

test('moderator team: list, add, login with new key, remove', async () => {
  const list1 = await (await mod('/api/mod/moderators')).json();
  assert.equal(list1.moderators.length, 1);

  const added = await mod('/api/mod/moderators', { method: 'POST', body: { label: 'night-shift' } });
  assert.equal(added.status, 201);
  const { moderator, key } = await added.json();
  assert.equal(moderator.label, 'night-shift');
  assert.ok(key.length >= 16, 'usable key shown once');

  const login = await fetch(`${base}/api/mod/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key })
  });
  assert.equal(login.status, 200);

  const removed = await mod(`/api/mod/moderators/${moderator.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);

  const list2 = await (await mod('/api/mod/moderators')).json();
  assert.equal(list2.moderators.length, 1);
});

test('cannot remove the last moderator', async () => {
  const list = await (await mod('/api/mod/moderators')).json();
  const res = await mod(`/api/mod/moderators/${list.moderators[0].id}`, { method: 'DELETE' });
  assert.equal(res.status, 409);
});

test('team endpoints require moderator auth', async () => {
  const res = await fetch(`${base}/api/mod/moderators`);
  assert.equal(res.status, 401);
});

test('resources endpoint serves crisis resources', async () => {
  const res = await fetch(`${base}/api/resources`);
  assert.equal(res.status, 200);
  const { resources } = await res.json();
  assert.ok(Array.isArray(resources) && resources.length > 0);
  assert.ok(resources.every(r => r.name && r.contact && r.verified));
});
