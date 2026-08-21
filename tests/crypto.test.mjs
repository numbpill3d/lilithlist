'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { encryptField, decryptField, encryptionEnabled, _resetKeyCache } from '../server/crypto.mjs';

test('no key: values are marked plaintext and round-trip', () => {
  delete process.env.LILITH_SECRET_KEY; _resetKeyCache();
  assert.equal(encryptionEnabled(), false);
  const stored = encryptField('hello world');
  assert.ok(stored.startsWith('enc:0:'));
  assert.equal(decryptField(stored), 'hello world');
});

test('with key: AES-256-GCM ciphertext round-trips and hides plaintext', () => {
  process.env.LILITH_SECRET_KEY = 'a'.repeat(64); // 32 bytes as hex
  _resetKeyCache();
  assert.equal(encryptionEnabled(), true);
  const stored = encryptField('sensitive narrative text');
  assert.ok(stored.startsWith('enc:1:'));
  assert.ok(!stored.includes('sensitive'));
  assert.equal(decryptField(stored), 'sensitive narrative text');
  assert.equal(decryptField('legacy bare plaintext'), 'legacy bare plaintext'); // pre-encryption rows
});

test('with key: tampered ciphertext fails authentication', () => {
  process.env.LILITH_SECRET_KEY = 'b'.repeat(64);
  _resetKeyCache();
  const bad = 'enc:1:' + Buffer.from('x'.repeat(48)).toString('base64');
  assert.throws(() => decryptField(bad));
});

test('rejects an invalid key length', () => {
  process.env.LILITH_SECRET_KEY = 'too-short';
  _resetKeyCache();
  assert.throws(() => encryptionEnabled(), /32 bytes/);
  delete process.env.LILITH_SECRET_KEY; _resetKeyCache();
});

test('report narrative is stored as ciphertext at rest', async () => {
  process.env.LILITH_SECRET_KEY = 'c'.repeat(64);
  _resetKeyCache();
  const { Store } = await import('../server/db.mjs?enc'); // fresh module graph not required; Store reads crypto live
  const dbPath = join(tmpdir(), `lilith-enc-${process.pid}-${Date.now()}.db`);
  const store = new Store(dbPath);
  const { report } = store.create({ risk: 'medium', region: 'west', idType: 'phone fragment',
    identifier: 'ending 1', title: 'T', details: 'PLAINTEXT-NEEDLE-42', date: '2026-07',
    context: 'other', tags: [] });
  // API-level read decrypts
  assert.equal(store.get(report.id).details, 'PLAINTEXT-NEEDLE-42');
  // raw column is ciphertext
  const raw = store.db.prepare('SELECT details FROM reports WHERE id = ?').get(report.id).details;
  assert.ok(raw.startsWith('enc:1:'));
  assert.ok(!raw.includes('NEEDLE'));
  store.close();
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix); } catch {} }
  delete process.env.LILITH_SECRET_KEY; _resetKeyCache();
});
