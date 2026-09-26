import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient, ADAPTER_VERSION, HEARTBEAT_MS, ATTACH_TIMEOUT_MS, GRANT_TIMEOUT_MS } from '../agent-client.js';

// The panel talks to the worker with one-shot messages and to the Arena tab with a port. Both sides are
// faked here so the failure paths that used to be able to hang the panel can be asserted directly.
function makePort() {
  const listeners = { message: [], disconnect: [] };
  const port = {
    posted: [], disconnected: false, dead: false,
    onMessage: { addListener: fn => listeners.message.push(fn) },
    onDisconnect: { addListener: fn => listeners.disconnect.push(fn) },
    postMessage(message) {
      if (port.dead || port.disconnected) throw new Error('Attempting to use a disconnected port object');
      port.posted.push(message);
    },
    disconnect() { if (!port.disconnected) { port.disconnected = true; listeners.disconnect.forEach(fn => fn()); } },
    emit(message) { listeners.message.forEach(fn => fn(message)); }
  };
  return port;
}

function installChrome({ attach, grant, sendMessage, port = makePort() } = {}) {
  const calls = [];
  globalThis.chrome = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: async message => {
        calls.push(message);
        if (sendMessage) return sendMessage(message);
        if (message.type === 'ATTACH') return attach ? attach(message) : { ok: true, value: { documentId: 'doc-1' } };
        if (message.type === 'STAGE_GRANT') return grant ? grant(message) : { ok: true, value: true };
        return { ok: true, value: true };
      }
    },
    tabs: { connect: () => port }
  };
  return { calls, port };
}

test('the shipped timeouts are long enough for a slow machine but shorter than a user’s patience', () => {
  assert.ok(ATTACH_TIMEOUT_MS >= 10000 && ATTACH_TIMEOUT_MS <= 60000);
  assert.ok(GRANT_TIMEOUT_MS >= 5000 && GRANT_TIMEOUT_MS <= ATTACH_TIMEOUT_MS);
});

const until = async predicate => {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(resolve => { setImmediate(resolve); }); }
  throw new Error('condition was never met');
};

async function connect(events, options = {}) {
  const harness = installChrome(options);
  const client = new AgentClient(42, event => events.push(event), options.expectedUrl, options.timeouts);
  await until(() => harness.port.posted.some(message => message.type === 'PROBE'));
  harness.port.emit({ type: 'READY', adapterVersion: options.adapterVersion ?? ADAPTER_VERSION, pageKind: options.pageKind ?? 'agent', model: options.model ?? '', models: options.models ?? [] });
  await client.readiness;
  return { ...harness, client };
}

test('a refused connection rejects readiness with the worker’s own code and message', async () => {
  const events = [];
  installChrome({ attach: async () => ({ ok: false, code: 'SITE_ACCESS_REQUIRED', error: 'Chrome has not granted Arena site access.' }) });
  const client = new AgentClient(42, event => events.push(event));
  await assert.rejects(client.readiness, /SITE_ACCESS_REQUIRED: Chrome has not granted Arena site access\./);
  assert.equal(events.length, 1);
  assert.deepEqual({ type: events[0].type, code: events[0].code, clicked: events[0].clicked }, { type: 'ERROR', code: 'SITE_ACCESS_REQUIRED', clicked: false });
  client.close();
});

test('a successful handshake turns the port into a ready client', async () => {
  const events = [];
  const { port, client } = await connect(events, { pageKind: 'direct', model: 'Max', models: [{ name: 'Max', org: 'Arena' }] });
  assert.equal(client.ready, true);
  assert.equal(client.pageKind, 'direct');
  assert.equal(client.model, 'Max');
  assert.deepEqual(client.models, [{ name: 'Max', org: 'Arena' }]);
  assert.equal(ADAPTER_VERSION, '2.9.0');
  assert.ok(HEARTBEAT_MS > 0);
  client.close();
  assert.equal(port.disconnected, true);
});

test('a stale content script is rejected instead of being spoken to', async () => {
  const events = [];
  const { port } = installChrome({});
  const client = new AgentClient(42, event => events.push(event));
  await until(() => port.posted.some(message => message.type === 'PROBE'));
  port.emit({ type: 'READY', adapterVersion: '0.0.1', pageKind: 'agent', model: '' });
  await assert.rejects(client.readiness, /Wrong content-script version/);
  assert.equal(client.ready, false);
  // Fails closed: the mismatched adapter is dropped, so nothing can be written into the page through it.
  assert.equal(client.closed, true);
  assert.equal(port.disconnected, true);
  assert.match(events.find(event => event.code === 'VERSION_MISMATCH').message, /Wrong content-script version/);
  assert.equal(port.posted.some(message => message.type === 'SEND'), false);
});

test('a worker request that never answers is reported instead of hanging the panel', async () => {
  const events = [];
  const { port, client } = await connect(events, { timeouts: { attach: 200, grant: 200 } });
  globalThis.chrome.runtime.sendMessage = async message => {
    if (message.type === 'STAGE_GRANT') return new Promise(() => {}); // worker gone: the promise never settles
    return { ok: true, value: true };
  };
  const started = Date.now();
  await assert.rejects(client.send('req-2', 'hello', 'https://arena.ai/agent', [{ name: 'a.txt', type: 'text/plain', data: 'AAA' }]), error => {
    assert.equal(error.name, 'TimeoutError');
    assert.match(error.message, /did not confirm the staged files within 0 seconds/);
    return true;
  });
  assert.ok(Date.now() - started < 5000, 'the caller is released long before the handshake window');
  assert.equal(port.posted.some(message => message.type === 'SEND'), false);
  client.close();
});

test('a connection request that never answers fails instead of pretending to be connected', async () => {
  const events = [];
  installChrome({ sendMessage: async message => (message.type === 'ATTACH' ? new Promise(() => {}) : { ok: true, value: true }) });
  const client = new AgentClient(42, event => events.push(event), undefined, { attach: 100, grant: 100 });
  await assert.rejects(client.readiness, /did not answer the connection request within 0 seconds/);
  assert.equal(client.ready, false);
  assert.equal(events.some(event => event.type === 'ERROR' && event.code === 'TIMEOUT'), true);
  client.close();
});

test('staged files are not sent when the worker cannot confirm them', async () => {
  const events = [];
  const { port, client } = await connect(events, {
    grant: async () => ({ ok: false, code: 'STAGE_UNBOUND', error: 'No pending staged-file send is attached to this Arena document.' })
  });
  await assert.rejects(client.send('req-1', 'hello', 'https://arena.ai/agent', [{ name: 'a.txt', type: 'text/plain', data: 'AAA' }]),
    /No pending staged-file send is attached/);
  assert.equal(port.posted.some(message => message.type === 'SEND'), false);
  client.close();
});

test('a throw from the worker (extension reloaded) rejects cleanly', async () => {
  const events = [];
  const { client } = await connect(events);
  globalThis.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
  await assert.rejects(client.send('req-3', 'hello', 'https://arena.ai/agent', [{ name: 'a.txt', type: 'text/plain', data: 'AAA' }]),
    /could not confirm the staged files \(Extension context invalidated\.\)/);
  client.close();
});

test('teardown never throws, even when the extension context is already gone', async () => {
  const events = [];
  const { calls, client } = await connect(events);
  globalThis.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
  assert.doesNotThrow(() => client.cancel('req-4'));
  assert.doesNotThrow(() => client.close());
  assert.equal(client.closed, true);
  client.close(); // idempotent
  assert.ok(calls.some(message => message.type === 'ATTACH'));
});

test('a staged-file grant is revoked once the turn is over', async () => {
  const events = [];
  const { calls, client } = await connect(events);
  client.close();
  const revokes = calls.filter(message => message.type === 'STAGE_REVOKE');
  assert.equal(revokes.length, 1);
  assert.equal(revokes[0].documentId, 'doc-1');
});

test('losing the port is reported once, with the state the panel needs to decide', async () => {
  const events = [];
  const { port, client } = await connect(events);
  port.disconnect();
  const lost = events.filter(event => event.type === 'BRIDGE_LOST');
  assert.equal(lost.length, 1);
  assert.deepEqual({ code: lost[0].code, wasReady: lost[0].wasReady }, { code: 'CONNECTION_LOST', wasReady: true });
  assert.equal(client.ready, false);
  client.close();
});

test('a page error is handed to the panel without dropping a healthy connection', async () => {
  const events = [];
  const { port, client } = await connect(events, { timeouts: { attach: 100, grant: 100 } });
  port.emit({ type: 'ERROR', code: 'COMPOSER_NOT_FOUND', message: 'No eligible message input is ready.', clicked: false, requestId: null });
  await until(() => events.some(event => event.type === 'ERROR' && event.code === 'COMPOSER_NOT_FOUND'));
  assert.equal(client.closed, false); // a recoverable page problem keeps the connection for the panel
  client.close();
});

test('methods refuse to run on a connection that is gone', async () => {
  const events = [];
  const { client } = await connect(events);
  client.close();
  assert.throws(() => client.post({ type: 'PING' }), /not ready/);
  assert.throws(() => client.watch('req-5', 'p', 'user-1', 'https://arena.ai/agent', false), /not ready/);
  assert.throws(() => client.answer('req-5', { token: 't', kind: 'option', index: 0 }), /not ready/);
  assert.throws(() => client.loadHistory('req-6', 'https://arena.ai/agent'), /not ready/);
});

test('handshake budget begins after attach, and timeout closes the unready port', async () => {
  const events = [];
  const { port } = installChrome({ attach: async () => {
    await new Promise(resolve => { setTimeout(resolve, 35); });
    return { ok: true, value: { documentId: 'slow-doc' } };
  } });
  const client = new AgentClient(42, event => events.push(event), undefined, { attach: 500, handshake: 15 });
  await assert.rejects(client.readiness, /Connection setup timed out/);
  assert.ok(port.posted.some(message => message.type === 'PROBE'), 'attach must finish before the short handshake starts');
  assert.equal(client.closed, true);
  assert.equal(port.disconnected, true);
  assert.equal(port.posted.some(message => message.type === 'SEND'), false);
});

test('an Arena dialog gets a bounded, non-renewing human-interaction deadline', async () => {
  const { port } = installChrome();
  const client = new AgentClient(42, () => {}, undefined, { handshake: 100, dialog: 20 });
  await until(() => port.posted.some(message => message.type === 'PROBE'));
  port.emit({ type: 'WAITING' });
  const timer = client.timeout;
  port.emit({ type: 'WAITING' });
  assert.equal(client.timeout, timer, 'repeated WAITING must not extend the deadline');
  await assert.rejects(client.readiness, /timed out/);
  assert.equal(client.closed, true);
  assert.equal(port.disconnected, true);
});

test('cancelling connection setup ignores a late READY', async () => {
  const { port } = installChrome();
  const client = new AgentClient(42, () => {});
  await until(() => port.posted.some(message => message.type === 'PROBE'));
  client.close();
  port.emit({ type: 'READY', adapterVersion: ADAPTER_VERSION });
  await assert.rejects(client.readiness, /closed/);
  assert.equal(client.ready, false);
});

test('a silent open port pauses sending without resending or terminating a long generation', async () => {
  const events = [];
  const { client, port } = await connect(events);
  client.lastInbound = 0; client.checkHealth(); client.checkHealth();
  assert.equal(client.silent, true);
  assert.equal(client.ready, true);
  assert.equal(client.closed, false);
  assert.equal(events.filter(event => event.type === 'TRANSPORT_HEALTH').length, 1);
  await assert.rejects(client.send('x', 'hello', 'https://arena.ai/agent'), /not responding/);
  assert.equal(port.posted.some(message => message.type === 'SEND'), false);
  port.emit({ type: 'PONG' });
  assert.equal(client.silent, false);
  assert.equal(events.at(-2).responsive, true);
  client.close();
});

test('synchronous Chrome attach failures are reported after the caller owns the client reference', async () => {
  installChrome();
  globalThis.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated'); };
  const events = [];
  let client;
  client = new AgentClient(42, event => { assert.ok(client); events.push(event); });
  await assert.rejects(client.readiness, /Extension context invalidated/);
  assert.equal(events.length, 1);
  assert.equal(client.closed, true);
});

// ---- Repo & branch picker state on the client (v2.9.0) -------------------------------------------
test('picker state from the adapter is normalized onto the client', async () => {
  const events = [];
  const { port, client } = await connect(events);
  port.emit({ type: 'MODEL_INFO', pageKind: 'agent', model: '', models: [],
    repoPickers: { repo: { present: true, value: 'Clyroas/arena-agent-auto-v2.8.0', disabled: false }, branch: { present: true, value: 'main', disabled: true } } });
  assert.deepEqual(client.repoPickers, { repo: { present: true, value: 'Clyroas/arena-agent-auto-v2.8.0', disabled: false }, branch: { present: true, value: 'main', disabled: true } });
  // A malformed frame can only ever become "not present" — never an invented repository.
  port.emit({ type: 'MODEL_INFO', pageKind: 'agent', model: '', models: [], repoPickers: { repo: { present: true, value: 42 } } });
  assert.deepEqual(client.repoPickers.repo, { present: true, value: '', disabled: false });
  port.emit({ type: 'MODEL_INFO', pageKind: 'agent', model: '', models: [], repoPickers: null });
  assert.equal(client.repoPickers.repo.value, '');
  client.close();
});

test('picker requests travel the port only while the connection is ready', async () => {
  const events = [];
  const { port, client } = await connect(events);
  client.picker('11111111-2222-3333-4444-555555555555', 'repo', 'open');
  client.picker('11111111-2222-3333-4444-555555555556', 'branch', 'pick', 'main');
  const pickerMessages = port.posted.filter(message => message.type === 'PICKER');
  assert.deepEqual(pickerMessages, [
    { type: 'PICKER', actionId: '11111111-2222-3333-4444-555555555555', kind: 'repo', action: 'open' },
    { type: 'PICKER', actionId: '11111111-2222-3333-4444-555555555556', kind: 'branch', action: 'pick', value: 'main' }
  ]);
  client.close();
  assert.throws(() => client.picker('11111111-2222-3333-4444-555555555557', 'repo', 'close'), /not ready/);
});
