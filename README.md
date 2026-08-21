# LilithList — self-hosted worker-to-worker safety bulletin

A privacy-first peer safety bulletin that now runs as a real **single community node**:
a dependency-free front end backed by a **zero-dependency Node + SQLite** server with
optional encryption at rest and an authenticated human-moderation queue. Bulletins
persist on the node instead of only in the browser, while the reporter keeps a private
revocation receipt locally. The visual language combines Craigslist-style
information density, early-2000s forum/BBS conventions, and a restrained brutalist
component system.

> Fictional demo data. This advances the prototype toward production but is **not** a
> deployable safety service — see the production boundary below.

## Requirements

- Node.js **≥ 22.5** (uses the built-in `node:sqlite`; no native modules, no `npm install`).

## Run

```bash
git clone https://github.com/numbpill3d/lilithlist.git
cd lilithlist
npm start          # http://127.0.0.1:4173  (PORT / HOST / LILITH_DB env override)
```

The server creates `data/lilithlist.db` on first run and seeds fictional bulletins.

## Test

```bash
npm test           # API + backend unit/integration (node:test + node:sqlite, no browser)
npm run test:e2e   # Playwright end-to-end; spawns its own node on a throwaway DB
```

`test:e2e` reuses an existing Playwright install; override its location with
`PLAYWRIGHT_PATH=/path/to/node_modules/playwright`.

## Architecture

```
browser (index.html + app.js)         zero-dependency Node server
  fetch /api/*  ───────────────▶  server/app.mjs      request routing, CSP, rate limits
                                  server/db.mjs       node:sqlite store, retention, moderation
                                  server/domain.mjs   authoritative validation + enums
                                  server/privacy.mjs  PII scanner (server re-checks)
                                  server/crypto.mjs   AES-256-GCM encryption at rest
                                  server/ratelimit.mjs hashed-IP token buckets
  localStorage: private receipts only          data/lilithlist.db (local file)
```

Key design decisions:

- **No accounts = minimum stored identity.** Filing a report returns a one-time secret
  *receipt*. The server stores only its SHA-256 hash; the plaintext is kept in the
  reporter's browser and is the only key that can revoke the bulletin. No email, no
  password, no account recovery — this is the "private recovery receipt" the governance
  model calls for.
- **The server never trusts the client.** Privacy/PII checks, enum validation, retention,
  and rate limits are all enforced server-side; the browser checks are only fast feedback.
- **Sensitive data stays on the operator's node** in a local SQLite file — deliberately
  *not* a third-party cloud, matching the "trusted community node" threat model.
- **Lifecycle is real:** corroboration (deduped per browser), correction, contest, and
  emergency-unpublish (which hides a bulletin immediately, pending review) are distinct
  actions recorded on the node. Retention is a server-enforced 90-day expiry.
- **Human moderation closes the loop:** an authenticated moderator role reviews a queue
  of high-risk, contested, correction-pending, and emergency-unpublished bulletins and
  resolves each (approve / remove / restore / dismiss). Every resolution is recorded in a
  `moderations` audit table. Moderators are the only accountable identity on the node;
  reporters stay account-less.
- **Optional encryption at rest:** set `LILITH_SECRET_KEY` (32 bytes) and report
  narratives, lifecycle reasons, and moderation notes are stored as AES-256-GCM
  ciphertext. The key lives in the operator's environment, never in the database.

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/reports` | filtered, paginated, published-only board |
| GET  | `/api/reports/:id` | one bulletin + its lifecycle log |
| POST | `/api/reports` | create; validates + PII-scans; returns `{ report, receipt }` |
| POST | `/api/lookup` | partial-marker lookup (rate limited, markers only) |
| POST | `/api/reports/:id/corroborate` | +1, deduped per browser |
| POST | `/api/reports/:id/actions` | correction / contest / emergency-unpublish |
| POST | `/api/reports/:id/revoke` | owner-only delete (requires receipt) |
| POST | `/api/mod/login` | moderator sign-in → bearer session token |
| GET  | `/api/mod/queue` | review queue + counts (bearer) |
| POST | `/api/mod/reports/:id/resolve` | approve / remove / restore / dismiss (bearer) |
| GET  | `/api/health`, `/api/stats` | liveness / counts |

## Launching it for real people

> **Read this first.** LilithList serves a vulnerable audience. Running this node
> for real users — not a demo — means you are responsible for people's safety data.
> The node has **no end-to-end encryption, no anonymity, and no human moderation**
> (see the production boundary below). At minimum, before onboarding real users you
> should put it behind HTTPS, control and trust your own proxy, take responsibility
> for the database contents and local law, and have a moderation/removal process and
> crisis resources ready. Launching the software is easy; launching a *safety service*
> responsibly is not. What follows is the technical half only.

You need three things: a small Linux server, a domain name, and HTTPS. Pick one path.

### Path A — VPS + Caddy (recommended, automatic HTTPS)

On any \$5/month VPS (Debian/Ubuntu) with a domain's DNS `A` record pointed at it:

```bash
# 1. Install Node >= 22 (nodesource) and the app
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo git clone https://github.com/numbpill3d/lilithlist.git /opt/lilithlist
sudo useradd --system --home /opt/lilithlist lilith
sudo mkdir -p /var/lib/lilithlist && sudo chown lilith:lilith /var/lib/lilithlist

# 2. Run it as a managed service on localhost:4173
sudo tee /etc/systemd/system/lilithlist.service >/dev/null <<'UNIT'
[Unit]
Description=LilithList community node
After=network.target

[Service]
Type=simple
User=lilith
WorkingDirectory=/opt/lilithlist
Environment=HOST=127.0.0.1 PORT=4173 TRUST_PROXY=1 LILITH_DB=/var/lib/lilithlist/lilithlist.db NODE_ENV=production
ExecStart=/usr/bin/node server/server.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/lilithlist

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now lilithlist

# 3. Put Caddy in front for automatic TLS (replace the domain)
sudo apt-get install -y caddy
echo 'safety.example.org {
    reverse_proxy 127.0.0.1:4173
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches and renews a Let's Encrypt certificate automatically. Because the node
runs with `TRUST_PROXY=1` behind Caddy, per-client rate limiting uses the real client
IP. Your site is live at `https://safety.example.org`.

### Path B — Docker

```bash
docker build -t lilithlist .
docker run -d --name lilithlist \
  -p 127.0.0.1:4173:4173 \
  -v lilithlist-data:/data \
  -e TRUST_PROXY=1 \
  --restart unless-stopped \
  lilithlist
```

Then point any TLS-terminating reverse proxy (Caddy, nginx, Traefik) at
`127.0.0.1:4173`. The database persists in the `lilithlist-data` volume.

### Path C — Managed platform (Fly.io, Render, Railway…)

Deployable, but SQLite needs a **persistent volume** mounted at the `LILITH_DB` path —
the default ephemeral filesystem will erase every bulletin on redeploy. Attach a volume,
set `LILITH_DB` to a path inside it, and set `HOST=0.0.0.0` and `TRUST_PROXY=1`.

### Environment variables

| var | default | notes |
|---|---|---|
| `PORT` | `4173` | listen port |
| `HOST` | `127.0.0.1` | use `0.0.0.0` only inside Docker/behind a proxy |
| `LILITH_DB` | `data/lilithlist.db` | put this on durable storage in production |
| `TRUST_PROXY` | off | set to `1` **only** when behind a proxy you control |
| `LILITH_SECRET_KEY` | off | 32 bytes (64 hex chars) enabling AES-256-GCM encryption at rest |
| `MOD_BOOTSTRAP_KEY` | — | sets the first moderator key; if unset one is generated and printed once |
| `NODE_ENV` | — | set to `production` |

### Moderation & encryption (production)

Turn on encryption at rest and choose your first moderator key:

```bash
# generate a 32-byte key once and keep it in the environment (not in the repo)
export LILITH_SECRET_KEY=$(openssl rand -hex 32)
export MOD_BOOTSTRAP_KEY=$(openssl rand -base64 24)
npm start
```

- Narratives, lifecycle reasons, and moderation notes are then stored as AES-256-GCM
  ciphertext. **If you lose `LILITH_SECRET_KEY`, encrypted bulletins are unrecoverable** —
  back the key up separately from the database.
- The moderator signs in at the site's **moderation** tab with `MOD_BOOTSTRAP_KEY`. If you
  do not set it, a key is generated and printed once in the server log on first run.
- In the systemd unit above, add `LILITH_SECRET_KEY=…` and `MOD_BOOTSTRAP_KEY=…` to the
  `Environment=` line (or use an `EnvironmentFile=` so secrets stay out of the unit).

### Operating the node

- **Back up** the SQLite file (`sqlite3 $LILITH_DB ".backup backup.db"` or copy the file
  and its `-wal`/`-shm` siblings while stopped). It is your only copy of every bulletin.
- **Seeding**: fictional seed data is inserted only when the table is empty. For a real
  launch, start with an empty DB and remove/replace `server/seed.mjs`'s data.
- **Updates**: `git pull` in `/opt/lilithlist` then `sudo systemctl restart lilithlist`.
  There are no dependencies to reinstall.
- **Health/monitoring**: `GET /api/health` returns `{"ok":true}`; `GET /api/stats`
  returns bulletin and pending-action counts.

## Production boundary

This build implements a working, moderated single node with optional encryption at rest.
It still does **not** implement:

- end-to-end (in-transit) encryption — TLS terminates at your reverse proxy; the node
  sees plaintext in memory
- federation, peer sync/mirroring, or signed cross-node bulletins, and therefore no
  correction/removal propagation *between* nodes
- reporter anonymity beyond being account-less (IP-hash rate limiting is not anonymity;
  run behind Tor/a privacy proxy if network-level anonymity matters to your users)
- anti-brigading/sybil resistance beyond per-browser dedup and rate limits
- jurisdiction-aware retention or independently verified crisis resources

A real deployment still requires survivor-centered governance, jurisdiction-specific legal
analysis, privacy threat modeling, in-transit/device-security engineering, an appeals
process with real moderators, operational security, and independent adversarial testing.
The software now does its part of the loop; the human and legal parts remain yours.

The original first-pass artifact is preserved as `index-v1.html`.
