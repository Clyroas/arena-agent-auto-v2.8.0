# Task List: Apple-Inspired UI/UX — Complete Polish Pass

Companion to `tasks/plan.md` (spec: `docs/specs/apple-ui-polish.md`). Direction (a) approved by the
human 2026-09-27: polish/complete the existing Apple-style UI; all Phases 0–6 in one run, with
checkpoints. No IBM Plex bundling; system font stacks stay. Supersedes the previous working list.

## Task 1: Generated floating.html + drift test (Phase 0, zero visual change)

**Description:** Add `scripts/gen-floating.mjs` that derives `floating.html` from `panel.html`,
encoding the known panel↔floating differences (e.g. `body.floating-view`, window-specific head/
script wiring) as explicit parameters. Commit the generated output byte-for-byte and add a drift
test so any hand-edit of `floating.html` fails the suite. Pattern precedent:
`scripts/build-skill-presets.mjs` + `test/skill-presets.test.mjs`.

**Acceptance criteria:**
- [ ] `node scripts/gen-floating.mjs` regenerates `floating.html` identical to the committed file
- [ ] Drift test fails when `floating.html` diverges from generator output
- [ ] DOM ids unchanged on both surfaces; `test/package.test.mjs` id-parity stays green
- [ ] `.agents/`-style exclusion holds: generator script is NOT packaged (`extension-files.json` unchanged)

**Verification:**
- [ ] Tests pass: `node --test test/package.test.mjs test/floating-drift.test.mjs` (new)
- [ ] Checks pass: `npm run check` (sandbox: `node --test test/*.test.mjs`) — 245+ green
- [ ] Manual check: open both surfaces via `dev/preview` — no rendering difference vs baseline

**Dependencies:** None
**Files likely touched:** `scripts/gen-floating.mjs` (new), `floating.html`, `test/` (new drift test), `package.json` (script entry if needed)
**Estimated scope:** Medium: 3–4 files

## Task 2: Stylesheet discipline lint + palette hooks (Phase 0, zero visual change)

**Description:** Extend `test/stylesheet.test.mjs` to fail on raw px font sizes, border radii, and
hex/rgba colors outside `:root` blocks. Capture today's violations in an explicit allowlist that
Phases 1–2 shrink to empty. Extend `test/palette-contrast.test.mjs` scaffolding for the 7 state
tokens introduced in Task 3.

**Acceptance criteria:**
- [ ] New lint rules fail on a deliberately injected violation (test-of-the-test)
- [ ] Current tree passes via the frozen allowlist; allowlist entries are selector+property pairs
- [ ] Palette suite still green; state-token cases added but marked pending until Task 3

**Verification:**
- [ ] Tests pass: `node --test test/stylesheet.test.mjs test/palette-contrast.test.mjs`
- [ ] Checks pass: `npm run check`

**Dependencies:** None (parallel-safe with Task 1)
**Files likely touched:** `test/stylesheet.test.mjs`, `test/palette-contrast.test.mjs`
**Estimated scope:** Small: 2 files

## Checkpoint: Phase 0
- [ ] Full suite green; `git diff` shows no change to `panel.css`/`panel.html` rendering paths
- [ ] Human notified guardrails landed before any visual work

## Task 3: Token scales + state colors (Phase 1)

**Description:** Define `--text-*` (≤6 steps), `--space-*` (4px grid), `--radius-*` (5 + capsule),
`--shadow-*` (2 levels + glass), `--dur-*`/`--ease-*` (motion tokens, reduced-motion kill switch
kept), and `--state-*` for the 7 session states in `:root` (both themes). Map every existing value
to the nearest step — intended visual delta ≈ zero. Resolve state colors AA across 2 themes ×
4 accents; shrink Task 2's allowlist.

**Acceptance criteria:**
- [ ] No raw font-size/radius/color declarations remain outside `:root` except allowlisted hairlines
- [ ] Palette test covers 7 states × 2 themes × 4 accents at AA (4.5:1 text, 3:1 UI)
- [ ] Saved accent values unchanged (preference compatibility)
- [ ] `prefers-reduced-motion` still disables motion wholesale

**Verification:**
- [ ] Tests pass: `node --test test/stylesheet.test.mjs test/palette-contrast.test.mjs test/preferences.test.mjs`
- [ ] Checks pass: `npm run check`
- [ ] Manual check: owner compares `dev/preview` against baseline screenshots (light+dark)

**Dependencies:** Tasks 1–2
**Files likely touched:** `panel.css`, `test/palette-contrast.test.mjs`, `test/stylesheet.test.mjs`
**Estimated scope:** Large: 1 CSS file heavily + 2 tests

## Task 4: One button (Phase 2)

**Description:** Collapse the ~20 button/chip/pill variants' button side into one component:
3 emphases (filled accent / tinted `--fill` / plain) × 3 sizes, token-driven, focus-visible ring
consistent, disabled/busy treatments unified. Re-point existing classes; keep ids and behavior.

**Acceptance criteria:**
- [ ] Every visible button uses exactly one emphasis×size pair; no bespoke padding/radius left
- [ ] Keyboard focus indicator visible on all buttons in both themes (AA 3:1)
- [ ] Existing click-routing tests unchanged and green (behavior untouched)

**Verification:**
- [ ] Tests pass: `node --test test/panel-aria.test.mjs test/panel-lifecycle.test.mjs`
- [ ] Checks pass: `npm run check`; Manual: `dev/preview` button matrix reviewed

**Dependencies:** Task 3
**Files likely touched:** `panel.css`, `panel.html` (+ regenerate `floating.html`), tests
**Estimated scope:** Medium: 2–3 files + regenerated floating

## Task 5: One chip + one row (Phase 2)

**Description:** Unify repo/branch chips, preset chip, attachment/screenshot chips onto one slotted
chip vocabulary (icon · label · chevron · count); unify dialog option rows, model rows, preset rows
onto one row component. Truncation + full-value tooltips preserved (prior shipped behavior).

**Acceptance criteria:**
- [ ] Chips share geometry tokens; state coverage idle/open/busy/disabled/missing renders from one rule set
- [ ] Option rows keep tested ARIA vocabulary (listitem/button/group per IMPLEMENTATION-STATUS)
- [ ] Long names truncate with ellipsis + tooltip at 360/380/620px

**Verification:**
- [ ] Tests pass: `node --test test/repo-pickers.test.mjs test/panel-aria.test.mjs test/stylesheet.test.mjs`
- [ ] Checks pass: `npm run check`; Manual: preview at three widths, both themes

**Dependencies:** Task 4
**Files likely touched:** `panel.css`, `panel.js` (`renderPickerBar` presentation only), `panel.html`/`floating.html`
**Estimated scope:** Medium: 3–4 files

## Task 6: One modal system + surfaces (Phase 2)

**Description:** Unify the four native `<dialog>`s and the settings sheet into one modal geometry.
Fold-or-restyle decision per plan: fold into `<dialog>` ONLY if inert-background, Tab confinement,
and opener-restore behavior survive `panel-lifecycle.test.mjs`; otherwise restyle the sheet. Then
reconcile notice, clarification/pair card, message bubbles, live activity, and status pill (capsule
label treatment) onto tokens.

**Acceptance criteria:**
- [ ] All dialogs share header/body/footer geometry, scrim, radius, elevation tokens
- [ ] Focus contract verified: background inert, Tab confined, opener restored (tests green)
- [ ] Status pill reads as iOS capsule label in all 7 states with glyph+word (not color alone)
- [ ] Decision (fold vs restyle) recorded in this file with rationale

**Verification:**
- [ ] Tests pass: `node --test test/panel-lifecycle.test.mjs test/panel-aria.test.mjs`
- [ ] Checks pass: `npm run check`; Manual: screen-reader pass on each dialog (owner-side)

**Dependencies:** Task 3 (can run parallel with 4–5 with hunk coordination)
**Files likely touched:** `panel.css`, `panel.html`/`floating.html`, `panel.js` (sheet mechanics only), tests
**Estimated scope:** Large: 4–5 files

## Checkpoint: Phase 2
- [ ] Suite green incl. lifecycle/aria; Task 2 allowlist empty for touched selectors
- [ ] Floating regenerated via script after markup changes; parity verified

## Task 7: States × surfaces matrix + two-pane floating (Phase 3)

**Description:** Narrow-first review of all 7 session states across {status pill, transcript, dock,
composer, Send} at 360px; relax ≥620px; ≥720px floating becomes two-pane (transcript | live
activity) using CSS grid over existing DOM only. Extend `dev/preview` state switcher so every cell
is reviewable.

**Acceptance criteria:**
- [ ] Preview exposes state × surface × theme × accent × text-size selection for owner review
- [ ] No overflow/clipping at 360px in any state; Send row always reachable
- [ ] Two-pane appears only ≥720px; narrow layout byte-identical CSS below breakpoint
- [ ] `window-geometry.js`, `live-view.js` logic untouched (CSS/markup only)

**Verification:**
- [ ] Tests pass: `node --test test/live-view.test.mjs test/conversation-view.test.mjs test/stylesheet.test.mjs`
- [ ] Checks pass: `npm run check`; Manual: OWNER browser review of the full matrix (blocking)

**Dependencies:** Tasks 4–6
**Files likely touched:** `panel.css`, `dev/preview.js`, `dev/preview.html`
**Estimated scope:** Large: 3–4 files

## Checkpoint: Phase 3
- [ ] Owner sign-off on the rendered matrix before subtraction/docs

## Task 8: Subtraction proposals (Phase 4, propose-only default)

**Description:** Present the six candidate cuts (toolbar version/turn-count relocation, composer
help line condense, settings footer condense, brand orb → glyph, dialog foot copy trim, empty-state
orb → text) as line items with exact relocation targets; apply ONLY those the human approves.
Fail-closed statements move, never vanish.

**Acceptance criteria:**
- [ ] Each cut listed with before/after copy and destination; approval checkbox per line item
- [ ] Applied cuts keep every guarantee string present somewhere reachable
- [ ] Not-approved cuts untouched

**Verification:**
- [ ] Tests pass: `node --test test/security-notice.test.mjs test/panel-aria.test.mjs` (copy assertions)
- [ ] Checks pass: `npm run check`; Manual: copy audit vs fail-closed inventory

**Dependencies:** Task 7 (approval can be gathered earlier)
**Files likely touched:** `panel.html`/`floating.html`, `panel.css`, `panel.js` (copy strings)
**Estimated scope:** Small–Medium depending on approvals

## Task 9: Styleguide + design-system docs (Phase 5)

**Description:** Create `dev/styleguide.html` rendering every component × state × theme × accent ×
text size from the real `panel.css`; write `docs/design-system.md` codifying the Apple idiom
(system-font stack, iOS semantic colors, glass rules, capsule geometry, spring motion, spacing/
type/radius scales, do/don't examples); update README appearance section and CHANGELOG Unreleased.

**Acceptance criteria:**
- [ ] Styleguide loads with no console errors and mirrors live panel components (shared CSS only)
- [ ] design-system.md documents every token group introduced in Task 3 with usage rules
- [ ] CHANGELOG entry honest about fixture-vs-browser verification status

**Verification:**
- [ ] Checks pass: `npm run check`; Manual: owner opens styleguide once

**Dependencies:** Tasks 3–8
**Files likely touched:** `dev/styleguide.html` (new), `docs/design-system.md` (new), `README.md`, `CHANGELOG.md`
**Estimated scope:** Medium: 4 files (2 new, dev-only styleguide not packaged)

## Task 10: Release checks (Phase 6)

**Description:** Final verification sweep: full suite, packaging (allow-list unchanged — no fonts),
`docs/IMPLEMENTATION-STATUS.md` honesty pass marking what is jsdom-verified vs owner-browser-
verified vs live-Arena-unverified; prepare `/review` then `/ship`; ship-time version decision
(stay 2.9.0 vs bump 2.10.0) made with the human.

**Acceptance criteria:**
- [ ] `npm run check` green; `npm run package:extension` succeeds; allow-list diff empty
- [ ] IMPLEMENTATION-STATUS updated; live smoke test explicitly recorded as owner action
- [ ] Human review completed on the final diff

**Verification:**
- [ ] Tests pass: `node --test test/*.test.mjs` (full)
- [ ] Build succeeds: `npm run package:extension`
- [ ] Manual check: owner live Arena smoke test before merge

**Dependencies:** Task 9
**Files likely touched:** `docs/IMPLEMENTATION-STATUS.md`, `CHANGELOG.md`, possibly `manifest.json` (version decision only)
**Estimated scope:** Small: 2–3 files

## Checkpoint: Complete
- [ ] All tasks above ticked; all checkpoints signed; ready for `/review`, then `/ship`
- [ ] The human has reviewed and approved the completed work
