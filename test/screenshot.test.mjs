import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOT, safeLink, findLinks, hostLabel, shotName, planSteps, dataUrlToBlob, captureSlice, CAPTURE_RETRY_LIMIT, stitchCaptures, captureLink } from '../screenshot.js';

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

const slices = [{ y: 0, dataUrl: 'data:image/png;base64,AAAA' }, { y: 500, dataUrl: 'data:image/png;base64,AAAA' }];
const metrics = { width: 1280, view: 500, height: 1000, title: 'Fixture' };
function bitmapHarness({ failAt = 0, abortAt = 0, controller } = {}) {
  let decoded = 0, open = 0, maxOpen = 0, closed = 0;
  const dimensions = [];
  return {
    dimensions,
    counts: () => ({ decoded, open, maxOpen, closed }),
    decode: async () => {
      decoded++;
      if (decoded === failAt) throw new Error('decode failed');
      open++; maxOpen = Math.max(maxOpen, open);
      if (decoded === abortAt) controller.abort();
      return { width: 2560, height: 1000, close() { open--; closed++; } };
    },
    makeCanvas: (width, height) => {
      dimensions.push([width, height]);
      return { width, height, getContext: () => ({ fillRect() {}, drawImage() {} }), convertToBlob: async () => new Blob(['pixels'], { type: 'image/png' }) };
    }
  };
}

test('stitching decodes one slice at a time and releases every bitmap', async () => {
  const h = bitmapHarness();
  const result = await stitchCaptures(slices, metrics, 'https://final.test/', h);
  assert.equal(result.url, 'https://final.test/');
  assert.deepEqual(h.counts(), { decoded: 2, open: 0, maxOpen: 1, closed: 2 });
});

test('stitching closes existing bitmaps on partial decode failure', async () => {
  const h = bitmapHarness({ failAt: 2 });
  await assert.rejects(stitchCaptures(slices, metrics, 'https://final.test/', h), /decode failed/);
  assert.equal(h.counts().open, 0);
  assert.equal(h.counts().closed, 1);
});

test('cancelling during decode closes the decoded bitmap and produces no file', async () => {
  const controller = new AbortController(), h = bitmapHarness({ abortAt: 2, controller });
  await assert.rejects(stitchCaptures(slices, metrics, 'https://final.test/', { ...h, signal: controller.signal }), error => error.code === 'CANCELLED');
  assert.equal(h.counts().open, 0);
});

test('stitched canvas area is capped, not just individual dimensions', async () => {
  const h = bitmapHarness();
  await stitchCaptures([{ ...slices[0], y: 14000 }], { ...metrics, height: 15000 }, 'https://final.test/', h);
  const [w, height] = h.dimensions[0];
  assert.ok(w * height <= SHOT.maxPixels);
  assert.ok(height <= SHOT.maxCanvas);
});

test('already-cancelled capture never requests permission or opens a popup', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(captureLink('https://example.test/', { api: {}, signal: controller.signal }), error => error.code === 'CANCELLED');
});

test('a popup created after cancellation is still closed and never captured', async () => {
  const controller = new AbortController(); let finish;
  const removed = [];
  const api = {
    permissions: { contains: async () => true },
    windows: { getLastFocused: async () => ({ id: 99 }), create: () => new Promise(resolve => { finish = resolve; }), remove: async id => removed.push(id) }
  };
  const task = captureLink('https://example.test/', { api, signal: controller.signal });
  // Attach the rejection handler before cancelling.
  const rejection = assert.rejects(task, error => error.code === 'CANCELLED');
  while (!finish) await new Promise(resolve => { setImmediate(resolve); });
  controller.abort(); finish({ id: 7, tabs: [{ id: 8 }] });
  await rejection;
  assert.deepEqual(removed, [7]);
});

test('navigation across a capture slice is refused and the user’s new focus is preserved', async () => {
  let url = 'https://example.test/', captureCount = 0;
  const removed = [], focus = [];
  const api = {
    permissions: { contains: async () => true },
    windows: { getLastFocused: async () => ({ id: 99 }), create: async () => ({ id: 7, tabs: [{ id: 8 }] }), remove: async id => removed.push(id), update: async id => focus.push(id) },
    tabs: { get: async () => ({ id: 8, windowId: 7, active: true, status: 'complete', url }), captureVisibleTab: async () => { captureCount++; url = 'https://other.test/'; return slices[0].dataUrl; } },
    scripting: { executeScript: async ({ func }) => [{ frameId: 0, documentId: 'doc-1', result: func.name === 'pageScroll' ? { y: 0, view: 500, width: 1280, href: url } : { ...metrics, href: url } }] }
  };
  await assert.rejects(captureLink('https://example.test/', { api }), error => error.code === 'PAGE_CHANGED');
  assert.equal(captureCount, 1);
  assert.deepEqual(removed, [7]);
  assert.deepEqual(focus, [], 'must not refocus an earlier window after a deliberate focus change');
});
