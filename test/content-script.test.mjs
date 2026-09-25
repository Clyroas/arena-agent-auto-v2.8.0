import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The content script is a classic script that runs in Chrome's isolated world. It is loaded here into a
// jsdom window with a fake chrome API and a fake ArenaAgentDOM, which is enough to drive the connection
// handover and the scan scheduler — the two places where a long conversation used to stall.
const source = readFileSync(new URL('../agent-content.js', import.meta.url), 'utf8');

function makePort(name = 'arena-agent-content-v3') {
  const listeners = { message: [], disconnect: [] };
  const port = {
    name, sender: { id: 'test-extension' }, posted: [], disconnected: false, dead: false, rejected: false,
    onMessage: { addListener: fn => listeners.message.push(fn) },
    onDisconnect: { addListener: fn => listeners.disconnect.push(fn) },
    postMessage(message) { if (port.dead || port.disconnected) throw new Error('Attempting to use a disconnected port object'); port.posted.push(message); },
    disconnect() { if (!port.disconnected) { port.disconnected = true; listeners.disconnect.forEach(fn => fn()); } },
    emit(message) { listeners.message.forEach(fn => fn(message)); }
  };
  return port;
}

function open() {
  const dom = new JSDOM('<!doctype html><html><body><main id="app"></main></body></html>', {
    url: 'https://arena.ai/agent/c/1', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const connectListeners = [];
  window.chrome = {
    runtime: {
      id: 'test-extension',
      onConnect: { addListener: fn => connectListeners.push(fn) },
      sendMessage: async () => ({ ok: true, value: true })
    }
  };
  const counters = { matchTurn: 0, checkBlocks: 0 };
  class DomError extends Error { constructor(code, message) { super(message); this.code = code; } }
  window.ArenaAgentDOM = {
    version: '2.8.2', counters, DomError,
    samePage: () => true,
    checkBlocks: () => { counters.checkBlocks++; },
    rows: () => [{ id: 'user-1', user: true }],
    matchTurn: () => { counters.matchTurn++; return { accepted: false }; },
    fail: (code, message) => { throw new DomError(code, message); },
    inspectControls: () => ({ inputKind: 'textarea', reviewPending: false, uploadKind: 'none', fileInputCount: 0 }),
    capabilities: () => ({ pageKind: 'agent', mode: '', checks: { composer: true, send: true, transcript: true, questions: false, responsePairs: false, reviewPanel: false, upload: false, uploadPicker: false } }),
    historyCount: () => 0
  };
  window.ArenaAgentAttachments = { ATTACHMENT_POLICY: { maxFiles: 4, maxBytes: 8 * 1024 * 1024 } };
  window.eval(source);
  return {
    window, counters, connectListeners,
    connect(port = makePort()) { connectListeners[0](port); return port; },
    close() { window.__ARENA_AGENT_REGISTRATION__?.dispose?.(); window.close(); }
  };
}

const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

test('the content script registers once and reports its version to the panel', () => {
  const page = open();
  try {
    assert.equal(page.connectListeners.length, 1);
    assert.equal(page.window.__ARENA_AGENT_REGISTRATION__.version, '2.8.2');
    assert.equal(page.window.__ARENA_AGENT_REGISTRATION__.isAlive(), true);
    page.window.eval(source); // a second injection of the same version must not stack listeners
    assert.equal(page.connectListeners.length, 1);
  } finally { page.close(); }
});

test('a second panel is refused while the first one is still connected', () => {
  const page = open();
  try {
    const first = page.connect(makePort());
    assert.equal(first.posted.some(message => message.type === 'ERROR'), false);
    const second = page.connect(makePort());
    const refusal = second.posted.find(message => message.code === 'TAB_IN_USE');
    assert.match(refusal.message, /Another extension panel is connected/);
    assert.equal(second.disconnected, true);
    assert.equal(first.disconnected, false);
  } finally { page.close(); }
});

test('a reconnect takes over when the previous panel is gone but the page has not noticed yet', () => {
  const page = open();
  try {
    const oldPanel = page.connect(makePort());
    // The panel closed its side of the port and is reconnecting at once: the page clears its side of that
    // port asynchronously, so from here the old port object simply throws on use.
    oldPanel.dead = true;
    const reconnected = page.connect(makePort());
    assert.equal(reconnected.disconnected, false, 'the reconnect must not be refused as TAB_IN_USE');
    assert.equal(reconnected.posted.some(message => message.code === 'TAB_IN_USE'), false);
    // A takeover that is only half done would show up here: the new port drives the capture loop.
    reconnected.emit({ type: 'PING' });
    assert.ok(reconnected.posted.some(message => message.type === 'PONG'));
    // The old port's disconnect event arrives after the handover and must not clean up the new owner.
    assert.equal(reconnected.disconnected, false);
    reconnected.emit({ type: 'PING' });
    assert.equal(reconnected.posted.filter(message => message.type === 'PONG').length, 2);
  } finally { page.close(); }
});

test('a heartbeat still scans immediately, so capture survives throttled timers', () => {
  const page = open();
  try {
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '11111111-1111-1111-1111-111111111111', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    const afterWatch = page.counters.matchTurn;
    assert.equal(afterWatch, 1);
    port.emit({ type: 'PING' });
    assert.equal(page.counters.matchTurn, afterWatch + 1);
  } finally { page.close(); }
});

test('a burst of page mutations does not run a full scan for every batch', async () => {
  const page = open();
  try {
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '22222222-2222-2222-2222-222222222222', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    const baseline = page.counters.matchTurn;
    const app = page.window.document.getElementById('app');
    // 40 separate tasks, each mutating the page: before coalescing this was 40 layout-reading scans.
    for (let i = 0; i < 40; i++) {
      app.textContent = `chunk ${i}`;
      await sleep(6);
    }
    const duringBurst = page.counters.matchTurn - baseline;
    assert.ok(duringBurst >= 1, 'the page changes must still be observed');
    assert.ok(duringBurst <= 8, `expected coalesced scans, saw ${duringBurst}`);
    // The trailing scan is not lost: the last change is still picked up after the burst.
    const settled = page.counters.matchTurn;
    await sleep(250);
    assert.ok(page.counters.matchTurn > settled, 'a final scan is queued for the last mutation');
  } finally { page.close(); }
});

test('disconnecting the panel stops the capture loop and its timers', async () => {
  const page = open();
  try {
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '33333333-3333-3333-3333-333333333333', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    port.disconnect();
    const afterDisconnect = page.counters.matchTurn;
    page.window.document.getElementById('app').textContent = 'changed while nobody is connected';
    await sleep(400);
    assert.equal(page.counters.matchTurn, afterDisconnect, 'no scan may run without a connected panel');
    // A new panel can connect again and is not treated as a second owner.
    const again = page.connect(makePort());
    assert.equal(again.disconnected, false);
    again.emit({ type: 'PING' });
    assert.ok(again.posted.some(message => message.type === 'PONG'));
  } finally { page.close(); }
});

function stageHarness(page) {
  const w = page.window;
  w.eval(readFileSync(new URL('../attachment-policy.js', import.meta.url), 'utf8'));
  const form = w.document.createElement('form');
  form.innerHTML = '<textarea></textarea><input type="file" multiple><button type="button">Send</button>';
  w.document.body.append(form);
  const field = form.querySelector('textarea'), input = form.querySelector('input'), button = form.querySelector('button');
  let clicks = 0, finish;
  button.addEventListener('click', () => { clicks++; });
  Object.assign(w.ArenaAgentDOM, {
    rows: () => [], conversationReady: () => [], reviewPanel: () => null,
    preflight: () => ({ field }), writeComposer: (field, text) => { field.value = text; },
    composer: () => field, composerText: field => field.value, promptMatches: (tx, text) => tx.prompt === text,
    uploadsFor: () => ({ input }), running: () => false, sendButton: () => button, enabled: () => true,
    stageRequestFor: () => { const token = w.crypto.randomUUID(); input.setAttribute('data-arena-agent-stage', token); return { input, token }; }
  });
  w.chrome.runtime.sendMessage = message => message.type === 'STAGE_FILES'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true });
  const port = page.connect(makePort());
  const requestId = w.crypto.randomUUID();
  const start = () => port.emit({ type: 'SEND', requestId, prompt: 'hello', url: w.location.href,
    attachments: [{ name: 'a.txt', type: 'text/plain', data: 'eA==' }] });
  return { input, port, requestId, start, clicks: () => clicks, finish: () => finish?.({ ok: true, value: { ok: true, files: [{ name: 'a.txt', size: 1 }] } }) };
}

test('staging timeout removes the single-use marker and ignores a late worker response', async () => {
  const page = open();
  try {
    let deadline;
    const nativeTimeout = page.window.setTimeout.bind(page.window);
    page.window.setTimeout = (fn, ms) => { if (ms === 10000) { deadline = fn; return 0; } return nativeTimeout(fn, ms); };
    const h = stageHarness(page); h.start();
    await sleep(10);
    assert.ok(h.input.hasAttribute('data-arena-agent-stage'));
    assert.equal(typeof deadline, 'function');
    deadline(); await sleep(10);
    assert.equal(h.port.posted.find(event => event.type === 'ERROR')?.code, 'STAGE_TIMEOUT');
    assert.equal(h.input.hasAttribute('data-arena-agent-stage'), false);
    h.finish(); await sleep(20);
    assert.equal(h.clicks(), 0);
  } finally { page.close(); }
});

test('cancelling staged preparation removes the marker immediately and never clicks Send later', async () => {
  const page = open();
  try {
    const h = stageHarness(page); h.start(); await sleep(10);
    assert.ok(h.input.hasAttribute('data-arena-agent-stage'));
    h.port.emit({ type: 'CANCEL', requestId: h.requestId });
    assert.equal(h.input.hasAttribute('data-arena-agent-stage'), false);
    h.finish(); await sleep(20);
    assert.equal(h.clicks(), 0);
    assert.equal(h.port.posted.some(event => event.type === 'ERROR'), false, 'cancelled work must not emit a late error into another transaction');
  } finally { page.close(); }
});
