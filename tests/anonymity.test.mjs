'use strict';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createApp } from '../server/app.mjs';

let server, base, app, dbPath;

before(async () => {
  dbPath = join(tmpdir(), `lilith-anon-${process.pid}-${Date.now()}.db`);
  app = createApp({ dbPath });
  server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix); } catch {} }
});

test('meta exposes version and short node id', async () => {
  const res = await fetch(`${base}/api/meta`);
  assert.equal(res.status, 200);
  const meta = await res.json();
  assert.match(meta.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof meta.node, 'string');
  assert.equal(meta.node.length, 8);
});

test('Onion-Location absent unless configured', async () => {
  delete process.env.LILITH_ONION_URL;
  const res = await fetch(`${base}/index.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('onion-location'), null);
});

test('Onion-Location advertised when LILITH_ONION_URL set', async () => {
  process.env.LILITH_ONION_URL = 'http://exampleonionaddress.onion';
  try {
    const res = await fetch(`${base}/index.html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('onion-location'), 'http://exampleonionaddress.onion/');
  } finally {
    delete process.env.LILITH_ONION_URL;
  }
});
