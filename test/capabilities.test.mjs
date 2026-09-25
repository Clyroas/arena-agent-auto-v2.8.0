import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { capabilitySummary } from '../core.js';

// The semantic capability snapshot is the adapter's early warning that Arena's markup moved. It is
// loaded here from the real agent-dom.js (not a stub) and fed straight into the panel's summary helper,
// so an Agent page that loses a control the adapter drives is reported as drift instead of only failing
// later, mid-send.
const agentDomSource = readFileSync(new URL('../agent-dom.js', import.meta.url), 'utf8');

function openDom(html) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://arena.ai/agent/c/1', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
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

const row = (id, text) => `<div data-agent-transcript-message="true" data-chat-message-id="${id}"><div class="prose">${text}</div><div aria-label="Response ended"></div></div>`;
const composerHtml = `
  <form>
    <textarea aria-label="Message Arena" placeholder="Send a message"></textarea>
    <input type="file" multiple accept="image/png">
    <button aria-label="Send">Send</button>
  </form>`;

test('a healthy Agent layout reports composer, send, upload and transcript with no drift', () => {
  const page = openDom(`${row('a1', 'Hello')}${composerHtml}`);
  try {
    const snapshot = page.D.capabilities(page.window.document);
    assert.equal(snapshot.pageKind, 'agent');
    assert.equal(snapshot.checks.composer, true);
    assert.equal(snapshot.checks.send, true);
    assert.equal(snapshot.checks.transcript, true);
    assert.equal(snapshot.checks.upload, true);
    const summary = capabilitySummary(snapshot);
    assert.equal(summary.reported, true);
    assert.equal(summary.drift, false);
    assert.deepEqual(summary.required, []);
    // The fixture has no clarification card, response pair or review panel; those are optional for a
    // text send, so they are named as unavailable without counting as drift.
    assert.equal(summary.missing.includes('message box'), false);
    assert.equal(summary.missing.includes('Send control'), false);
  } finally { page.close(); }
});

test('a page whose composer disappeared is reported as drift, not a silent success', () => {
  const page = openDom(row('a1', 'Hello'));
  try {
    const snapshot = page.D.capabilities(page.window.document);
    assert.equal(snapshot.checks.composer, false);
    assert.equal(snapshot.checks.send, false);
    const summary = capabilitySummary(snapshot);
    assert.equal(summary.drift, true);
    assert.equal(summary.missing.includes('message box'), true);
    assert.equal(summary.missing.includes('Send control'), true);
  } finally { page.close(); }
});

test('a page without a composer file input degrades uploads but does not block text chat', () => {
  const page = openDom(`${row('a1', 'Hello')}<form><textarea aria-label="Message Arena"></textarea><button aria-label="Send">Send</button></form>`);
  try {
    const snapshot = page.D.capabilities(page.window.document);
    assert.equal(snapshot.checks.upload, false);
    const summary = capabilitySummary(snapshot);
    assert.equal(summary.drift, false);
    assert.deepEqual(summary.required, []);
    assert.match(summary.text, /Core chat is available/);
  } finally { page.close(); }
});
