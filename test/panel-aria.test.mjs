import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// The panel's markup is a contract no other test reads as a whole: panel-lifecycle.test.mjs drives the
// behaviour and conversation-view/live-view build their own fragments. Two accessibility mistakes that
// a live panel had - a dialog with no accessible name, and option rows whose role replaced the button
// they were - are invisible to a behavioural test, because both still work with a mouse. This file
// reads the real markup the way an assistive technology would.
const html = readFileSync(new URL('../panel.html', import.meta.url), 'utf8');
const dom = new JSDOM(html);
const { document } = dom.window;

// Roles an author may put on an element without destroying what it is. A <button> is a control first:
// overriding it with a structural role (listitem, option, presentation) is a conformance error and
// removes the one affordance the user needs.
const ROLE_REPLACES_CONTROL = new Set(['listitem', 'list', 'option', 'presentation', 'none', 'paragraph', 'region', 'group']);

test('every dialog can be announced by name', () => {
  const dialogs = [...document.querySelectorAll('dialog,[role="dialog"]')];
  assert.ok(dialogs.length >= 4, 'the panel keeps its sheet and its three dialogs');
  for (const dialog of dialogs) {
    const label = dialog.getAttribute('aria-label');
    const labelledby = dialog.getAttribute('aria-labelledby');
    const name = label || (labelledby ? labelledby.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || '').join(' ') : '');
    assert.ok(name, `${dialog.id || dialog.tagName} must have an accessible name (aria-label or aria-labelledby with text)`);
  }
});

test('no control has its role replaced by a structural one', () => {
  for (const element of document.querySelectorAll('button,a[href],input,select,textarea,summary')) {
    const role = element.getAttribute('role');
    assert.ok(!role || !ROLE_REPLACES_CONTROL.has(role),
      `${element.tagName.toLowerCase()}#${element.id || '(no id)'} carries role="${role}", which erases the control's own semantics`);
  }
});

test('every aria-* id reference resolves', () => {
  for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      for (const id of element.getAttribute(attribute).split(/\s+/).filter(Boolean)) {
        assert.ok(document.getElementById(id), `${attribute}="${id}" on ${element.tagName.toLowerCase()}#${element.id} points at nothing`);
      }
    }
  }
});

test('ids are unique, so a reference can never land on the wrong element', () => {
  const seen = new Map();
  for (const element of document.querySelectorAll('[id]')) {
    assert.ok(!seen.has(element.id), `#${element.id} appears more than once`);
    seen.set(element.id, element);
  }
});

test('every form control has a label or an accessible name', () => {
  for (const control of document.querySelectorAll('input,select,textarea')) {
    if (control.closest('[aria-hidden="true"]')) continue; // the file input is driven by its own button
    const labelled = control.labels?.length || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby');
    assert.ok(labelled, `${control.tagName.toLowerCase()}#${control.id} has no label or accessible name`);
  }
});

test('the interactive elements that need a name have one', () => {
  for (const element of document.querySelectorAll('button,a[href]')) {
    const name = element.getAttribute('aria-label') || element.textContent.trim() || element.getAttribute('title') || '';
    assert.ok(name, `${element.tagName.toLowerCase()}#${element.id} would be announced with no name`);
  }
});

test('the status regions that announce changes keep their live behaviour', () => {
  for (const id of ['chat-announcement', 'notice', 'status', 'prompt-count', 'attachment-status', 'shot-status'])
    assert.ok(document.getElementById(id), `#${id} is part of how the panel reports itself`);
  assert.match(html, /aria-live="polite"/, 'the polite live regions must stay');
  assert.match(html, /id="chat-scroll"[^>]*tabindex="0"/, 'the transcript must stay keyboard-scrollable');
});
