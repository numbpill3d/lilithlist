'use strict';

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Store } from './db.mjs';
import { validateReportInput, validateAction } from './domain.mjs';
import { RateLimiter } from './ratelimit.mjs';
import { loadOrCreateIdentity, loadPeers, buildFeed, pullFromPeer } from './federation.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
  '/icon.svg': 'icon.svg'
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
const MAX_BODY = 16 * 1024;

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : (headers['Content-Type'] || 'text/plain; charset=utf-8'),
    ...headers
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let aborted = false;
    const chunks = [];
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY) { aborted = true; reject(new Error('body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

// Only honor X-Forwarded-For when explicitly told we sit behind a trusted proxy
// (TRUST_PROXY=1). Otherwise a direct client could spoof the header to dodge
// rate limiting and corroboration dedup.
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
function clientKey(req, secret, scope = '') {
  let ip = req.socket?.remoteAddress || 'local';
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
    if (forwarded) ip = forwarded;
  }
  return createHash('sha256').update(ip + '|' + scope + '|' + secret).digest('hex');
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

const DEFAULT_LIMITS = {
  report: { capacity: 5, refillPerMinute: 5 },
  lookup: { capacity: 5, refillPerMinute: 5 },
  action: { capacity: 20, refillPerMinute: 20 }
};

export function createApp({ dbPath = 'data/lilithlist.db', limits = {}, nodeKeyPath, peersPath: peersPathOpt } = {}) {
  const store = new Store(dbPath);
  const secret = randomBytes(24).toString('hex');
  const cfg = {
    report: { ...DEFAULT_LIMITS.report, ...(limits.report || {}) },
    lookup: { ...DEFAULT_LIMITS.lookup, ...(limits.lookup || {}) },
    action: { ...DEFAULT_LIMITS.action, ...(limits.action || {}) }
  };
  const limiters = {
    report: new RateLimiter(cfg.report),
    lookup: new RateLimiter(cfg.lookup),
    action: new RateLimiter(cfg.action)
  };
  const identity = loadOrCreateIdentity(nodeKeyPath || process.env.LILITH_NODE_KEY || 'data/node_identity.json');
  const peersPath = peersPathOpt || process.env.LILITH_PEERS || 'data/peers.json';
  let peers = loadPeers(peersPath);
  const reloadPeers = () => { peers = loadPeers(peersPath); return peers; };
  async function syncAllPeers() {
    const results = [];
    for (const peer of peers) results.push(await pullFromPeer(store, peer));
    return results;
  }
  const pruneTimer = setInterval(() => {
    for (const l of Object.values(limiters)) l.prune();
  }, 3600000);
  if (pruneTimer.unref) pruneTimer.unref();
  const federationInterval = Number.parseInt(process.env.FEDERATION_INTERVAL_MS || '0', 10);
  let syncTimer = null;
  if (federationInterval > 0) {
    syncTimer = setInterval(() => { syncAllPeers().catch(() => {}); }, federationInterval);
    if (syncTimer.unref) syncTimer.unref();
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    try {
      if (path.startsWith('/api/')) return await api(req, res, url, method);
      return await serveStatic(res, path);
    } catch (err) {
      if (err.message === 'body too large') return send(res, 413, { error: 'Request body too large.' });
      if (err.message === 'invalid json') return send(res, 400, { error: 'Invalid JSON body.' });
      return send(res, 500, { error: 'Internal error.' });
    }
  }

  async function serveStatic(res, path) {
    const rel = STATIC_FILES[path];
    if (!rel) return send(res, 404, 'not found');
    const full = normalize(join(ROOT, rel));
    if (!full.startsWith(ROOT)) return send(res, 403, 'forbidden');
    const ext = '.' + rel.split('.').pop();
    const data = await readFile(full);
    return send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  }

  async function api(req, res, url, method) {
    const path = url.pathname;

    if (path === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
    if (path === '/api/stats' && method === 'GET') return send(res, 200, store.stats());

    if (path === '/api/reports' && method === 'GET') {
      return send(res, 200, store.listPublished({
        query: url.searchParams.get('query') || '',
        region: url.searchParams.get('region') || 'all',
        risk: url.searchParams.get('risk') || 'all',
        sort: url.searchParams.get('sort') || 'newest',
        page: Number.parseInt(url.searchParams.get('page') || '1', 10) || 1
      }));
    }

    if (path === '/api/reports' && method === 'POST') {
      if (!limiters.report.take(clientKey(req, secret, 'report')).allowed) {
        return send(res, 429, { error: 'Posting rate limit reached. Pause before filing another report.' });
      }
      const body = await readJson(req);
      const { errors, value } = validateReportInput(body);
      if (errors.length) return send(res, 422, { error: 'Privacy review failed.', findings: [...new Set(errors)] });
      const { report, receipt } = store.create(value);
      return send(res, 201, { report, receipt });
    }

    if (path === '/api/lookup' && method === 'POST') {
      if (!limiters.lookup.take(clientKey(req, secret, 'lookup')).allowed) {
        return send(res, 429, { error: 'Demo lookup limit reached. Pause before searching again.' });
      }
      const body = await readJson(req);
      const raw = String(body.query || '').trim();
      const normalized = Store.normIdentifier(raw);
      if (raw.length < 3 || normalized.length < 3) {
        return send(res, 400, { error: 'Use at least 3 letters or numbers for a privacy-minimized lookup.' });
      }
      return send(res, 200, { matches: store.lookup(normalized) });
    }

    const reportMatch = path.match(/^\/api\/reports\/([A-Za-z0-9-]+)(\/[a-z]+)?$/);
    if (reportMatch) {
      const id = reportMatch[1];
      const sub = reportMatch[2];

      if (!sub && method === 'GET') {
        const report = store.get(id);
        if (report) return send(res, 200, { report, actions: store.actionsFor(id) });
        const mirror = store.getMirror(id);
        if (mirror) return send(res, 200, { report: mirror, actions: [], mirror: true });
        return send(res, 404, { error: 'Bulletin not found or no longer published.' });
      }

      if (sub === '/corroborate' && method === 'POST') {
        if (!limiters.action.take(clientKey(req, secret, 'action')).allowed) {
          return send(res, 429, { error: 'Too many actions. Slow down.' });
        }
        const result = store.corroborate(id, clientKey(req, secret, 'vote:' + id));
        if (!result.ok && result.code === 404) return send(res, 404, { error: 'Bulletin not found.' });
        if (!result.ok && result.code === 409) return send(res, 409, { error: 'Already corroborated from this browser.', report: result.report });
        return send(res, 200, { report: result.report });
      }

      if (sub === '/actions' && method === 'POST') {
        if (!limiters.action.take(clientKey(req, secret, 'action')).allowed) {
          return send(res, 429, { error: 'Too many actions. Slow down.' });
        }
        const body = await readJson(req);
        const { errors, value } = validateAction(body);
        if (errors.length) return send(res, 422, { error: errors[0] });
        const result = store.addAction(id, value);
        if (!result.ok) return send(res, 404, { error: 'Bulletin not found.' });
        return send(res, 201, { action: result.action, hidden: result.hidden });
      }

      if (sub === '/revoke' && method === 'POST') {
        const body = await readJson(req);
        const result = store.revoke(id, String(body.receipt || ''));
        if (!result.ok && result.code === 404) return send(res, 404, { error: 'Bulletin not found.' });
        if (!result.ok && result.code === 403) return send(res, 403, { error: 'Receipt did not match. Only the reporter can revoke this bulletin.' });
        return send(res, 200, { ok: true });
      }
    }

    // ── Federation ─────────────────────────────────────────────────────────
    if (path === '/api/federation/feed' && method === 'GET') {
      return send(res, 200, buildFeed(store, identity));
    }
    if (path === '/api/federation/status') {
      const mod = store.moderatorForToken(bearer(req));
      if (!mod) return send(res, 401, { error: 'Moderator authentication required.' });
      if (method === 'GET') {
        return send(res, 200, {
          node: identity.publicKey,
          peers: peers.map(p => ({ label: p.label, url: p.url, pubkey: p.pubkey })),
          mirrors: store.mirrorCount()
        });
      }
    }
    if (path === '/api/federation/sync' && method === 'POST') {
      const mod = store.moderatorForToken(bearer(req));
      if (!mod) return send(res, 401, { error: 'Moderator authentication required.' });
      reloadPeers();
      const results = await syncAllPeers();
      return send(res, 200, { results, mirrors: store.mirrorCount() });
    }

    // ── Moderation (bearer-authenticated) ──────────────────────────────────
    if (path === '/api/mod/login' && method === 'POST') {
      if (!limiters.action.take(clientKey(req, secret, 'modlogin')).allowed) {
        return send(res, 429, { error: 'Too many login attempts. Slow down.' });
      }
      const body = await readJson(req);
      const session = store.login(String(body.key || ''));
      if (!session) return send(res, 401, { error: 'Invalid moderator key.' });
      return send(res, 200, session);
    }

    if (path.startsWith('/api/mod/')) {
      const mod = store.moderatorForToken(bearer(req));
      if (!mod) return send(res, 401, { error: 'Moderator authentication required.' });

      if (path === '/api/mod/session' && method === 'GET') return send(res, 200, { label: mod.label });
      if (path === '/api/mod/logout' && method === 'POST') { store.logout(bearer(req)); return send(res, 200, { ok: true }); }
      if (path === '/api/mod/queue' && method === 'GET') return send(res, 200, { queue: store.queue(), stats: store.stats() });

      const resolveMatch = path.match(/^\/api\/mod\/reports\/([A-Za-z0-9-]+)\/resolve$/);
      if (resolveMatch && method === 'POST') {
        const body = await readJson(req);
        const action = String(body.action || '');
        if (!['approve', 'remove', 'restore', 'dismiss'].includes(action)) {
          return send(res, 400, { error: 'Unknown resolution action.' });
        }
        const note = String(body.note || '').slice(0, 500);
        const result = store.resolve(resolveMatch[1], { action, note, moderatorLabel: mod.label });
        if (!result.ok) return send(res, result.code === 404 ? 404 : 400, { error: 'Could not resolve that bulletin.' });
        return send(res, 200, { report: result.report });
      }

      return send(res, 404, { error: 'Unknown moderator endpoint.' });
    }

    return send(res, 404, { error: 'Unknown endpoint.' });
  }

  handler.store = store;
  handler.identity = identity;
  handler.syncAllPeers = syncAllPeers;
  handler.reloadPeers = reloadPeers;
  handler.close = () => { clearInterval(pruneTimer); if (syncTimer) clearInterval(syncTimer); store.close(); };
  return handler;
}
