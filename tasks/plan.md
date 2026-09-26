# Implementation Plan: Apple-Inspired UI/UX — Complete Polish Pass (Phases 0–6)

Spec: [`docs/specs/apple-ui-polish.md`](../docs/specs/apple-ui-polish.md). Direction (a) chosen by the
human on 2026-09-27: **polish and complete the existing Apple-style UI** — the instrument-panel
one-pager (`docs/ideas/instrument-panel-ui-revamp.md`) is superseded for visual direction; its
structural spine (guardrails → tokens → components → states → subtraction → styleguide → release)
and phase numbering are retained, re-mapped onto the Apple idiom. No IBM Plex bundling (system font
stacks stay; the ~800 KB cost is moot). "Complete" = all phases in one run, checkpoints still gate.

This plan replaces the previous working list (toolbar reconnect / chip polish / SECURITY_CHECK);
that work's shipped code stays, its unchecked tasks are dropped from this run.

## Architecture Decisions

- **Generated `floating.html`, checked-in output + drift test.** Same pattern as
  `scripts/build-skill-presets.mjs` + `test/skill-presets.test.mjs`: no build step ships in the
  extension (AGENTS.md rule 3 holds — generation is a dev script whose output is committed).
  The three known panel↔floating diffs become explicit parameters of the generator.
- **Tokens before touch.** Phase 1 introduces scales (`--text-*`, `--space-*`, `--radius-*`,
  `--shadow-*`, `--dur-*`/`--ease-*`, `--state-*`) and rewrites existing values to them with
  **zero intended visual change**; Phase 2 changes visuals component by component. Measured
  baseline to collapse: 13 distinct font sizes (11–20px, seven inside a 3px band), 15 radii,
  131 `font-size`/`border-radius` declarations.
- **Palette discipline becomes machine-enforced.** Extend `test/stylesheet.test.mjs` to reject raw
  px sizes/radii/hex colors outside `:root`; extend `test/palette-contrast.test.mjs` to the 7
  session-state tokens × 2 themes × 4 accents. Green before any component restyle.
- **Settings sheet folds into the native `<dialog>` modal system only if the tested focus contract
  survives** (`panel-lifecycle.test.mjs`: inert background, Tab confinement, opener restore). If it
  cannot be preserved, keep the sheet's behavior and restyle it to dialog geometry instead —
  decision recorded at task time, never silently.
- **Ids frozen.** DOM ids in `panel.html` do not change (245 Node/jsdom tests + floating parity
  depend on them). Classes may change freely. Fail-closed copy moves at most; never deleted.
- **Two-pane floating ≥720px is CSS-only** over the DOM `live-view.js` already owns;
  `window-geometry.js`, `worker.js`, adapter files untouched.
- **Subtraction cuts are line-item approvals** (Phase 4): the run *proposes* each cut as a diff
  summary; nothing is removed without a human yes. Default in this plan: propose-only.
- **Version stays 2.9.0 during the run** (panel-only, no adapter-contract change; AGENTS.md rule 6);
  bump decision happens at ship with the CHANGELOG entry.

## Dependency Graph

```text
P0 guardrails ─┬─ P1 tokens ─── P2 components ─── P3 states ─┬─ P5 styleguide/docs ── P6 release
               │                                             │
               └─ P4 subtraction proposals ──────────────────┘ (cuts applied only if approved)
```

- P0 must land first (drift test protects every later markup change; stylesheet lint defines the
  token budget P1 fills).
- P1 → P2 → P3 strictly sequential (tokens feed components; states matrix exercises components).
- P4 proposals can be drafted during P2–P3 but execute only after approval; executed cuts land
  before P5 so the styleguide shows the final surface set.
- P5 → P6: docs/styleguide precede release checks; final checkpoint runs everything.

## Task List

### Phase 0: Guardrails (zero visual change)

- [ ] Task 1: `scripts/gen-floating.mjs` + committed generated `floating.html` + drift test
      (`test/floating-drift.test.mjs` or folded into `package.test.mjs`); byte-exact; `panel.html`
      untouched; id parity test stays green.
- [ ] Task 2: Stylesheet-discipline lint in `test/stylesheet.test.mjs` (raw font-size/radius/color
      outside `:root` fails), with a temporary allowlist capturing today's violations that Phases
      1–2 shrink to empty; palette test extended to state-token placeholders.

### Checkpoint: Phase 0
- [ ] `node --test test/*.test.mjs` 245+ green, zero visual/CSS change (`git diff` shows none in
      `panel.css` beyond comments); drift test passes on committed output.

### Phase 1: Tokens

- [ ] Task 3: Define scales in `:root` (both themes) mapping every current value to the nearest
      step; rewrite `panel.css` declarations to tokens; resolve the 7 state colors AA across
      2 themes × 4 accents; update `test/palette-contrast.test.mjs` to read tokens; shrink the
      stylesheet-lint allowlist accordingly.

### Checkpoint: Phase 1
- [ ] Full suite green; allowlist reduced to layout hairlines/exceptions only; rendered result
      claimed identical (fixture-level; pixel check deferred to owner preview).

### Phase 2: Components

- [ ] Task 4: Buttons — one component, 3 emphases (filled accent / tinted / plain) × 3 sizes;
      kill ad-hoc variants; ARIA cases per emphasis.
- [ ] Task 5: Chips & rows — composer picker chips, preset chip, attachment/screenshot chips onto
      one slotted chip; option rows onto one row vocabulary.
- [ ] Task 6: Modal system — dialogs unified geometry; settings sheet fold-or-restyle decision
      (above); notice + clarification/pair card + message bubbles + live activity reconciled to
      tokens; status pill as capsule label.

### Checkpoint: Phase 2
- [ ] Suite green incl. lifecycle/aria; lint allowlist empty for touched selectors; floating
      regenerated via script (never hand-edited) after any markup need.

### Phase 3: States × Surfaces

- [ ] Task 7: Narrow-first pass at 360px across all 7 states × {pill, transcript, dock, composer,
      Send}; ≥620px relax; two-pane floating ≥720px (CSS grid only); `dev/preview` state switcher
      extended so the owner can review every cell.

### Checkpoint: Phase 3
- [ ] Preview matrix reviewed by owner in a real browser (light+dark, 4 accents, 5 text sizes);
      findings fixed before continuing.

### Phase 4: Subtraction (propose-only default)

- [ ] Task 8: Present the six candidate cuts (toolbar version/turn-count, composer help line,
      settings footer, brand orb, dialog foot copy, empty-state orb) as a line-item list with
      exact relocation targets; apply only approved cuts, each preserving fail-closed wording.

### Phase 5: Styleguide + Docs

- [ ] Task 9: `dev/styleguide.html` (every component × state × theme × accent × size, driven by
      real `panel.css`); `docs/design-system.md` (Apple-idiom contract); README appearance section;
      CHANGELOG Unreleased entry.

### Phase 6: Release Checks

- [ ] Task 10: `npm run check` (sandbox fallback documented), `npm run package:extension`
      (allow-list unchanged — no fonts added), IMPLEMENTATION-STATUS honesty pass
      (fixture-verified vs owner-browser-verified), `/review` then `/ship` with human.

### Checkpoint: Complete
- [ ] All acceptance criteria met; open questions resolved; human sign-off recorded.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Settings-sheet fold breaks tested focus/inert behavior | High | Task 6 has an explicit restyle-instead fallback; lifecycle tests gate |
| Token remap causes unintended visual shifts | Med | One-commit-per-scale; owner preview diff at Checkpoints 1/3; lint allowlist tracks residue |
| Generator drift vs hand edits | Med | Drift test fails CI; contributors edit only `panel.html` + regenerate |
| Two-pane CSS regresses narrow floating window | Low | Breakpoint-scoped; `window-geometry.js` untouched; preview at 3 widths |
| Sandbox cannot render pixels | Known | Owner-side `dev/preview` review at Checkpoints 1/3; CI `npm run test:browser` where Chromium exists |
| Scope creep into behavior changes | Med | Boundaries in spec; adapter/send-path files out of scope by rule |

## Open Questions

- Q: Pre-approve any Phase 4 cuts now? (Recommendation: decide at Task 8 with concrete diffs.)
- Q: Ship-time version: stay 2.9.0 or bump 2.10.0 for the visible change? (Decide at Task 10.)
- Q: Which Plex… — **resolved: none** (direction (a) keeps system stacks).

## Parallelization Opportunities

- **Safe to parallelize:** Task 1 (generator) ∥ Task 2 (lint) — disjoint files. Within Phase 2,
  Tasks 4/5 touch overlapping `panel.css` hunks — coordinate hunk boundaries or run sequentially.
- **Must be sequential:** P1 → P2 → P3; Task 8 execution after approval; Task 9 after cuts; P6 last.
- **Needs coordination:** every markup change routes through the generator (Task 1) — land it first
  precisely so parallel hands never edit `floating.html`.

## Verification (project-wide floor)

Per `.agents/references/definition-of-done.md` plus AGENTS.md checks:

```bash
npm run check                      # eslint + tests (note: sandbox shell needs node --test test/*.test.mjs)
node --test test/<focused>.test.mjs
npm run test:browser               # CI only; Chromium unavailable in this sandbox
npm run package:extension          # final checkpoint; allow-list unchanged
```

Live-tab manual verification required before ship; Node/jsdom suites are structural, not pixel,
proof.
