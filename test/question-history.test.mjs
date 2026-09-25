import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { questionState, liveStatus } from '../live-status.js';

// v2.8.1: after an option card is answered, Arena may hide or remove that card while its preamble
// text stays in the row. The old row must stay history (never a competing reply), an answered card
// must not block completion, and a reconnect after the answer must still know which row was the card.
const agentDomSource = readFileSync(new URL('../agent-dom.js', import.meta.url), 'utf8');

function openDom(html) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://arena.ai/agent/c/1', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  // jsdom has no layout, so visibility is stubbed: everything counts as laid out unless it or an
  // ancestor is display:none/hidden, which is exactly what the hidden-remnant test needs.
  window.HTMLElement.prototype.getClientRects = function () {
    for (let p = this; p; p = p.parentElement) {
      if (p.hasAttribute?.('hidden') || p.style?.display === 'none' || p.getAttribute?.('aria-hidden') === 'true') return [];
    }
    return [{ x: 0, y: 0, width: 10, height: 10 }];
  };
  window.getComputedStyle = function (el) {
    for (let p = el; p && p.style; p = p.parentElement) {
      if (p.style.display === 'none' || p.hasAttribute?.('hidden')) {
        return { display: 'none', visibility: 'visible', opacity: '1', pointerEvents: 'auto', flexDirection: 'row', getPropertyValue: prop => (prop === 'display' ? 'none' : '') };
      }
    }
    return { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto', flexDirection: 'row', getPropertyValue: prop => (prop === 'display' ? 'block' : '') };
  };
  window.eval(agentDomSource);
  window.document.body.innerHTML = html;
  return { window, D: window.ArenaAgentDOM, close: () => window.close() };
}

const userRow = (id, text) => `<div data-agent-transcript-message="true" data-chat-message-id="${id}"><div data-user-message-layout="true"><div class="prose">${text}</div></div></div>`;
const replyRow = (id, text, ended = true) => `<div data-agent-transcript-message="true" data-chat-message-id="${id}"><div class="prose">${text}</div>${ended ? '<div aria-label="Response ended"></div>' : ''}</div>`;
const cardRow = (id, preamble, checked) => `<div data-agent-transcript-message="true" data-chat-message-id="${id}"><div class="prose">${preamble}</div><div><div><span>Which database?</span></div><div role="radiogroup" aria-label="Which database?"><button role="radio" aria-checked="${checked ? 'true' : 'false'}"><span class="body-sm">Postgres</span></button><button role="radio" aria-checked="false"><span class="body-sm">SQLite</span></button></div></div></div>`;

test('an answered row whose card is gone is history, not a second reply', () => {
  const html = userRow('user-1', 'hello world')
    + replyRow('assistant-1', 'I need to clarify something before proceeding.', false)
    + replyRow('assistant-2', 'Here is the final answer after your clarification.');
  const page = openDom(html);
  try {
    // Without any question history the two plain rows are genuinely ambiguous: fail closed as before.
    assert.throws(() => page.D.matchTurn({ baseline: [], prompt: 'hello world' }, page.window.document),
      error => error.code === 'AMBIGUOUS_REPLY');
    // With the answered row remembered (live tracking or WATCH resume), the new reply is captured.
    const result = page.D.matchTurn({ baseline: [], prompt: 'hello world', questionRows: ['assistant-1'] }, page.window.document);
    assert.equal(result.accepted, true);
    assert.equal(result.text, 'Here is the final answer after your clarification.');
    assert.equal(result.complete, true);
    assert.equal(result.assistantId, 'assistant-2');
  } finally { page.close(); }
});

test('a hidden card remnant still marks the row as history without resume state', () => {
  const html = userRow('user-1', 'hello world')
    + `<div data-agent-transcript-message="true" data-chat-message-id="assistant-1"><div class="prose">I need to clarify something.</div><div style="display:none"><div role="radiogroup" aria-label="Which?"><button role="radio" aria-checked="true"><span class="body-sm">A</span></button></div></div></div>`
    + replyRow('assistant-2', 'Here is the final answer.');
  const page = openDom(html);
  try {
    const result = page.D.matchTurn({ baseline: [], prompt: 'hello world' }, page.window.document);
    assert.equal(result.accepted, true);
    assert.equal(result.text, 'Here is the final answer.');
    assert.equal(result.complete, true);
  } finally { page.close(); }
});

test('an answered card on the page does not block completion, an unanswered one does', () => {
  const answered = openDom(userRow('user-1', 'hello world') + cardRow('assistant-1', 'Let me ask first.', true) + replyRow('assistant-2', 'Here is the final answer.'));
  try {
    const result = answered.D.matchTurn({ baseline: [], prompt: 'hello world', questionRows: ['assistant-1'] }, answered.window.document);
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].data.answered, true);
    assert.equal(result.questions[0].data.readOnly, true);
    assert.equal(result.complete, true);
    assert.equal(result.text, 'Here is the final answer.');
  } finally { answered.close(); }
  const unanswered = openDom(userRow('user-1', 'hello world') + cardRow('assistant-1', 'Let me ask first.', false) + replyRow('assistant-2', 'Here is the final answer.'));
  try {
    const result = unanswered.D.matchTurn({ baseline: [], prompt: 'hello world', questionRows: ['assistant-1'] }, unanswered.window.document);
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].data.answered, false);
    assert.equal(result.complete, false);
  } finally { unanswered.close(); }
});

test('a preamble tracked as a reply hands over once its cards render', () => {
  // Scan 1: the preamble row has text but its cards have not rendered yet, so it looks like the reply.
  const first = openDom(userRow('user-1', 'hello world') + replyRow('assistant-1', 'Let me ask first.', false));
  let tx;
  try {
    const seen = first.D.matchTurn({ baseline: [], prompt: 'hello world' }, first.window.document);
    assert.equal(seen.assistantId, 'assistant-1');
    tx = { baseline: [], prompt: 'hello world', userId: 'user-1', assistantId: seen.assistantId, seenRows: seen.turnIds, questionRows: seen.questionRows };
  } finally { first.close(); }
  // Scan 2: the same row now shows its cards (still unanswered) and the final reply streams in.
  // The tracked ID moves from the preamble row to the new reply instead of stopping as changed.
  const second = openDom(userRow('user-1', 'hello world') + cardRow('assistant-1', 'Let me ask first.', false) + replyRow('assistant-2', 'Here is the final answer.', false));
  try {
    const result = second.D.matchTurn(tx, second.window.document);
    assert.equal(result.accepted, true);
    assert.equal(result.assistantId, 'assistant-2');
    assert.equal(result.text, 'Here is the final answer.');
  } finally { second.close(); }
});

test('questionState tells answerable, arena-only and answered cards apart', () => {
  assert.equal(questionState([]), 'none');
  assert.equal(questionState([{ token: 't' }]), 'answerable'); // old shape without flags
  assert.equal(questionState([{ readOnly: false, answerState: '' }]), 'answerable');
  assert.equal(questionState([{ readOnly: true, answered: true, sensitive: false }]), 'answered');
  assert.equal(questionState([{ readOnly: true, answered: false, sensitive: true }]), 'arena');
  // Old adapters without the new flags: the reason distinguishes answered from sensitive.
  assert.equal(questionState([{ readOnly: true, reason: 'An option is already selected in Arena. Wait there or check its state.' }]), 'answered');
  assert.equal(questionState([{ readOnly: true, reason: 'This may be an approval, sensitive action or security question. Handle it in Arena.' }]), 'arena');
  const NOW = 1_700_000_000_000;
  const turn = live => ({ status: 'waiting', acceptedAt: NOW - 1000, lastActivityAt: NOW - 1000, live });
  assert.equal(liveStatus(turn({ questions: [{ readOnly: true, answered: true }] }), NOW).step, 'Working');
  assert.equal(liveStatus(turn({ questions: [{ readOnly: true, answered: false, sensitive: true }] }), NOW).step, 'Waiting for you in Arena');
  assert.equal(liveStatus(turn({ questions: [{ readOnly: false }] }), NOW).step, 'Waiting for your answer');
});

test('watch forwards remembered question rows so a resume keeps tracking', async () => {
  const { AgentClient } = await import('../agent-client.js');
  const posted = [];
  const listeners = { message: [], disconnect: [] };
  const port = {
    onMessage: { addListener: fn => listeners.message.push(fn) },
    onDisconnect: { addListener: fn => listeners.disconnect.push(fn) },
    postMessage: message => posted.push(message),
    disconnect: () => {}
  };
  globalThis.chrome = {
    runtime: { id: 'test', lastError: undefined, sendMessage: async () => ({ ok: true, value: { documentId: 'doc-1' } }) },
    tabs: { connect: () => port }
  };
  const client = new AgentClient(42, () => {}, 'https://arena.ai/agent');
  try {
    for (let i = 0; i < 200 && !posted.some(m => m.type === 'PROBE'); i++) await new Promise(resolve => { setImmediate(resolve); });
    listeners.message.forEach(fn => fn({ type: 'READY', adapterVersion: '2.8.1', pageKind: 'agent' }));
    await client.readiness;
    client.watch('11111111-1111-1111-1111-111111111111', 'hello', 'user-1', 'https://arena.ai/agent', false, ['assistant-1']);
    const watch = posted.find(m => m.type === 'WATCH');
    assert.deepEqual(watch.knownQuestionRows, ['assistant-1']);
  } finally { client.close(); delete globalThis.chrome; }
});
