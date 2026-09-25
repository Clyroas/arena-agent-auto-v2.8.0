import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as core from '../core.js';
import * as attachments from '../attachment-state.js';
import * as screenshots from '../screenshot.js';
import { liveStatus, questionState } from '../live-status.js';
import { TabAwakeLease } from '../tab-awake.js';

// Exercise the real panel bootstrap/handlers against its actual markup. Presentation and Chrome are
// replaced here; the separate browser suite uses real extension worlds, native inputs and ports.
const source = readFileSync(new URL('../panel.js', import.meta.url), 'utf8').replace(/^import[^\n]*\n/gm, '');
const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => { setImmediate(resolve); });
async function open({ captureLink = async () => {}, send = async () => {} } = {}) {
  const dom = new JSDOM(html, { url: 'https://extension.test/panel.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, deadlines = [];
  const listener = { addListener() {}, removeListener() {} };
  w.chrome = {
    runtime: { sendMessage: async message => ({ ok: true, value: message.type === 'LIST_TABS' ? [] : { id: 1, url: core.AGENT_URL, title: 'Fixture', autoDiscardable: true } }) },
    tabs: { onUpdated: listener, onRemoved: listener, get: async () => ({ autoDiscardable: true }), update: async () => {}, create: async () => {} },
    permissions: { contains: async () => true, onAdded: listener, onRemoved: listener }
  };
  const originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => { if (ms === 15000) { deadlines.push(fn); return 0; } return originalTimeout(fn, ms); };
  Object.assign(w, core, attachments, screenshots, {
    hasShotAccess: () => screenshots.hasShotAccess(w.chrome), requestShotAccess: async () => true, removeShotAccess: async () => true,
    captureLink, liveStatus, questionState, setupFloatingGeometry() {}, recentModels: () => [], rememberModel() {},
    ArenaAgentAttachments: globalThis.ArenaAgentAttachments,
    ConversationView: class { render() {} },
    TabAwakeLease: class extends TabAwakeLease { constructor() { super(w.chrome); } },
    AgentClient: class {
      constructor() { this.ready = true; this.uploadKind = 'input'; this.readiness = Promise.resolve(); }
      close() { this.ready = false; }
    }
  });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.eval(`${source}\nwindow.testPanel = {
    stageFiles, clear, screenshotLink, cancelScreenshot, handleEvent, render,
    setup(connection) { state = 'ready'; client = connection; tab = { id: 1, url: AGENT_URL }; setSheet(false); render(); },
    setCapabilities(capabilities) { client.capabilities = capabilities; render(); },
    setModel(expected, actual) { requestedModel = expected; client.model = actual; render(); },
    setTurn(turn) { turns.push(turn); pending = turn; state = 'waiting'; },
    get current() { return { staged, pending, turns, state, shotOperation, historyRequest }; }
  };`);
  await tick();
  const connection = { ready: true, uploadKind: 'input', pageKind: 'agent', send, close() { this.ready = false; }, loadHistory() {} };
  w.testPanel.setup(connection);
  return { w, ui: w.testPanel, deadlines, close() { w.testPanel.clear(); w.close(); } };
}

test('all-rejected attachment selections still show feedback in the real panel markup', async () => {
  const page = await open();
  try {
    page.ui.stageFiles([new File(['zip'], 'bad.zip', { type: 'application/zip' })], 'drop');
    assert.equal(page.w.document.getElementById('attachments').hidden, false);
    assert.match(page.w.document.getElementById('attachment-status').textContent, /supported list/);
  } finally { page.close(); }
});

test('actual COMPLETE and cancellation cleanup leave no files on historical turns', async () => {
  const page = await open();
  try {
    const turn = { id: 'one', prompt: 'hello', reply: '', attachments: [], files: [new File(['secret'], 'a.txt')], payload: [{ data: 'secret' }] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'COMPLETE', requestId: 'one', text: 'done', url: core.AGENT_URL });
    assert.equal(turn.files, null);
    assert.equal(turn.payload, null);
    assert.equal(turn.status, 'complete');
    assert.equal(page.ui.current.pending, null);
  } finally { page.close(); }
});

test('a screenshot completing after clear cannot stage into the next session', async () => {
  let finish;
  const page = await open({ captureLink: () => new Promise(resolve => { finish = resolve; }) });
  try {
    page.w.document.getElementById('prompt').value = 'https://example.test/';
    const task = page.ui.screenshotLink('https://example.test/');
    await tick();
    const signal = page.ui.current.shotOperation.controller.signal;
    page.ui.clear();
    assert.equal(signal.aborted, true);
    finish({ file: new File(['pixels'], 'shot.png', { type: 'image/png' }), url: 'https://example.test/' });
    await task;
    assert.equal(page.ui.current.staged.length, 0);
    assert.equal(page.ui.current.state, 'disconnected');
    assert.equal(page.w.document.getElementById('shot-status').textContent, '');
  } finally { page.close(); }
});

test('capture disables Send, draft edits cancel it, and late success cannot attach', async () => {
  let finish;
  const page = await open({ captureLink: () => new Promise(resolve => { finish = resolve; }) });
  try {
    const prompt = page.w.document.getElementById('prompt'); prompt.value = 'https://example.test/';
    const task = page.ui.screenshotLink('https://example.test/');
    await tick();
    assert.equal(page.w.document.getElementById('prepare').disabled, true);
    prompt.value = 'another draft'; prompt.dispatchEvent(new page.w.Event('input'));
    finish({ file: new File(['pixels'], 'shot.png', { type: 'image/png' }), url: 'https://example.test/' });
    await task;
    assert.equal(page.ui.current.staged.length, 0);
    assert.equal(page.ui.current.shotOperation, null);
  } finally { page.close(); }
});

test('a removed screenshot can be captured again in the same panel', async () => {
  const page = await open({ captureLink: async () => ({ file: new File(['pixels'], 'shot.png', { type: 'image/png' }), url: 'https://example.test/' }) });
  try {
    page.w.document.getElementById('prompt').value = 'https://example.test/';
    await page.ui.screenshotLink('https://example.test/');
    assert.equal(page.ui.current.staged.length, 1);
    assert.equal(page.w.document.querySelectorAll('.shot-chip').length, 0);
    page.w.document.querySelector('.attachment-remove').click();
    assert.equal(page.w.document.querySelectorAll('.shot-chip').length, 1);
  } finally { page.close(); }
});

test('history timeout unlocks the button and ignores the late history response', async () => {
  const page = await open();
  try {
    page.w.document.getElementById('load-history').click();
    const id = page.ui.current.historyRequest;
    assert.ok(id);
    page.deadlines.at(-1)();
    assert.equal(page.ui.current.historyRequest, null);
    page.ui.handleEvent({ type: 'HISTORY', requestId: id, turns: [{ prompt: 'late', status: 'complete', reply: 'late' }] });
    assert.equal(page.ui.current.turns.length, 0);
    assert.match(page.w.document.getElementById('notice-text').textContent, /HISTORY_TIMEOUT/);
  } finally { page.close(); }
});

test('the panel send path sends each original file once and does not store its encoded payload', async () => {
  let sent;
  const page = await open({ send: async (id, prompt, url, payload) => { sent = structuredClone(payload); } });
  try {
    page.ui.stageFiles([new File(['alpha'], 'same.txt', { type: 'text/plain' }), new File(['bravo'], 'same.txt', { type: 'text/plain' })], 'drop');
    page.w.document.getElementById('prompt').value = 'Compare these';
    page.w.document.getElementById('prepare').click();
    for (let i = 0; i < 10 && !sent; i++) await tick();
    assert.deepEqual(sent.map(item => atob(item.data)), ['alpha', 'bravo']);
    assert.equal(page.ui.current.pending.payload, undefined);
  } finally { page.close(); }
});

test('same-conversation reconnect keeps the local draft and history without sending', async () => {
  let sends = 0;
  const page = await open({ send: async () => { sends++; } });
  try {
    const turn = { id: 'one', prompt: 'hello', reply: '', attachments: [] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'COMPLETE', requestId: 'one', text: 'done', url: core.AGENT_URL });
    page.w.document.getElementById('prompt').value = 'Unsent local draft';
    page.w.document.getElementById('reconnect').click();
    await tick(); await tick();
    assert.equal(page.ui.current.state, 'ready');
    assert.equal(page.ui.current.turns[0], turn);
    assert.equal(page.w.document.getElementById('prompt').value, 'Unsent local draft');
    assert.equal(sends, 0);
  } finally { page.close(); }
});

test('a security verification pauses the panel instead of stopping the turn, and clearing it resumes', async () => {
  const page = await open();
  try {
    const turn = { id: 'sec', prompt: 'hello', reply: '', status: 'waiting', attachments: [] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'BLOCKED', requestId: 'sec', code: 'SECURITY_CHECK', message: 'Arena is showing a security verification.', clicked: true, accepted: true });
    // The turn must stay alive: not an error, not released, still the pending reply.
    assert.equal(page.ui.current.state, 'waiting');
    assert.equal(turn.status, 'waiting');
    assert.equal(turn.securityHold, true);
    assert.equal(page.ui.current.pending, turn, 'the pending card must survive a transient verification');
    assert.equal(page.w.document.getElementById('pending').dataset.kind, 'blocked');
    assert.match(page.w.document.getElementById('pending-title').textContent, /Waiting for verification/);
    assert.match(page.w.document.getElementById('notice-text').textContent, /paused, not stopped/);
    // Clearing the verification resumes without a resend and restores the normal status.
    page.ui.handleEvent({ type: 'SECURITY_CLEARED', requestId: 'sec' });
    assert.equal(turn.securityHold, false);
    assert.equal(page.ui.current.pending, turn);
    assert.match(page.w.document.getElementById('notice-text').textContent, /resumed automatically/);
  } finally { page.close(); }
});

test('a security BLOCKED event does not release staged attachments like a stop would', async () => {
  const page = await open();
  try {
    const turn = { id: 'sec2', prompt: 'hello', reply: '', status: 'sending', attachments: [], files: [new File(['secret'], 'a.txt')], payload: [{ data: 'secret' }] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'BLOCKED', requestId: 'sec2', code: 'SECURITY_CHECK', message: 'Arena is showing a security verification.' });
    assert.equal(turn.status, 'waiting', 'a pause is not a stop');
    assert.ok(turn.files, 'staged files must remain available so the user can retry after verifying');
    assert.equal(page.ui.current.state, 'waiting');
  } finally { page.close(); }
});

test('model mismatch blocks Send until the user explicitly confirms the actual model', async () => {
  let sends = 0;
  const page = await open({ send: async () => { sends++; } });
  try {
    page.ui.setModel('Expected', 'Actual');
    const button = page.w.document.getElementById('prepare');
    assert.equal(button.disabled, true);
    page.w.document.getElementById('prompt').value = 'hello';
    button.click(); assert.equal(sends, 0);
    page.w.document.getElementById('accept-current-model').click();
    assert.equal(page.w.document.getElementById('confirm-dialog').open, true);
    assert.equal(button.disabled, true);
    page.w.document.getElementById('dialog-ok').click(); await tick();
    assert.equal(button.disabled, false);
    assert.equal(sends, 0, 'confirmation never sends on behalf of the user');
  } finally { page.close(); }
});

test('a page that no longer exposes the composer blocks Send and names the gap', async () => {
  let sends = 0;
  const page = await open({ send: async () => { sends++; } });
  try {
    // No snapshot: the connection was verified against the same adapter version, so Send stays usable.
    assert.equal(page.w.document.getElementById('prepare').disabled, false);
    // A reported snapshot that is missing a control the adapter drives is drift: Send is refused with a
    // named gap instead of failing later, mid-send.
    page.ui.setCapabilities({ pageKind: 'agent', mode: '', checks: { composer: false, send: false, transcript: true, questions: false, responsePairs: false, reviewPanel: false, upload: false, uploadPicker: false } });
    const button = page.w.document.getElementById('prepare');
    assert.equal(button.disabled, true);
    page.w.document.getElementById('prompt').value = 'hello';
    button.click(); assert.equal(sends, 0);
    assert.match(page.w.document.getElementById('adapter-state').textContent, /missing: message box, Send control/);
    assert.equal(page.w.document.getElementById('adapter-state').dataset.drift, 'true');
    // An optional capability going away (here: the task-review panel) is reported, not blocking.
    page.ui.setCapabilities({ pageKind: 'agent', mode: '', checks: { composer: true, send: true, transcript: true, questions: true, responsePairs: true, reviewPanel: false, upload: true, uploadPicker: true } });
    assert.equal(button.disabled, false);
    assert.equal(page.w.document.getElementById('adapter-state').dataset.drift, 'false');
  } finally { page.close(); }
});
