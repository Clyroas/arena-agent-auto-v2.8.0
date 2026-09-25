import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The version string is part of the wire protocol: the panel refuses an adapter that does not report the
// same version (VERSION_MISMATCH) and the worker refuses a page whose injected script did not register it
// (SCRIPT_REGISTRATION_FAILED). A version bump that misses one of these anchors disables the extension at
// runtime, so every anchor is checked here instead.
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const version = manifest.version;

test('the manifest declares a version Chrome accepts', () => {
  assert.match(version, /^\d+(?:\.\d+){0,3}$/);
  assert.equal(pkg.version, version, 'package.json and the manifest must not drift apart');
});

test('every runtime version anchor matches the manifest', () => {
  const anchors = [
    ['agent-client.js', /ADAPTER_VERSION = '([^']+)'/],
    ['attachment.js', /ADAPTER_VERSION = '([^']+)'/],
    ['attachment-policy.js', /const VERSION = '([^']+)'/],
    ['agent-dom.js', /globalThis\.ArenaAgentDOM = \{ version: '([^']+)'/],
    ['agent-content.js', /const VERSION = '([^']+)'/],
    ['agent-content.js', /adapterVersion: '([^']+)'/],
    ['panel.js', /content script v([\d.]+) verified/],
    ['panel.html', /<title>Arena Auto Chat · ([\d.]+)<\/title>/],
    ['panel.html', /<strong id="version">v([\d.]+)<\/strong>/],
    ['floating.html', /<title>Floating · Arena Auto Chat · ([\d.]+)<\/title>/],
    ['floating.html', /<strong id="version">v([\d.]+)<\/strong>/],
    ['manifest.json', /"default_title": "Arena Auto Chat · ([\d.]+)"/]
  ];
  for (const [file, pattern] of anchors) {
    const match = pattern.exec(read(file));
    assert.ok(match, `${file} is missing the version anchor ${pattern}`);
    assert.equal(match[1], version, `${file} reports ${match[1]} but the manifest says ${version}`);
  }
});

test('the files Chrome loads are exactly the files in the repository', () => {
  // No build step: the manifest must point at files that exist, and every content script must be present.
  const files = [manifest.background?.service_worker, manifest.side_panel?.default_path,
    ...Object.values(manifest.action?.default_icon || {}), ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap(entry => entry.js || []), manifest.content_security_policy ? 'panel.html' : null];
  for (const file of files.filter(Boolean)) assert.doesNotThrow(() => read(file), `${file} is referenced by the manifest but missing`);
  for (const script of manifest.content_scripts[0].js) {
    assert.ok(/^[a-zA-Z0-9._-]+\.js$/.test(script), `${script} must be a plain file name`);
  }
});

test('the extension asks only for the permissions it uses', () => {
  assert.deepEqual(manifest.permissions.sort(), ['scripting', 'sidePanel']);
  assert.deepEqual(manifest.host_permissions, ['https://arena.ai/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['<all_urls>']);
  assert.equal(manifest.manifest_version, 3);
  // Extension pages must not be able to talk to the network: nothing but the packaged code runs there.
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
});
