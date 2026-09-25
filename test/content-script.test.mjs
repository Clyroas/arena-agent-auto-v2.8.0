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
    version: '2.8.3', counters, DomError,
    samePage: () => true,
    checkBlocks: () => { counters.checkBlocks++; },
    securityNotice: () => '',
    rows: () => [{ id: 'user-1', user: true }],
    matchTurn: () => { counters.matchTurn++; return { accepted: false }; },
    fail: (code, message) => { throw new DomError(code, message); },
    inspectControls: () => ({ inputKind: 'textarea', reviewPending: false, uploadKind: 'none', fileInputCount: 0 }),
    capabilities: () => ({ pageKind: 'agent', mode: '', checks: { composer: true, send: true, transcript: true, questions: false, responsePairs: false, reviewPanel: false, upload: false, uploadPicker: false } }),
    pageKind: () => 'agent', currentModel: () => '', modelCatalog: () => [],
    historyCount: () => 0,
    reanchor: () => false
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
    assert.equal(page.window.__ARENA_AGENT_REGISTRATION__.version, '2.8.3');
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

test('a visible security verification pauses capture instead of stopping it, and resumes on its own', async () => {
  const page = open();
  try {
    let notice = 'Arena is showing a security verification.';
    page.window.ArenaAgentDOM.securityNotice = () => notice;
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '44444444-4444-4444-4444-444444444444', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    const whileClear = page.counters.matchTurn;
    assert.ok(page.counters.checkBlocks >= 1, 'the initial scan runs normally');
    // The verification appears. Capture must not fail the turn: it holds and says why.
    port.emit({ type: 'PING' });
    assert.equal(page.counters.matchTurn, whileClear, 'no capture work runs while verification is visible');
    assert.equal(port.posted.some(event => event.type === 'ERROR'), false, 'a transient verification must not stop the turn');
    const blocked = port.posted.filter(event => event.type === 'BLOCKED');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].code, 'SECURITY_CHECK');
    assert.match(blocked[0].message, /verification/i);
    // Repeating heartbeats while still blocked must not spam the panel with duplicate notices.
    port.emit({ type: 'PING' });
    assert.equal(port.posted.filter(event => event.type === 'BLOCKED').length, 1);
    // The user clears it in Arena: the very next scan resumes tracking without any reconnect.
    notice = '';
    port.emit({ type: 'PING' });
    const cleared = port.posted.filter(event => event.type === 'SECURITY_CLEARED');
    assert.equal(cleared.length, 1, 'the panel is told the verification passed');
    assert.equal(port.posted.some(event => event.type === 'ERROR'), false);
    assert.ok(page.counters.matchTurn > whileClear, 'capture continues after the verification is cleared');
  } finally { page.close(); }
});

test('a rate limit is still a hard stop, not a pause', async () => {
  const page = open();
  try {
    page.window.ArenaAgentDOM.checkBlocks = () => { throw new page.window.ArenaAgentDOM.DomError('RATE_LIMIT', 'Arena is limiting requests.'); };
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '55555555-5555-5555-5555-555555555555', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    const stopped = port.posted.find(event => event.type === 'ERROR');
    assert.equal(stopped?.code, 'RATE_LIMIT');
    assert.equal(port.posted.some(event => event.type === 'BLOCKED'), false);
  } finally { page.close(); }
});

test('connecting while a verification is showing waits for it and then reports READY, instead of failing', async () => {
  const page = open();
  try {
    let blocked = true;
    page.window.ArenaAgentDOM.inspectControls = () => {
      if (blocked) throw new page.window.ArenaAgentDOM.DomError('SECURITY_CHECK', 'A security verification is visible.');
      return { inputKind: 'textarea', reviewPending: false, uploadKind: 'none', fileInputCount: 0 };
    };
    const port = page.connect(makePort());
    port.emit({ type: 'PROBE' });
    await sleep(50);
    const waiting = port.posted.find(event => event.type === 'WAITING');
    assert.equal(waiting?.code, 'SECURITY_CHECK');
    assert.match(waiting.message, /verification/i);
    assert.equal(port.posted.some(event => event.type === 'ERROR'), false, 'a visible verification must not kill the handshake');
    assert.equal(port.posted.some(event => event.type === 'READY'), false);
    // The user clears it: the same handshake reaches READY with no reconnect.
    blocked = false;
    await sleep(500);
    assert.ok(port.posted.some(event => event.type === 'READY'), 'the panel connects once verification passes');
    assert.equal(port.posted.some(event => event.type === 'ERROR'), false);
  } finally { page.close(); }
});

test('a security pause does not spend the message-acceptance budget', async () => {
  const page = open();
  try {
    const seen = [];
    let notice = '';
    page.window.ArenaAgentDOM.securityNotice = () => notice;
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '66666666-6666-6666-6666-666666666666', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    // A resume path sets ackDeadline to Infinity; the shift must leave it unscathed.
    notice = 'Arena is showing a security verification.';
    port.emit({ type: 'PING' });
    notice = '';
    port.emit({ type: 'PING' });
    seen.push(...port.posted.filter(event => event.type === 'SECURITY_CLEARED'));
    assert.equal(seen.length, 1);
    assert.equal(port.posted.some(event => event.type === 'ERROR'), false, 'no SEND_NOT_CONFIRMED after a pause on a resumed turn');
  } finally { page.close(); }
});

test('a transcript remount right after a security verification resumes instead of stopping', async () => {
  const page = open();
  try {
    let notice = 'Arena is showing a security verification.';
    page.window.ArenaAgentDOM.securityNotice = () => notice;
    let failNext = false, reanchors = 0;
    page.window.ArenaAgentDOM.matchTurn = () => {
      page.counters.matchTurn++;
      // The verification clears while Arena re-mounts: the first read sees an empty transcript, and the
      // second read (after re-anchoring on the accepted message ID) sees it whole again.
      if (failNext) { failNext = false; throw new page.window.ArenaAgentDOM.DomError('CONVERSATION_CHANGED', 'The Agent transcript changed or was virtualized. Capture stopped to avoid an unrelated reply. Inspect the Arena tab. [Seen: nothing; 0 row(s) on page]'); }
      return { accepted: true, userId: 'user-1' };
    };
    page.window.ArenaAgentDOM.reanchor = () => { reanchors++; return true; };
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '77777777-7777-7777-7777-777777777777', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    notice = ''; failNext = true;
    port.emit({ type: 'PING' });
    assert.equal(port.posted.some(event => event.type === 'ERROR'), false, 'a post-verification remount must not stop capture');
    assert.equal(reanchors, 1, 'the accepted message ID is used to re-anchor exactly once');
    // The retry result must actually be used: the scan has to continue past the recovered read rather than
    // discarding it and throwing the original error.
    const afterRecovery = page.counters.matchTurn;
    assert.equal(afterRecovery, 2, 'one failed read, then exactly one re-anchored retry that is used');
  } finally { page.close(); }
});

test('a genuine transcript change is still a hard stop', async () => {
  const page = open();
  try {
    page.window.ArenaAgentDOM.matchTurn = () => { throw new page.window.ArenaAgentDOM.DomError('CONVERSATION_CHANGED', 'The Agent transcript changed or was virtualized.'); };
    page.window.ArenaAgentDOM.reanchor = () => false;
    const port = page.connect(makePort());
    port.emit({ type: 'WATCH', requestId: '88888888-8888-8888-8888-888888888888', prompt: 'hello', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    const stopped = port.posted.find(event => event.type === 'ERROR');
    assert.equal(stopped?.code, 'CONVERSATION_CHANGED', 'outside a verification settle window the guard must still stop capture');
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
