import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const preview = read('dev/preview.js');
const packaged = JSON.parse(read('extension-files.json'));

test('the glass study is opt-in, loaded after the real panel CSS, and never ships', () => {
  assert.match(preview, /new URLSearchParams\(location\.search\)\.get\('design'\) === 'glass'/);
  assert.match(preview, /asset\('\.\.\/panel\.css'\)[\s\S]*?if \(glassPreview\)[\s\S]*?liquid-glass-prototype\.css/);
  assert.ok(packaged.includes('panel.css'));
  assert.equal(packaged.some(file => file.startsWith('dev/') || file.includes('liquid-glass-prototype.css')), false);
  assert.doesNotMatch(read('panel.html'), /liquid-glass-prototype\.css/);
  assert.doesNotMatch(read('floating.html'), /liquid-glass-prototype\.css/);
});

test('the preview covers light and dark shell, conversation, cards, settings, and solid fallbacks', () => {
  const css = read('dev/liquid-glass-prototype.css');
  for (const selector of [':root[data-preview="glass"]', ':root[data-preview="glass"][data-theme="dark"]', '.toolbar', '.composer-dock', '.bubble.user',
    '.bubble.assistant', '.question-card', '.pending-reply', '.sheet', '.group', 'dialog'])
    assert.ok(css.includes(selector), `${selector} is missing from the glass study`);
  assert.match(css, /@supports\s+not\s*\(backdrop-filter:/);
  assert.match(css, /@media\s*\(prefers-contrast:\s*more\)/);
  assert.doesNotMatch(css, /\.turn\s*\{[^}]*backdrop-filter|\.bubble\.[a-z]+\s*\{[^}]*backdrop-filter/s,
    'repeated message rows must not each have a costly backdrop filter');
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i, 'preview must use only local assets');
});

test('the dev-only live preview root opens the glass study, not the default panel', () => {
  const server = read('dev/glass-preview-server.py');
  assert.match(server, /if self\.path == "\/":/);
  assert.match(server, /self\.send_header\("Location", "\/dev\/preview\.html\?design=glass"\)/);
  assert.equal(packaged.some(file => file.startsWith('dev/') || file === 'index.html'), false);
});

test('the real fake-port preview still exposes ready, streaming and error scenarios', () => {
  const page = read('dev/preview.html');
  for (const act of ['reply', 'tools', 'error']) assert.match(page, new RegExp(`data-act="${act}"`));
  assert.match(preview, /const acts = \{/);
  assert.match(preview, /await acts\.reply\(\)/);
});
