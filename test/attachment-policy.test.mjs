import test from 'node:test';
import assert from 'node:assert/strict';
import '../attachment-policy.js';

const A = globalThis.ArenaAgentAttachments;
const file = (name, type, size) => ({ name, type, size });

test('exposes one frozen policy shared by the panel and the page adapter', () => {
  assert.equal(A.ATTACHMENT_POLICY.maxFiles, 4);
  assert.equal(A.ATTACHMENT_POLICY.maxBytes, 8 * 1024 * 1024);
  assert.ok(Object.isFrozen(A.ATTACHMENT_POLICY));
});

test('validateAttachments accepts the supported list and reports why others are refused', () => {
  const { accepted, rejected } = A.validateAttachments([
    file('photo.png', 'image/png', 1200),
    file('notes.txt', 'text/plain', 10),
    file('archive.zip', 'application/zip', 10),
    file('empty.pdf', 'application/pdf', 0),
    file('huge.pdf', 'application/pdf', A.ATTACHMENT_POLICY.maxBytes + 1),
    file('', 'text/plain', 5)
  ]);
  assert.deepEqual(accepted.map(item => item.name), ['photo.png', 'notes.txt']);
  assert.equal(rejected.length, 4);
  assert.match(rejected[0].reason, /not in the supported list/);
  assert.match(rejected[1].reason, /empty/);
  assert.match(rejected[2].reason, /8 MB/);
  assert.match(rejected[3].reason, /filename/);
});

test('the file extension decides the type when the browser reports none', () => {
  assert.equal(A.attachmentKind('report.md', ''), 'text/markdown');
  assert.equal(A.attachmentKind('data.JSON', ''), 'application/json');
  assert.equal(A.attachmentKind('no-extension', ''), '');
  assert.equal(A.attachmentKind('scan.jpg', 'text/plain'), 'image/jpeg');
});

test('a batch longer than the policy allows is trimmed, never silently merged', () => {
  const five = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'].map(name => file(name, 'text/plain', 1));
  const { accepted, rejected } = A.validateAttachments(five);
  assert.equal(accepted.length, 4);
  assert.deepEqual(rejected.map(item => item.name), ['e.txt']);
});

test('accept attribute tokens are checked against the same list', () => {
  assert.equal(A.acceptAllows('.png,image/jpeg'), true);
  assert.equal(A.acceptAllows('file'), true);
  assert.equal(A.acceptAllows('*/*'), true);
  assert.equal(A.acceptAllows('.png,application/zip'), false);
  assert.equal(A.acceptAllows('image/*'), true);
  assert.equal(A.isAcceptedToken(''), true);
});

test('base64 helpers round-trip bytes without loss', () => {
  const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
  assert.deepEqual(Array.from(A.base64ToBytes(A.bytesToBase64(bytes))), [0, 1, 250, 255, 128, 64]);
  const big = new Uint8Array(200000).map((_, index) => index % 251); // spans several 0x8000 chunks
  assert.deepEqual(A.base64ToBytes(A.bytesToBase64(big)), big);
});

test('formatBytes never prints a wrong size', () => {
  assert.equal(A.formatBytes(0), '0 B');
  assert.equal(A.formatBytes(1023), '1023 B');
  assert.equal(A.formatBytes(2048), '2.0 KB');
  assert.equal(A.formatBytes(50000), '49 KB');
  assert.equal(A.formatBytes(3 * 1048576), '3.0 MB');
  assert.equal(A.formatBytes(NaN), 'unknown size');
  assert.equal(A.formatBytes(-4), 'unknown size');
});

test('file accept restrictions apply to each file, including MIME aliases and wildcards', () => {
  assert.equal(A.acceptsFile('.png', file('report.pdf', 'application/pdf', 1)), false);
  assert.equal(A.acceptsFile('IMAGE/*', file('PHOTO.PNG', 'image/png', 1)), true);
  assert.equal(A.acceptsFile('.PNG', file('PHOTO.PNG', 'image/png', 1)), true);
  assert.equal(A.acceptsFile('application/javascript', file('code.js', 'text/javascript', 1)), true);
  assert.equal(A.acceptsFile('image/*', file('code.js', 'text/javascript', 1)), false);
  assert.equal(A.acceptsFile('application/zip', file('a.zip', 'application/zip', 1)), false);
});

test('encoded attachments use exact decoded size at the 8 MiB boundary', () => {
  for (const size of [A.ATTACHMENT_POLICY.maxBytes - 1, A.ATTACHMENT_POLICY.maxBytes]) {
    const data = Buffer.alloc(size).toString('base64');
    assert.equal(A.decodeAttachment({ name: 'a.txt', type: 'text/plain', data }).bytes.byteLength, size);
  }
  assert.throws(() => A.decodeAttachment({ name: 'a.txt', type: 'text/plain', data: Buffer.alloc(A.ATTACHMENT_POLICY.maxBytes + 1).toString('base64') }));
  assert.throws(() => A.decodeAttachment({ name: 'a.txt', type: 'text/plain', data: '!' }));
  assert.throws(() => A.decodeAttachment({ name: 'a.txt', type: 'text/plain', data: '' }));
});
