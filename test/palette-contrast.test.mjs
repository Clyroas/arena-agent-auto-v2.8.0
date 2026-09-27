import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The stylesheet has no build step and no linter of its own. stylesheet.test.mjs checks its structure
// (braces, custom properties, keyframes, the motion guards) but never its colour, so a token that is
// unreadable slipped through unnoticed: the light theme's secondary/tertiary text sat at 2.0–3.8:1 and
// every accent failed as text on its own tint. This file reads the tokens the panel actually uses out
// of panel.css and checks the pairs the interface actually renders against WCAG AA (4.5:1 for text,
// 3:1 for the graphics that carry state), compositing translucent colours the way Chrome will.
const raw = readFileSync(new URL('../panel.css', import.meta.url), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const TEXT = 4.5;
const GRAPHIC = 3;

const declarations = block => new Map([...block.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
function blockOf(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`panel.css no longer defines ${selector}`);
  const open = css.indexOf('{', start), close = css.indexOf('}', open);
  return declarations(css.slice(open + 1, close));
}
const rgb = value => {
  if (value && typeof value === 'object') return value; // already flattened by over()/blend()
  const text = String(value).trim();
  const hex = text.startsWith('#')
    ? (text.length === 4 ? [...text.slice(1)].map(char => char + char).join('') : text.slice(1))
    : null;
  if (hex) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  const match = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!match) throw new Error(`panel.css uses a colour this test cannot read: ${value}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
};
// A translucent colour over its backdrop is what the eye sees; Chrome never shows the raw value.
const flatten = (value, backdrop) => { const f = rgb(value), b = rgb(backdrop); return { r: f.a * f.r + (1 - f.a) * b.r, g: f.a * f.g + (1 - f.a) * b.g, b: f.a * f.b + (1 - f.a) * b.b, a: 1 }; };
const blend = (value, backdrop, share) => { const f = rgb(value), b = rgb(backdrop); return { r: f.r * share + b.r * (1 - share), g: f.g * share + b.g * (1 - share), b: f.b * share + b.b * (1 - share), a: 1 }; };
const luminance = ({ r, g, b }) => [r, g, b].map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background, backdrop) => {
  const fg = flatten(foreground, backdrop ?? background), bg = flatten(background, backdrop ?? background);
  const first = luminance(fg), second = luminance(bg);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};
// The one tint share each translucent surface is defined with, so a change to the token moves the test.
const shareOf = (token, colour) => {
  const match = new RegExp(`${token}\\s*:\\s*color-mix\\(in srgb,\\s*var\\(--${colour}\\)\\s*([\\d.]+)%`).exec(css);
  if (!match) throw new Error(`panel.css no longer tints ${colour} for ${token}`);
  return Number(match[1]) / 100;
};

const light = blockOf(':root {');
const dark = blockOf(':root[data-theme="dark"]');
// Every accent the Appearance setting offers. Blue is the default in :root, so it has no override
// block of its own; the other three carry one per theme.
const accents = ['blue', 'green', 'violet', 'amber'].map(name => {
  const lightBlock = css.includes(`:root[data-accent="${name}"]`) ? blockOf(`:root[data-accent="${name}"]`) : null;
  const darkBlock = css.includes(`:root[data-theme="dark"][data-accent="${name}"]`) ? blockOf(`:root[data-theme="dark"][data-accent="${name}"]`) : null;
  return { name, light: lightBlock?.get('--accent') || light.get('--accent'), dark: darkBlock?.get('--accent') || dark.get('--accent') };
});

const PROBLEMS = [];
// A readable form for a composited colour, so a failure names the two values the eye actually sees.
const describe = colour => {
  const { r, g, b } = rgb(colour);
  return '#' + [r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
};
const pair = (theme, accent, label, fg, bg, min) => {
  const ratio = contrast(fg, bg);
  if (ratio + 0.005 < min) PROBLEMS.push(`${theme}/${accent} ${label}: ${ratio.toFixed(2)}:1 (needs ${min}) — ${describe(fg)} on ${describe(bg)}`);
};
for (const [theme, base, accentsOf] of [['light', light, accent => accent.light], ['dark', dark, accent => accent.dark]]) {
  for (const accent of accents) {
    const tokens = new Map([...base, ['--accent', accentsOf(accent)]]);
    const value = name => {
      const found = tokens.get(name);
      if (!found) { PROBLEMS.push(`${theme}/${accent.name} ${name} is not defined`); return 'rgba(0, 0, 0, 0)'; }
      return found;
    };
    const over = (name, backdrop) => flatten(value(name), backdrop);
    // Opaque surfaces, in the order the panel stacks them.
    const bg = value('--bg'), surface = value('--surface');
    const sheet = over('--sheet', bg), glass = over('--glass', bg), glassStrong = over('--glass-strong', bg);
    const fillOnSurface = over('--fill', surface), fillOnBg = over('--fill', bg), fill2OnSurface = over('--fill-2', surface);
    const notice = blend(value('--orange'), surface, shareOf('--notice-bg', 'orange'));
    const error = blend(value('--red'), surface, shareOf('--error-bg', 'red'));
    const accentSoft = blend(value('--accent'), surface, shareOf('--accent-soft', 'accent'));

    for (const [name, surfaceValue] of [['bg', bg], ['surface', surface], ['sheet', sheet], ['glass', glass], ['glassStrong', glassStrong], ['fill', fillOnSurface], ['fill over background', fillOnBg], ['fill2', fill2OnSurface], ['notice', notice], ['error', error]])
      pair(theme, accent.name, `--label on ${name}`, value('--label'), surfaceValue, TEXT);
    for (const [name, surfaceValue] of [['bg', bg], ['surface', surface], ['sheet', sheet], ['glassStrong', glassStrong], ['fill', fillOnSurface], ['fill2', fill2OnSurface]])
      pair(theme, accent.name, `--secondary on ${name}`, value('--secondary'), surfaceValue, TEXT);
    for (const [name, surfaceValue] of [['bg', bg], ['surface', surface], ['sheet', sheet], ['glassStrong', glassStrong], ['fill2', fill2OnSurface]])
      pair(theme, accent.name, `--tertiary on ${name}`, value('--tertiary'), surfaceValue, TEXT);
    for (const [name, surfaceValue] of [['bg', bg], ['surface', surface], ['sheet', sheet], ['glassStrong', glassStrong], ['fill', fillOnSurface], ['fill over background', fillOnBg]])
      pair(theme, accent.name, `--accent as text on ${name}`, value('--accent'), surfaceValue, TEXT);
    pair(theme, accent.name, '--accent as text on --accent-soft', value('--accent'), accentSoft, TEXT);
    pair(theme, accent.name, '--accent-ink on --accent', value('--accent-ink'), value('--accent'), TEXT);
    pair(theme, accent.name, '--accent-ink on the imported bubble', value('--accent-ink'), blend(value('--accent'), value('--gray'), 0.78), TEXT);
    for (const [name, surfaceValue] of [['surface', surface], ['bg', bg], ['sheet', sheet], ['glassStrong', glassStrong], ['fill', fillOnSurface], ['error', error]])
      pair(theme, accent.name, `--danger-ink on ${name}`, value('--danger-ink'), surfaceValue, TEXT);
    for (const [name, surfaceValue] of [['surface', surface], ['bg', bg], ['fill2', fill2OnSurface]])
      pair(theme, accent.name, `--warning-ink on ${name}`, value('--warning-ink'), surfaceValue, TEXT);
    // State graphics: the focus ring, the status dots and the two glyph inks on the mid-grey fills.
    pair(theme, accent.name, '--accent vs --surface (ring/dot)', value('--accent'), surface, GRAPHIC);
    pair(theme, accent.name, '--surface ink on --tertiary fill', surface, over('--tertiary', surface), GRAPHIC);
    pair(theme, accent.name, '--surface ink on --secondary fill', surface, over('--secondary', surface), GRAPHIC);
    pair(theme, accent.name, 'white glyph on the --green badge', '#ffffff', value('--green'), GRAPHIC);
    pair(theme, accent.name, '--green dot on the live panel', value('--green'), fill2OnSurface, GRAPHIC);
    pair(theme, accent.name, 'white glyph on the --red badge', '#ffffff', value('--red'), GRAPHIC);
    pair(theme, accent.name, '--red glyph on the live panel', value('--red'), fill2OnSurface, GRAPHIC);
  }
}

test('every text and state-graphic pair the panel renders meets WCAG AA', () => {
  assert.deepEqual(PROBLEMS, [], 'these token pairs are below the contrast the panel needs');
});

test('the tokens the contrast rules depend on still exist', () => {
  for (const token of ['--label', '--secondary', '--tertiary', '--accent', '--accent-ink', '--danger-ink', '--warning-ink', '--green', '--red', '--orange', '--gray', '--surface', '--bg', '--fill', '--fill-2', '--sheet', '--glass', '--glass-strong'])
    assert.ok(light.get(token), `panel.css must define ${token} in the light theme`);
  for (const token of ['--label', '--secondary', '--tertiary', '--accent', '--accent-ink', '--danger-ink', '--warning-ink'])
    assert.ok(dark.get(token), `panel.css must define ${token} in the dark theme`);
  assert.equal(accents.filter(accent => accent.light && accent.dark).length, 4, 'all four accent choices must exist in both themes');
});
