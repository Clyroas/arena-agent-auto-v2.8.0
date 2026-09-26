# Task List: Pill Reconnect + Picker Chips Polish + False Security-Check Fix

Companion to `tasks/plan.md`. Checkboxes track implementation; nothing is checked —
this is the plan awaiting human review.

## Task 1: Pill reconnects from `error` state

**Description:** Route the header status-pill click to the existing reconnect flow
(the same `action('reconnect')` path as Settings → Reconnect, including its
same-conversation confirmations) when `state === 'error'`, and give the pill a
distinct small red treatment in that state. All other states keep opening Settings.

**Acceptance criteria:**
- [ ] Clicking the pill in `error` state runs the existing reconnect action (same confirmations, same "nothing resent" guarantees); clicking it in any other state opens Settings as today
- [ ] In `error` state the pill is visibly red with a "Reconnect…" tooltip/label affordance, in light and dark themes, at 360px width
- [ ] `floating.html` surface behaves identically (same script, mirrored markup)

**Verification:**
- [ ] Tests pass: `node --test test/panel-aria.test.mjs test/panel-lifecycle.test.mjs` (extended with pill-click routing cases)
- [ ] Checks pass: `npm run check`
- [ ] Manual check: force an error state (e.g. close the Arena tab), click the red pill, confirm reattach offers appear and nothing is resent

**Dependencies:** None

**Files likely touched:**
- `panel.js` (pill click handler ~L60, `render()` pill title ~L158)
- `panel.css` (`.status-pill` error state ~L155)
- `panel.html`, `floating.html` (pill tooltip/ARIA text, only if markup must change)
- `test/panel-aria.test.mjs` and/or `test/panel-lifecycle.test.mjs` (new cases)

**Estimated scope:** Small: 3–4 files (+2 test/markup parity)

## Task 2: Pill reattach from `disconnected` + guards, ARIA, docs

**Description:** Extend Task 1 so the pill also offers one-click reattach from
`disconnected` when a prior tab is known (`tab` set, no client), stays inert (opens
Settings, no reconnect) while `busy`/`connecting`/`reconnecting` or with no known tab,
and exposes correct ARIA now that the pill is not always a sheet toggle. Update the
in-panel help wording that points users at Settings for reconnecting.

**Acceptance criteria:**
- [ ] Pill reconnects only when a reattach is possible (known tab, idle); otherwise it opens Settings and never fires a partial reconnect
- [ ] `aria-expanded`/`aria-controls`/`aria-label` on the pill are correct per state (toggle semantics only when it toggles the sheet), with keyboard-focus behavior unchanged
- [ ] Help copy ("…then reconnect") and pill tooltips describe the new one-click path on both `panel.html` and `floating.html`

**Verification:**
- [ ] Tests pass: `node --test test/panel-aria.test.mjs test/panel-lifecycle.test.mjs`
- [ ] Checks pass: `npm run check`
- [ ] Manual check: disconnected-with-tab → pill reattaches; busy/connecting → pill opens Settings; screen-reader label announces the action

**Dependencies:** Task 1

**Files likely touched:**
- `panel.js` (pill routing guards, `render()` ARIA/title)
- `panel.html`, `floating.html` (help copy, pill attributes)
- `test/panel-aria.test.mjs` (ARIA-per-state cases)

**Estimated scope:** Small: 2–3 files (+tests)

## Checkpoint: After Tasks 1–2

- [ ] All tests pass (`npm run check`)
- [ ] Pill reconnects from error/disconnected-with-tab; gear still opens Settings everywhere
- [ ] Floating window matches the side panel
- [ ] Review with human before proceeding

## Task 3: Compact chip layout (truncation, tooltip, narrow panels)

**Description:** Make the `picker-bar` repo/branch chips compact and readable:
bounded widths with ellipsis truncation, full-value tooltips, stable 28px height
aligned with the composer, and a clean wrap/stack at narrow (≤380px) widths without
pushing the Send row off-screen. Presentation-only; no behavior change.

**Acceptance criteria:**
- [ ] Long repo/branch names (up to the 120-char cap) truncate with ellipsis and expose the full value via tooltip on both chips
- [ ] At 360px, 380px, and 620px+ widths the chip bar stays inside the composer with no overlap of Send/attach controls
- [ ] `floating.html` renders identically (shared `panel.css`, mirrored markup verified)

**Verification:**
- [ ] Tests pass: `node --test test/stylesheet.test.mjs test/palette-contrast.test.mjs` (+ any chip-markup assertions added to `panel-aria`)
- [ ] Checks pass: `npm run check`
- [ ] Manual check: Agent tab with a long repo + branch name at three widths, light + dark theme

**Dependencies:** None (soft order after Task 2 for single-session work; shares `panel.css` hunks)

**Files likely touched:**
- `panel.css` (`.picker-bar`, `.picker-chip` ~L594–612, narrow breakpoint ~L538)
- `panel.html`, `floating.html` (only if chip markup/attributes must change)
- `test/panel-aria.test.mjs` or `test/stylesheet.test.mjs` (new assertions)

**Estimated scope:** Small: 1–2 files (+tests)

## Task 4: Chip loading/disabled states + state tests

**Description:** Give the chips unambiguous states in `renderPickerBar`: opening/picking
in progress (busy pill on the active chip), disabled-while-busy/pending, present-but-
disabled by Arena, and not-present (bar hidden, as today) — each with an accurate
tooltip. Cover the state matrix with jsdom tests.

**Acceptance criteria:**
- [ ] Every `renderPickerBar` state (idle, picker open, busy, pending turn, Arena-disabled, missing) shows the correct enabled/disabled treatment and tooltip text
- [ ] Opening the picker dialog or starting a turn mid-render cannot leave a chip enabled-but-dead or disabled-but unexplained
- [ ] jsdom tests cover the full state matrix for both chips

**Verification:**
- [ ] Tests pass: `node --test test/repo-pickers.test.mjs` (new panel-state cases) or the panel lifecycle suite hosting them
- [ ] Checks pass: `npm run check`
- [ ] Manual check: open repo picker → chips disable with reason; start a turn → chips disable; Arena-disabled picker → explanatory tooltip

**Dependencies:** Task 3

**Files likely touched:**
- `panel.js` (`renderPickerBar` ~L390, `openPickerDialog`/`receivePicker` state flow)
- `panel.css` (state treatments, if new classes are needed)
- `test/repo-pickers.test.mjs` (state-matrix cases)

**Estimated scope:** Small: 2–3 files

## Checkpoint: After Tasks 3–4

- [ ] All tests pass (`npm run check`)
- [ ] Chips readable at all widths with correct states and tooltips; floating matches
- [ ] Review with human before proceeding

## Task 5: Reproduce-first fixture for the false SECURITY_CHECK (failing test)

**Description:** Without changing shipped code, build a jsdom fixture that reproduces
the false positive: an Agent page whose selected repository name matches
`SECURITY_TEXT` (start with `captcha-solver`, per the code's own comment) surfaced in
a post-switch notice (`[data-sonner-toast]`/`[role=alert]`/`h1`), then drive the
picker-adjacent `checkBlocks`/`securityNotice` call sites (`handlePicker` entry,
post-close, next-open) to pin exactly which one raises `SECURITY_CHECK` "right after
pick". Land as a failing test documenting the call site.

**Acceptance criteria:**
- [ ] A failing test exists showing `SECURITY_CHECK` raised from picker-adjacent UI text containing only the repo name, with no genuine interstitial present
- [ ] The test names the exact call site (handlePicker entry check vs post-close check vs next-open check) via the driven path
- [ ] No shipped code changed in this task (fixture + test only)

**Verification:**
- [ ] Tests pass-except-new: new test fails for the documented reason; `npm run check` otherwise green
- [ ] Manual check (live tab, if available): select a security-worded repo and confirm the same error text appears without Send

**Dependencies:** None (needs no Phase 1–2 code; runs last per agreed order)

**Files likely touched:**
- `test/security-notice.test.mjs` (false-positive fixture cases)
- `test/picker-content.test.mjs` (picker-path driver, if the call site needs the content harness)

**Estimated scope:** Small: 1–2 files (tests only)

## Task 6: Narrow the SECURITY_CHECK trigger to genuine verifications

**Description:** Fix the call site pinned by Task 5 so text attributable to the
pickers' own current values (repo/branch labels the adapter just read via `repoInfo`)
cannot raise `SECURITY_CHECK`, while a genuine interstitial (challenge iframe,
verification dialog copy unrelated to picker values) still raises exactly as today.
Fail closed: any doubt keeps the current fatal behavior.

**Acceptance criteria:**
- [ ] Task 5's reproduction passes: selecting/opening around a `captcha`-named repo raises no `SECURITY_CHECK`
- [ ] All genuine-positive cases (challenge iframe, "verify you are human" interstitial, hidden-remnant quiet) behave exactly as before
- [ ] No new page-shape allow-listing and no silent swallowing: non-picker-attributable matches still fail with coded `SECURITY_CHECK`

**Verification:**
- [ ] Tests pass: `node --test test/security-notice.test.mjs test/picker-content.test.mjs test/content-script.test.mjs`
- [ ] Checks pass: `npm run check`
- [ ] Manual check: live tab — security-worded repo selects cleanly; (if safely simulable) a real interstitial still pauses with `SECURITY_CHECK`

**Dependencies:** Task 5

**Files likely touched:**
- `agent-dom.js` (`checkBlocks` ~L367, `securityNotice` ~L343, `SECURITY_TEXT` ~L334, picker-label helpers)
- `agent-content.js` (only if the fix belongs at the `handlePicker` call site ~L653 instead)
- `test/security-notice.test.mjs` (Task 5 test now green + genuine-positive guards)

**Estimated scope:** Medium: 2–3 files

## Task 7: Regression tests + full verification

**Description:** Lock the fix in with regression coverage (false-positive fixtures
across toast/alert/h1 carriers × repo/branch values, plus genuine-positive controls),
run the full suite and packaging, and record the manual live-tab verification the
Node suite cannot cover.

**Acceptance criteria:**
- [ ] Regression matrix covers each notice carrier (`[role=alert]`, `[data-sonner-toast]`, `h1`/`h2`, challenge iframe) × picker-valued vs genuine verification text
- [ ] `npm run check`, `npm run test:browser` (if Chromium available), and `npm run package:extension` all pass with the extension allow-list unchanged
- [ ] `docs/IMPLEMENTATION-STATUS.md` / `CHANGELOG.md` note the fix and its live-verification status honestly (verified vs fixture-only)

**Verification:**
- [ ] Tests pass: `npm test` (full) + `npm run test:browser`
- [ ] Checks pass: `npm run check` + `npm run package:extension`
- [ ] Manual check: live Agent tab — repo select → no error; branch open → no error; next Send → works; real interstitial (if encountered) → pauses and resumes

**Dependencies:** Task 6

**Files likely touched:**
- `test/security-notice.test.mjs`, `test/picker-content.test.mjs` (regression matrix)
- `CHANGELOG.md`, `docs/IMPLEMENTATION-STATUS.md` (status notes)
- `test/browser/fixtures/agent.html` (only if a browser-fixture carrier is needed)

**Estimated scope:** Small: 2–4 files (tests + docs)

## Checkpoint: Complete

- [ ] All tests pass; all genuine-positive security tests still green
- [ ] Pill reconnect, chip polish, and security fix all verified per their manual checks
- [ ] Plan checkboxes all ticked; ready for `/review`, then `/ship`
- [ ] The human has reviewed and approved the completed work
