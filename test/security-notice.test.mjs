import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The adapter must be able to *report* a security verification without throwing, so the capture loop can
// pause and resume around it. checkBlocks() stays hard-failing for callers that need the fatal behavior.
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
    return [{ x: 0, y: 0, width: 200, height: 120 }];
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

test('securityNotice reports a verification notice without throwing, unlike checkBlocks', () => {
  const { D, close } = openDom('<div role="alert">Verify you are human to continue</div>');
  try {
    assert.match(D.securityNotice(), /security verification/i);
    assert.throws(() => D.checkBlocks(), { code: 'SECURITY_CHECK' }, 'the fatal path must be unchanged');
  } finally { close(); }
});

test('securityNotice is quiet on an ordinary page', () => {
  const { D, close } = openDom('<main><form><textarea></textarea></form></main>');
  try {
    assert.equal(D.securityNotice(), '');
    assert.doesNotThrow(() => D.checkBlocks());
  } finally { close(); }
});

test('securityNotice ignores a hidden verification remnant', () => {
  // Arena sometimes leaves the notice in the DOM after the user has passed it; a hidden node is not a block.
  const { D, close } = openDom('<div role="alert" hidden>Checking your browser before accessing</div>');
  try {
    assert.equal(D.securityNotice(), '');
  } finally { close(); }
});

test('securityNotice detects a visible challenge iframe but not a tiny one', () => {
  // jsdom has no layout, so getBoundingClientRect is stubbed: the adapter only treats a challenge frame as
  // a block when it is actually drawn at a plausible size.
  const big = openDom('<iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>');
  try {
    big.window.HTMLIFrameElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 120, top: 0, left: 0, right: 300, bottom: 120 });
    assert.match(big.D.securityNotice(), /security verification/i);
    assert.throws(() => big.D.checkBlocks(), { code: 'SECURITY_CHECK' });
  } finally { big.close(); }
  const small = openDom('<iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>');
  try {
    small.window.HTMLIFrameElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 });
    assert.equal(small.D.securityNotice(), '');
    assert.doesNotThrow(() => small.D.checkBlocks());
  } finally { small.close(); }
});

test('securityNotice does not read the transcript', () => {
  const html = '<div data-agent-transcript-message="true" data-chat-message-id="u1"><div class="prose">Verify you are human to continue</div></div>';
  const { D, close } = openDom(html);
  try {
    assert.equal(D.securityNotice(), '', 'chat text that merely mentions verification is not a block');
  } finally { close(); }
});
