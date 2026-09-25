import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { LiveView } from '../live-view.js';

// LiveView owns the moving parts of a turn: the preview text, the tool rows, the question cards and the
// response pair. The panel re-renders it on every live update, so the two animation hooks added to it
// (the writing caret and the entrance of a new tool row) have to be driven by state that flips once.
const dom = new JSDOM('<!doctype html><html><body><article id="turn"></article></body></html>');
const doc = dom.window.document;
const live = (turn, active = true) => {
  const container = doc.getElementById('turn');
  container.replaceChildren();
  const view = new LiveView(container, () => {}, () => {});
  view.render(turn, active);
  return { view, container };
};
const base = (liveData = {}, extra = {}) => ({ id: 'turn-1', status: 'waiting', live: { text: '', tools: [], questions: [], rich: null, ...liveData }, reply: '', ...extra });

test('the caret only appears while Arena is actually writing', () => {
  const streaming = live(base({ text: 'Writing the answer', generating: true }));
  assert.equal(streaming.view.text.classList.contains('streaming'), true);
  assert.equal(streaming.view.text.hidden, false);

  // Finished streaming: the text stays, the caret goes.
  const done = live(base({ text: 'Writing the answer', generating: false }));
  assert.equal(done.view.text.classList.contains('streaming'), false);

  // A finished turn shows no preview at all, so no caret either.
  const replied = live(base({ text: 'Writing the answer', generating: true }, { reply: 'Done', status: 'complete' }));
  assert.equal(replied.view.text.classList.contains('streaming'), false);

  // Tracking stopped (the panel is in an error state): nothing should look like it is still writing.
  const stopped = live(base({ text: 'Writing the answer', generating: true }), false);
  assert.equal(stopped.view.text.classList.contains('streaming'), false);

  // Thinking with no text yet: no caret in an empty element.
  const thinking = live(base({ thinking: { state: 'active', label: 'Thinking…' }, generating: true }));
  assert.equal(thinking.view.text.classList.contains('streaming'), false);
});

test('the caret does not flicker when the same state is rendered again', () => {
  const { view } = live(base({ text: 'Streaming along', generating: true }));
  const before = view.text.className;
  view.render(base({ text: 'Streaming along', generating: true }), true);
  view.render(base({ text: 'Streaming along and more', generating: true }), true);
  assert.equal(view.text.classList.contains('streaming'), true);
  assert.equal(before, view.text.className);
});

test('only a genuinely new tool step animates in', () => {
  const first = live(base({ tools: [{ tool: 'Bash', duration: '3s', status: 'activity' }], generating: true }));
  assert.deepEqual([...first.view.tools.children].map(row => row.classList.contains('tool-new')), [true]);

  // Same row, new status: it must not animate a second time.
  first.view.render(base({ tools: [{ tool: 'Bash', duration: '3s', status: 'done' }], generating: true }), true);
  assert.deepEqual([...first.view.tools.children].map(row => row.classList.contains('tool-new')), [false]);
  assert.equal(first.view.tools.firstElementChild.className.includes('tool-done'), true);

  // A second step arrives: only that one is marked new.
  first.view.render(base({ tools: [{ tool: 'Bash', duration: '3s', status: 'done' }, { tool: 'Bash', duration: '5s', status: 'activity' }], generating: true }), true);
  assert.deepEqual([...first.view.tools.children].map(row => row.classList.contains('tool-new')), [false, true]);
});

test('a fresh turn starts its tool rows over', () => {
  const { view, container } = live(base({ tools: [{ tool: 'Bash', duration: '3s', status: 'done' }], generating: true }));
  assert.deepEqual([...view.tools.children].map(row => row.classList.contains('tool-new')), [true]); // the view is new
  const next = new LiveView(container, () => {}, () => {});
  next.render(base({ tools: [{ tool: 'Bash', duration: '9s', status: 'activity' }], generating: true }), true);
  assert.equal(next.tools.firstElementChild.classList.contains('tool-new'), true);
});

test('question cards and the response pair still behave as before', () => {
  const question = { token: 'q1', question: 'Which database?', custom: true, readOnly: false, busy: false, answerState: '',
    options: [{ label: 'Postgres', description: 'Managed', disabled: false, checked: false }, { label: 'SQLite', description: 'Local', disabled: false, checked: false }] };
  const { view } = live(base({ questions: [question], generating: true }));
  const card = view.questions.querySelector('.question-card');
  assert.equal(card.querySelector('.question-title').textContent, 'Which database?');
  assert.equal(card.querySelectorAll('.question-option').length, 2);
  assert.equal(card.querySelector('.question-submit').disabled, true); // nothing chosen yet

  // Choosing an option enables submit and marks the row, which is what the tick animation hangs off.
  card.querySelectorAll('.question-option')[1].click();
  const chosen = view.questions.querySelectorAll('.question-option')[1];
  assert.equal(chosen.getAttribute('aria-checked'), 'true');
  assert.equal(view.questions.querySelector('.question-submit').disabled, false);

  // The card is removed when Arena moves on, so a later question gets a fresh card and a fresh tick.
  view.render(base({ questions: [], generating: true }), true);
  assert.equal(view.questions.querySelector('.question-card'), null);
  view.render(base({ questions: [{ ...question, token: 'q2' }], generating: true }), true);
  assert.equal(view.questions.querySelectorAll('.question-card').length, 1);
});

test('the pair card only offers what Arena offers', () => {
  const pair = { prompt: 'Which response do you prefer?', ready: true, offered: true, choice: '', unknownChoice: false, enabled: { a: true, b: false },
    skip: { offered: true, enabled: true }, sides: [{ side: 'a', label: 'Response A', text: 'Short', done: true, failed: false },
      { side: 'b', label: 'Response B', text: 'Long', done: true, failed: false }] };
  const { view } = live(base({ pair, generating: false }));
  assert.equal(view.pair.card.hidden, false);
  assert.equal(view.pair.sides[0].button.disabled, false);
  assert.equal(view.pair.sides[1].button.disabled, true); // Arena has not unlocked B
  assert.equal(view.pair.skip.hidden, false);
  assert.equal(view.pair.title.textContent, 'Which response do you prefer?');
});

test('live output hides itself when there is nothing to show', () => {
  const { view } = live(base());
  assert.equal(view.root.hidden, true);
  view.render(base({ interactionNotice: 'Arena shows a control this panel does not operate.' }), true);
  assert.equal(view.root.hidden, false);
  assert.match(view.notice.textContent, /does not operate/);
});
