import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBounds } from '../window-geometry.js';
import { recentModels, rememberModel, RECENT_MAX } from '../recent-models.js';

const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
};

test('a floating window is restored inside the current work area', () => {
  const screen = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
  assert.deepEqual(fitBounds({ width: 460, height: 820, left: 100, top: 100 }, screen), { width: 460, height: 820, left: 100, top: 100 });
  // A position saved on a monitor that is no longer there is pulled back into view.
  assert.deepEqual(fitBounds({ width: 460, height: 820, left: 5000, top: 5000 }, screen), { width: 460, height: 820, left: 1460, top: 260 });
  assert.deepEqual(fitBounds(null, screen), { width: 460, height: 820, left: 1436, top: 24 });
});

test('a tiny work area still gets a usable window', () => {
  const small = { availLeft: 0, availTop: 0, availWidth: 400, availHeight: 500 };
  assert.deepEqual(fitBounds({ width: 900, height: 900, left: 10, top: 10 }, small), { width: 400, height: 500, left: 0, top: 0 });
});

test('saved bounds that are not numbers fall back to defaults', () => {
  const screen = { availLeft: 40, availTop: 20, availWidth: 1200, availHeight: 800 };
  const bounds = fitBounds({ width: 'wide', height: null, left: NaN, top: undefined }, screen);
  assert.equal(bounds.width, 460);
  assert.equal(bounds.height, 800);
  assert.ok(bounds.left >= 40 && bounds.left + bounds.width <= 1240);
  assert.ok(bounds.top >= 20 && bounds.top + bounds.height <= 820);
});

test('recent models are names only, deduplicated, and capped', () => {
  const storage = fakeStorage();
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']) rememberModel(name, storage);
  assert.deepEqual(recentModels(storage), ['Zeta', 'Epsilon', 'Delta', 'Gamma', 'Beta']);
  assert.equal(recentModels(storage).length, RECENT_MAX);
  rememberModel('alpha', storage); // re-selecting an older model moves it to the front, in one spelling only
  assert.deepEqual(recentModels(storage), ['alpha', 'Zeta', 'Epsilon', 'Delta', 'Gamma']);
});

test('nothing but a short name can ever reach the preference list', () => {
  const storage = fakeStorage();
  rememberModel('   ', storage);
  rememberModel('x'.repeat(121), storage);
  rememberModel(42, storage);
  rememberModel(null, storage);
  assert.deepEqual(recentModels(storage), []);
});

test('a damaged or hostile preference value cannot break the panel', () => {
  assert.deepEqual(recentModels(fakeStorage({ 'arena-auto-recent-models': 'not json' })), []);
  assert.deepEqual(recentModels(fakeStorage({ 'arena-auto-recent-models': '{"a":1}' })), []);
  assert.deepEqual(recentModels(fakeStorage({ 'arena-auto-recent-models': JSON.stringify(['ok', '', null, 'y'.repeat(200), 7]) })), ['ok']);
  const throwing = { getItem: () => { throw new Error('storage disabled'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(recentModels(throwing), []);
  assert.deepEqual(rememberModel('Alpha', throwing), ['Alpha']);
});
