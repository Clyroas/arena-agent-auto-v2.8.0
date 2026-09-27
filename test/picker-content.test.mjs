import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The full repo/branch picker path in the content script: the real agent-dom.js and the real
// agent-content.js are both loaded into a jsdom Arena page whose picker behaves like the site's
// (a trigger click expands its popover, an option click applies the choice, Escape collapses it).
// The only fakes are the chrome API and the panel port, so the PICKER wire messages, the one-click
// rules and the confirmation logic run exactly as they will in the Arena tab.
const domSource = readFileSync(new URL('../agent-dom.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('../agent-content.js', import.meta.url), 'utf8');

const BOOK = '<svg viewBox="0 0 24 24" fill="none">'
  + '<path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143"></path>'
  + '<path d="M15 17V22L17.5 20.4L20 22V17"></path><path d="M6 17L20 17"></path>'
  + '<path d="M6 17C4.89543 17 4 17.8954 4 19C4 20.1046 4.89543 21 6 21H11.5"></path></svg>';
const BRANCH = '<svg viewBox="0 0 24 24" fill="none">'
  + '<path d="M18 8C19.1046 8 20 7.10457 20 6C20 4.89543 19.1046 4 18 4C16.8954 4 16 4.89543 16 6C16 7.10457 16.8954 8 18 8Z"></path>'
  + '<path d="M6 20C7.10457 20 8 19.1046 8 18C8 16.8954 7.10457 16 6 16C4.89543 16 4 16.8954 4 18C4 19.1046 4.89543 20 6 20Z"></path>'
  + '<path d="M6 16V3"></path><path d="M8 18H9C12.5 18 18 15.9 18 9.5V8"></path></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9L12 15L18 9"></path></svg>';
const trigger = (id, controls, icon, label) =>
  `<button type="button" id="${id}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${controls}" data-state="closed">`
  + `<span class="flex min-w-0 items-center gap-1.5">${icon}<span class="truncate">${label}</span></span>${CHEVRON}</button>`;
const option = value => `<div role="option" data-value="${value}"><span class="truncate">${value}</span><span>Updated recently</span></div>`;

const PAGE = `<!doctype html><html><body>
<main><ol id="transcript"><div data-agent-transcript-message="true" data-chat-message-id="user-1"><div data-user-message-layout="true"><div class="prose">busy</div></div></div></ol>
<form id="composer">
  <div class="flex">${trigger('repo-trigger', 'radix-repo', BOOK, 'Clyroas/arena-agent-auto-v2.8.0')}${trigger('branch-trigger', 'radix-branch', BRANCH, 'main')}</div>
  <textarea id="message" aria-label="Message Arena" placeholder="Send a message"></textarea>
  <button id="send" type="button" aria-label="Send">Send</button>
</form></main>
<div id="radix-repo" role="dialog" data-state="open" hidden>
  <input type="text" placeholder="Search repositories" value="">
  <div role="listbox">${option('Clyroas/arena-agent-auto-v2.8.0')}${option('Clyroas/other-repo')}</div>
</div>
<div id="radix-branch" role="dialog" data-state="open" hidden>
  <div role="listbox">${option('main')}${option('arena/picker-bar')}</div>
</div>
</body></html>`;

function makePort() {
  const listeners = { message: [], disconnect: [] };
  const port = {
    name: 'arena-agent-content-v3', sender: { id: 'test-extension' }, posted: [], disconnected: false,
    onMessage: { addListener: fn => listeners.message.push(fn) },
    onDisconnect: { addListener: fn => listeners.disconnect.push(fn) },
    postMessage(message) { port.posted.push(message); },
    disconnect() { if (!port.disconnected) { port.disconnected = true; listeners.disconnect.forEach(fn => fn()); } },
    emit(message) { listeners.message.forEach(fn => fn(message)); }
  };
  return port;
}

function openPage() {
  const dom = new JSDOM(PAGE, { url: 'https://arena.ai/agent/c/1', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.getClientRects = function () {
    for (let p = this; p; p = p.parentElement) {
      if (p.hasAttribute?.('hidden') || p.style?.display === 'none' || p.getAttribute?.('aria-hidden') === 'true') return [];
    }
    return [{ x: 0, y: 0, width: 10, height: 10 }];
  };
  window.getComputedStyle = function (el) {
    for (let p = el; p && p.style; p = p.parentElement) {
      if (p.style.display === 'none' || p.hasAttribute?.('hidden')) {
        return { display: 'none', visibility: 'visible', opacity: '1', pointerEvents: 'auto', flexDirection: 'row', getPropertyValue: prop => (prop === 'display' ? 'none' : '') };
      }
    }
    return { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', flexDirection: 'row', getPropertyValue: prop => (prop === 'display' ? 'block' : '') };
  };
  const connectListeners = [];
  window.chrome = {
    runtime: {
      id: 'test-extension',
      onConnect: { addListener: fn => connectListeners.push(fn) },
      sendMessage: async () => ({ ok: true, value: true })
    }
  };
  window.eval(domSource);
  window.eval(contentSource);
  const doc = window.document;
  // The fixture's "Radix": trigger clicks toggle their popover; an option click applies the choice;
  // a document Escape collapses everything, exactly the gestures the site itself honours.
  for (const trigger of doc.querySelectorAll('button[aria-haspopup="dialog"][aria-controls]')) {
    trigger.addEventListener('click', () => {
      const dialog = doc.getElementById(trigger.getAttribute('aria-controls'));
      const open = trigger.getAttribute('data-state') === 'open';
      trigger.setAttribute('data-state', open ? 'closed' : 'open');
      dialog.hidden = open;
    });
  }
  for (const dialog of doc.querySelectorAll('[role="dialog"]')) {
    const trigger = doc.querySelector(`button[aria-controls="${dialog.id}"]`);
    for (const option of dialog.querySelectorAll('[role="option"]')) {
      option.addEventListener('click', () => {
        trigger.querySelector('span.truncate').textContent = option.dataset.value;
        trigger.setAttribute('data-state', 'closed');
        dialog.hidden = true;
      });
    }
  }
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const trigger of doc.querySelectorAll('button[aria-haspopup="dialog"][data-state="open"]')) {
      trigger.setAttribute('data-state', 'closed');
      doc.getElementById(trigger.getAttribute('aria-controls'))?.setAttribute('hidden', '');
    }
  });
  return {
    window, connectListeners,
    connect(port = makePort()) { connectListeners[0](port); return port; },
    close() { window.__ARENA_AGENT_REGISTRATION__?.dispose?.(); window.close(); }
  };
}

const ACTION = '11111111-2222-3333-4444-555555555555';
const wait = ms => new Promise(resolve => { setTimeout(resolve, ms); });
async function until(predicate, tries = 60) {
  for (let i = 0; i < tries; i++) { const value = predicate(); if (value) return value; await wait(25); }
  return null;
}
const realm = value => JSON.parse(JSON.stringify(value));
const lastOfType = (port, type) => [...port.posted].reverse().find(message => message.type === type);

test('opening a picker clicks Arena’s trigger once and reports its own option list', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    let clicks = 0;
    page.window.document.getElementById('repo-trigger').addEventListener('click', () => { clicks++; });
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'open' });
    const state = await until(() => lastOfType(port, 'PICKER_STATE'));
    assert.equal(clicks, 1, 'exactly one trigger click');
    assert.equal(state.kind, 'repo');
    assert.equal(state.phase, 'open');
    assert.deepEqual(realm(state.options).map(option => option.label), ['Clyroas/arena-agent-auto-v2.8.0', 'Clyroas/other-repo']);
    assert.equal(state.repoPickers.repo.value, 'Clyroas/arena-agent-auto-v2.8.0');
  } finally { page.close(); }
});

test('a pick clicks one exact option, confirms from the trigger label, and reports the new state', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'open' });
    await until(() => lastOfType(port, 'PICKER_STATE'));
    let clicks = 0;
    for (const option of page.window.document.querySelectorAll('#radix-repo [role="option"]'))
      option.addEventListener('click', () => { clicks++; });
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'pick', value: 'Clyroas/other-repo' });
    const done = await until(() => lastOfType(port, 'PICKER_STATE')?.phase === 'done' ? lastOfType(port, 'PICKER_STATE') : null);
    assert.ok(done, 'the pick was confirmed');
    assert.equal(clicks, 1, 'exactly one option click');
    assert.equal(done.value, 'Clyroas/other-repo');
    assert.equal(done.repoPickers.repo.value, 'Clyroas/other-repo');
    assert.equal(page.window.document.getElementById('radix-repo').hidden, true, 'Arena’s popover closed');
    // A second pick on the same session is stale: nothing was clicked again.
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'pick', value: 'Clyroas/other-repo' });
    const stale = await until(() => lastOfType(port, 'PICKER_ERROR'));
    assert.equal(stale.code, 'PICKER_STALE');
    assert.equal(clicks, 1);
  } finally { page.close(); }
});

test('an unknown option is a coded refusal that leaves Arena’s picker open for the user', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'branch', action: 'open' });
    await until(() => lastOfType(port, 'PICKER_STATE'));
    let clicks = 0;
    for (const option of page.window.document.querySelectorAll('#radix-branch [role="option"]'))
      option.addEventListener('click', () => { clicks++; });
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'branch', action: 'pick', value: 'not-a-branch' });
    const error = await until(() => lastOfType(port, 'PICKER_ERROR'));
    assert.equal(error.code, 'PICKER_NOT_FOUND');
    assert.equal(error.clicked, false);
    assert.equal(clicks, 0);
    assert.equal(page.window.document.getElementById('radix-branch').hidden, false, 'the popover is still open');
    // The user closes from the panel: one Escape dismisses it in Arena.
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'branch', action: 'close' });
    const closed = await until(() => lastOfType(port, 'PICKER_STATE')?.phase === 'closed' ? lastOfType(port, 'PICKER_STATE') : null);
    assert.ok(closed);
    assert.equal(page.window.document.getElementById('radix-branch').hidden, true);
  } finally { page.close(); }
});

test('picker actions are refused while a turn is being tracked', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'WATCH', requestId: '99999999-9999-9999-9999-999999999999', prompt: 'busy', userMessageId: 'user-1', url: 'https://arena.ai/agent/c/1' });
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'open' });
    const error = await until(() => lastOfType(port, 'PICKER_ERROR'));
    assert.equal(error.code, 'PICKER_BUSY');
    assert.equal(page.window.document.getElementById('repo-trigger').getAttribute('data-state'), 'closed', 'nothing was clicked');
  } finally { page.close(); }
});

test('a Send is refused while Arena’s picker is open, and says so with its own code', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'open' });
    await until(() => lastOfType(port, 'PICKER_STATE'));
    port.emit({ type: 'SEND', requestId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', prompt: 'hello', url: 'https://arena.ai/agent/c/1' });
    const error = await until(() => lastOfType(port, 'ERROR'));
    assert.equal(error.code, 'PICKER_OPEN');
    assert.match(error.message, /repository picker is open/);
    assert.equal(error.clicked, false);
    assert.equal(page.window.document.getElementById('message').value, '', 'nothing was typed into Arena');
  } finally { page.close(); }
});

test('an invalid picker request is refused without touching the page', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'PICKER', actionId: 'not-a-uuid', kind: 'repo', action: 'open' });
    const error = await until(() => lastOfType(port, 'PICKER_ERROR'));
    assert.equal(error.code, 'INVALID_PICKER_REQUEST');
    assert.equal(page.window.document.getElementById('repo-trigger').getAttribute('data-state'), 'closed');
  } finally { page.close(); }
});

test('a picker Arena did not open is a coded failure, not a silent retry', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    // Break the fixture’s wiring so the click does nothing, like a page whose popover failed to mount.
    const trigger = page.window.document.getElementById('branch-trigger');
    const clone = trigger.cloneNode(true);
    trigger.replaceWith(clone);
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'branch', action: 'open' });
    const error = await until(() => lastOfType(port, 'PICKER_ERROR'), 260);
    assert.equal(error.code, 'PICKER_NOT_OPENED');
    assert.match(error.message, /did not open its branch picker/);
  } finally { page.close(); }
});

test('losing the panel closes a picker it left open, once and best effort', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'open' });
    await until(() => lastOfType(port, 'PICKER_STATE'));
    assert.equal(page.window.document.getElementById('radix-repo').hidden, false);
    let escapes = 0;
    page.window.document.addEventListener('keydown', event => { if (event.key === 'Escape') escapes++; });
    port.disconnect();
    await until(() => page.window.document.getElementById('radix-repo').hidden);
    assert.equal(escapes, 1, 'exactly one Escape from cleanup');
  } finally { page.close(); }
});

test('only one picker at a time, and popover text is never mistaken for a page notice', async () => {
  const page = openPage();
  try {
    const port = page.connect();
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'open' });
    await until(() => lastOfType(port, 'PICKER_STATE'));
    // A repository literally named like a notice word is page content, not a notice.
    page.window.document.querySelector('#radix-repo [role="option"] .truncate').textContent = 'captcha-solver';
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'branch', action: 'open' });
    const busy = await until(() => lastOfType(port, 'PICKER_ERROR'));
    assert.equal(busy.code, 'PICKER_BUSY');
    assert.match(busy.message, /repository picker is still open/);
    assert.equal(page.window.document.getElementById('branch-trigger').getAttribute('data-state'), 'closed', 'the other trigger was never clicked');
    port.emit({ type: 'PICKER', actionId: ACTION, kind: 'repo', action: 'close' });
    const closed = await until(() => lastOfType(port, 'PICKER_STATE')?.phase === 'closed' ? lastOfType(port, 'PICKER_STATE') : null);
    assert.ok(closed, 'closing works even with notice-like option text on screen');
  } finally { page.close(); }
});
