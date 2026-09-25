import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOT, safeLink, findLinks, hostLabel, shotName, planSteps, dataUrlToBlob, captureSlice, CAPTURE_RETRY_LIMIT } from '../screenshot.js';

test('safeLink refuses anything that is not a plain web link', () => {
  assert.equal(safeLink('https://example.com/a?b=1#frag'), 'https://example.com/a?b=1');
  assert.equal(safeLink('http://example.com/'), 'http://example.com/');
  assert.equal(safeLink('https://user:pw@example.com/'), null); // never carry credentials into a capture
  assert.equal(safeLink('file:///etc/passwd'), null);
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink(''), null);
});

test('findLinks trims sentence punctuation but keeps balanced parentheses', () => {
  assert.deepEqual(findLinks('See https://en.wikipedia.org/wiki/Foo_(bar).'), ['https://en.wikipedia.org/wiki/Foo_(bar)']);
  assert.deepEqual(findLinks('Two: https://a.test/1, https://b.test/2. And https://c.test/3'), ['https://a.test/1', 'https://b.test/2', 'https://c.test/3']);
  assert.deepEqual(findLinks('https://a.test/1 https://a.test/1'), ['https://a.test/1']);
  assert.equal(findLinks('https://a.test/1 https://b.test/2 https://c.test/3 https://d.test/4').length, 3); // capped
  assert.deepEqual(findLinks('no links here'), []);
});

test('planSteps covers the page exactly once, top to bottom', () => {
  assert.deepEqual(planSteps(1000, 500), [0, 500]);
  assert.deepEqual(planSteps(300, 500), [0]); // shorter than the window: one slice
  assert.deepEqual(planSteps(1000, 400), [0, 400, 600]); // last slice clamped to the bottom edge
  assert.deepEqual(planSteps(20000, 500, 1000), [0, 500]); // the CSS height cap applies
  assert.equal(planSteps(15000, 400, 15000, 3).length, 3); // hard part cap
  assert.deepEqual(planSteps(0, 0), [0]);
});

test('a data URL becomes a blob and junk is refused with a coded error', async () => {
  const blob = dataUrlToBlob('data:image/png;base64,AAAA');
  assert.equal(blob.type, 'image/png');
  assert.equal(blob.size, 3);
  assert.throws(() => dataUrlToBlob('not a data url'), error => error.code === 'CAPTURE_FAILED');
});

test('hostLabel and shotName stay filesystem-friendly', () => {
  assert.equal(hostLabel('https://www.example.com/x'), 'example.com');
  assert.equal(hostLabel('nonsense'), 'page');
  assert.equal(shotName('https://www.example.com/deep/path', new Date(2026, 0, 2, 3, 4)), 'screenshot-example.com-20260102-0304.png');
});

test('a rate-limited capture is retried instead of throwing the whole run away', async () => {
  const quota = () => { throw new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota exceeded'); };
  let calls = 0;
  const api = { tabs: { captureVisibleTab: async () => { calls++; if (calls < 3) quota(); return 'data:image/png;base64,AAAA'; } } };
  const waits = [];
  assert.equal(await captureSlice(api, 1, { wait: async ms => waits.push(ms) }), 'data:image/png;base64,AAAA');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [350, 700]); // growing pause between attempts
});

test('a real capture failure is reported at once, and a stuck quota is not retried forever', async () => {
  let calls = 0;
  const failing = { tabs: { captureVisibleTab: async () => { calls++; throw new Error('The tab was closed.'); } } };
  await assert.rejects(captureSlice(failing, 1), /The tab was closed/);
  assert.equal(calls, 1);

  let quotaCalls = 0;
  const alwaysQuota = { tabs: { captureVisibleTab: async () => { quotaCalls++; throw new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND'); } } };
  await assert.rejects(captureSlice(alwaysQuota, 1, { wait: async () => {} }), /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/);
  assert.equal(quotaCalls, CAPTURE_RETRY_LIMIT);
});

test('the screenshot budget stays inside what Arena accepts as one attachment', () => {
  assert.equal(SHOT.maxBytes, 8 * 1024 * 1024);
  assert.ok(SHOT.maxParts <= 30);
  assert.ok(SHOT.maxCssHeight / SHOT.height <= SHOT.maxParts);
});
