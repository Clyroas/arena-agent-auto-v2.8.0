import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { selectAttachments, releaseTurnAttachments, restoreTurnAttachments } from '../attachment-state.js';

test('the whole classic policy can be injected repeatedly into the same lexical scope', () => {
  const source = readFileSync(new URL('../attachment-policy.js', import.meta.url), 'utf8');
  const context = vm.createContext({ btoa, atob });
  vm.runInContext(source, context);
  const first = context.ArenaAgentAttachments;
  vm.runInContext(source, context);
  assert.equal(context.ArenaAgentAttachments, first);
  context.ArenaAgentAttachments = { version: 'old' };
  vm.runInContext(source, context);
  assert.equal(context.ArenaAgentAttachments.version, first.version);
});

test('equal metadata never substitutes the wrong file bytes', async () => {
  const files = [new File(['alpha'], 'same.txt', { type: 'text/plain' }), new File(['bravo'], 'same.txt', { type: 'text/plain' })];
  const { accepted } = selectAttachments(files);
  assert.equal(accepted[0].file, files[0]);
  assert.equal(accepted[1].file, files[1]);
  assert.deepEqual(await Promise.all(accepted.map(item => item.file.text())), ['alpha', 'bravo']);
});

test('metadata normalization never loses the original File, and all overflow is reported', () => {
  const file = new File(['code'], ' code.js ', { type: 'application/javascript' });
  const { accepted, rejected } = selectAttachments([file]);
  assert.equal(accepted[0].file, file);
  assert.equal(accepted[0].type, 'text/javascript');
  assert.equal(rejected.length, 0);
  const result = selectAttachments([file, file, file], 1);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.equal(selectAttachments([file], 0).rejected.length, 1);
});

test('terminal cleanup drops originals and transport data but preserves historical metadata', () => {
  const metadata = [{ name: 'a.txt', type: 'text/plain', size: 1 }];
  const payload = [{ data: 'eA==' }];
  const turn = { attachments: metadata, payload, files: [new File(['x'], 'a.txt')] };
  releaseTurnAttachments(turn);
  assert.equal(turn.files, null);
  assert.equal(turn.payload, null);
  assert.equal(payload[0].data, '');
  assert.equal(turn.attachments, metadata);
  releaseTurnAttachments(turn);
});

test('pre-click restoration transfers the original File once, then releases the turn', () => {
  const file = new File(['x'], 'a.txt');
  const turn = { attachments: [{ name: 'a.txt', type: 'text/plain', size: 1 }], files: [file] };
  const restored = restoreTurnAttachments(turn);
  assert.equal(restored[0].file, file);
  assert.equal(turn.files, null);
  assert.deepEqual(restoreTurnAttachments(turn), []);
});
