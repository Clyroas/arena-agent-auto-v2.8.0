import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const agents = join(root, '.agents');
const skillsDir = join(agents, 'skills');
const referencesDir = join(agents, 'references');
const commandsDir = join(agents, 'commands');
const read = file => readFileSync(join(root, file), 'utf8');

const EXPECTED_SKILLS = [
  'api-and-interface-design',
  'browser-testing-with-devtools',
  'ci-cd-and-automation',
  'code-review-and-quality',
  'code-simplification',
  'constraint-driven-development',
  'context-engineering',
  'debugging-and-error-recovery',
  'deprecation-and-migration',
  'documentation-and-adrs',
  'doubt-driven-development',
  'frontend-ui-engineering',
  'git-workflow-and-versioning',
  'idea-refine',
  'incremental-implementation',
  'interview-me',
  'observability-and-instrumentation',
  'performance-optimization',
  'planning-and-task-breakdown',
  'security-and-hardening',
  'shipping-and-launch',
  'source-driven-development',
  'spec-driven-development',
  'test-driven-development',
  'using-agent-skills'
];

const EXPECTED_REFERENCES = [
  'accessibility-checklist.md',
  'definition-of-done.md',
  'observability-checklist.md',
  'orchestration-patterns.md',
  'performance-checklist.md',
  'security-checklist.md',
  'testing-patterns.md'
];

const EXPECTED_COMMANDS = [
  'build.md',
  'code-simplify.md',
  'constraints.md',
  'plan.md',
  'review.md',
  'ship.md',
  'spec.md',
  'test.md',
  'webperf.md'
];

const dirs = path => readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()).sort();
const files = path => readdirSync(path).filter(name => statSync(join(path, name)).isFile()).sort();

test('vendors all 25 Addy Osmani agent skills', () => {
  assert.deepEqual(dirs(skillsDir), EXPECTED_SKILLS);
});

test('each skill has SKILL.md whose frontmatter name matches the directory', () => {
  for (const name of EXPECTED_SKILLS) {
    const text = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
    const match = /^---\r?\nname:\s*(\S+)\s*\r?\n/.exec(text);
    assert.ok(match, `${name} is missing YAML name frontmatter`);
    assert.equal(match[1], name);
  }
});

test('shared checklists and lifecycle commands are present', () => {
  assert.deepEqual(files(referencesDir), EXPECTED_REFERENCES);
  assert.deepEqual(files(commandsDir), EXPECTED_COMMANDS);
  assert.ok(existsSync(join(agents, 'LICENSE')));
  const source = read('.agents/SOURCE.md');
  assert.match(source, /addyosmani\/agent-skills/);
  assert.match(source, /0\.6\.10/);
  assert.match(source, /bcab6a1b8503100e8618c3b4e32cc78de43de769/);
});

test('relative reference links from skills resolve on disk', () => {
  const link = /(?:`|\()((?:\.\.\/)*references\/[A-Za-z0-9._-]+\.md)(?:`|#|\))/g;
  let checked = 0;
  for (const name of EXPECTED_SKILLS) {
    const skillRoot = join(skillsDir, name);
    const stack = [skillRoot];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(path);
          continue;
        }
        if (!entry.name.endsWith('.md')) continue;
        const text = readFileSync(path, 'utf8');
        for (const match of text.matchAll(link)) {
          checked += 1;
          const target = join(path, '..', match[1]);
          assert.ok(existsSync(target), `${path} links to missing ${match[1]}`);
        }
      }
    }
  }
  assert.ok(checked >= 20, `expected skill-pack reference links, found ${checked}`);
});

test('lifecycle command reference links resolve', () => {
  const link = /(?:`|\()((?:\.\.\/)*references\/[A-Za-z0-9._-]+\.md)(?:`|#|\))/g;
  for (const name of EXPECTED_COMMANDS) {
    const path = join(commandsDir, name);
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(link)) {
      assert.ok(existsSync(join(path, '..', match[1])), `${name} links to missing ${match[1]}`);
    }
  }
});

test('the skill pack is not part of the unpacked extension', () => {
  const packaged = JSON.parse(read('extension-files.json'));
  assert.equal(packaged.some(file => file === 'AGENTS.md' || file.startsWith('.agents/') || file.startsWith('skills/')), false);
  assert.match(read('AGENTS.md'), /\.agents\/skills\//);
});
