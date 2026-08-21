'use strict';

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

// Field-level encryption at rest for sensitive free text (report narratives,
// lifecycle reasons, moderation notes). The key is supplied by the operator via
// LILITH_SECRET_KEY (32 bytes, hex or base64) and never stored in the database.
//
// Stored format:
//   enc:1:<base64(iv|tag|ciphertext)>   when a key is configured (AES-256-GCM)
//   enc:0:<utf8>                        when no key is configured (dev/plaintext)
//
// Both prefixes decrypt correctly, so a node can be started without a key for
// local development and later given one for production without a migration for
// newly written rows. (Rows written in one mode are readable in the same mode.)

function loadKey() {
  const raw = process.env.LILITH_SECRET_KEY;
  if (!raw) return null;
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('LILITH_SECRET_KEY must be 32 bytes (64 hex chars or base64 of 32 bytes).');
  }
  return key;
}

let KEY;
export function encryptionEnabled() {
  if (KEY === undefined) KEY = loadKey();
  return KEY !== null;
}

export function encryptField(plaintext) {
  const text = String(plaintext ?? '');
  if (!encryptionEnabled()) return 'enc:0:' + text;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'enc:1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptField(stored) {
  const value = String(stored ?? '');
  if (value.startsWith('enc:0:')) return value.slice(6);
  if (value.startsWith('enc:1:')) {
    if (!encryptionEnabled()) throw new Error('Encrypted data present but LILITH_SECRET_KEY is not set.');
    const buf = Buffer.from(value.slice(6), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
  return value; // legacy plaintext (pre-encryption rows)
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

// Test/reset hook.
export function _resetKeyCache() { KEY = undefined; }
