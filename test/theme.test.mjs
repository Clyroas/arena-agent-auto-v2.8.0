import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// theme.js runs in the <head> of panel.html and floating.html before first paint. Since v2.10.0 the
// design language is dark-only (spec/rog-design-language.md D2): whatever a user has stored — legacy
// "light", "dark", "system", or nothing — must resolve to the dark theme with no light flash, while
// the setting control itself stays discoverable (AGENTS.md) and cross-window storage sync keeps working.
const source = readFileSync(new URL('../theme.js', import.meta.url), 'utf8');

function boot({ stored = undefined, mediaMatches = false } = {}) {
  const dom = new JSDOM('<!doctype html><html data-theme=""><body></body></html>', { url: 'https://example.test/' });
  const { window } = dom;
  const listeners = [];
  window.matchMedia = () => ({ matches: mediaMatches, addEventListener: (_event, handler) => listeners.push(handler) });
  if (stored !== undefined) window.localStorage.setItem('arenaAgentTheme', stored);
  window.eval(source);
  return {
    window,
    document: window.document,
    fireMediaChange: (matches) => {
      for (const handler of listeners) handler({ matches });
    },
  };
}

test('every stored preference resolves to the dark theme', () => {
  for (const stored of ['light', 'dark', 'system', 'bogus', undefined]) {
    const { document } = boot({ stored });
    assert.equal(document.documentElement.dataset.theme, 'dark', `stored ${String(stored)} must render dark`);
  }
});

test('the OS colour scheme never changes the resolved theme', () => {
  for (const mediaMatches of [true, false]) {
    const { document, fireMediaChange } = boot({ stored: 'system', mediaMatches });
    assert.equal(document.documentElement.dataset.theme, 'dark');
    fireMediaChange(!mediaMatches);
    assert.equal(document.documentElement.dataset.theme, 'dark', 'a media change must not resurrect a light theme');
  }
});

test('the raw preference is still recorded on the element', () => {
  // The select keeps showing what the user chose (control stays discoverable); only rendering changed.
  const { document } = boot({ stored: 'light' });
  assert.equal(document.documentElement.dataset.themePreference, 'light');
});

test('storage events between panel and floating window keep resolving to dark', () => {
  const { window, document } = boot({ stored: 'dark' });
  window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'arenaAgentTheme', newValue: 'light' }));
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.documentElement.dataset.themePreference, 'light');
});
