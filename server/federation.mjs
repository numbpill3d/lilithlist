'use strict';

import { generateKeyPairSync, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Canonical serialization ────────────────────────────────────────────────
// Deterministic JSON (recursively sorted keys) so a signature computed on one
// node verifies byte-for-byte on another.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// ── Node identity (Ed25519) ────────────────────────────────────────────────
// The private key never leaves this node. The public key (base64 SPKI DER) is
// the node's federation id and is pinned out-of-band by peers.
export function loadOrCreateIdentity(path) {
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    const publicKey = createPublicKey({ key: Buffer.from(saved.publicKey, 'base64'), type: 'spki', format: 'der' });
    return makeIdentity(saved.publicKey, publicKey, saved.privateKey);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ publicKey: pubB64, privateKey: privPem }), { mode: 0o600 });
  return makeIdentity(pubB64, publicKey, privPem);
}

function makeIdentity(pubB64, publicKeyObj, privatePem) {
  return {
    id: pubB64,
    publicKey: pubB64,
    signRecord(obj) {
      return edSign(null, Buffer.from(stableStringify(obj), 'utf8'), privatePem).toString('base64');
    },
    _publicKeyObj: publicKeyObj
  };
}

export function publicKeyFromB64(b64) {
  return createPublicKey({ key: Buffer.from(b64, 'base64'), type: 'spki', format: 'der' });
}

export function verifyRecord(obj, sigB64, pubB64) {
  try {
    const key = publicKeyFromB64(pubB64);
    return edVerify(null, Buffer.from(stableStringify(obj), 'utf8'), key, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

// ── Peer configuration ──────────────────────────────────────────────────────
// data/peers.json: [ { "label": "sister-node", "url": "https://…", "pubkey": "<base64>" } ]
// Trust is manual: a peer's bulletins are accepted only if signed by the pinned key.
export function loadPeers(path) {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(p => p && typeof p.url === 'string' && typeof p.pubkey === 'string')
      .map(p => ({ label: String(p.label || p.url), url: p.url.replace(/\/+$/, ''), pubkey: p.pubkey }));
  } catch {
    return [];
  }
}

// ── Feed building (origin → peers) ──────────────────────────────────────────
export function buildFeed(store, identity) {
  const bulletins = store.originFeedBulletins().map(record => ({ record, sig: identity.signRecord(record) }));
  const tombstones = store.feedTombstones().map(record => ({ record, sig: identity.signRecord(record) }));
  return { node: identity.publicKey, bulletins, tombstones };
}

// ── Pull sync (peer → mirrors) ──────────────────────────────────────────────
// Fetches a peer's feed, verifies every record against the pinned key, upserts
// verified bulletins as read-only mirrors, and applies signed tombstones.
export async function pullFromPeer(store, peer, { fetchImpl = fetch, now = Date.now() } = {}) {
  const result = { peer: peer.label, added: 0, removed: 0, rejected: 0, error: null };
  let feed;
  try {
    const res = await fetchImpl(`${peer.url}/api/federation/feed`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feed = await res.json();
  } catch (err) {
    result.error = err.message;
    return result;
  }
  if (!feed || feed.node !== peer.pubkey || !Array.isArray(feed.bulletins)) {
    result.error = 'feed identity mismatch or malformed';
    return result;
  }
  for (const entry of feed.bulletins) {
    if (!entry || !entry.record || typeof entry.record.id !== 'string') { result.rejected++; continue; }
    if (!verifyRecord(entry.record, entry.sig, peer.pubkey)) { result.rejected++; continue; }
    if (Number.isFinite(Date.parse(entry.record.expiresAt)) && Date.parse(entry.record.expiresAt) <= now) continue;
    store.upsertMirror(peer.pubkey, entry.record);
    result.added++;
  }
  for (const entry of (feed.tombstones || [])) {
    if (!entry || !entry.record || typeof entry.record.id !== 'string') { result.rejected++; continue; }
    if (!verifyRecord(entry.record, entry.sig, peer.pubkey)) { result.rejected++; continue; }
    if (store.removeMirror(peer.pubkey, entry.record.id)) result.removed++;
  }
  return result;
}
