import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_URL, DIRECT_URL, isArena, isDirect, isDirectChat, directModelUrl, samePage, tabLabel, withTimeout, TimeoutError } from '../core.js';

test('isArena accepts only the Arena origin', () => {
  assert.equal(isArena('https://arena.ai/agent'), true);
  assert.equal(isArena('https://arena.ai/agent/c/abc?x=1#y'), true);
  assert.equal(isArena('https://arena.ai.evil.test/agent'), false);
  assert.equal(isArena('http://arena.ai/agent'), false);
  assert.equal(isArena('https://sub.arena.ai/agent'), false);
  assert.equal(isArena(''), false);
  assert.equal(isArena(undefined), false);
  assert.equal(isArena('not a url'), false);
});

test('isDirect separates the unsupported text modes from a Direct chat', () => {
  assert.equal(isDirect('https://arena.ai/text/battle'), true);
  assert.equal(isDirect('https://arena.ai/text/direct'), false);
  assert.equal(isDirect('https://arena.ai/text/direct/'), false);
  assert.equal(isDirect('https://arena.ai/agent'), false);
  assert.equal(isDirectChat('https://arena.ai/text/direct'), true);
  assert.equal(isDirectChat('https://arena.ai/text/direct/'), true);
  assert.equal(isDirectChat('https://arena.ai/text/direct/extra'), false);
});

test('directModelUrl keeps the model name in Arena’s own parameter', () => {
  assert.equal(directModelUrl(''), DIRECT_URL);
  assert.equal(directModelUrl('GPT-5 & friends'), 'https://arena.ai/text/direct?model_a=GPT-5+%26+friends');
});

test('samePage treats Arena’s own model parameters as the same page', () => {
  assert.equal(samePage('https://arena.ai/text/direct?model_a=x', 'https://arena.ai/text/direct?model=x'), true);
  assert.equal(samePage('https://arena.ai/text/direct?a=1', 'https://arena.ai/text/direct?a=2'), false);
  assert.equal(samePage('https://arena.ai/text/direct#one', 'https://arena.ai/text/direct#two'), false);
  // Anything that is not an empty Direct chat must match exactly, so a real conversation switch is never
  // mistaken for a parameter rewrite (the caller stops capture instead of attributing the wrong reply).
  assert.equal(samePage('https://arena.ai/agent/c/1', 'https://arena.ai/agent/c/1'), true);
  assert.equal(samePage('https://arena.ai/agent/c/1?a=1', 'https://arena.ai/agent/c/1'), false);
  assert.equal(samePage(AGENT_URL, 'https://arena.ai/text/direct'), false);
  assert.equal(samePage('nonsense', 'https://arena.ai/agent'), false);
});

test('tabLabel tolerates a tab without a usable URL', () => {
  assert.equal(tabLabel({ id: 7, title: 'Arena', url: 'https://arena.ai/agent/c/1?x=2' }), 'Tab 7 · Arena · arena.ai/agent/c/1');
  assert.equal(tabLabel({ id: 8, title: '', url: '' }), 'Tab 8 · Arena · ');
});

test('withTimeout resolves and rejects with the original outcome', async () => {
  assert.equal(await withTimeout(Promise.resolve('value'), 50, 'late'), 'value');
  assert.equal(await withTimeout('plain value', 50, 'late'), 'plain value');
  await assert.rejects(withTimeout(Promise.reject(new Error('worker failed')), 50, 'late'), { message: 'worker failed' });
});

test('withTimeout gives up on a request that never answers', async () => {
  const never = new Promise(() => {});
  let settled = false;
  const guarded = withTimeout(never, 20, 'RPC did not answer').catch(error => { settled = true; throw error; });
  await assert.rejects(guarded, error => {
    assert.equal(error.name, 'TimeoutError');
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.message, 'RPC did not answer');
    return true;
  });
  assert.equal(settled, true);
  assert.ok(new TimeoutError('x') instanceof Error);
});

test('withTimeout does not cancel the request it is waiting for', async () => {
  let resolveLate;
  const late = new Promise(resolve => { resolveLate = resolve; });
  await assert.rejects(withTimeout(late, 10, 'late'), { code: 'TIMEOUT' });
  resolveLate('still arrives'); // Chrome may still finish the work; only the caller stopped waiting.
  assert.equal(await late, 'still arrives');
});
