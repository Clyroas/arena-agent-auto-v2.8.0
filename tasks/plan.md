# Implementation Plan: Toolbar Reconnect Button + Picker Chips Polish + False Security-Check Fix

## Overview

Three ordered workstreams for the Arena Auto Chat side panel (all on
`arena/01a0dc6e-arena-agent-auto-v2-8-0`, plan mode — no code changed yet):

1. **Reconnect via a toolbar button** — a compact reconnect button appears in the toolbar (between
   the status pill and the gear) whenever the session is in `error` state with a known tab and
   nothing else running, and runs the existing reconnect flow (same confirmations, nothing resent).
   The pill and the gear remain the Settings entry points.
2. **Compact + readable repo/branch chips** — truncation, tooltips, narrow-panel
   behavior, and clear loading/disabled states for the `picker-bar` chips above the
   composer (`panel.html` + `floating.html` share the markup).
3. **False `SECURITY_CHECK` after selecting a repository** — reproduce-first, then fix
   the adapter's notice scan so repository/branch names that read like notice words
   (the codebase's own example: `captcha-solver`) cannot raise a security-verification
   error when no verification is actually showing.

## Architecture Decisions

- **A new toolbar button carries reconnect (Task 1, decided by the human reviewer).** The original
  plan reused the status pill as the control; the reviewer chose a separate small button instead,
  with the ≤380px crowding risk stated and accepted. The button exists only when a reconnect is
  actually possible (`error` state, known tab, idle), so the toolbar gains nothing until it is
  actionable and the pill/gear keep their Settings role. Both controls run the same `reconnect`
  flow through one `runAction` wrapper — no duplicated confirmations, no clicking through the inert
  settings sheet.
- **Picker chips stay page-driven.** The polish touches only presentation and local
  state mapping (`renderPickerBar`); option data still comes exclusively from Arena's
  own picker. No GitHub API, no cached values beyond the existing `repoPickers` frame.
- **Fail-closed security fix.** The `SECURITY_CHECK` fix must narrow the *false*
  trigger (picker-known text), never broaden an allow-list of page shapes, and all
  existing `test/security-notice.test.mjs` genuine-positive cases must stay green.
  The reproduce-first task pins the exact call site before any fix is written.
- **Floating-window parity.** `floating.html` duplicates the toolbar/composer markup;
  every `panel.html`/`panel.css`/`panel.js` change in Phases 1–2 must be mirrored and
  verified there (same script drives both surfaces).

## Dependency Graph

```text
Phase 1: toolbar reconnect (panel-only)        Phase 3: adapter fix (content-side)
  Task 1 (error-state slice) ✅ DONE             Task 5 (reproduce-first fixture)
    │                                             │
  Task 2 (disconnected + guards)                Task 6 (narrow the trigger)
                                                  │
Phase 2: chip polish (panel-only)               Task 7 (regression tests)
  Task 3 (layout/truncation)                      │
    │                                         (independent of Phases 1-2;
  Task 4 (loading/disabled states)             ordered last per review decision)
```

- Phase 1 → Phase 2: soft ordering only (both touch `panel.js`/`panel.css`, adjacent
  but non-overlapping hunks; single-session sequential, parallel-safe with coordination).
- Phase 3 is independent of Phases 1–2 (touches `agent-dom.js`/`agent-content.js` +
  Node tests) but runs last per the agreed order; its manual verification reuses the
  Phase 2 chips to read picker values.
- Within each phase, tasks are sequential (later task builds on earlier behavior/tests).

## Task List

### Phase 1: Toolbar Reconnect

- [x] Task 1: Toolbar reconnect button from `error` state (behavior + red style + tests) — done; see `tasks/todo.md` for the design change (separate button, human decision) and what remains manual
- [ ] Task 2: Reconnect affordance from `disconnected` + guards, ARIA, docs

### Checkpoint: Phase 1

- [ ] `npm run check` passes; pill reconnects from error/disconnected, opens Settings otherwise
- [ ] Gear button still opens Settings in every state; floating window matches
- [ ] Review with human before proceeding

### Phase 2: Repo/Branch Chip Polish

- [ ] Task 3: Compact chip layout (truncation, tooltip, narrow-panel behavior)
- [ ] Task 4: Chip loading/disabled states + state tests

### Checkpoint: Phase 2

- [ ] `npm run check` passes; long repo/branch names truncate with full-value tooltips
- [ ] Chips stay readable at 380px and 620px+ widths; states correct while busy/pending
- [ ] Review with human before proceeding

### Phase 3: False SECURITY_CHECK Fix

- [ ] Task 5: Reproduce-first fixture pinning the exact call site (failing test)
- [ ] Task 6: Narrow the trigger so picker-known text can't raise SECURITY_CHECK
- [ ] Task 7: Regression tests + full verification

### Checkpoint: Complete

- [ ] `npm run check` passes; all genuine-positive security tests still green
- [ ] Selecting a `captcha`-named repo no longer raises SECURITY_CHECK; real interstitial still pauses
- [ ] All acceptance criteria met; ready for review (`/review`) then `/ship`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| New toolbar button confuses existing users (pill always opened Settings) | Med | Button appears only in actionable states with a red treatment and a "Reconnect" glyph; pill/gear always open Settings; help text updated in Task 2 |
| Pill ARIA semantics (`aria-expanded`/`aria-controls` on the pill) | Med | Task 1 leaves pill semantics untouched (it still only toggles the sheet); Task 2 revisits if the pill gains routing |
| Narrow-panel (≤380px) toolbar crowding | Low | Accepted by the reviewer with Task 1; the button is hidden unless a reconnect is possible, so the cost exists only in the error state — verify at 360px in Task 1/3 |
| Security fix over-narrows and misses a real interstitial | High | Fix excludes only picker-known current values; genuine-positive fixtures must stay green; no new page-shape allow-listing |
| Live-site Arena markup differs from fixtures | Med | Adapter changes stay fail-closed with coded errors; manual verification on a live tab required before ship |
| `floating.html` drifts from `panel.html` | Low | Every panel-markup task lists floating parity explicitly with its own acceptance bullet |

## Open Questions

- Q: Should the red pill show a ↻ glyph/text change (e.g. "Reconnect") or keep the state label with red styling? (Recommendation: keep label, add red treatment + tooltip; decided at Task 1 implementation.)
- Q: Exact live reproduction strings for Phase 3 (repo name + Arena toast text)? Task 5 starts with the `captcha-solver` hypothesis from the code comments and confirms against the live tab.

## Parallelization Opportunities

- **Safe to parallelize:** Phase 3 (Tasks 5–7) vs Phases 1–2 — disjoint file sets
  (adapter + Node tests vs panel UI). Task 3 (CSS/layout) vs Task 1/2 (toolbar JS) with
  coordination on `panel.css` hunks.
- **Must be sequential:** Task 1 → Task 2 (same click-routing code); Task 3 → Task 4
  (states build on layout); Task 5 → Task 6 → Task 7 (reproduce → fix → guard).
- **Needs coordination:** `panel.js` `render()` and `panel.css` are shared by Phases
  1–2 — agree hunk boundaries before parallel work; `floating.html` parity edits must
  land with their panel counterparts, not as a separate pass.

## Verification (project-wide floor)

Per `.agents/references/definition-of-done.md` plus this repo's checks (`AGENTS.md`):

```bash
npm run check          # eslint + Node/jsdom regressions (every task)
node --test test/<focused>.test.mjs   # per-task focused run
npm run test:browser   # opt-in Chromium fixtures; no live Arena network
```

No build step exists; "build succeeds" maps to `npm run check` + `npm run package:extension`
(allow-list unchanged) at final checkpoint. Live-tab manual verification is required
before ship — the Node suite is not a substitute (see `README.md`).
