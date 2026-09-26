// Derives the side panel's ready-made task prompts from the vendored addyosmani/agent-skills pack.
//
// The pack itself is never shipped in the extension (AGENTS.md: "Do not ship skills in the
// extension"), so it cannot be read at runtime. This script turns each SKILL.md and lifecycle
// command into one insertable prompt and writes the result to skill-presets.js, which IS packaged.
// Keeping one derivation instead of a hand-maintained copy means a pack refresh updates the panel:
//
//   npm run build:presets      # regenerate skill-presets.js
//   npm test                   # test/skill-presets.test.mjs fails if the file drifted
//
// Pure module: importing it reads nothing and touches nothing. Only the CLI branch below writes.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = join(root, '.agents');
const target = join(root, 'skill-presets.js');

// The phase column of the table in AGENTS.md. Presets are grouped by it, in this order.
export const GROUP_ORDER = ['Lifecycle', 'Discover', 'Define', 'Plan', 'Build', 'Verify', 'Review', 'Ship'];

// skill name -> phase. test/skill-presets.test.mjs checks this map against AGENTS.md, so a skill
// that changes phase upstream is a one-line edit here rather than a silent mis-grouping.
export const SKILL_PHASE = {
  'using-agent-skills': 'Discover',
  'interview-me': 'Define',
  'idea-refine': 'Define',
  'spec-driven-development': 'Define',
  'constraint-driven-development': 'Define',
  'planning-and-task-breakdown': 'Plan',
  'incremental-implementation': 'Build',
  'test-driven-development': 'Build',
  'frontend-ui-engineering': 'Build',
  'api-and-interface-design': 'Build',
  'context-engineering': 'Build',
  'source-driven-development': 'Build',
  'doubt-driven-development': 'Build',
  'debugging-and-error-recovery': 'Verify',
  'browser-testing-with-devtools': 'Verify',
  'code-review-and-quality': 'Review',
  'code-simplification': 'Review',
  'security-and-hardening': 'Review',
  'performance-optimization': 'Review',
  'git-workflow-and-versioning': 'Ship',
  'ci-cd-and-automation': 'Ship',
  'deprecation-and-migration': 'Ship',
  'documentation-and-adrs': 'Ship',
  'observability-and-instrumentation': 'Ship',
  'shipping-and-launch': 'Ship'
};

const ACRONYMS = { api: 'API', ci: 'CI', cd: 'CD', adrs: 'ADRs', ui: 'UI', tdd: 'TDD', owasp: 'OWASP', devtools: 'DevTools' };
const SMALL_WORDS = new Set(['and', 'or', 'the', 'of', 'with', 'for', 'in', 'to', 'a', 'an', 'on', 'vs']);

const files = dir => readdirSync(dir).filter(name => name.endsWith('.md')).sort();

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fields = {};
  if (match) for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

// The first paragraph under "## Overview" reads as a plain statement of what the workflow is, which
// is exactly the context a prompt needs. Later paragraphs are procedure the skill itself carries.
function overviewParagraph(text) {
  const start = text.search(/^## Overview\s*$/m);
  if (start < 0) return '';
  const body = text.slice(start).replace(/^## Overview[^\n]*\n/, '');
  const next = body.search(/^#{2,3}\s/m);
  const section = next < 0 ? body : body.slice(0, next);
  const paragraph = section.split(/\n\s*\n/).map(part => part.trim()).find(Boolean) || '';
  return paragraph.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
}

// Frontmatter descriptions open with a sentence, then list triggers. Only the sentence is useful.
function firstSentence(text) {
  const match = /^.+?[.!?](?:\s|$)/.exec(String(text || '').replace(/\s+/g, ' ').trim());
  return (match ? match[0] : String(text || '')).trim();
}

function titleFromId(id) {
  const words = id.split('-');
  return words.map((word, index) => {
    const lower = ACRONYMS[word] ? ACRONYMS[word] : word.charAt(0).toUpperCase() + word.slice(1);
    return index > 0 && SMALL_WORDS.has(word) ? word : lower;
  }).join(' ');
}

// Provenance from .agents/SOURCE.md, so the shipped file records exactly which pack it came from.
function packSource() {
  const text = readFileSync(join(agentsDir, 'SOURCE.md'), 'utf8');
  const version = /\|\s*Plugin version\s*\|\s*([^|\s]+)/.exec(text)?.[1] || 'unknown';
  const commit = /`([0-9a-f]{7,40})`/.exec(text)?.[1] || 'unknown';
  return `addyosmani/agent-skills ${version} · ${commit}`;
}

const SKILL_TAIL = 'Apply it in order to my task below. State the assumptions you are making before you start, and stop to ask before any step that would change scope or decide something I have not decided.';
const COMMAND_TAIL = 'Start with the clarifying questions it asks for before producing anything, then follow it in order on my task below.';

export function buildSkillPresets() {
  const presets = [];

  for (const name of files(join(agentsDir, 'commands'))) {
    const id = name.replace(/\.md$/, '');
    const meta = frontmatter(readFileSync(join(agentsDir, 'commands', name), 'utf8'));
    presets.push({
      id: `command:${id}`,
      kind: 'command',
      label: `/${id}`,
      group: 'Lifecycle',
      summary: firstSentence(meta.description) || 'A lifecycle entry point from the agent-skills pack.',
      prompt: [`Run the "/${id}" workflow from the agent-skills pack.`, firstSentence(meta.description), COMMAND_TAIL, 'My task:'].filter(Boolean).join('\n\n')
    });
  }

  for (const name of readdirSync(join(agentsDir, 'skills')).sort()) {
    const dir = join(agentsDir, 'skills', name);
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const meta = frontmatter(text);
    const phase = SKILL_PHASE[meta.name];
    if (!phase) throw new Error(`${name} has no phase in SKILL_PHASE — add it so the prompt is grouped`);
    presets.push({
      id: `skill:${meta.name}`,
      kind: 'skill',
      label: titleFromId(meta.name),
      group: phase,
      summary: firstSentence(meta.description) || 'A workflow from the agent-skills pack.',
      prompt: [`Follow the "${meta.name}" workflow from the agent-skills pack (phase: ${phase}).`, overviewParagraph(text), SKILL_TAIL, 'My task:'].filter(Boolean).join('\n\n')
    });
  }

  // Commands first (they are the entry points), then skills in lifecycle order, then pack order.
  const rank = preset => GROUP_ORDER.indexOf(preset.group);
  presets.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  for (const preset of presets) {
    preset.search = [preset.label, preset.id, preset.group, preset.summary, preset.kind].join(' ').toLowerCase();
  }
  return presets;
}

export function renderSkillPresetsModule() {
  const presets = buildSkillPresets();
  const body = presets.map(preset => `  {\n${Object.entries(preset)
    .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`).join(',\n')}\n  }`).join(',\n');
  return `// GENERATED by scripts/build-skill-presets.mjs from the vendored ${packSource()} pack.
// Do not edit by hand: run \`npm run build:presets\`. test/skill-presets.test.mjs regenerates this
// text and fails when it no longer matches .agents/, so a pack refresh cannot silently go stale.
//
// The pack itself is never packaged (AGENTS.md). This module is the only part of it that ships, and
// it holds no chat content: every string below is a fixed instruction template the panel inserts
// into the composer on an explicit click. Nothing is sent from here.

export const SKILL_PRESETS_SOURCE = ${JSON.stringify(packSource())};

export const SKILL_PRESETS = Object.freeze([
${body}
]);

export const PRESET_GROUPS = Object.freeze(${JSON.stringify(GROUP_ORDER)});

// One draft at a time: a preset either appends after what you already typed or starts a fresh
// message, and it refuses to push the draft over Arena's limit instead of silently truncating.
export function composePresetText(draft, preset, limit) {
  const current = String(draft || '');
  const text = current.trim() ? \`\${current.replace(/\\s+$/, '')}\\n\\n\${preset.prompt}\` : preset.prompt;
  if (text.length > limit) return { ok: false, text, overflow: text.length - limit };
  return { ok: true, text, overflow: 0 };
}

export function findPresets(query, presets = SKILL_PRESETS) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return presets;
  return presets.filter(preset => preset.search.includes(needle));
}
`;
}

if (process.argv[1] && /build-skill-presets\.mjs$/.test(process.argv[1])) {
  const written = renderSkillPresetsModule();
  writeFileSync(target, written);
  console.info(`Wrote ${relative(root, target)} (${buildSkillPresets().length} prompts from ${packSource()}).`);
}
