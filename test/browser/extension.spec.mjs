import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = readFileSync(new URL('./fixtures/agent.html', import.meta.url), 'utf8');
const version = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')).version;
let context, worker, extensionId, arena, panel, tabId;

test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  // Every ordinary web request is intercepted. No Arena account, credentials or network automation.
  await context.route(/^https?:/, route => route.request().url() === 'https://arena.ai/agent'
    ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  arena = await context.newPage(); await arena.goto('https://arena.ai/agent');
  panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://arena.ai/agent' }))[0].id);
});

test.afterEach(async () => { await context?.close(); });

async function connect() {
  await panel.locator('#tabs').selectOption(String(tabId));
  await panel.locator('#confirmed').check(); await panel.locator('#authorize').check();
  await panel.locator('#connect').click();
}

test('automatic injection followed by repeated full-bundle attach is safe in Chrome’s isolated world', async () => {
  const errors = []; arena.on('pageerror', error => errors.push(error.message));
  const results = await panel.evaluate(async ({ tabId }) => {
    const { attachAgent } = await import(chrome.runtime.getURL('attachment.js'));
    const first = await attachAgent(tabId, 'https://arena.ai/agent');
    const second = await attachAgent(tabId, 'https://arena.ai/agent');
    const [check] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [second.documentId] }, world: 'ISOLATED',
      func: () => ({ version: globalThis.ArenaAgentAttachments.version, alive: globalThis.__ARENA_AGENT_REGISTRATION__.isAlive() }) });
    return { sameDocument: first.documentId === second.documentId, ...check.result };
  }, { tabId });
  expect(results).toEqual({ sameDocument: true, version, alive: true });
  expect(errors).toEqual([]);
});

test('real panel → worker → main-world staging preserves equal-metadata files and clicks Send once', async () => {
  await connect(); await expect(panel.locator('#prompt')).toBeEnabled();
  await panel.locator('#attachment-input').setInputFiles([
    { name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('alpha') },
    { name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from('bravo') }
  ]);
  await expect(panel.locator('.attachment-chip')).toHaveCount(2);
  await panel.locator('#prompt').fill('Compare these files');
  await panel.locator('#prepare').click();
  await expect(panel.locator('.bubble.assistant')).toContainText('Fixture reply: received once.');
  expect(await arena.evaluate(() => window.sendClicks)).toBe(1);
  expect(await arena.evaluate(() => window.uploadedFiles.map(file => file.text))).toEqual(['alpha', 'bravo']);
  expect(await arena.evaluate(() => Object.hasOwn(document.getElementById('files'), 'files'))).toBe(false);
  // Native clear must work; no own-property FileList may shadow later page/user changes.
  expect(await arena.evaluate(() => { const input = document.getElementById('files'); input.value = ''; return input.files.length; })).toBe(0);
  await panel.close();
  panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await connect(); await expect(panel.locator('#prompt')).toBeEnabled();
  expect(await arena.evaluate(() => window.sendClicks)).toBe(1);
});

test('an expired main-world staging request cannot insert bytes', async () => {
  // Dynamic import is supported in extension pages, not ServiceWorkerGlobalScope. Import the
  // packaged helper here and still run the actual serialized function in the tab's MAIN world.
  const result = await panel.evaluate(async tabId => {
    const token = crypto.randomUUID();
    await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: token => document.getElementById('files').setAttribute('data-arena-agent-stage', token), args: [token] });
    const { arenaAgentStageFiles } = await import(chrome.runtime.getURL('stage-main.js'));
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: arenaAgentStageFiles,
      args: [{ token, expiresAt: Date.now() - 1, files: [{ name: 'a.txt', type: 'text/plain', data: 'eA==' }] }] });
    return result.result;
  }, tabId);
  expect(result.ok).toBe(false);
  expect(await arena.locator('#files').evaluate(input => input.files.length)).toBe(0);
});

test('connection waiting for a page dialog has an accessible cancellation path', async () => {
  await arena.evaluate(() => {
    document.getElementById('composer').hidden = true;
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.textContent = 'Welcome information'; document.body.append(dialog);
  });
  await connect();
  await expect(panel.locator('#notice-text')).toContainText('ARENA_DIALOG_OPEN');
  await expect(panel.locator('#connection-focus')).toBeEnabled();
  await panel.locator('#connection-cancel').click();
  await expect(panel.locator('#notice-text')).toContainText('Connection setup cancelled');
  await expect(panel.locator('#disconnect')).toBeEnabled();
  expect(await arena.evaluate(() => window.sendClicks)).toBe(0);
});
