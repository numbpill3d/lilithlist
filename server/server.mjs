'use strict';

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { createApp } from './app.mjs';
import { seedIfEmpty } from './seed.mjs';

const PORT = Number.parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.LILITH_DB || 'data/lilithlist.db';

mkdirSync('data', { recursive: true });

const app = createApp({ dbPath: DB_PATH });
const seeded = seedIfEmpty(app.store);
if (seeded) console.log(`[lilithlist] seeded ${seeded} fictional bulletins`);

// Ensure a moderator exists. A freshly generated key is printed exactly once —
// record it now; only its hash is stored and it cannot be shown again.
const boot = app.store.ensureBootstrapModerator(process.env.MOD_BOOTSTRAP_KEY);
if (boot.created && boot.generated) {
  console.log('\n  ┌─ MODERATOR BOOTSTRAP KEY (shown once) ───────────────────');
  console.log(`  │  ${boot.key}`);
  console.log('  │  Sign in at /  →  "moderation"  →  this key.');
  console.log('  └──────────────────────────────────────────────────────────\n');
} else if (boot.created) {
  console.log('[lilithlist] moderator created from MOD_BOOTSTRAP_KEY');
}
if (process.env.LILITH_SECRET_KEY) console.log('[lilithlist] encryption at rest: ENABLED');
else console.log('[lilithlist] encryption at rest: OFF (set LILITH_SECRET_KEY for production)');
console.log(`[lilithlist] node id: ${app.identity.publicKey.slice(0, 16)}…`);
const peerCount = app.reloadPeers().length;
console.log(`[lilithlist] federation peers: ${peerCount}${peerCount ? '' : ' (none configured; add data/peers.json)'}`);

const server = createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`[lilithlist] community node listening on http://${HOST}:${PORT}`);
  console.log('[lilithlist] fictional data · local SQLite · no third-party network');
});

function shutdown() {
  server.close(() => { app.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
