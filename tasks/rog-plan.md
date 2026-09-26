# Implementation Plan: ROG Design Language Replacement (v2.10.0)

Companion to `spec/rog-design-language.md` (approved). Replaces the stale
`tasks/plan.md` / `tasks/todo.md` from the 2.8.x toolbar/picker effort — that work is
shipped; those files are kept only as history references and superseded here.

## Overview

Eight ordered tasks, each independently verifiable with `npm run check`:

- [x] **T0 (extra, human-approved):** Fix Critical audit finding C-1 — `npm test` glob
      matched zero files on Node 20. → commit `8aae284`. Gate restored: 245/245 green.
- [ ] **T1 Baseline:** Record starting state (done in this session's logs); mark spec approved.
- [ ] **T2 Token layer:** Rewrite `panel.css` `:root` to the dark-only ROG token set (§5);
      delete every `data-theme="light"` rule block. RED first: amend
      `test/palette-contrast.test.mjs` to the new token list + add no-light-block assertion
      to `test/stylesheet.test.mjs`; watch them fail; then GREEN via CSS.
- [ ] **T3 Theme logic:** `theme.js` resolves system/light/dark → always dark (R2); storage
      sync between panel/floating kept. New `test/theme.test.mjs` (RED→GREEN).
- [ ] **T4 Accent removal (D5):** Drop accent picker from `panel.html`/`floating.html`,
      retire accent handling in `customization.js` (normalize() tolerates old stored objects,
      R3). Markup-parity expectations in `test/package.test.mjs` checked.
- [ ] **T5 Component restyle:** Typography (uppercase bold headers, letter-spacing),
      ≤2px radii, beveled clip-path containers, thin dividers, buttons/inputs/status pill/
      notices/chips/bubbles, restrained red glow on focus/active only. Rainbow/conic ban stays.
      Verify keyboard focus visibility (risk §10) and `prefers-reduced-motion` guard intact.
- [ ] **T6 Icons:** Redraw 5 `icons/ui/*.svg` (alert, check, chevrons, send, sparkle) angular,
      same filenames/viewBox/mask mechanism (R4); regenerate 4 toolbar PNGs (16/32/48/128).
- [ ] **T7 Version bump 2.10.0:** All §7 anchors lockstep (`version-sync.test.mjs` guards —
      do not edit it), CHANGELOG entry, README/docs current-version prose.
- [ ] **T8 Verify:** Full `npm run check`, `npm run package:extension` + unzip sanity,
      dev-preview visual pass, reduced-motion check, contrast spot audit.

## Sequencing rules

- One task = one commit, message prefixed `feat(rog-ui):` (or `test:`/`docs:` when pure).
- Never leave HEAD with a red gate; if a task can't go green, revert its working-tree changes.
- No HTML IDs/ARIA changes; no protocol/storage-key changes; `dist/` never hand-edited.
