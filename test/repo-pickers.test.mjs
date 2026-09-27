import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Arena's Agent Mode repository & branch pickers (v2.9.0). The adapter is loaded here from the real
// agent-dom.js (not a stub) and driven against a fixture built from Arena's own trigger markup — the
// button OuterHTML the feature was specified from — so recognition, option reading, the one exact-match
// click and the one Escape dismissal are all exercised against the shipped selectors.
const agentDomSource = readFileSync(new URL('../agent-dom.js', import.meta.url), 'utf8');

// The exact icon geometry from Arena's own buttons; the adapter matches these literally.
const BOOK = '<svg width="1.5em" height="1.5em" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143" stroke="currentColor" stroke-linecap="round"></path>'
  + '<path d="M15 17V22L17.5 20.4L20 22V17" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
  + '<path d="M6 17L20 17" stroke="currentColor" stroke-linecap="round"></path>'
  + '<path d="M6 17C4.89543 17 4 17.8954 4 19C4 20.1046 4.89543 21 6 21H11.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const BRANCH = '<svg width="1.5em" height="1.5em" viewBox="0 0 24 24" stroke-width="1.5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path d="M18 8C19.1046 8 20 7.10457 20 6C20 4.89543 19.1046 4 18 4C16.8954 4 16 4.89543 16 6C16 7.10457 16.8954 8 18 8Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
  + '<path d="M6 20C7.10457 20 8 19.1046 8 18C8 16.8954 7.10457 16 6 16C4.89543 16 4 16.8954 4 18C4 19.1046 4.89543 20 6 20Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
  + '<path d="M6 16V3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
  + '<path d="M8 18H9C12.5 18 18 15.9 18 9.5V8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const CHEVRON = '<svg width="1.5em" height="1.5em" stroke-width="1.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path d="M6 9L12 15L18 9" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

// Arena's trigger shape, verbatim from the supplied OuterHTML (class names dropped for the fixture only).
const trigger = (id, controls, icon, label, extra = '') =>
  `<button type="button" id="${id}" class="border-border flex h-8 items-center justify-between gap-1.5 rounded-md border bg-transparent px-2.5 text-sm" `
  + `aria-haspopup="dialog" aria-expanded="false" aria-controls="${controls}" data-state="closed" ${extra}>`
  + `<span class="flex min-w-0 items-center gap-1.5">${icon}<span class="truncate">${label}</span></span>${CHEVRON}</button>`;

const option = (value, extra = '') =>
  `<div role="option" data-value="${value}" ${extra}><span class="truncate">${value}</span><span>Updated 2 days ago</span></div>`;

const pickersPage = ({ decoy = true, dialogChild = true, duplicate = false, branchDisabled = false } = {}) => `
  <main><ol id="transcript"></ol>
  <form>
    <div class="flex">
      ${trigger('repo-trigger', 'radix-_r_6f_', BOOK, 'Clyroas/arena-agent-auto-v2.8.0')}
      ${trigger('branch-trigger', 'radix-_r_6g_', BRANCH, 'main', branchDisabled ? 'disabled' : '')}
      ${decoy ? trigger('decoy-trigger', 'radix-decoy', '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" stroke="currentColor"></path></svg>', 'Some model') : ''}
      ${duplicate ? trigger('repo-trigger-2', 'radix-_r_6f_2', BOOK, 'Clyroas/arena-agent-auto-v2.8.0') : ''}
    </div>
    <textarea aria-label="Message Arena" placeholder="Send a message"></textarea>
    <button aria-label="Send" type="submit">Send</button>
  </form></main>
  <div id="radix-_r_6f_" role="dialog" data-state="open" hidden>
    <input type="text" placeholder="Search repositories" value="">
    <div role="listbox">${option('Clyroas/arena-agent-auto-v2.8.0')}${option('Clyroas/other-repo')}${option('Clyroas/archived-repo', 'aria-disabled="true"')}</div>
  </div>
  <div id="radix-_r_6g_" role="dialog" data-state="open" hidden>
    <input type="search" placeholder="Search branches" value="">
    <div role="listbox">${option('main')}${option('arena/picker-bar')}</div>
  </div>
  ${dialogChild ? `<div role="dialog" id="unrelated">${trigger('in-dialog-trigger', 'radix-in-dialog', BOOK, 'Clyroas/inside-dialog')}</div>` : ''}`;

function openPage(html = pickersPage()) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
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
  return { window, D: window.ArenaAgentDOM, close: () => window.close() };
}

// The fixture's "Radix": a trigger click expands its popover; a document Escape collapses any open one.
function wireRadix(window) {
  const doc = window.document;
  for (const trigger of doc.querySelectorAll('button[aria-haspopup="dialog"][aria-controls]')) {
    trigger.addEventListener('click', () => {
      const dialog = doc.getElementById(trigger.getAttribute('aria-controls'));
      if (!dialog) return;
      const open = trigger.getAttribute('data-state') === 'open';
      trigger.setAttribute('data-state', open ? 'closed' : 'open');
      trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
      dialog.hidden = open;
    });
  }
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const trigger of doc.querySelectorAll('button[aria-haspopup="dialog"][data-state="open"]')) {
      trigger.setAttribute('data-state', 'closed');
      doc.getElementById(trigger.getAttribute('aria-controls'))?.setAttribute('hidden', '');
    }
  });
}

const realm = value => JSON.parse(JSON.stringify(value));
const openDialog = (page, id) => { page.window.document.getElementById(id).hidden = false; };

test('repoInfo recognizes both pickers from the supplied Arena markup', () => {
  const page = openPage();
  try {
    const info = page.D.repoInfo();
    assert.deepEqual(realm(info.repo), { present: true, value: 'Clyroas/arena-agent-auto-v2.8.0', disabled: false });
    assert.deepEqual(realm(info.branch), { present: true, value: 'main', disabled: false });
  } finally { page.close(); }
});

test('lookalike triggers are not pickers: a different icon, a dialog-scoped copy and hidden copies are ignored', () => {
  const page = openPage(pickersPage() + trigger('hidden-trigger', 'radix-hidden', BOOK, 'Clyroas/hidden-copy', 'hidden'));
  try {
    const triggers = page.D.pickerTriggers();
    assert.equal(triggers.repo.el.id, 'repo-trigger');
    assert.equal(triggers.branch.el.id, 'branch-trigger');
    assert.equal(triggers.ambiguous, false);
    // A same-shaped button with an unrelated icon is just another control.
    assert.equal(page.window.document.getElementById('decoy-trigger') === triggers.repo.el, false);
  } finally { page.close(); }
});

test('two visible copies of one picker are ambiguity, not a first-match guess', () => {
  const page = openPage(pickersPage({ duplicate: true }));
  try {
    const triggers = page.D.pickerTriggers();
    assert.equal(triggers.ambiguous, true);
    const info = page.D.repoInfo();
    assert.deepEqual(realm(info.repo), { present: false, value: '', disabled: false });
    assert.deepEqual(realm(info.branch), { present: true, value: 'main', disabled: false });
  } finally { page.close(); }
});

test('a picker Arena has disabled is reported, never guessed around', () => {
  const page = openPage(pickersPage({ branchDisabled: true }));
  try {
    const info = page.D.repoInfo();
    assert.deepEqual(realm(info.branch), { present: true, value: 'main', disabled: true });
    assert.equal(page.D.enabled(page.window.document.getElementById('branch-trigger')), false);
  } finally { page.close(); }
});

test('the popover is found only through its own trigger state and aria-controls', () => {
  const page = openPage();
  try {
    assert.equal(page.D.pickerDialog('repo'), null);
    assert.equal(page.D.pickersOpen().length, 0);
    openDialog(page, 'radix-_r_6f_');
    assert.equal(page.D.pickerDialog('repo'), null, 'the trigger still reports data-state=closed');
    page.window.document.getElementById('repo-trigger').setAttribute('data-state', 'open');
    const dialog = page.D.pickerDialog('repo');
    assert.equal(dialog.id, 'radix-_r_6f_');
    assert.deepEqual(realm(page.D.pickersOpen()), ['repo']);
    // An unrelated visible dialog is never adopted as a picker.
    page.window.document.getElementById('unrelated').removeAttribute('hidden');
    assert.equal(page.D.pickersOpen().length, 1);
  } finally { page.close(); }
});

test('option rows are read with their label, meta and availability', () => {
  const page = openPage();
  try {
    openDialog(page, 'radix-_r_6f_');
    const doc = page.window.document;
    doc.getElementById('repo-trigger').setAttribute('data-state', 'open');
    const list = page.D.readPickerOptions(page.D.pickerDialog('repo'));
    assert.deepEqual(realm(list.options.map(option => option.label)),
      ['Clyroas/arena-agent-auto-v2.8.0', 'Clyroas/other-repo', 'Clyroas/archived-repo']);
    assert.equal(list.options[0].meta, 'Updated 2 days ago');
    assert.equal(list.options[0].disabled, false);
    assert.equal(list.options[2].disabled, true);
    assert.equal(list.query, '');
    doc.querySelector('#radix-_r_6f_ input').value = 'other';
    assert.equal(page.D.readPickerOptions(page.D.pickerDialog('repo')).query, 'other');
  } finally { page.close(); }
});

test('a popover without recognizable option rows is a coded refusal, not a scrape', () => {
  const page = openPage();
  try {
    const doc = page.window.document;
    openDialog(page, 'radix-_r_6f_');
    doc.getElementById('repo-trigger').setAttribute('data-state', 'open');
    doc.querySelector('#radix-_r_6f_ [role="listbox"]').remove();
    assert.throws(() => page.D.readPickerOptions(page.D.pickerDialog('repo')),
      error => error.code === 'PICKER_UNRECOGNIZED');
  } finally { page.close(); }
});

test('picking clicks exactly the one exact match, once', () => {
  const page = openPage();
  try {
    wireRadix(page.window);
    const doc = page.window.document;
    doc.getElementById('repo-trigger').click();
    const dialog = page.D.pickerDialog('repo');
    const target = [...doc.querySelectorAll('#radix-_r_6f_ [role="option"]')].find(el => el.dataset.value === 'Clyroas/other-repo');
    let clicks = 0;
    target.addEventListener('click', () => { clicks++; });
    assert.equal(page.D.pickPickerOption(dialog, 'Clyroas/other-repo'), 'Clyroas/other-repo');
    assert.equal(clicks, 1);
    // Whitespace differences do not create a second spelling of the same option.
    assert.equal(page.D.pickPickerOption(dialog, '  Clyroas/other-repo  '), 'Clyroas/other-repo');
    assert.equal(clicks, 2, 'each call is one explicit click; the adapter itself never repeats');
  } finally { page.close(); }
});

test('picking refuses unknown, duplicate and unavailable options without clicking', () => {
  const page = openPage();
  try {
    wireRadix(page.window);
    const doc = page.window.document;
    doc.getElementById('repo-trigger').click();
    const dialog = page.D.pickerDialog('repo');
    let clicks = 0;
    for (const option of doc.querySelectorAll('#radix-_r_6f_ [role="option"]')) option.addEventListener('click', () => { clicks++; });
    assert.throws(() => page.D.pickPickerOption(dialog, 'not/in-the-list'), error => error.code === 'PICKER_NOT_FOUND');
    assert.throws(() => page.D.pickPickerOption(dialog, ''), error => error.code === 'INVALID_PICK');
    assert.throws(() => page.D.pickPickerOption(dialog, 'Clyroas/archived-repo'), error => error.code === 'PICKER_OPTION_DISABLED');
    // A duplicate label is ambiguous: two rows now carry the same name.
    const twin = doc.createElement('div');
    twin.setAttribute('role', 'option');
    twin.innerHTML = '<span class="truncate">Clyroas/other-repo</span>';
    doc.querySelector('#radix-_r_6f_ [role="listbox"]').append(twin);
    assert.throws(() => page.D.pickPickerOption(dialog, 'Clyroas/other-repo'), error => error.code === 'PICKER_AMBIGUOUS');
    assert.equal(clicks, 0, 'no refusal path may click anything');
  } finally { page.close(); }
});

test('closing dispatches one Escape that the page itself honours', () => {
  const page = openPage();
  try {
    wireRadix(page.window);
    const doc = page.window.document;
    doc.getElementById('repo-trigger').click();
    const dialog = page.D.pickerDialog('repo');
    assert.ok(dialog, 'the fixture opened its popover');
    let escapes = 0;
    doc.addEventListener('keydown', event => { if (event.key === 'Escape') escapes++; });
    page.D.closePickerDialog(dialog);
    assert.equal(escapes, 1);
    assert.equal(page.D.pickerDialog('repo'), null, 'the popover is gone after the single Escape');
    page.D.closePickerDialog(page.D.pickerDialog('repo')); // an already-closed popover is a no-op
    assert.equal(escapes, 1);
  } finally { page.close(); }
});
