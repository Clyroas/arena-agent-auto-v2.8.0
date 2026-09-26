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
import { SKILL_PRESETS, PRESET_GROUPS, findPresets, composePresetText } from '../skill-presets.js';

// Exercise the real panel bootstrap/handlers against its actual markup. Presentation and Chrome are
// replaced here; the separate browser suite uses real extension worlds, native inputs and ports.
const source = readFileSync(new URL('../panel.js', import.meta.url), 'utf8').replace(/^import[^\n]*\n/gm, '');
const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => { setImmediate(resolve); });
async function open({ captureLink = async () => {}, send = async () => {}, picker = () => {}, repoPickers = null, pageKind = 'agent' } = {}) {
  const dom = new JSDOM(html, { url: 'https://extension.test/panel.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, deadlines = [];
  const listener = { addListener() {}, removeListener() {} };
  w.chrome = {
    runtime: { sendMessage: async message => ({ ok: true, value: message.type === 'LIST_TABS' ? [] : { id: 1, url: core.AGENT_URL, title: 'Fixture', autoDiscardable: true } }) },
    tabs: { onUpdated: listener, onRemoved: listener, get: async () => ({ autoDiscardable: true }), update: async () => {}, create: async () => {} },
    permissions: { contains: async () => true, onAdded: listener, onRemoved: listener }
  };
  const originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => { if (ms === 15000) { deadlines.push(fn); return 0; } return originalTimeout(fn, ms); };
  Object.assign(w, core, attachments, screenshots, { normalizePickers,
    hasShotAccess: () => screenshots.hasShotAccess(w.chrome), requestShotAccess: async () => true, removeShotAccess: async () => true,
    captureLink, liveStatus, questionState, setupFloatingGeometry() {}, recentModels: () => [], rememberModel() {},
    ArenaAgentAttachments: globalThis.ArenaAgentAttachments,
    ConversationView: class { render() {} },
    TabAwakeLease: class extends TabAwakeLease { constructor() { super(w.chrome); } },
    AgentClient: class {
      constructor() { this.ready = true; this.uploadKind = 'input'; this.readiness = Promise.resolve(); }
      close() { this.ready = false; }
    },
    // The generated task-prompt library panel.js imports (its imports are stripped above).
    SKILL_PRESETS, PRESET_GROUPS, findPresets, composePresetText
  });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.eval(`${source}\nwindow.testPanel = {
    stageFiles, clear, screenshotLink, cancelScreenshot, handleEvent, render,
    setup(connection) { state = 'ready'; client = connection; tab = { id: 1, url: AGENT_URL }; setSheet(false); render(); },
    setCapabilities(capabilities) { client.capabilities = capabilities; render(); },
    setModel(expected, actual) { requestedModel = expected; client.model = actual; render(); },
    setTurn(turn) { turns.push(turn); pending = turn; state = 'waiting'; },
    get current() { return { staged, pending, turns, state, shotOperation, historyRequest }; },
    countDraft(mode, cut) { if (mode === 'cut') promptCut = cut; renderPromptCount(); },
    get pickerSession() { return pickerAction; }
  };`);
  await tick();
  const connection = { ready: true, uploadKind: 'input', pageKind, send, close() { this.ready = false; }, loadHistory() {}, picker, ...(repoPickers ? { repoPickers } : {}) };
  w.testPanel.setup(connection);
  return { w, ui: w.testPanel, deadlines, close() { w.testPanel.clear(); w.close(); } };
}

test('all-rejected attachment selections still show feedback in the real panel markup', async () => {
  const page = await open();
  try {
    page.ui.stageFiles([new File(['zip'], 'bad.zip', { type: 'application/zip' })], 'drop');
    assert.equal(page.w.document.getElementById('attachments').hidden, false);
    assert.match(page.w.document.getElementById('attachment-status').textContent, /supported list/);
  } finally { page.close(); }
});

test('actual COMPLETE and cancellation cleanup leave no files on historical turns', async () => {
  const page = await open();
  try {
    const turn = { id: 'one', prompt: 'hello', reply: '', attachments: [], files: [new File(['secret'], 'a.txt')], payload: [{ data: 'secret' }] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'COMPLETE', requestId: 'one', text: 'done', url: core.AGENT_URL });
    assert.equal(turn.files, null);
    assert.equal(turn.payload, null);
    assert.equal(turn.status, 'complete');
    assert.equal(page.ui.current.pending, null);
  } finally { page.close(); }
});

test('a screenshot completing after clear cannot stage into the next session', async () => {
  let finish;
  const page = await open({ captureLink: () => new Promise(resolve => { finish = resolve; }) });
  try {
    page.w.document.getElementById('prompt').value = 'https://example.test/';
    const task = page.ui.screenshotLink('https://example.test/');
    await tick();
    const signal = page.ui.current.shotOperation.controller.signal;
    page.ui.clear();
    assert.equal(signal.aborted, true);
    finish({ file: new File(['pixels'], 'shot.png', { type: 'image/png' }), url: 'https://example.test/' });
    await task;
    assert.equal(page.ui.current.staged.length, 0);
    assert.equal(page.ui.current.state, 'disconnected');
    assert.equal(page.w.document.getElementById('shot-status').textContent, '');
  } finally { page.close(); }
});

test('capture disables Send, draft edits cancel it, and late success cannot attach', async () => {
  let finish;
  const page = await open({ captureLink: () => new Promise(resolve => { finish = resolve; }) });
  try {
    const prompt = page.w.document.getElementById('prompt'); prompt.value = 'https://example.test/';
    const task = page.ui.screenshotLink('https://example.test/');
    await tick();
    assert.equal(page.w.document.getElementById('prepare').disabled, true);
    prompt.value = 'another draft'; prompt.dispatchEvent(new page.w.Event('input'));
    finish({ file: new File(['pixels'], 'shot.png', { type: 'image/png' }), url: 'https://example.test/' });
    await task;
    assert.equal(page.ui.current.staged.length, 0);
    assert.equal(page.ui.current.shotOperation, null);
  } finally { page.close(); }
});

test('a removed screenshot can be captured again in the same panel', async () => {
  const page = await open({ captureLink: async () => ({ file: new File(['pixels'], 'shot.png', { type: 'image/png' }), url: 'https://example.test/' }) });
  try {
    page.w.document.getElementById('prompt').value = 'https://example.test/';
    await page.ui.screenshotLink('https://example.test/');
    assert.equal(page.ui.current.staged.length, 1);
    assert.equal(page.w.document.querySelectorAll('.shot-chip').length, 0);
    page.w.document.querySelector('.attachment-remove').click();
    assert.equal(page.w.document.querySelectorAll('.shot-chip').length, 1);
  } finally { page.close(); }
});

test('history timeout unlocks the button and ignores the late history response', async () => {
  const page = await open();
  try {
    page.w.document.getElementById('load-history').click();
    const id = page.ui.current.historyRequest;
    assert.ok(id);
    page.deadlines.at(-1)();
    assert.equal(page.ui.current.historyRequest, null);
    page.ui.handleEvent({ type: 'HISTORY', requestId: id, turns: [{ prompt: 'late', status: 'complete', reply: 'late' }] });
    assert.equal(page.ui.current.turns.length, 0);
    assert.match(page.w.document.getElementById('notice-text').textContent, /HISTORY_TIMEOUT/);
  } finally { page.close(); }
});

test('the panel send path sends each original file once and does not store its encoded payload', async () => {
  let sent;
  const page = await open({ send: async (id, prompt, url, payload) => { sent = structuredClone(payload); } });
  try {
    page.ui.stageFiles([new File(['alpha'], 'same.txt', { type: 'text/plain' }), new File(['bravo'], 'same.txt', { type: 'text/plain' })], 'drop');
    page.w.document.getElementById('prompt').value = 'Compare these';
    page.w.document.getElementById('prepare').click();
    for (let i = 0; i < 10 && !sent; i++) await tick();
    assert.deepEqual(sent.map(item => atob(item.data)), ['alpha', 'bravo']);
    assert.equal(page.ui.current.pending.payload, undefined);
  } finally { page.close(); }
});

test('same-conversation reconnect keeps the local draft and history without sending', async () => {
  let sends = 0;
  const page = await open({ send: async () => { sends++; } });
  try {
    const turn = { id: 'one', prompt: 'hello', reply: '', attachments: [] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'COMPLETE', requestId: 'one', text: 'done', url: core.AGENT_URL });
    page.w.document.getElementById('prompt').value = 'Unsent local draft';
    page.w.document.getElementById('reconnect').click();
    await tick(); await tick();
    assert.equal(page.ui.current.state, 'ready');
    assert.equal(page.ui.current.turns[0], turn);
    assert.equal(page.w.document.getElementById('prompt').value, 'Unsent local draft');
    assert.equal(sends, 0);
  } finally { page.close(); }
});

test('a security verification pauses the panel instead of stopping the turn, and clearing it resumes', async () => {
  const page = await open();
  try {
    const turn = { id: 'sec', prompt: 'hello', reply: '', status: 'waiting', attachments: [] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'BLOCKED', requestId: 'sec', code: 'SECURITY_CHECK', message: 'Arena is showing a security verification.', clicked: true, accepted: true });
    // The turn must stay alive: not an error, not released, still the pending reply.
    assert.equal(page.ui.current.state, 'waiting');
    assert.equal(turn.status, 'waiting');
    assert.equal(turn.securityHold, true);
    assert.equal(page.ui.current.pending, turn, 'the pending card must survive a transient verification');
    assert.equal(page.w.document.getElementById('pending').dataset.kind, 'blocked');
    assert.match(page.w.document.getElementById('pending-title').textContent, /Waiting for verification/);
    assert.match(page.w.document.getElementById('notice-text').textContent, /paused, not stopped/);
    // Clearing the verification resumes without a resend and restores the normal status.
    page.ui.handleEvent({ type: 'SECURITY_CLEARED', requestId: 'sec' });
    assert.equal(turn.securityHold, false);
    assert.equal(page.ui.current.pending, turn);
    assert.match(page.w.document.getElementById('notice-text').textContent, /resumed automatically/);
  } finally { page.close(); }
});

test('a security BLOCKED event does not release staged attachments like a stop would', async () => {
  const page = await open();
  try {
    const turn = { id: 'sec2', prompt: 'hello', reply: '', status: 'sending', attachments: [], files: [new File(['secret'], 'a.txt')], payload: [{ data: 'secret' }] };
    page.ui.setTurn(turn);
    page.ui.handleEvent({ type: 'BLOCKED', requestId: 'sec2', code: 'SECURITY_CHECK', message: 'Arena is showing a security verification.' });
    assert.equal(turn.status, 'waiting', 'a pause is not a stop');
    assert.ok(turn.files, 'staged files must remain available so the user can retry after verifying');
    assert.equal(page.ui.current.state, 'waiting');
  } finally { page.close(); }
});

test('model mismatch blocks Send until the user explicitly confirms the actual model', async () => {
  let sends = 0;
  const page = await open({ send: async () => { sends++; } });
  try {
    page.ui.setModel('Expected', 'Actual');
    const button = page.w.document.getElementById('prepare');
    assert.equal(button.disabled, true);
    page.w.document.getElementById('prompt').value = 'hello';
    button.click(); assert.equal(sends, 0);
    page.w.document.getElementById('accept-current-model').click();
    assert.equal(page.w.document.getElementById('confirm-dialog').open, true);
    assert.equal(button.disabled, true);
    page.w.document.getElementById('dialog-ok').click(); await tick();
    assert.equal(button.disabled, false);
    assert.equal(sends, 0, 'confirmation never sends on behalf of the user');
  } finally { page.close(); }
});

test('a page that no longer exposes the composer blocks Send and names the gap', async () => {
  let sends = 0;
  const page = await open({ send: async () => { sends++; } });
  try {
    // No snapshot: the connection was verified against the same adapter version, so Send stays usable.
    assert.equal(page.w.document.getElementById('prepare').disabled, false);
    // A reported snapshot that is missing a control the adapter drives is drift: Send is refused with a
    // named gap instead of failing later, mid-send.
    page.ui.setCapabilities({ pageKind: 'agent', mode: '', checks: { composer: false, send: false, transcript: true, questions: false, responsePairs: false, reviewPanel: false, upload: false, uploadPicker: false } });
    const button = page.w.document.getElementById('prepare');
    assert.equal(button.disabled, true);
    page.w.document.getElementById('prompt').value = 'hello';
    button.click(); assert.equal(sends, 0);
    assert.match(page.w.document.getElementById('adapter-state').textContent, /missing: message box, Send control/);
    assert.equal(page.w.document.getElementById('adapter-state').dataset.drift, 'true');
    // An optional capability going away (here: the task-review panel) is reported, not blocking.
    page.ui.setCapabilities({ pageKind: 'agent', mode: '', checks: { composer: true, send: true, transcript: true, questions: true, responsePairs: true, reviewPanel: false, upload: true, uploadPicker: true } });
    assert.equal(button.disabled, false);
    assert.equal(page.w.document.getElementById('adapter-state').dataset.drift, 'false');
  } finally { page.close(); }
});

// ---- Arena Agent Mode repo & branch pickers (v2.9.0) ---------------------------------------------
const PICKERS = { repo: { present: true, value: 'Clyroas/arena-agent-auto-v2.8.0', disabled: false }, branch: { present: true, value: 'main', disabled: false } };

test('the repo and branch chips mirror Arena’s picker state and hide when it has none', async () => {
  const plain = await open();
  try {
    assert.equal(plain.w.document.getElementById('picker-bar').hidden, true);
  } finally { plain.close(); }
  const page = await open({ repoPickers: PICKERS });
  try {
    const bar = page.w.document.getElementById('picker-bar');
    assert.equal(bar.hidden, false);
    assert.equal(page.w.document.getElementById('repo-chip-label').textContent, 'Clyroas/arena-agent-auto-v2.8.0');
    assert.equal(page.w.document.getElementById('branch-chip-label').textContent, 'main');
    assert.equal(page.w.document.getElementById('repo-chip').disabled, false);
    // A Direct chat never shows Arena's repository pickers.
    const direct = await open({ repoPickers: PICKERS, pageKind: 'direct' });
    try { assert.equal(direct.w.document.getElementById('picker-bar').hidden, true); }
    finally { direct.close(); }
  } finally { page.close(); }
});

test('opening a chip asks the tab to open Arena’s picker and lists what it sends back', async () => {
  const calls = [];
  const page = await open({ repoPickers: PICKERS, picker: (...args) => calls.push(args) });
  try {
    page.w.document.getElementById('repo-chip').click();
    const dialog = page.w.document.getElementById('picker-dialog');
    assert.equal(dialog.open, true);
    assert.deepEqual(calls[0].slice(0, 3), [calls[0][0], 'repo', 'open']);
    assert.match(page.w.document.getElementById('picker-status').textContent, /Opening Arena’s picker/);
    assert.equal(page.w.document.getElementById('prepare').disabled, true, 'Send waits while the picker is in use');
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId: calls[0][0], kind: 'repo', phase: 'open',
      options: [{ label: 'Clyroas/arena-agent-auto-v2.8.0', meta: 'Updated 2 days ago', disabled: false }, { label: 'Clyroas/other-repo', meta: '', disabled: false }], query: '' });
    const rows = [...page.w.document.querySelectorAll('#picker-list .model-option')];
    assert.equal(rows.length, 2);
    assert.equal(rows[0].getAttribute('aria-current'), 'true');
    assert.equal(rows[0].disabled, false);
    // Typing filters the list that Arena itself sent; nothing is sent back to the tab.
    const search = page.w.document.getElementById('picker-search');
    search.value = 'other';
    search.dispatchEvent(new page.w.Event('input'));
    assert.equal(page.w.document.querySelectorAll('#picker-list .model-option').length, 1);
    assert.equal(calls.length, 1);
  } finally { page.close(); }
});

test('choosing an option picks through Arena once, then the dialog closes and the chip updates', async () => {
  const calls = [];
  const page = await open({ repoPickers: PICKERS, picker: (...args) => calls.push(args) });
  try {
    page.w.document.getElementById('repo-chip').click();
    const actionId = calls[0][0];
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId, kind: 'repo', phase: 'open',
      options: [{ label: 'Clyroas/arena-agent-auto-v2.8.0', meta: '', disabled: false }, { label: 'Clyroas/other-repo', meta: '', disabled: false }], query: '' });
    page.w.document.querySelector('#picker-list .model-option[data-name="Clyroas/other-repo"]').click();
    assert.deepEqual(calls[1].slice(1), ['repo', 'pick', 'Clyroas/other-repo']);
    assert.match(page.w.document.getElementById('picker-status').textContent, /Asking Arena to switch/);
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId, kind: 'repo', phase: 'done', value: 'Clyroas/other-repo',
      repoPickers: { repo: { present: true, value: 'Clyroas/other-repo', disabled: false }, branch: { present: true, value: 'main', disabled: false } } });
    assert.equal(page.w.document.getElementById('picker-dialog').open, false);
    assert.equal(page.w.document.getElementById('repo-chip-label').textContent, 'Clyroas/other-repo');
    assert.equal(page.w.document.getElementById('prepare').disabled, false);
    assert.match(page.w.document.getElementById('notice-text').textContent, /switched its repository to Clyroas\/other-repo/);
    // The finished dialog does not send another close: Arena’s picker already closed itself.
    assert.equal(calls.length, 2);
  } finally { page.close(); }
});

test('a picker error stays visible in the dialog and never closes it behind the user’s back', async () => {
  const calls = [];
  const page = await open({ repoPickers: PICKERS, picker: (...args) => calls.push(args) });
  try {
    page.w.document.getElementById('branch-chip').click();
    const actionId = calls[0][0];
    page.w.document.getElementById('picker-dialog-title').textContent = 'Branch';
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId, kind: 'branch', phase: 'open',
      options: [{ label: 'main', meta: '', disabled: false }], query: '' });
    page.w.document.querySelector('#picker-list .model-option').click();
    page.ui.handleEvent({ type: 'PICKER_ERROR', actionId, kind: 'branch', code: 'PICK_NOT_CONFIRMED', message: 'Arena did not confirm the change.' });
    assert.equal(page.w.document.getElementById('picker-dialog').open, true);
    assert.match(page.w.document.getElementById('picker-status').textContent, /PICK_NOT_CONFIRMED/);
    assert.equal(page.w.document.getElementById('picker-status').dataset.kind, 'error');
    // A stale frame from an older dialog is ignored entirely.
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId: '00000000-0000-0000-0000-000000000000', kind: 'branch', phase: 'done', value: 'nope' });
    assert.equal(page.w.document.getElementById('picker-dialog').open, true);
    // Done dismisses Arena’s own picker through the tab.
    page.w.document.getElementById('picker-close').click();
    assert.equal(page.w.document.getElementById('picker-dialog').open, false);
    assert.deepEqual(calls.at(-1).slice(1, 3), ['branch', 'close']);
    assert.equal(page.ui.pickerSession, null);
  } finally { page.close(); }
});

test('an unavailable option is shown disabled and cannot be picked', async () => {
  const calls = [];
  const page = await open({ repoPickers: PICKERS, picker: (...args) => calls.push(args) });
  try {
    page.w.document.getElementById('repo-chip').click();
    const actionId = calls[0][0];
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId, kind: 'repo', phase: 'open',
      options: [{ label: 'Clyroas/arena-agent-auto-v2.8.0', meta: '', disabled: false }, { label: 'Clyroas/archived-repo', meta: 'archived', disabled: true }], query: '' });
    const rows = [...page.w.document.querySelectorAll('#picker-list .model-option')];
    assert.equal(rows[1].disabled, true);
    rows[1].click();
    assert.equal(calls.length, 1, 'a disabled option never reaches the tab');
  } finally { page.close(); }
});

// ---- Panel-wide UI regressions (2.9.1) -----------------------------------------------------------
// Both of these shipped in 2.9.0 and neither was a behavioural bug: the panel worked, it just said
// something untrue after a reset and announced its option rows as the wrong kind of thing.

test('a cleared session does not leave the previous draft’s counter on screen', async () => {
  const page = await open();
  try {
    const prompt = page.w.document.getElementById('prompt');
    const counter = page.w.document.getElementById('prompt-count');
    prompt.value = 'x'.repeat(25000); // over 80% of the limit: the counter appears
    page.w.testPanel.countDraft();
    assert.equal(counter.hidden, false);
    assert.match(counter.textContent, /25,000 \/ 30,000/);
    page.ui.clear();
    assert.equal(prompt.value, '', 'clear() empties the composer');
    assert.equal(counter.hidden, true, 'the counter belongs to the draft, not to the panel');
    assert.equal(counter.textContent, '');
    // Send clears the draft too, and it already reset the counter; keep that contract.
    page.ui.countDraft('cut', 1234);
    assert.equal(counter.hidden, false);
    assert.match(counter.textContent, /your paste was cut: 1,234/);
    page.ui.clear();
    assert.equal(counter.hidden, true);
    assert.equal(counter.textContent, '');
  } finally { page.close(); }
});

test('option rows keep their button semantics inside the list', async () => {
  const calls = [];
  const page = await open({ repoPickers: PICKERS, picker: (...args) => calls.push(args) });
  try {
    page.w.document.getElementById('repo-chip').click();
    page.ui.handleEvent({ type: 'PICKER_STATE', actionId: calls[0][0], kind: 'repo', phase: 'open',
      options: [{ label: 'Clyroas/arena-agent-auto-v2.8.0', meta: '', disabled: false }], query: '' });
    const row = page.w.document.querySelector('#picker-list [role="listitem"]');
    assert.ok(row, 'each option is a list item');
    const button = row.querySelector('button.model-option');
    assert.ok(button, 'the list item contains the control, rather than being the control');
    assert.equal(button.getAttribute('role'), null, 'the button keeps its own role');
    // The list only contains list items: its own headings and empty notes stay out of the semantics.
    for (const child of page.w.document.getElementById('picker-list').children)
      assert.ok(child.getAttribute('role') === 'listitem' || child.getAttribute('role') === 'presentation',
        `the list must not contain ${child.tagName.toLowerCase()} with role ${child.getAttribute('role')}`);
  } finally { page.close(); }
});

test('a ready panel uses a short status label, and staged files are counted where the eye can see them', async () => {
  const page = await open();
  try {
    assert.equal(page.w.document.getElementById('status').textContent, 'Ready');
    assert.equal(page.w.document.getElementById('settings-sheet').dataset.open, 'false');
    assert.equal(page.w.document.getElementById('attach-files').dataset.count, '');
    assert.equal(page.ui.stageFiles([new File(['hello'], 'note.txt', { type: 'text/plain' })], 'pick'), true);
    const attach = page.w.document.getElementById('attach-files');
    assert.equal(attach.dataset.count, '1');
    assert.match(attach.getAttribute('aria-label'), /1 file staged/);
    page.ui.clear();
    assert.equal(page.w.document.getElementById('settings-sheet').dataset.open, 'true', 'disconnect opens setup instead of leaving the user on a dead composer');
    assert.equal(page.w.document.getElementById('prompt-count').hidden, true);
  } finally { page.close(); }
});
