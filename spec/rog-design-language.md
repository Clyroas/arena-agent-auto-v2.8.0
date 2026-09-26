# SPEC: ROG Design Language Replacement (v2.10.0)

Status: **APPROVED** (human: "6 yes, go" + earlier "1–5 confirmed") · Phase: build (incremental-implementation)
Source: chat spec draft (turn "Full design language replacement…") + resolved decisions below.

## 1. Objective

Replace the Arena Auto Chat panel/floating-window visual design with a dark-first,
high-contrast ROG (Republic of Gamers) design language. Pure style overhaul: CSS custom
properties, component rules, SVG icon geometry, and raster toolbar icons. No functional,
protocol, or layout-contract changes.

## 2. Resolved decisions (from the human)

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Style depth | **Full design language replacement** (not an overlay, not an added theme option) |
| D2 | Light mode | **Remove it entirely** — dark-only UI |
| D3 | Icons | **Redraw all SVG icons** angular/geometric; regenerate raster toolbar PNGs |
| D4 | Version | **Bump to 2.10.0** (minor): wire-protocol version change, lockstep across all anchors |
| D5 | Accent picker (derived from D1+D2, flagged for confirmation) | The blue/green/violet/amber accent **selector is removed**; red becomes *the* accent. Rationale: keeping four non-ROG accents contradicts "full replacement"; keeping only red makes the picker dead UI. |

## 3. Assumptions

1. "Full UI" = extension surfaces (`panel.html`, `floating.html`, shared `panel.css`).
   Content-script-injected page DOM (`agent-dom.js` pickers etc.) keeps its existing styling contract.
2. Removing light mode does **not** remove the Theme setting control (AGENTS.md: controls stay
   discoverable). The select remains with Dark/System options; System resolves to dark.
3. `dev/preview.html` follows the same stylesheet automatically; no separate design work.
4. All structural/accessibility test gates must pass — by amending tests where the *design
   requirement itself changed* (light palette gone, accents gone), never by deleting assertions wholesale.
5. `dist/` is generated output (`npm run package:extension`) and is never hand-edited.
6. Documentation prose that pins "2.9.0" as current version gets updated; historical review docs
   keep their era-accurate references.

## 4. Scope

**In scope:** `panel.css`, `theme.js`, `customization.js`, `panel.html`, `floating.html`,
`icons/ui/*.svg` (5 files), `icons/icon{16,32,48,128}.png`, `dev/preview.html|js` (anchors only),
version anchors (§7), `test/palette-contrast.test.mjs`, `test/stylesheet.test.mjs`,
`test/package.test.mjs` (if markup-parity expectations shift), `CHANGELOG.md`, `README.md`,
`docs/architecture.md`, `docs/IMPLEMENTATION-STATUS.md`.

**Out of scope:** message protocol shapes, fail-closed behaviour, permissions, storage keys
(`arenaAgentTheme` key name unchanged), HTML element IDs/structure, ARIA attributes,
`agent-dom.js` page-injection logic, `.agents/` pack contents.

## 5. Design tokens (dark-only, WCAG-AA verified numerically)

Base surfaces: `--bg #050505`, `--surface #121212`, elevated/sheet/glass tints per current stacking
model. Text: `--label #ffffff`, `--secondary #b3b3b3` (≥4.5:1 on all surfaces incl. fill overlays),
`--tertiary` raised from draft #808080 to ≥4.6:1 on `--fill-2` (~#8A8A8A). Accents:
`--accent #cc0000` → **adjusted to ~#E01525** so accent-as-text meets 4.5:1 on `--glass-strong`
(draft value measures 4.26:1 — fails the gate). Status: green/red/orange ink values re-verified
against the new dark surfaces; white glyphs on badges ≥3:1. Geometry: border-radius ≤2px,
beveled `clip-path` corners on containers, thin silver/`#1E1E1E` dividers, uppercase bold headers
with letter-spacing, system font stack retained. Motion: existing motion layer restyled to
restrained red glow on focus/active only; durations ≤0.15s–0.2s; `prefers-reduced-motion` guard
untouched; rainbow/conic-gradient ban stays in force.

## 6. Behavioural requirements

- R1: Panel and floating window render the ROG dark theme in every state; no light flash on load.
- R2: Theme select offers Dark + System; any stored value (incl. legacy "light", "system") resolves
  to dark; storage events between panel and floating window keep working.
- R3: Appearance prefs still save/apply text size; accent preference storage is retired cleanly
  (normalize() drops it; no crash for users with old stored objects).
- R4: All redrawn icons render at their existing sizes via the existing mask/background mechanism
  (same file names, same viewBox convention); toolbar PNGs visible at 16px.
- R5: Version 2.10.0 propagates through every anchor listed in §7; mismatched old content scripts
  are rejected exactly as before (that is the point of the bump).

## 7. Version anchors (lockstep 2.9.0 → 2.10.0)

`manifest.json` (version + default_title), `package.json`, `agent-client.js`, `attachment.js`,
`attachment-policy.js`, `agent-dom.js`, `agent-content.js` (×2), `panel.js` (verified-string),
`panel.html` (title + #version), `floating.html` (title + #version), `dev/preview.js`,
`CHANGELOG.md` (new entry), `README.md`, `docs/*` current-version prose. Guarded by
`test/version-sync.test.mjs` — do not edit that test.

## 8. Test-gate strategy (RED first)

- `palette-contrast.test.mjs`: rewrite to the dark-only token set; drop light/accent loops, keep
  every surface × text-token pair and all state-graphic pairs at AA thresholds.
- `stylesheet.test.mjs`: structure/motion/reduced-motion/dock-position/icon-existence tests kept;
  add assertion that no `data-theme="light"` rule block remains.
- New test: theme resolution — `preference ∈ {system, light, dark}` all resolve to `dark`
  (extend existing preferences coverage or add `test/theme.test.mjs`).
- Existing suites (`node --test test/`) must stay green throughout; `npm run package:extension`
  allow-list unchanged (same file names).

## 9. Task breakdown (dependency order — basis for tasks/plan.md)

- T1 Baseline: capture current test results; replace stale `tasks/` plan/todo with this effort.
- T2 Token layer: rewrite `:root`/dark blocks in `panel.css` to the §5 table; delete light theme. (deps: T1)
- T3 Theme logic: `theme.js` dark-only resolution (R2); amend contrast/stylesheet tests RED→GREEN. (deps: T2)
- T4 Accent removal: `customization.js` + `panel.html`/`floating.html` select; markup parity check. (deps: T3; confirm D5 first)
- T5 Component restyle: typography, borders/clip-path, buttons, inputs, status pill, notices, chips, bubbles, restrained red glow. (deps: T2–T4)
- T6 Icons: redraw 5 SVGs; regenerate 4 PNGs. (deps: T5 — final colours known)
- T7 Version bump 2.10.0 + CHANGELOG + docs prose. (deps: T2–T6; last, per repo convention)
- T8 Verify: full `npm run check`, packaging, dev preview visual pass, reduced-motion check.

## 10. Non-goals / risks

- Not introducing build steps, dependencies, or new persisted data.
- Risk: clip-path bevels clipping focus rings → verify keyboard focus visibility.
- Risk: red-on-near-black contrast ceiling → §5 values pre-computed; adjust within ROG family if a pair fails.
- Risk: removing accent picker strands stored prefs → R3 handles migration.
