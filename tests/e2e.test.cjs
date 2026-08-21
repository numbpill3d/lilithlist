const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { rmSync } = require('node:fs');

// Playwright is reused from an existing install to keep this repo dependency-free.
// Override with PLAYWRIGHT_PATH if it lives elsewhere.
const PW_PATH = process.env.PLAYWRIGHT_PATH || '/home/scorn/shopify-automation/node_modules/playwright';
const { chromium } = require(PW_PATH);

const PORT = Number.parseInt(process.env.E2E_PORT || '4188', 10);
const BASE = `http://127.0.0.1:${PORT}/`;
const DB_PATH = join(tmpdir(), `lilith-e2e-${process.pid}-${Date.now()}.db`);
const ROOT = join(__dirname, '..');

let browser, server;

function waitForHealth(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${BASE}api/health`);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() > deadline) return reject(new Error('server did not become healthy'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

test.before(async () => {
  server = spawn(process.execPath, ['server/server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', LILITH_DB: DB_PATH },
    stdio: 'ignore'
  });
  await waitForHealth();
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(DB_PATH + suffix); } catch {} }
});

async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return { page, context };
}

async function fillValidReport(page, over = {}) {
  const v = { risk: 'medium', region: 'west', idType: 'phone fragment', identifier: 'phone ending 1234',
    title: 'Boundary concern during screening', details: 'Repeatedly pushed past a clearly written boundary. No appointment took place.',
    date: '2026-08', context: 'screening / booking', ...over };
  await page.getByRole('button', { name: /file safety report/i }).click();
  await page.selectOption('[name="risk"]', v.risk);
  await page.selectOption('[name="region"]', v.region);
  await page.selectOption('[name="idType"]', { label: v.idType });
  await page.fill('[name="identifier"]', v.identifier);
  await page.fill('[name="title"]', v.title);
  await page.fill('[name="details"]', v.details);
  await page.fill('[name="date"]', v.date);
  await page.selectOption('[name="context"]', { label: v.context });
  for (const box of await page.locator('#reportForm input[type="checkbox"][required]').all()) await box.check();
}

test('persistent demo boundary and browser data controls are visible', async () => {
  const { page, context } = await freshPage();
  await assert.doesNotReject(() => page.locator('[data-testid="demo-boundary"]').waitFor());
  assert.match(await page.locator('[data-testid="demo-boundary"]').innerText(), /demo|fictional/i);
  assert.equal(await page.getByRole('button', { name: /local data/i }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /erase.*exit/i }).count(), 1);
  await context.close();
});

test('board loads bulletins from the node', async () => {
  const { page, context } = await freshPage();
  await page.locator('#boardList [data-thread]').first().waitFor();
  assert.ok(await page.locator('#boardList [data-thread]').count() >= 1);
  assert.match(await page.locator('#resultCount').innerText(), /post/i);
  await context.close();
});

test('report submission requires a redacted preview before publishing', async () => {
  const { page, context } = await freshPage();
  await fillValidReport(page);
  await page.getByRole('button', { name: /review report/i }).click();
  await assert.doesNotReject(() => page.getByRole('heading', { name: /review before saving/i }).waitFor());
  assert.match(await page.locator('[data-testid="storage-warning"]').innerText(), /published to the node|not encrypted/i);
  assert.equal(await page.getByRole('button', { name: /confirm.*publish/i }).count(), 1);
  await context.close();
});

test('publishing persists the bulletin on the node and issues a receipt', async () => {
  const { page, context } = await freshPage();
  await fillValidReport(page, { title: 'Persisted node bulletin marker' });
  await page.getByRole('button', { name: /review report/i }).click();
  await page.getByRole('button', { name: /confirm.*publish/i }).click();
  // receipt dialog appears with a recovery receipt
  await assert.doesNotReject(() => page.locator('#confirmDialog .receipt-box').getByText(/private recovery receipt/i).waitFor());
  await page.getByRole('button', { name: /view bulletin/i }).click();
  await assert.doesNotReject(() => page.getByRole('button', { name: /revoke my bulletin/i }).waitFor());
  // survives a full reload (server-persisted, receipt retained locally)
  await page.reload();
  await page.fill('#boardQuery', 'Persisted node bulletin marker');
  await page.locator('#boardList [data-thread]').first().waitFor();
  assert.ok(await page.locator('#boardList [data-thread]').count() >= 1);
  await context.close();
});

test('privacy gate catches direct contact information before preview', async () => {
  const { page, context } = await freshPage();
  await fillValidReport(page, { risk: 'high', region: 'south', idType: 'other non-unique marker',
    identifier: 'contact marker', title: 'Messages from test@example.com',
    details: 'Call +1 (555) 123-4567 for the entire account.', context: 'screening / booking' });
  await page.getByRole('button', { name: /review report/i }).click();
  await assert.doesNotReject(() => page.locator('[data-testid="privacy-error-summary"]').waitFor());
  assert.match(await page.locator('[data-testid="privacy-error-summary"]').innerText(), /email|phone/i);
  assert.equal(await page.getByRole('heading', { name: /review before saving/i }).count(), 0);
  await context.close();
});

test('correction is distinct from corroboration and persists on the node', async () => {
  const { page, context } = await freshPage();
  const firstRow = page.locator('#boardList [data-thread]').first();
  await firstRow.waitFor();
  const id = await firstRow.getAttribute('data-thread');
  await firstRow.click();
  const before = await page.locator('[data-testid="corroboration-count"]').innerText();
  await page.getByRole('button', { name: /request correction/i }).click();
  await page.fill('[name="correctionReason"]', 'The approximate month should be reviewed.');
  await page.getByRole('button', { name: /submit correction/i }).click();
  await assert.doesNotReject(() => page.getByText(/correction pending/i).waitFor());
  // correction does not change corroboration count
  assert.equal(await page.locator('[data-testid="corroboration-count"]').innerText(), before);
  // persists across reload for the same id (server-backed)
  await page.reload();
  await page.locator(`[data-thread="${id}"]`).click();
  await assert.doesNotReject(() => page.getByText(/correction pending/i).waitFor());
  await context.close();
});

test('lookup rejects punctuation-only input instead of matching every report', async () => {
  const { page, context } = await freshPage();
  await page.getByRole('button', { name: 'lookup' }).click();
  await page.fill('#lookupQuery', '!!!');
  await page.getByRole('button', { name: /search node/i }).click();
  assert.equal(await page.locator('#lookupList [data-thread]').count(), 0);
  assert.match(await page.locator('#lookupCount').innerText(), /invalid|minim/i);
  await context.close();
});

test('lookup finds a seeded partial marker', async () => {
  const { page, context } = await freshPage();
  await page.getByRole('button', { name: 'lookup' }).click();
  await page.fill('#lookupQuery', '4421');
  await page.getByRole('button', { name: /search node/i }).click();
  await page.locator('#lookupList [data-thread]').first().waitFor();
  assert.ok(await page.locator('#lookupList [data-thread]').count() >= 1);
  await context.close();
});

test('browser back restores the previous application view', async () => {
  const { page, context } = await freshPage();
  await page.getByRole('button', { name: 'lookup' }).click();
  await page.getByRole('button', { name: /how it works/i }).click();
  await page.goBack();
  await assert.doesNotReject(() => page.getByRole('heading', { name: 'lookup' }).waitFor());
  await context.close();
});
