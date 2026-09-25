import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The stylesheet has no build step and no linter of its own, so the mistakes that silently break the
// panel are checked here: a typo in a custom property name, an animation that points at a keyframes
// block that was renamed away, an unbalanced brace that swallows the rules after it - and that the
// accessibility escape hatch for motion is still in place. The motion added on top of the original
// design is CSS-only, so this file is what keeps it honest.
const raw = readFileSync(new URL('../panel.css', import.meta.url), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const MOTION_START = raw.indexOf('/* ---------- Motion (v2.8.x)');
const motion = MOTION_START < 0 ? '' : raw.slice(MOTION_START).replace(/\/\*[\s\S]*?\*\//g, '');

// Custom properties Chrome itself defines, plus the one this stylesheet registers with @property.
const EXTERNAL = new Set(['--glow-angle']);
// Animation names the shorthand may contain that are not keyframes.
const KEYWORDS = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'infinite', 'both',
  'forwards', 'backwards', 'normal', 'reverse', 'alternate', 'paused', 'running', 'step-end', 'step-start', 'steps', 'cubic-bezier', 'var']);
// Properties a keyframes block may animate. Layout properties would make the panel janky exactly when
// Arena is already re-rendering the page for a stream.
const ANIMATABLE = new Set(['opacity', 'transform', 'translate', 'rotate', 'scale', 'filter', 'color', 'background-color', 'background-position',
  'box-shadow', 'visibility']);

// Returns the body of the first block after `startIndex` by counting braces, so single-line and
// multi-line blocks are both handled.
function blockAt(source, startIndex) {
  const open = source.indexOf('{', startIndex);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(open + 1, index);
  }
  return null;
}
const keyframeBlocks = source => new Map([...source.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map(match => [match[1], blockAt(source, match.index) || '']));
// Every `animation:` shorthand in a stylesheet, as { value, selector } pairs.
function animations(source) {
  const found = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*(?:animation(?:-name)?\s*:[^;}]+)[^{}]*)\}/g)) {
    const selector = match[1].split(/[;}]/).pop().trim();
    for (const declaration of match[2].matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) found.push({ selector, value: declaration[1].trim() });
  }
  return found;
}

test('braces are balanced', () => {
  let depth = 0;
  for (const [index, char] of [...css].entries()) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    assert.ok(depth >= 0, `an extra closing brace appears near character ${index}`);
  }
  assert.equal(depth, 0, 'a block was left unclosed');
});

test('every custom property that is read is also defined', () => {
  const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map(match => match[1]));
  const missing = new Set();
  for (const match of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
    if (!defined.has(match[1]) && !match[2] && !EXTERNAL.has(match[1])) missing.add(match[1]);
  }
  assert.deepEqual([...missing], [], 'these custom properties are used but never defined (a typo would fail silently)');
});

test('every animation refers to a keyframes block that exists', () => {
  const keyframes = new Set(keyframeBlocks(css).keys());
  const unknown = new Set();
  for (const { value } of animations(css)) {
    // `cubic-bezier(.2, .8, .2, 1)` and `steps(4)` are not animation names: drop functions first.
    for (const token of value.replace(/[a-z-]+\([^)]*\)/gi, ' ').split(/[\s,]+/)) {
      if (!token || KEYWORDS.has(token) || keyframes.has(token) || /^[0-9.]+m?s$/.test(token) || /^[0-9.]+$/.test(token)) continue;
      unknown.add(token);
    }
  }
  assert.deepEqual([...unknown], [], 'these animation names have no matching @keyframes');
});

test('the motion layer only animates compositor-friendly properties', () => {
  const violations = [];
  for (const [name, body] of keyframeBlocks(css)) {
    for (const declaration of body.matchAll(/([a-zA-Z-]+)\s*:/g)) {
      const property = declaration[1];
      if (ANIMATABLE.has(property) || property.startsWith('--')) continue; // --glow-angle drives a gradient, not layout
      violations.push(`${name} animates ${property}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('reduced-motion still disables the whole motion layer', () => {
  const guard = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\*,[\s\S]*?animation-duration:\s*\.001ms\s*!important/.test(css);
  assert.ok(guard, 'the global prefers-reduced-motion override must stay, or every new animation ignores the user’s setting');
  assert.match(css, /animation-iteration-count:\s*1\s*!important/);
  assert.match(css, /transition-duration:\s*\.001ms\s*!important/);
});

test('interface motion stays short, and only ambient motion loops', () => {
  // A taste guard: anything that signals a change (a reply arriving, a card appearing, a button becoming
  // usable) must be snappy. Continuous animations are the deliberate exceptions (the glow, the shimmer,
  // the caret, the breathing thought label, the notice ping) and carry `infinite` or a repeat count.
  const slow = [];
  for (const { value } of animations(css)) {
    if (/infinite/.test(value)) continue;
    const iterations = value.split(/[\s,]+/).filter(token => /^[0-9]+$/.test(token));
    if (iterations.length) continue;
    for (const duration of value.matchAll(/(?<![\d.])([0-9]*\.?[0-9]+)s(?![\w-])/g)) {
      if (Number(duration[1]) > .6) slow.push(`"${value}" is ${duration[1]}s`);
    }
  }
  assert.deepEqual(slow, []);
});

test('the new motion layer is bound to state that changes once per event', () => {
  // The panel re-renders on every live update. An animation keyed off a selector that stays true would
  // not replay (that is fine), but one keyed off a class the render loop rewrites would twitch. Each rule
  // in the motion section must therefore hang off state (hidden/aria/data/class) or an element that is
  // created once per event - never off a bare element that is re-rendered in place.
  const CREATED_ONCE = new Set(['.arrive', '.chat-empty > *', '.chat-empty .empty-orb', '.live-output', '.question-card', '.assistant-message',
    '.assistant-mark', '.attachment-chip', '.history-import']);
  // Classes the panel adds for exactly one event and never rewrites in place.
  const STATE_CLASSES = /(?:^|\.)(?:tool-new|streaming|fresh)(?:[.:\s]|$)/;
  const risky = [];
  for (const { selector } of animations(motion)) {
    if (/\[|:not\(|:nth-child|:has\(|:first-child|:last-child|^\.live|^dialog/.test(selector)) continue;
    if (CREATED_ONCE.has(selector) || STATE_CLASSES.test(selector)) continue;
    risky.push(selector);
  }
  assert.deepEqual(risky, [], 'bind these animations to a state change, or document them as created-once elements');
});

test('the motion layer does not touch the layout the transcript depends on', () => {
  // ConversationView measures the scroller and the composer to keep the view pinned to the newest reply.
  // Any animation that changes an element's size would fight that measurement.
  const banned = /(?:^|[;{])\s*(width|height|margin|padding|top|left|right|bottom|font-size|line-height)\s*:/;
  for (const [name, body] of keyframeBlocks(css)) assert.doesNotMatch(body, banned, `${name} animates a layout property`);
});
