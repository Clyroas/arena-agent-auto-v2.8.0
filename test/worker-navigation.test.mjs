import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_URL, directModelUrl } from '../core.js';

const listeners = [], calls = [];
let windowState = 'normal', tabUrl = AGENT_URL;
globalThis.chrome = {
  runtime: {
    id: 'extension', getURL: name => `chrome-extension://extension/${name}`,
    onMessage: { addListener: fn => listeners.push(fn) },
    onInstalled: { addListener() {} }, onStartup: { addListener() {} }
  },
  action: { onClicked: { addListener() {} } },
  tabs: {
    get: async id => ({ id, windowId: 7, url: tabUrl }),
    update: async (id, options) => { calls.push(['tab', id, options]); }
  },
  windows: {
    get: async () => ({ state: windowState }),
    update: async (id, options) => { calls.push(['window', id, options]); }
  }
};
await import('../worker.js');
const navigate = url => new Promise(resolve => {
  listeners.at(-1)({ type: 'NAVIGATE_TAB', tabId: 42, url },
    { id: 'extension', url: chrome.runtime.getURL('floating.html') }, resolve);
});

for (const target of [AGENT_URL, directModelUrl('test-model')]) {
  test(`explicit switch foregrounds and wakes the selected tab: ${target}`, async () => {
    calls.length = 0; windowState = 'normal'; tabUrl = AGENT_URL;
    assert.equal((await navigate(target)).ok, true);
    assert.deepEqual(calls, [
      ['window', 7, { focused: true }],
      ['tab', 42, { url: target, active: true, autoDiscardable: false }]
    ]);
  });
}
test('switch restores a minimized browser window', async () => {
  calls.length = 0; windowState = 'minimized';
  assert.equal((await navigate(AGENT_URL)).ok, true);
  assert.deepEqual(calls[0], ['window', 7, { focused: true, state: 'normal' }]);
});
test('invalid targets and non-Arena tabs cannot trigger navigation or focus', async () => {
  calls.length = 0;
  assert.equal((await navigate('https://example.com')).ok, false);
  tabUrl = 'https://example.com';
  assert.equal((await navigate(AGENT_URL)).ok, false);
  assert.deepEqual(calls, []);
});
