import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const approved = [
  'academy-guide', 'algorithmic-art', 'brand-guidelines', 'canvas-design', 'claude-api',
  'discernment-nudge', 'frontend-design', 'internal-comms', 'mcp-builder', 'skill-creator',
  'slack-gif-creator', 'theme-factory', 'web-artifacts-builder', 'webapp-testing'
];
const blocked = ['doc-coauthoring', 'docx', 'pdf', 'pptx', 'xlsx'];
const sourceUrl = 'https://github.com/anthropics/skills';
const pinnedRevision = '33375500bcea98d610eb30ce10ac4e59b89c390d';

function audit(manifest) {
  assert.equal(manifest.source, sourceUrl);
  assert.equal(manifest.revision, pinnedRevision, 'review and re-pin upstream before a source refresh');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.licenseFile, 'skill-sources/LICENSE-ANTHROPIC.txt');
  assert.deepEqual(manifest.skills, approved, 'only individually licensed and audited skills may enter the catalog');
  assert.equal(new Set(manifest.skills).size, approved.length);
  assert.deepEqual(Object.keys(manifest.excluded).sort(), blocked);
  for (const id of blocked) {
    assert.ok(!manifest.skills.includes(id), `${id} has no verified permission to ship`);
    assert.ok(manifest.excluded[id], `${id} must have a recorded exclusion reason`);
  }
}

test('the public example source has an exact pinned allow-list and excludes restricted/unlicensed skills', () => {
  const manifest = JSON.parse(read('skill-sources/manifest.json'));
  audit(manifest);
  assert.throws(() => audit({ ...manifest, skills: manifest.skills.filter(id => id !== 'academy-guide') }), /only individually licensed/);
  assert.throws(() => audit({ ...manifest, skills: [...manifest.skills, 'pdf'] }), /only individually licensed/);
  assert.throws(() => audit({ ...manifest, license: 'unknown' }), /Apache-2.0/);
});

test('the audited source keeps its Apache license and the current engineering pack keeps its MIT license', () => {
  assert.match(read('skill-sources/LICENSE-ANTHROPIC.txt'), /Apache License\s+Version 2\.0, January 2004/);
  assert.match(read('skill-sources/LICENSE-ANTHROPIC.txt'), /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(read('skill-sources/LICENSE-ANTHROPIC.txt'), /Copyright 2026 Anthropic, PBC\./);
  assert.match(read('.agents/LICENSE'), /MIT License/);
  assert.match(read('.agents/SOURCE.md'), /bcab6a1b8503100e8618c3b4e32cc78de43de769/);
});
