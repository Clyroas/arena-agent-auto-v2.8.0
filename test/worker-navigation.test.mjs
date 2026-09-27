import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_URL, directModelUrl } from '../core.js';

const listeners = [], calls = [];
let windowState = 'normal', tabUrl = AGENT_URL;
let activeTabId = null, lastFocusedWindow = null, lastNormalWindow = null;
globalThis.chrome = {
  runtime: {
    id: 'extension', getURL: name => `chrome-extension://extension/${name}`,
    onMessage: { addListener: fn => listeners.push(fn) },
    onInstalled: { addListener() {} }, onStartup: { addListener() {} }
  },
  action: { onClicked: { addListener() {} } },
  tabs: {
    get: async id => ({ id, windowId: 7, url: tabUrl }),
    update: async (id, options) => { calls.push(['tab', id, options]); },
    query: async ({ windowId, active }) => (activeTabId != null ? [{ id: activeTabId, windowId, active: true }] : [])
  },
  windows: {
    get: async () => ({ state: windowState }),
    update: async (id, options) => { calls.push(['window', id, options]); },
    getLastFocused: async options => {
      if (options?.windowTypes?.includes('normal')) return lastNormalWindow;
      return lastFocusedWindow;
    }
  }
};
await import('../worker.js');
const navigate = url => new Promise(resolve => {
  listeners.at(-1)({ type: 'NAVIGATE_TAB', tabId: 42, url },
    { id: 'extension', url: chrome.runtime.getURL('floating.html') }, resolve);
});
const restore = prev => new Promise(resolve => {
  listeners.at(-1)({ type: 'RESTORE_TAB', ...prev },
    { id: 'extension', url: chrome.runtime.getURL('floating.html') }, resolve);
});

for (const target of [AGENT_URL, directModelUrl('test-model')]) {
  test(`explicit switch foregrounds and wakes the selected tab: ${target}`, async () => {
    calls.length = 0; windowState = 'normal'; tabUrl = AGENT_URL; activeTabId = null; lastFocusedWindow = null; lastNormalWindow = null;
    assert.equal((await navigate(target)).ok, true);
    assert.deepEqual(calls, [
      ['window', 7, { focused: true }],
      ['tab', 42, { url: target, active: true }]
    ]);
  });
}
test('switch restores a minimized browser window', async () => {
  calls.length = 0; windowState = 'minimized'; activeTabId = null; lastFocusedWindow = null; lastNormalWindow = null;
  assert.equal((await navigate(AGENT_URL)).ok, true);
  assert.deepEqual(calls[0], ['window', 7, { focused: true, state: 'normal' }]);
});
test('invalid targets and non-Arena tabs cannot trigger navigation or focus', async () => {
  calls.length = 0; activeTabId = null; lastFocusedWindow = null; lastNormalWindow = null;
  assert.equal((await navigate('https://example.com')).ok, false);
  tabUrl = 'https://example.com';
  assert.equal((await navigate(AGENT_URL)).ok, false);
  assert.deepEqual(calls, []);
});

test('snapshot captures previous active tab and restore reactivates it', async () => {
  calls.length = 0; windowState = 'normal'; tabUrl = AGENT_URL;
  activeTabId = 99; lastFocusedWindow = { id: 7, type: 'normal' }; lastNormalWindow = null;
  const res = await navigate(AGENT_URL);
  assert.equal(res.ok, true);
  assert.equal(res.value.previousTabId, 99);
  calls.length = 0;
  const restored = await restore(res.value);
  assert.equal(restored.ok, true);
  assert.deepEqual(calls, [['tab', 99, { active: true }]]);
});

test('restore re-minimizes the window and refocuses the previous window', async () => {
  calls.length = 0; windowState = 'minimized'; tabUrl = AGENT_URL;
  activeTabId = null; lastFocusedWindow = { id: 3, type: 'normal' }; lastNormalWindow = null;
  const res = await navigate(AGENT_URL);
  assert.equal(res.ok, true);
  assert.equal(res.value.wasMinimized, true);
  assert.equal(res.value.previousWindowId, 3);
  calls.length = 0;
  const restored = await restore(res.value);
  assert.equal(restored.ok, true);
  assert.deepEqual(calls, [
    ['window', 7, { state: 'minimized' }],
    ['window', 3, { focused: true }]
  ]);
});

test('restore refocuses both popup window and normal browser window', async () => {
  calls.length = 0; windowState = 'normal'; tabUrl = AGENT_URL;
  activeTabId = null; lastFocusedWindow = { id: 10, type: 'popup' }; lastNormalWindow = { id: 1, type: 'normal' };
  const res = await navigate(AGENT_URL);
  assert.equal(res.ok, true);
  assert.equal(res.value.previousWindowId, 10);
  assert.equal(res.value.previousNormalWindowId, 1);
  calls.length = 0;
  const restored = await restore(res.value);
  assert.equal(restored.ok, true);
  assert.deepEqual(calls, [
    ['window', 1, { focused: true }],
    ['window', 10, { focused: true }]
  ]);
});

test('restore does not alter active tab or window when Arena was already active and focused', async () => {
  calls.length = 0; windowState = 'normal'; tabUrl = AGENT_URL;
  activeTabId = 42; lastFocusedWindow = { id: 7, type: 'normal' }; lastNormalWindow = null;
  const res = await navigate(AGENT_URL);
  assert.equal(res.ok, true);
  assert.equal(res.value.previousTabId, null);
  assert.equal(res.value.previousWindowId, 7);
  calls.length = 0;
  const restored = await restore(res.value);
  assert.equal(restored.ok, true);
  assert.deepEqual(calls, []);
});

test('restore tolerates empty or invalid arguments', async () => {
  calls.length = 0;
  const restored = await restore({});
  assert.equal(restored.ok, true);
  assert.deepEqual(calls, []);
});

