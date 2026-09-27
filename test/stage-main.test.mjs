import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { arenaAgentStageFiles } from '../stage-main.js';

// The helper is deliberately serialized with no closure. Test that boundary, not a copied validator.
function harness(accept = '', { multiple = true, tokenPresent = true } = {}) {
  const token = crypto.randomUUID();
  let events = 0, assignments = 0;
  class Input {
    constructor() { this.accept = accept; this.multiple = multiple; this.isConnected = true; this.valueFiles = []; this.token = tokenPresent ? token : null; }
    get files() { return this.valueFiles; }
    set files(value) { assignments++; this.valueFiles = value; }
    closest() { return null; }
    getAttribute() { return this.token; }
    removeAttribute() { this.token = null; }
    dispatchEvent() { events++; }
  }
  class Transfer {
    constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
  }
  const input = new Input();
  const context = vm.createContext({ Date, File, Event, atob, Uint8Array, HTMLInputElement: Input, DataTransfer: Transfer,
    document: { querySelectorAll: () => input.token ? [input] : [] } });
  const run = vm.runInContext(`(${arenaAgentStageFiles.toString()})`, context);
  return { input, run: (files, expiresAt = Date.now() + 9000) => run({ token, expiresAt, files }), counts: () => ({ events, assignments }) };
}
const txt = { name: 'same.txt', type: 'text/plain', data: 'YWxwaGE=' };

test('main-world native insertion preserves order and consumes the marker once', async () => {
  const h = harness('text/plain');
  const result = await h.run([txt, { ...txt, data: 'YnJhdm8=' }]);
  assert.equal(result.ok, true);
  assert.deepEqual(await Promise.all(h.input.files.map(file => file.text())), ['alpha', 'bravo']);
  assert.equal(Object.hasOwn(h.input, 'files'), false);
  assert.equal(h.input.token, null);
  assert.equal((await h.run([txt])).ok, false);
  assert.deepEqual(h.counts(), { events: 2, assignments: 1 });
});

test('main-world insertion independently enforces file accept, expiry and cancellation', async () => {
  for (const [h, expiry] of [[harness('.png'), undefined], [harness(), Date.now() - 1], [harness('', { tokenPresent: false }), undefined]]) {
    assert.equal((await h.run([txt], expiry)).ok, false);
    assert.deepEqual(h.counts(), { events: 0, assignments: 0 });
  }
});

test('main-world accept handles wildcard and MIME alias consistently', async () => {
  assert.equal((await harness('image/*').run([{ name: 'a.png', type: 'image/png', data: 'eA==' }])).ok, true);
  assert.equal((await harness('APPLICATION/JAVASCRIPT').run([{ name: 'a.js', type: 'text/javascript', data: 'eA==' }])).ok, true);
  assert.equal((await harness('image/*').run([txt])).ok, false);
});

test('main-world rejection of any file is atomic (no partial assignment)', async () => {
  const h = harness('text/plain');
  assert.equal((await h.run([txt, { ...txt, data: '!' }])).ok, false);
  assert.deepEqual(h.counts(), { events: 0, assignments: 0 });
});
