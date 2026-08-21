'use strict';

import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { RETENTION_DAYS, RISK_ORDER, PAGE_SIZE } from './domain.mjs';
import { encryptField, decryptField, sha256, encryptionEnabled } from './crypto.mjs';

const DAY_MS = 86400000;
const SESSION_TTL_MS = 12 * 3600000;
const CLEAN_STATES = ['reviewed', 'removed'];

export { sha256, encryptionEnabled };

function shortId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export class Store {
  constructor(path = 'data/lilithlist.db') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id            TEXT PRIMARY KEY,
        risk          TEXT NOT NULL,
        region        TEXT NOT NULL,
        id_type       TEXT NOT NULL,
        identifier    TEXT NOT NULL DEFAULT '',
        identifier_norm TEXT NOT NULL DEFAULT '',
        title         TEXT NOT NULL,
        details       TEXT NOT NULL,
        date          TEXT NOT NULL,
        context       TEXT NOT NULL,
        tags          TEXT NOT NULL DEFAULT '[]',
        corroborations INTEGER NOT NULL DEFAULT 0,
        state         TEXT NOT NULL DEFAULT 'reviewed',
        source        TEXT NOT NULL DEFAULT 'community node',
        published     INTEGER NOT NULL DEFAULT 1,
        receipt_hash  TEXT,
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reports_expiry ON reports(expires_at);
      CREATE INDEX IF NOT EXISTS idx_reports_ident ON reports(identifier_norm);

      CREATE TABLE IF NOT EXISTS actions (
        id          TEXT PRIMARY KEY,
        report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        reason      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_actions_report ON actions(report_id);

      CREATE TABLE IF NOT EXISTS corroborations (
        report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        voter_hash  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (report_id, voter_hash)
      );

      CREATE TABLE IF NOT EXISTS moderators (
        id         TEXT PRIMARY KEY,
        key_hash   TEXT NOT NULL,
        label      TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mod_sessions (
        token_hash   TEXT PRIMARY KEY,
        moderator_id TEXT NOT NULL REFERENCES moderators(id) ON DELETE CASCADE,
        expires_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS moderations (
        id             TEXT PRIMARY KEY,
        report_id      TEXT NOT NULL,
        moderator_label TEXT NOT NULL,
        action         TEXT NOT NULL,
        note           TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moderations_report ON moderations(report_id);
    `);
  }

  static normIdentifier(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  #rowToReport(row) {
    if (!row) return null;
    return {
      id: row.id,
      risk: row.risk,
      region: row.region,
      idType: row.id_type,
      identifier: row.identifier,
      title: row.title,
      details: decryptField(row.details),
      date: row.date,
      context: row.context,
      tags: JSON.parse(row.tags || '[]'),
      corroborations: row.corroborations,
      state: row.state,
      source: row.source,
      published: !!row.published,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      updated: relativeTime(row.created_at)
    };
  }

  sweepExpired() {
    const now = new Date().toISOString();
    const info = this.db.prepare('DELETE FROM reports WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM actions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM mod_sessions WHERE expires_at <= ?').run(now);
    return info.changes;
  }

  listPublished({ query = '', region = 'all', risk = 'all', sort = 'newest', page = 1 } = {}) {
    this.sweepExpired();
    const rows = this.db.prepare('SELECT * FROM reports WHERE published = 1').all();
    let reports = rows.map(r => this.#rowToReport(r));
    const q = query.trim().toLowerCase();
    reports = reports.filter(r =>
      (region === 'all' || r.region === region) &&
      (risk === 'all' || r.risk === risk) &&
      (!q || [r.title, r.identifier, r.details, r.id, ...r.tags].join(' ').toLowerCase().includes(q))
    );
    if (sort === 'expiry') reports.sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
    else if (sort === 'risk') reports.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    else reports.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const total = reports.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), pages);
    const items = reports.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
    return { items, total, page: current, pages };
  }

  get(id, { includeUnpublished = false } = {}) {
    this.sweepExpired();
    const row = includeUnpublished
      ? this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id)
      : this.db.prepare('SELECT * FROM reports WHERE id = ? AND published = 1').get(id);
    return this.#rowToReport(row);
  }

  lookup(normalizedQuery) {
    this.sweepExpired();
    const rows = this.db.prepare(
      "SELECT * FROM reports WHERE published = 1 AND identifier_norm != '' AND instr(identifier_norm, ?) > 0"
    ).all(normalizedQuery);
    return rows.map(r => this.#rowToReport(r));
  }

  create(draft) {
    const now = new Date();
    const expires = new Date(now.getTime() + RETENTION_DAYS * DAY_MS);
    const receipt = randomBytes(18).toString('base64url');
    const id = shortId('LL');
    const state = draft.risk === 'high' ? 'review-pending' : 'reviewed';
    this.db.prepare(`
      INSERT INTO reports (id, risk, region, id_type, identifier, identifier_norm, title, details,
        date, context, tags, corroborations, state, source, published, receipt_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'community node', 1, ?, ?, ?)
    `).run(
      id, draft.risk, draft.region, draft.idType, draft.identifier,
      Store.normIdentifier(draft.identifier), draft.title, encryptField(draft.details),
      draft.date, draft.context, JSON.stringify(draft.tags), state,
      sha256(receipt), now.toISOString(), expires.toISOString()
    );
    return { report: this.get(id), receipt };
  }

  corroborate(id, voterHash) {
    const report = this.get(id);
    if (!report) return { ok: false, code: 404 };
    try {
      this.db.prepare('INSERT INTO corroborations (report_id, voter_hash, created_at) VALUES (?, ?, ?)')
        .run(id, voterHash, new Date().toISOString());
    } catch {
      return { ok: false, code: 409, report };
    }
    this.db.prepare('UPDATE reports SET corroborations = corroborations + 1 WHERE id = ?').run(id);
    return { ok: true, report: this.get(id) };
  }

  addAction(id, { type, reason }) {
    const report = this.get(id);
    if (!report) return { ok: false, code: 404 };
    const now = new Date().toISOString();
    const action = { id: shortId('ACT'), reportId: id, type, status: 'pending', reason, createdAt: now, expiresAt: report.expiresAt };
    this.db.prepare(`INSERT INTO actions (id, report_id, type, status, reason, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(action.id, id, type, 'pending', encryptField(reason), now, report.expiresAt);

    const nextState = type === 'correction' ? 'correction-pending'
      : type === 'contest' ? 'disputed' : 'unpublish-pending';
    if (type === 'emergency-unpublish') {
      this.db.prepare('UPDATE reports SET state = ?, published = 0 WHERE id = ?').run(nextState, id);
    } else {
      this.db.prepare('UPDATE reports SET state = ? WHERE id = ?').run(nextState, id);
    }
    return { ok: true, action, hidden: type === 'emergency-unpublish' };
  }

  actionsFor(id, { withReason = false } = {}) {
    const rows = this.db.prepare('SELECT id, report_id AS reportId, type, status, reason, created_at AS createdAt, expires_at AS expiresAt FROM actions WHERE report_id = ? ORDER BY created_at DESC').all(id);
    return rows.map(a => withReason ? { ...a, reason: decryptField(a.reason) } : (delete a.reason, a));
  }

  revoke(id, receipt) {
    const row = this.db.prepare('SELECT receipt_hash FROM reports WHERE id = ?').get(id);
    if (!row) return { ok: false, code: 404 };
    if (!row.receipt_hash || row.receipt_hash !== sha256(receipt)) return { ok: false, code: 403 };
    this.db.prepare('DELETE FROM reports WHERE id = ?').run(id);
    return { ok: true };
  }

  // ── Moderation ─────────────────────────────────────────────────────────────
  // Ensures at least one moderator exists. If bootstrapKey is provided it is used;
  // otherwise a random key is generated and returned exactly once for the operator
  // to record. Only the key hash is stored.
  ensureBootstrapModerator(bootstrapKey) {
    const existing = this.db.prepare('SELECT COUNT(*) AS n FROM moderators').get().n;
    if (existing > 0) return { created: false };
    const key = bootstrapKey && String(bootstrapKey).length >= 16 ? String(bootstrapKey) : randomBytes(18).toString('base64url');
    this.db.prepare('INSERT INTO moderators (id, key_hash, label, created_at) VALUES (?, ?, ?, ?)')
      .run(shortId('MOD'), sha256(key), 'moderator-1', new Date().toISOString());
    return { created: true, key, generated: !bootstrapKey };
  }

  login(key) {
    const mod = this.db.prepare('SELECT * FROM moderators WHERE key_hash = ?').get(sha256(String(key)));
    if (!mod) return null;
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.db.prepare('INSERT INTO mod_sessions (token_hash, moderator_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), mod.id, expires);
    return { token, label: mod.label, expiresAt: expires };
  }

  moderatorForToken(token) {
    if (!token) return null;
    this.sweepExpired();
    const row = this.db.prepare(`SELECT m.id, m.label FROM mod_sessions s
      JOIN moderators m ON m.id = s.moderator_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(String(token)), new Date().toISOString());
    return row || null;
  }

  logout(token) {
    this.db.prepare('DELETE FROM mod_sessions WHERE token_hash = ?').run(sha256(String(token)));
  }

  queue() {
    this.sweepExpired();
    const rows = this.db.prepare(
      `SELECT * FROM reports WHERE state NOT IN (${CLEAN_STATES.map(() => '?').join(',')}) ORDER BY created_at DESC`
    ).all(...CLEAN_STATES);
    return rows.map(r => {
      const report = this.#rowToReport(r);
      return { report, actions: this.actionsFor(report.id, { withReason: true }).filter(a => a.status === 'pending') };
    });
  }

  // Resolves a queued report. action ∈ approve | remove | restore | dismiss.
  resolve(id, { action, note = '', moderatorLabel }) {
    const report = this.get(id, { includeUnpublished: true });
    if (!report) return { ok: false, code: 404 };
    let published, state;
    if (action === 'approve') { published = 1; state = 'reviewed'; }
    else if (action === 'restore') { published = 1; state = 'reviewed'; }
    else if (action === 'remove') { published = 0; state = 'removed'; }
    else if (action === 'dismiss') { published = report.published ? 1 : 0; state = 'reviewed'; }
    else return { ok: false, code: 400 };

    this.db.prepare('UPDATE reports SET published = ?, state = ? WHERE id = ?').run(published, state, id);
    this.db.prepare("UPDATE actions SET status = 'resolved' WHERE report_id = ? AND status = 'pending'").run(id);
    this.db.prepare('INSERT INTO moderations (id, report_id, moderator_label, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(shortId('MODACT'), id, moderatorLabel || 'moderator', action, encryptField(note), new Date().toISOString());
    return { ok: true, report: this.get(id, { includeUnpublished: true }) };
  }

  moderationsFor(id) {
    return this.db.prepare('SELECT id, action, moderator_label AS moderator, note, created_at AS createdAt FROM moderations WHERE report_id = ? ORDER BY created_at DESC')
      .all(id).map(m => ({ ...m, note: decryptField(m.note) }));
  }

  stats() {
    this.sweepExpired();
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE published = 1').get().n;
    const pending = this.db.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").get().n;
    const queue = this.db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE state NOT IN (${CLEAN_STATES.map(() => '?').join(',')})`).get(...CLEAN_STATES).n;
    return { total, pending, queue };
  }

  close() { this.db.close(); }
}

function relativeTime(iso) {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return 'recently';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr`;
  const days = Math.floor(hrs / 24);
  return `${days} d`;
}
