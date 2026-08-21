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
