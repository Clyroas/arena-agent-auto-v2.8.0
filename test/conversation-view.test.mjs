import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import '../attachment-policy.js';
import { ConversationView } from '../conversation-view.js';
import { renderRich } from '../rich-view.js';

// ConversationView is the one part of the panel that builds the transcript. It is tested against the real
// panel.html markup (not a hand-made fixture), so a renamed or removed element is caught here, and the
// state toggles the motion layer hangs off - hidden on the reply block, on the outcome note, on the jump
// button - are asserted directly instead of being taken on trust.
const panelHtml = readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
// The body tag carries attributes (<body data-sheet="open">), so match the tag rather than a literal
// string; a silent miss here would make this whole file test a copy of the head instead of the panel.
const body = panelHtml.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').replace(/<script[\s\S]*?<\/script>/g, '');
assert.ok(body.includes('id="prepare"') && !/<(?:html|head|body)\b/i.test(body), 'panel.html could not be split into head and body');

// The panel measures the scroller and the composer to keep the newest reply in view; jsdom has no
// ResizeObserver, so the observers are simply inert here. The module runs in this process (not inside the
// jsdom window), so both live on the Node global.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = handle => clearTimeout(handle);

const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { pretendToBeVisual: true, url: 'https://example.test/panel.html' });
const doc = dom.window.document;
const turn = (extra = {}) => ({ id: extra.id || 't1', prompt: 'A question', reply: '', status: 'sending', mode: 'agent', live: null, ...extra });
const make = () => {
  // Only the transcript list is emptied: re-parenting it would detach the elements around it
  // (#history-section, #chat-empty, …) that render() reaches for by id.
  const container = doc.getElementById('history');
  container.replaceChildren();
  const answers = [];
  const view = new ConversationView(doc, (id, answer) => answers.push([id, answer]), () => {});
  return { view, container, answers };
};

test('the empty state is what the panel shows before the first turn', () => {
  const { view } = make();
  view.render([], null, 'ready');
  assert.equal(doc.getElementById('history-section').hidden, true);
  assert.equal(doc.getElementById('chat-empty').hidden, false);
  assert.equal(doc.getElementById('turn-count').textContent, '0 turns');
  assert.match(doc.getElementById('empty-help').textContent, /Ask anything below/);
});

test('a reply arriving flips exactly the state the arrival animations key off', () => {
  const { view, container } = make();
  const live = { text: 'Streaming the answer', rich: null, tools: [], questions: [], generating: true, interactionNotice: '' };
  view.render([turn({ live })], { id: 't1', status: 'waiting' }, 'waiting');
  const article = container.querySelector('.turn');
  // No reply yet: the reply block is not in the transcript at all, so its entrance runs the moment the
  // panel inserts it (a brand-new element, not a display toggle).
  assert.equal(article.querySelector('.assistant-message'), null);
  assert.equal(article.querySelector('.bubble.user').textContent, 'A question');
  assert.equal(article.querySelector('.live-text').classList.contains('streaming'), true);

  // The reply lands: the block becomes visible (the animation plays on that display change) and carries
  // the formatted tree with a copy button.
  const rich = [['h3', {}, 'Answer'], ['pre', { lang: 'js' }, 'const a = 1;']];
  view.render([turn({ status: 'complete', reply: 'Answer', rich, live })], null, 'ready');
  const done = container.querySelector('.turn');
  assert.equal(done.querySelector('.assistant-message').hidden, false);
  assert.equal(done.querySelector('.bubble.assistant').classList.contains('rich'), true);
  assert.equal(done.querySelector('.rich-code code').textContent, 'const a = 1;');
  assert.equal(done.querySelector('.reply-copy').hidden, false);
  assert.equal(done.querySelector('.live-text').classList.contains('streaming'), false);
  assert.equal(doc.getElementById('turn-count').textContent, '1 turn');
  assert.match(doc.getElementById('chat-announcement').textContent, /Reply received for turn 1/);
});

test('an outcome note stays hidden until there is something to say', () => {
  const { view, container } = make();
  view.render([turn({ status: 'complete', reply: 'Fine.' })], null, 'ready');
  assert.equal(container.querySelector('.turn-outcome').hidden, true);

  view.render([turn({ status: 'error', code: 'RATE_LIMIT', reply: '' , outcomeText: 'Arena is limiting requests.' })], null, 'error');
  const outcome = container.querySelector('.turn-outcome');
  assert.equal(outcome.hidden, false);
  assert.match(outcome.textContent, /Arena is limiting requests/);
  assert.equal(container.querySelector('.turn').dataset.state, 'error');
});

test('cancelled and imported turns explain themselves', () => {
  const { view, container } = make();
  view.render([turn({ id: 'a', status: 'cancelled', reply: '' }), turn({ id: 'b', imported: true, status: 'imported-ambiguous', prompt: 'Older question' })], null, 'ready');
  const [cancelled, imported] = container.querySelectorAll('.turn');
  assert.match(cancelled.querySelector('.turn-outcome').textContent, /Tracking stopped in this panel/);
  assert.equal(imported.classList.contains('imported'), true);
  assert.equal(imported.querySelector('.imported-badge').textContent, 'From Arena page');
  assert.match(imported.querySelector('.turn-outcome').textContent, /Several separate replies/);
});

test('a reply that arrives while the user has scrolled away is announced, not forced', async () => {
  const { view } = make();
  const settle = () => new Promise(resolve => { setTimeout(resolve, 5); }); // let the deferred scroll settle
  const scroll = doc.getElementById('chat-scroll');
  Object.defineProperty(scroll, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(scroll, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(scroll, 'scrollTop', { value: 0, configurable: true, writable: true });
  view.render([turn({ live: { text: 'streaming', generating: true } })], { id: 't1', status: 'waiting' }, 'waiting');
  await settle(); // the new turn scrolls itself into view first, like a real send
  scroll.scrollTop = 300; // …then the user scrolls back up to read something
  scroll.dispatchEvent(new dom.window.Event('scroll'));
  assert.equal(view.following, false);
  assert.equal(doc.getElementById('latest-reply').hidden, false);

  view.render([turn({ status: 'complete', reply: 'Arrived.' })], null, 'ready');
  await settle();
  assert.equal(view.unseen, true);
  assert.equal(doc.getElementById('latest-reply').textContent, 'New reply ↓');
  assert.match(doc.getElementById('chat-announcement').textContent, /Reply received for turn 1/);

  doc.getElementById('latest-reply').click();
  assert.equal(view.following, true);
  assert.equal(view.unseen, false);
  assert.equal(doc.getElementById('latest-reply').hidden, true);
});

test('a removed turn takes its nodes with it', () => {
  const { view, container } = make();
  view.render([turn({ id: 'a', reply: 'One' }), turn({ id: 'b', prompt: 'Second', reply: 'Two' })], null, 'ready');
  assert.equal(container.querySelectorAll('.turn').length, 2);
  view.render([turn({ id: 'b', prompt: 'Second', reply: 'Two' })], null, 'ready');
  assert.equal(container.querySelectorAll('.turn').length, 1);
  assert.equal(container.querySelector('.turn').dataset.turnId, 'b');
  assert.match(container.querySelector('.message-index').textContent, /Turn 1/);
});

test('rich replies are rebuilt by the same renderer the panel uses for finished answers', () => {
  // The live preview uses the identical tree, so a malformed tree must degrade to plain text rather than
  // leaving an empty bubble (which would make the arrival animation look like nothing happened).
  assert.equal(renderRich(doc, [['p', {}, 'plain']]).textContent, 'plain');
  const host = doc.createElement('div');
  host.append(renderRich(doc, [['script', {}, 'alert(1)']])); // an unknown tag keeps its text, never the tag
  assert.equal(host.querySelector('script'), null);
  assert.equal(host.textContent, 'alert(1)');
});
