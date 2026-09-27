import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const files = JSON.parse(read('extension-files.json'));
const manifest = JSON.parse(read('manifest.json'));

test('release allow-list contains manifest entries and every packaged code/style/markup dependency', () => {
  const included = new Set(files);
  assert.equal(files.length, included.size);
  for (const path of [manifest.background.service_worker, manifest.side_panel.default_path, ...manifest.content_scripts.flatMap(entry => entry.js), ...Object.values(manifest.icons)])
    assert.ok(included.has(path), `Missing manifest file: ${path}`);
  for (const file of files) {
    assert.doesNotThrow(() => read(file));
    assert.equal(/(?:^|\/)(?:node_modules|dev|test|scripts|\.git)(?:\/|$)/.test(file), false);
    const contents = /\.(js|html|css)$/.test(file) ? read(file) : '';
    const patterns = file.endsWith('.js') ? [/\b(?:from|import)\s*['"](\.\/[^'"]+)['"]/g]
      : file.endsWith('.html') ? [/(?:src|href)="([^"#]+)"/g]
        : file.endsWith('.css') ? [/url\(["']?([^"')]+)["']?\)/g] : [];
    for (const pattern of patterns) for (const match of contents.matchAll(pattern)) {
      if (/^(?:https?:|blob:|data:)/.test(match[1])) continue;
      const dependency = posix.normalize(posix.join(posix.dirname(file), match[1]));
      assert.ok(included.has(dependency), `${file} depends on unpackaged ${dependency}`);
    }
  }
});

test('side-panel and floating-window controls have the same IDs', () => {
  const ids = file => [...read(file).matchAll(/\bid="([^"]+)"/g)].map(match => match[1]).filter(id => id !== 'window-status').sort();
  assert.deepEqual(ids('panel.html'), ids('floating.html'));
});
