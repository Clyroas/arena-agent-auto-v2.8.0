import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderRich, richToMarkdown, safeHref } from '../rich-view.js';

const doc = new JSDOM('<!doctype html><html><body></body></html>').window.document;
const html = tree => {
  const fragment = renderRich(doc, tree);
  if (!fragment) return null;
  const host = doc.createElement('div');
  host.append(fragment);
  return host;
};

test('safeHref allows only ordinary web links', () => {
  assert.equal(safeHref('https://arena.ai/agent'), 'https://arena.ai/agent');
  assert.equal(safeHref('mailto:someone@example.com'), 'mailto:someone@example.com');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,<script>'), '');
  assert.equal(safeHref('https://user:pass@arena.ai/'), '');
  assert.equal(safeHref(''), '');
});

test('an empty or malformed tree falls back to plain text instead of rendering', () => {
  assert.equal(renderRich(doc, null), null);
  assert.equal(renderRich(doc, []), null);
  // A bare string is a text node in the captured format and is shown as-is.
  assert.equal(html(['plain text']).textContent, 'plain text');
  assert.equal(renderRich(doc, [['div', {}]]), null); // no text at all
  assert.equal(renderRich(doc, [['div', {}, 42], ['div', {}, null]]), null); // not strings, not nodes
});

test('unknown tags keep their text but lose the tag', () => {
  const host = html([['div', {}, 'before ', ['marquee', {}, 'kept'], ' after']]);
  assert.equal(host.innerHTML, '<div>before kept after</div>');
});

test('links are rebuilt with safe attributes only', () => {
  const host = html([['p', {}, ['a', { href: 'https://arena.ai/x' }, 'Arena']]]);
  const anchor = host.querySelector('a');
  assert.equal(anchor.getAttribute('href'), 'https://arena.ai/x');
  assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(anchor.getAttribute('target'), '_blank');
  const unsafe = html([['p', {}, ['a', { href: 'javascript:alert(1)' }, 'click']]]);
  assert.equal(unsafe.querySelector('a'), null);
  assert.equal(unsafe.textContent, 'click');
});

test('code blocks carry their language and offer a copy button', () => {
  const copied = [];
  const fragment = renderRich(doc, [['pre', { lang: 'js' }, 'const a = 1;']], { onCopy: (text, button) => copied.push([text, button]) });
  const host = doc.createElement('div'); host.append(fragment);
  assert.equal(host.querySelector('.rich-code-lang').textContent, 'js');
  assert.equal(host.querySelector('code').textContent, 'const a = 1;');
  host.querySelector('.rich-copy').click();
  assert.deepEqual(copied.map(entry => entry[0]), ['const a = 1;']);
});

test('math keeps its TeX source and ordered lists keep their start', () => {
  const host = html([['div', {}, ['code', { math: 'block' }, 'x^2'], ['ol', { start: 3 }, ['li', {}, 'third']]]]);
  assert.equal(host.querySelector('.rich-math.block').textContent, 'x^2');
  assert.equal(host.querySelector('ol').getAttribute('start'), '3');
});

test('the table wrapper is added so wide replies stay readable', () => {
  const host = html([['table', {}, ['tbody', {}, ['tr', {}, ['th', {}, 'a'], ['td', {}, 'b']]]]]);
  assert.equal(host.querySelector('.rich-table > table tbody tr td').textContent, 'b');
});

test('a reply tree that is too deep is refused rather than rendered partially', () => {
  let node = ['div', {}, 'text'];
  for (let i = 0; i < 60; i++) node = ['div', {}, node];
  assert.equal(renderRich(doc, [node]), null);
});

test('markdown export mirrors the structure Arena showed', () => {
  const markdown = richToMarkdown([
    ['h2', {}, 'Title'],
    ['p', {}, 'Some ', ['strong', {}, 'bold'], ' text'],
    ['ul', {}, ['li', {}, 'first'], ['li', {}, 'second']],
    ['pre', { lang: 'py' }, 'print(1)'],
    ['blockquote', {}, 'quoted']
  ]);
  assert.match(markdown, /## Title/);
  assert.match(markdown, /\*\*bold\*\*/);
  assert.match(markdown, /- first\n- second/);
  assert.match(markdown, /```py\nprint\(1\)\n```/);
  assert.match(markdown, /> quoted/);
});

test('markdown export escapes pipes in tables and extends code fences', () => {
  const table = richToMarkdown([['table', {}, ['tbody', {}, ['tr', {}, ['th', {}, 'a|b']], ['tr', {}, ['td', {}, '1']]]]]);
  assert.match(table, /\| a\\\|b \|/);
  const fenced = richToMarkdown([['pre', {}, '```\ninner\n```']]);
  assert.match(fenced, /^~~~\n/);
});
