# Implementation Plan: Pill Reconnect + Picker Chips Polish + False Security-Check Fix

## Overview

Three ordered workstreams for the Arena Auto Chat side panel (all on
`arena/01a0dc6e-arena-agent-auto-v2-8-0`, plan mode — no code changed yet):

1. **Reconnect via the status pill** — the existing header status pill turns red and
   acts as a one-click reconnect button when the session is in `error` (and, when a
   prior tab is known, `disconnected`), instead of only opening Settings. The gear
   button remains the Settings entry point.
2. **Compact + readable repo/branch chips** — truncation, tooltips, narrow-panel
   behavior, and clear loading/disabled states for the `picker-bar` chips above the
   composer (`panel.html` + `floating.html` share the markup).
3. **False `SECURITY_CHECK` after selecting a repository** — reproduce-first, then fix
   the adapter's notice scan so repository/branch names that read like notice words
   (the codebase's own example: `captcha-solver`) cannot raise a security-verification
   error when no verification is actually showing.

## Architecture Decisions

- **No new element for reconnect.** Per the review decision, the status pill itself
  becomes the control (`panel.js` click routing + `panel.css` red state) rather than
  adding a separate round button. Rationale: the toolbar is already crowded at
  ≤380px, the pill already carries connection state, and one control avoids two
  competing reconnect affordances.
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
Phase 1: pill reconnect (panel-only)          Phase 3: adapter fix (content-side)
  Task 1 (error-state slice)                    Task 5 (reproduce-first fixture)
    │                                             │
  Task 2 (disconnected + guards)                Task 6 (narrow the trigger)
                                                  │
Phase 2: chip polish (panel-only)               Task 7 (regression tests)
  Task 3 (layout/truncation)                    │
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

### Phase 1: Status Pill Reconnect

- [ ] Task 1: Pill reconnects from `error` state (behavior + red style + tests)
- [ ] Task 2: Pill reattach from `disconnected` + guards, ARIA, floating parity

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
| Pill click change confuses existing users (pill always opened Settings) | Med | Distinct red reconnect styling + tooltip/label change only in actionable states; gear always opens Settings; help text updated |
| `aria-expanded`/`aria-controls` semantics break (pill no longer always toggles the sheet) | Med | Task 2 updates ARIA per state and extends `panel-aria` tests |
| Narrow-panel (≤380px) toolbar crowding | Low | Reuses existing pill slot — no new element; verify at 360px in Task 1/3 |
| Security fix over-narrows and misses a real interstitial | High | Fix excludes only picker-known current values; genuine-positive fixtures must stay green; no new page-shape allow-listing |
| Live-site Arena markup differs from fixtures | Med | Adapter changes stay fail-closed with coded errors; manual verification on a live tab required before ship |
| `floating.html` drifts from `panel.html` | Low | Every panel-markup task lists floating parity explicitly with its own acceptance bullet |

## Open Questions

- Q: Should the red pill show a ↻ glyph/text change (e.g. "Reconnect") or keep the state label with red styling? (Recommendation: keep label, add red treatment + tooltip; decided at Task 1 implementation.)
- Q: Exact live reproduction strings for Phase 3 (repo name + Arena toast text)? Task 5 starts with the `captcha-solver` hypothesis from the code comments and confirms against the live tab.

## Parallelization Opportunities

- **Safe to parallelize:** Phase 3 (Tasks 5–7) vs Phases 1–2 — disjoint file sets
  (adapter + Node tests vs panel UI). Task 3 (CSS/layout) vs Task 1/2 (pill JS) with
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
