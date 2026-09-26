import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as core from '../core.js';
import * as attachments from '../attachment-state.js';
import * as screenshots from '../screenshot.js';
import { normalizePickers } from '../agent-client.js';
import { liveStatus, questionState } from '../live-status.js';
import { TabAwakeLease } from '../tab-awake.js';
import { SKILL_PRESETS, PRESET_GROUPS } from '../skill-presets.js';

// The real panel bootstrap and its real markup, with only presentation and Chrome replaced (the same
// substitution panel-lifecycle.test.mjs uses). What is under test here is the panel's own behaviour:
// the dock chip, the dialog, the search, and what a chosen prompt does to the draft — including that
// it does nothing else. The single-send path has its own coverage elsewhere.
const source = readFileSync(new URL('../panel.js', import.meta.url), 'utf8').replace(/^import[^\n]*\n/gm, '');
const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => { setImmediate(resolve); });

async function open({ send = async () => {} } = {}) {
  const dom = new JSDOM(html, { url: 'https://extension.test/panel.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const problems = [];
  w.console.error = (...args) => problems.push(args.join(' '));
  w.addEventListener('error', event => problems.push(String(event.error || event.message)));
  const listener = { addListener() {}, removeListener() {} };
  w.chrome = {
    runtime: { sendMessage: async message => ({ ok: true, value: message.type === 'LIST_TABS' ? [] : { id: 1, url: core.AGENT_URL, title: 'Fixture', autoDiscardable: true } }) },
    tabs: { onUpdated: listener, onRemoved: listener, get: async () => ({ autoDiscardable: true }), update: async () => {}, create: async () => {} },
    permissions: { contains: async () => true, onAdded: listener, onRemoved: listener }
  };
  Object.assign(w, core, attachments, screenshots, { normalizePickers,
    hasShotAccess: () => screenshots.hasShotAccess(w.chrome), requestShotAccess: async () => true, removeShotAccess: async () => true,
    captureLink: async () => {}, liveStatus, questionState, setupFloatingGeometry() {}, recentModels: () => [], rememberModel() {},
    ArenaAgentAttachments: globalThis.ArenaAgentAttachments,
    ConversationView: class { render() {} },
    TabAwakeLease: class extends TabAwakeLease { constructor() { super(w.chrome); } },
    AgentClient: class {
      constructor() { this.ready = true; this.uploadKind = 'input'; this.readiness = Promise.resolve(); }
      close() { this.ready = false; }
    },
    // The generated prompt library, exactly as panel.js imports it.
    SKILL_PRESETS, PRESET_GROUPS,
    findPresets: (query, presets = SKILL_PRESETS) => {
      const needle = String(query || '').trim().toLowerCase();
      return needle ? presets.filter(preset => preset.search.includes(needle)) : presets;
    },
    composePresetText: (draft, preset, limit) => {
      const current = String(draft || '');
      const text = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${preset.prompt}` : preset.prompt;
      return text.length > limit ? { ok: false, text, overflow: text.length - limit } : { ok: true, text, overflow: 0 };
    }
  });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.eval(`${source}\nwindow.testPanel = {
    clear, render, handleEvent,
    setup(connection) { state = 'ready'; client = connection; tab = { id: 1, url: AGENT_URL }; setSheet(false); render(); },
    setTurn(turn) { turns.push(turn); pending = turn; state = 'sending'; render(); },
    get draft() { return $('prompt'); }
  };`);
  await tick();
  const connection = { ready: true, uploadKind: 'input', pageKind: 'agent', send, close() { this.ready = false; }, loadHistory() {} };
  w.testPanel.setup(connection);
  return { w, ui: w.testPanel, problems, close() { w.testPanel.clear(); w.close(); } };
}

const byId = (page, id) => page.w.document.getElementById(id);
const prompt = page => byId(page, 'prompt');

test('the prompt chip stays out of the way until there is a draft to write into', async () => {
  const page = await open();
  try {
    // Disconnected: the composer is disabled, so there is nothing a preset could be inserted into.
    page.ui.clear();
    assert.equal(byId(page, 'presets-chip').hidden, true);
    page.ui.setup({ ready: true, uploadKind: 'input', pageKind: 'agent', close() {}, loadHistory() {} });
    assert.equal(byId(page, 'presets-chip').hidden, false);
    assert.equal(byId(page, 'presets-chip').disabled, false);
    assert.match(byId(page, 'presets-chip').title, /34 workflows/);
  } finally { page.close(); }
});

test('opening the dialog lists every workflow, grouped by lifecycle phase', async () => {
  const page = await open();
  try {
    byId(page, 'presets-chip').click();
    const dialog = byId(page, 'presets-dialog');
    assert.equal(dialog.open, true);
    assert.equal(byId(page, 'presets-dialog-title').textContent, 'Task prompts');
    assert.equal(dialog.getAttribute('aria-labelledby'), 'presets-dialog-title');
    const rows = [...byId(page, 'presets-list').querySelectorAll('.model-row')];
    assert.equal(rows.length, SKILL_PRESETS.length);
    // One row per option and one control inside it: the listitem role never replaces the button.
    assert.equal(rows.filter(row => row.getAttribute('role') === 'listitem').length, SKILL_PRESETS.length);
    assert.equal(rows.filter(row => row.querySelector('button[role]')).length, 0);
    // Commands lead, then the phases in lifecycle order.
    const groups = [...byId(page, 'presets-list').querySelectorAll('.model-group')].map(node => node.textContent);
    assert.deepEqual(groups, PRESET_GROUPS);
    assert.equal(byId(page, 'presets-status').textContent, `${SKILL_PRESETS.length} of ${SKILL_PRESETS.length} prompts · choosing one fills your draft`);
    assert.equal(byId(page, 'presets-search').value, '');
  } finally { page.close(); }
});

test('search filters the list, reports the count, and says so when nothing matches', async () => {
  const page = await open();
  try {
    byId(page, 'presets-chip').click();
    const search = byId(page, 'presets-search');
    search.value = 'security';
    search.dispatchEvent(new page.w.Event('input'));
    let rows = [...byId(page, 'presets-list').querySelectorAll('.model-option')];
    assert.deepEqual(rows.map(button => button.dataset.preset), ['command:review', 'skill:security-and-hardening']);
    assert.match(byId(page, 'presets-status').textContent, /^2 of 34 prompts/);
    search.value = 'no such workflow anywhere';
    search.dispatchEvent(new page.w.Event('input'));
    assert.equal(byId(page, 'presets-list').querySelectorAll('.model-option').length, 0);
    assert.equal(byId(page, 'presets-list').textContent, 'No prompt matches that search.');
    assert.equal(byId(page, 'presets-status').textContent, '');
    // Closing resets the search, so the next open starts from the whole library.
    byId(page, 'presets-close').click();
    assert.equal(byId(page, 'presets-dialog').open, false);
    assert.equal(byId(page, 'presets-search').value, '');
  } finally { page.close(); }
});

test('the search field takes the focus when the dialog opens', async () => {
  const page = await open();
  try {
    byId(page, 'presets-chip').click();
    assert.equal(page.w.document.activeElement, byId(page, 'presets-search'));
    assert.deepEqual(page.problems, []);
  } finally { page.close(); }
});

test('nothing in the prompt flow logs an error or throws', async () => {
  const page = await open();
  try {
    byId(page, 'presets-chip').click();
    byId(page, 'presets-search').value = 'plan';
    byId(page, 'presets-search').dispatchEvent(new page.w.Event('input'));
    byId(page, 'presets-list').querySelector('.model-option').click();
    byId(page, 'presets-chip').click();
    page.w.dispatchEvent(new page.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepEqual(page.problems, []);
  } finally { page.close(); }
});

test('a chosen prompt fills an empty draft, arms Send, and sends nothing', async () => {
  const sends = [];
  const page = await open({ send: async (...args) => { sends.push(args); } });
  try {
    byId(page, 'presets-chip').click();
    const preset = SKILL_PRESETS.find(item => item.id === 'skill:test-driven-development');
    byId(page, 'presets-list').querySelector('button[data-preset="skill:test-driven-development"]').click();
    assert.equal(prompt(page).value, preset.prompt);
    assert.equal(byId(page, 'prepare').disabled, false, 'the draft is now sendable');
    assert.equal(byId(page, 'presets-dialog').open, false, 'the dialog gets out of the way');
    assert.equal(byId(page, 'presets-chip').hidden, false);
    // The caret lands where the task goes, and the panel announces what it did.
    assert.equal(prompt(page).selectionStart, preset.prompt.length);
    assert.equal(prompt(page).selectionEnd, preset.prompt.length);
    assert.equal(page.w.document.activeElement, prompt(page));
    assert.match(byId(page, 'notice-text').textContent, /Inserted the “Test Driven Development” prompt/);
    // Inserting is not sending: the port was never touched.
    assert.deepEqual(sends, []);
    assert.equal(byId(page, 'prepare').textContent, 'Send to Arena');
  } finally { page.close(); }
});

test('a chosen prompt appends after what is already written, without touching it', async () => {
  const page = await open();
  try {
    prompt(page).value = 'Earlier thought\n\n';
    prompt(page).dispatchEvent(new page.w.Event('input'));
    byId(page, 'presets-chip').click();
    const preset = SKILL_PRESETS.find(item => item.id === 'command:spec');
    byId(page, 'presets-list').querySelector('button[data-preset="command:spec"]').click();
    assert.equal(prompt(page).value, `Earlier thought\n\n${preset.prompt}`);
    // The draft's own listeners ran on a real input event, so the composer is in its normal state:
    // the field auto-grew and Send is armed, exactly as if this had been typed out.
    assert.notEqual(prompt(page).style.height, '', 'the composer auto-grows on the inserted draft');
    assert.equal(byId(page, 'prepare').disabled, false);
  } finally { page.close(); }
});

test('the prompt already in the draft is marked current in the list', async () => {
  const page = await open();
  try {
    const preset = SKILL_PRESETS.find(item => item.id === 'skill:code-review-and-quality');
    prompt(page).value = preset.prompt;
    byId(page, 'presets-chip').click();
    const current = byId(page, 'presets-list').querySelectorAll('.model-option[aria-current="true"]');
    assert.equal(current.length, 1);
    assert.equal(current[0].dataset.preset, 'skill:code-review-and-quality');
  } finally { page.close(); }
});

test('a draft too close to the limit refuses the prompt instead of truncating it', async () => {
  const page = await open();
  try {
    const preset = SKILL_PRESETS.find(item => item.id === 'skill:spec-driven-development');
    prompt(page).value = `x`.repeat(30000 - preset.prompt.length + 5);
    prompt(page).dispatchEvent(new page.w.Event('input'));
    byId(page, 'presets-chip').click();
    byId(page, 'presets-list').querySelector('button[data-preset="skill:spec-driven-development"]').click();
    assert.equal(prompt(page).value.length, 30000 - preset.prompt.length + 5, 'the draft is untouched');
    assert.match(byId(page, 'notice-text').textContent, /^PRESET_TOO_LONG: “Spec Driven Development” needs \d+ more characters/);
    assert.equal(byId(page, 'presets-dialog').open, true, 'the dialog stays open so the choice can be changed');
  } finally { page.close(); }
});

test('only one modal dialog can be open at a time', async () => {
  const page = await open();
  try {
    byId(page, 'model-chip').hidden = false; byId(page, 'model-chip').disabled = false;
    byId(page, 'model-chip').click();
    assert.equal(byId(page, 'model-dialog').open, true);
    byId(page, 'presets-chip').click();
    assert.equal(byId(page, 'presets-dialog').open, false, 'a second dialog must not stack on the first');
    byId(page, 'model-close').click();
    byId(page, 'presets-chip').click();
    assert.equal(byId(page, 'presets-dialog').open, true);
  } finally { page.close(); }
});

test('a composer you can no longer type in closes the prompt dialog rather than trapping focus', async () => {
  const page = await open();
  try {
    byId(page, 'presets-chip').click();
    assert.equal(byId(page, 'presets-dialog').open, true);
    // A turn starts: the draft is locked, so the modal dialog has nothing left to act on.
    page.ui.setTurn({ id: 'r1', prompt: 'a task', reply: '', status: 'sending' });
    page.ui.handleEvent({ type: 'SENDING', requestId: 'r1' });
    assert.equal(byId(page, 'presets-dialog').open, false);
    assert.equal(byId(page, 'presets-chip').hidden, true);
  } finally { page.close(); }
});

test('the floating window offers the same controls under the same ids', async () => {
  const floating = new JSDOM(readFileSync(new URL('../floating.html', import.meta.url), 'utf8')).window.document;
  for (const id of ['presets-chip', 'presets-chip-label', 'presets-dialog', 'presets-dialog-title', 'presets-close', 'presets-status', 'presets-search', 'presets-list']) {
    assert.ok(floating.getElementById(id), `floating.html is missing #${id}`);
  }
  assert.equal(floating.getElementById('presets-chip').getAttribute('aria-controls'), 'presets-dialog');
  assert.equal(floating.getElementById('presets-search').getAttribute('aria-label'), 'Search task prompts');
});
