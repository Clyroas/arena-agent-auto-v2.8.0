# Spec: Apple-Inspired UI/UX — Complete Polish Pass (Phases 0–6)

Status: **DRAFT — awaiting human review before implementation** (spec-driven-development gate).
Branch context: current Arena session branch, version anchors at 2.9.0. Companion plan/tasks:
`tasks/plan.md`, `tasks/todo.md` (overwritten for this initiative; the prior pill-reconnect /
chip-polish / SECURITY_CHECK plan is superseded as a working list — its Task 1 remains shipped code).

## Decisions recorded by the human (2026-09-27)

1. **Direction = (a): polish and complete the current Apple-style UI.** The "instrument panel"
   direction in `docs/ideas/instrument-panel-ui-revamp.md` is **not** adopted; that one-pager is
   superseded for visual direction (kept as history).
2. **No IBM Plex bundling.** Since direction (a) keeps the Apple system-font idiom, the ~800 KB
   font-bundling cost is **moot and declined**: fonts stay system stacks (`--font`, `--mono`),
   `extension-files.json` gains no font assets, `manifest.json` needs no `font-src`. This is the
   cheaper, equally-compliant reading of the Q2 answer; flag if you actually want Plex bundled
   anyway inside an otherwise Apple-style UI.
3. **"Complete" = all phases (0–6) in one run**, re-mapped from the one-pager's instrument-panel
   phase list onto the Apple idiom (below). The one-pager's structural spine
   (guardrails → tokens → components → states → subtraction → styleguide → release) is retained;
   only the *visual* direction changes.

## Objective

Make the side panel and floating window read as **one finished, coherent, Apple-grade product
surface** — the design language already present in `panel.css` (SF-system type, iOS semantic
colors, glass surfaces, capsule controls, spring-feel motion) applied *consistently everywhere*,
with every state, every surface, and both windows matching. Success = "it looks like one finished
product," not a new look. The user is the repository owner driving Arena Agent Mode daily.

**Non-goals:** no new behavior (no search/export/shortcuts), no framework or build step, no
runtime dependencies, no DOM-id renames, no toolbar icon change, no telemetry, no dock↔floating
session handoff (deferred per the one-pager). Fail-closed copy and guarantees are relocated at
most, never deleted.

## Commands

```bash
npm run check            # eslint + Node/jsdom regressions (every task; note: npm test relies on
                         # shell glob expansion — sandbox fallback: node --test test/*.test.mjs)
node --test test/<focused>.test.mjs
npm run test:browser     # opt-in Chromium fixtures; NOT runnable in this sandbox (no Chromium)
npm run package:extension
```

## Project Structure (touched paths)

```text
panel.html / floating.html   → markup parity (ids frozen; classes may change)
panel.css                    → the single stylesheet both surfaces load
panel.js                     → presentation + state mapping only
conversation-view.js live-view.js rich-view.js live-status.js theme.js customization.js
dev/preview.*                → state switcher used for owner browser review
scripts/gen-floating.mjs     → NEW: generates floating.html from panel.html (checked-in output)
test/                        → drift/stylesheet/palette/aria/lifecycle suites extended
docs/design-system.md        → NEW acceptance surface (Apple-idiom contract)
CHANGELOG.md docs/IMPLEMENTATION-STATUS.md README.md appearance section
icons/ui/*.svg               → redrawn in the same idiom if inconsistent (only if needed)
```

## Code Style

Plain CSS custom properties + plain JS modules, current conventions. Tokens first:

```css
/* Good: scale values only, semantic token names */
.composer { padding: var(--space-3); border-radius: var(--radius-l); }
/* Bad: invented values */
.composer { padding: 13px; border-radius: 14px; }
```

## Testing Strategy

- jsdom/Node suites prove structure: id parity, ARIA contracts, generated-file drift, stylesheet
  discipline (no raw sizes/radii/colors outside `:root`), palette AA (2 themes × 4 accents × 7 states).
- `npm run package:extension` proves the allow-list unchanged-or-documented.
- Pixel verification is **owner-side via `dev/preview`** and CI `npm run test:browser`; this
  sandbox cannot render (documented limitation, same as `docs/UI-REVIEW.md`).

## Boundaries

- **Always:** run focused tests per task + `npm run check` per checkpoint; keep `panel.html` ids;
  mirror every panel change into generated `floating.html`; preserve every fail-closed statement.
- **Ask first:** removing/relocating any copy block (subtraction cuts are line-item decisions);
  changing the accent value set; anything touching `agent-dom.js`/`agent-content.js` send paths.
- **Never:** add a build step to the packaged extension; add runtime deps; rename DOM ids; touch
  `.agents/`; store anything beyond appearance; broaden selector guessing.

---

## Phase Map (all six, one run)

### Phase 0 — Guardrails (zero visual change)
- T0.1 `scripts/gen-floating.mjs`: derive `floating.html` from `panel.html` (the known diffs
  become script parameters); checked-in output; drift test fails on divergence (pattern:
  `scripts/build-skill-presets.mjs` + byte-for-byte compare). `test/package.test.mjs` id-parity
  stays green.
- T0.2 Extend `test/stylesheet.test.mjs`: forbid raw px font sizes, radii, and hex/rgba colors
  outside `:root` blocks (allowlist for hairlines/0/1px where justified).
- Pre-existing baseline note: `npm test`'s quoted glob does not expand under this sandbox shell;
  use `node --test test/*.test.mjs` locally (245/245 green at baseline). Not a repo bug to fix here.

### Phase 1 — Tokens (Apple idiom formalized)
- Type scale (collapse 13 sizes → ≤6 named steps), space scale (4px grid), radius scale
  (collapse 15 radii → 5: `--radius-s…xl` + capsule), elevation (2 subtle shadow levels + glass),
  motion scale (duration/easing tokens; keep `prefers-reduced-motion` kill switch),
  state-color tokens for the 7 session states (`disconnected connecting ready sending waiting
  reconnecting error`) resolved to AA across 2 themes × 4 accents; extend
  `test/palette-contrast.test.mjs` to the new state tokens. No component restyling yet.

### Phase 2 — Components (one of each)
- One button (3 emphases × 3 sizes), one chip with slots, one row, one modal system (settings
  sheet folds into native `<dialog>` geometry while keeping tested inert/Tab-trap/opener-restore
  behavior), notice, clarification/pair card, message bubbles, live activity, status pill treated
  as the Apple "capsule label." All via existing tokens; ids untouched; ARIA per-component tests
  extended in `test/panel-aria.test.mjs`.

### Phase 3 — States × Surfaces matrix
- Narrow-first at 360px (pill · transcript · dock · composer · Send), relax ≥620px;
  ≥720px floating window becomes two-pane (transcript | live activity) in CSS only over the DOM
  `live-view.js` already owns. Verify light+dark, 4 accents, 5 text sizes in `dev/preview`.

### Phase 4 — Subtraction (each cut = ask-first line item)
From the one-pager's list, re-scoped to the Apple idiom; nothing removed without a yes:
toolbar `v2.9.0 · 0 turns` → Settings/empty-state; composer help 5 items → 1 line + `?`;
settings footer 3 paragraphs → 1 sentence + Privacy row; brand orb → glyph; dialog foot copy
trim; empty-state orb → text. **Default in this run: propose, do not execute, unless approved.**

### Phase 5 — Styleguide + docs
- `dev/styleguide.html` (component × state × theme × accent × size, driven by real `panel.css`),
  `docs/design-system.md` (the Apple-idiom contract: SF type stack, iOS system colors, glass rules,
  capsule geometry, spring motion), README appearance section, CHANGELOG.

### Phase 6 — Release checks
- `npm run check` full green; `npm run package:extension` allow-list unchanged (no fonts added);
  record honest verified-vs-fixture-only status in `docs/IMPLEMENTATION-STATUS.md`; owner runs the
  live Arena smoke test (cannot happen in sandbox).

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Settings-sheet → `<dialog>` fold breaks tested focus behavior | High | T2 lands with lifecycle tests green before any visual change; revert path kept |
| Drift test false failures from generation ordering | Med | Byte-exact generator + committed output reviewed once |
| Two-pane floating layout regresses window geometry code | Med | CSS-only constraint; `window-geometry.js` untouched |
| Palette re-solve shifts saved-accent contrast | Low | AA enforced by extended palette test; accent hex values preserved |
| Sandbox can't render pixels | Known | dev/preview owner review + CI browser suite; claims marked fixture-only |

## Open Questions (non-blocking defaults chosen)

1. IBM Plex: assumed **declined** (see decision 2). Reply to reverse.
2. Phase 4 cuts: assumed **propose-only** until line-item approval. Reply to pre-approve all/some.
3. Version at ship: assumed **stay 2.9.0** (panel-only, no adapter contract change) pending ship-time call.
