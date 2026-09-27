import test from 'node:test';
import assert from 'node:assert/strict';
import { TabAwakeLease } from '../tab-awake.js';

for (const original of [true, false]) test(`awake lease restores the original ${original} value`, async () => {
  const updates = [];
  const lease = new TabAwakeLease({ tabs: { get: async () => ({ autoDiscardable: original }), update: async (id, value) => updates.push([id, value.autoDiscardable]) } });
  await lease.acquire(1);
  await lease.release(1);
  assert.deepEqual(updates, [[1, false], [1, original]]);
  assert.equal(lease.entries.size, 0);
});

test('release and reacquire are serialized while the initial tab read is outstanding', async () => {
  let answer;
  const updates = [];
  const lease = new TabAwakeLease({ tabs: { get: () => new Promise(resolve => { answer = resolve; }), update: async (id, value) => updates.push(value.autoDiscardable) } });
  const first = lease.acquire(1);
  await Promise.resolve();
  const release = lease.release(1), second = lease.acquire(1);
  answer({ autoDiscardable: true });
  await Promise.all([first, release, second]);
  assert.deepEqual(updates, [false, true, false]);
  assert.equal(lease.entries.size, 1);
  await lease.release(1);
  assert.equal(updates.at(-1), true);
});

test('tab removal is safe during release', async () => {
  const lease = new TabAwakeLease({ tabs: { get: async () => { throw new Error('tab gone'); } } });
  await lease.acquire(1);
  await lease.release(1);
  assert.equal(lease.entries.size, 0);
});
