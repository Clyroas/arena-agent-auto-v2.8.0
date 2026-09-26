# Instrument Panel — Arena Auto Chat UI revamp

Refined 2026-09-27 on `arena/01a0df0b-arena-agent-auto-v2-8-0` from `main` `461c4a7` (every version anchor
at 2.9.0) with the **idea-refine** workflow (Define phase) from the vendored agent-skills pack
([`.agents/skills/idea-refine/SKILL.md`](../../.agents/skills/idea-refine/SKILL.md)). This is a one-pager,
not a spec or a plan: nothing in the runtime, `.agents/`, `extension-files.json` or a version anchor changed
with it, and it is not packaged. The next step, if taken, is `spec-driven-development` for Slice 0.

**Decisions recorded in the session** (the human's, not the agent's): scope = a full top-to-bottom UI
overhaul with a *visibly new* look · user = the repository owner, driving Arena from the panel daily ·
success = "it looks like one finished product" · repo rules hold (no build step, no runtime dependencies,
appearance-only storage, fail-closed) · spine = tokens → components → states · visual direction = **B,
instrument panel** · dock ↔ floating handoff = sequenced as the first follow-up spec, not bundled · typeface =
**IBM Plex Sans + IBM Plex Mono**, bundled · subtraction = specific cuts may be proposed, each needs a
line-item yes.

## Problem Statement

How might we make the side panel read as one finished, visibly new product — a cockpit for Arena's agent
rather than a chat bubble with features bolted on — for a daily Agent Mode user, without loosening a
fail-closed guarantee, adding a build step, or storing anything beyond appearance?

## Recommended Direction

**A state-forward "instrument panel" identity, built tokens → components → states, with guardrails first.**

The panel today has a good design language applied inconsistently. Measured on `panel.css` (782 lines,
176 class selectors): 13 distinct font sizes, seven of them inside a 3 px band; 15 distinct border radii;
20 button/chip/pill variants; two modal systems (four native `<dialog>`s beside a settings sheet with a
hand-rolled `inert` + Tab trap); three local breakpoints (380 / 560 / 620 px) each patching one overflow;
and `floating.html` as a 96-line hand-mirrored copy of `panel.html` that differs in three lines. The colour
layer is the exception — it is tokenised and AA-checked by `test/palette-contrast.test.mjs` since the
2026-09-26 UI review. Rather than extract the implicit system, we define a new one:

- **Surfaces:** flat, hairline-separated, no `backdrop-filter`; dark-first with a first-class light theme.
- **State is the design:** a persistent status strip in which each of the seven session states
  (`disconnected · connecting · ready · sending · waiting · reconnecting · error`) owns a colour, a glyph
  and a word. Errors look like errors; the coded error text is the design element, not an apology.
- **Type:** IBM Plex Sans for the interface and reply text, IBM Plex Mono for machine-facing text — coded
  errors, repository/branch, tool steps, the character counter. One family designed together; the
  IBM lineage is the theme.
- **Discipline:** dense in information, spare in chrome. Subtraction (below) is what keeps "instrument"
  from becoming "busy" — busy reads as *unfinished*, the opposite of the success criterion.

**Sequence.** (0) Guardrails — generate `floating.html` from `panel.html` with a checked-in output and a
drift test, the pattern `scripts/build-skill-presets.mjs` + `test/skill-presets.test.mjs` already use;
extend `test/stylesheet.test.mjs` to forbid raw font sizes, radii and colours outside `:root`; extend
`test/panel-aria.test.mjs` per component. Zero visual change. (1) Tokens — type, space, radius, elevation,
state-colour and motion scales; palette re-solved to AA for 2 themes × 4 accents × 7 states. (2)
Components — one button (3 emphases × 3 sizes), one chip with slots (icon · label · chevron · count), one
row, one status strip, one modal system, notice, clarification/pair card, message, live activity. (3)
States — a state × surface matrix (strip · transcript · dock · composer · Send) designed narrow-first at
360 px; ≥ 620 px relaxes; ≥ 720 px the floating window becomes two-pane (transcript | live activity — a
CSS grid over the DOM `live-view.js` already owns). (4) Subtraction — the line-item cuts. (5)
`dev/styleguide.html` (every component × state × theme × accent × text size, driven by the real
`panel.css`) plus `docs/design-system.md` as the acceptance surface. (6) Release — `npm run check`, the CI
browser suite, `npm run package:extension`, a recorded live Arena smoke test.

**Why B over the alternatives.** *Arena-native* (mirroring the shadcn-style idiom the adapter's selectors
reveal — Radix `data-state`, `sonner` toasts, Tailwind utilities) would blur the surface boundary the
"not a final answer" design depends on, would be guessing Arena's look, and would drift with every Arena
redesign. *Chrome-native Material 3* is coherent with the host but generic, and its 40 px controls and
large radii cost vertical space at 360 px. For one daily Agent Mode user, B is where cohesion and daily
friction coincide: legible states, first-class repo/branch/tool steps, errors that are unmistakable.

## Key Assumptions to Validate

- [ ] **Density reads as finished, not busy, at 360 px** (the riskiest — taste). Slice 0: a static mock of
      idle / streaming / error in `dev/preview`, reviewed in a real browser, approved before any component
      work starts.
- [ ] **IBM Plex Sans reads well for long replies at all five text sizes (12–18 px)** and Plex Mono at
      11–13 px for the strip and chips. Slice 0 renders the transcript in Plex Sans and in the OS face side
      by side; the fallback if Plex Sans loses is mono-only (−~130 KB) with the system sans for text.
- [ ] **The new palette clears AA** (4.5:1 text, 3:1 UI components and focus rings) across 2 themes ×
      4 accents × 7 state colours. Extend `test/palette-contrast.test.mjs` to the state colours; green before
      phase 2.
- [ ] **Native `<dialog>` can absorb the settings sheet** without losing the tested focus behaviour (inert
      background, Tab confinement, opener restore). `test/panel-lifecycle.test.mjs` already exercises the
      other dialogs under jsdom, so the harness exists.
- [ ] **A generated `floating.html` satisfies "no build step"** — checked-in output plus a drift test, exactly
      like `skill-presets.js`; `test/package.test.mjs` (id parity between the two files) stays unchanged.
- [ ] **The two-pane floating layout is CSS-only on existing DOM** — no `live-view.js` change; verified in the
      preview at ≥ 720 px.
- [ ] **Bundled fonts load under the extension CSP.** `manifest.json` declares no `font-src`/`default-src`,
      so a local `@font-face` is not blocked today; add `font-src 'self'` explicitly (manifest-only — not a
      wire change, no version bump by itself). `test/package.test.mjs` already scans CSS `url()`s, so a font
      missing from `extension-files.json` fails the suite.

## MVP Scope

**Slice 0 — tests the riskiest assumption (taste/density), ships nothing.** A tokens file and a static mock
of three states (idle, streaming, error) at 360 px in `dev/preview`, in Plex and in the OS face, reviewed
by the owner in a real browser. If it fails, re-cut before spending on components.

**The package — what "complete" means.** Phases 0–6 above, with these bounds:

- In: `panel.html` / generated `floating.html`, `panel.css`, `panel.js` (presentation and state mapping
  only), `conversation-view.js`, `live-view.js`, `rich-view.js`, `live-status.js`, `theme.js`,
  `customization.js`, `icons/ui/*.svg` redrawn in the new idiom, `dev/preview.*` (state switcher) and a new
  `dev/styleguide.html`, `docs/design-system.md`, `CHANGELOG.md`, the README appearance section,
  `docs/IMPLEMENTATION-STATUS.md`, `extension-files.json` (fonts + `OFL.txt`), `manifest.json`
  (`font-src 'self'` only).
- Retained: light + dark, the four accents, the five text sizes, the `prefers-reduced-motion` kill switch,
  every ARIA contract the 2026-09-26 review established, every fail-closed statement in the copy (moved,
  never deleted).
- Fixed: DOM ids in `panel.html` do not change — 245 Node/jsdom tests (green on the base commit) and the floating-window
  parity test depend on them; classes may change freely.
- Cost stated up front: the packaged extension grows from **552 KB to roughly 800 KB** (Plex Sans + Mono,
  Latin WOFF2, variable where available). The licence is SIL OFL 1.1; the licence file ships next to the
  fonts.

## Not Doing (and Why)

- **Dock ↔ floating handoff** — sequenced as the first follow-up spec, not dropped. Chat is never persisted,
  so a handoff moves in-memory session state (the direct port, the tracked turn, staged file bytes, history)
  between two extension pages; it touches `panel.js`'s session lifecycle, `worker.js`'s floating-window
  request and the port handover, and it may force a version bump. It is `docs/IMPLEMENTATION-STATUS.md`
  "Still open" #6 in its own right, and it cannot be verified in a sandbox without Chromium. Mixing it into a
  visual overhaul would make both harder to verify.
- **The Arena-native look** — surface-boundary risk, guessed idiom, drift with Arena's redesigns.
- **New behaviour** — conversation search/export, prompt copying, configurable shortcuts
  (`IMPLEMENTATION-STATUS` #7). This package changes look and structure, not what the panel does.
- **A framework or build step** — `AGENTS.md` rule 3. Everything stays plain CSS and JS; generated files are
  checked in with drift tests.
- **Renaming DOM ids** — a guardrail, not a limitation.
- **The extension's toolbar icon (`icons/icon16–128.png`)** — a brand asset and a separate decision; only the
  in-panel UI glyphs are redrawn.
- **Telemetry on theme/accent/text-size choice** — `AGENTS.md` rule 5; appearance stays local.
- **Pixel verification in the implementation sandbox** — impossible without Chromium, as `docs/UI-REVIEW.md`
  already records. The owner reviews in the browser via the dev preview, CI runs `npm run test:browser`, and
  a live Arena smoke test is recorded before release.

## Proposed cuts — each needs a line-item yes (nothing is removed otherwise)

Fail-closed statements ("nothing is sent", "one send, no retries", "not a final answer") are relocated,
never deleted.

- [ ] Toolbar: drop `v2.9.0 · 0 turns` from the header — version moves to Settings › Help & privacy, the
      turn count to the transcript's end / empty state.
- [ ] Composer help line: five items → one line; keyboard hints move behind a `?` affordance.
- [ ] Settings footer: three paragraphs → one sentence plus a Privacy disclosure row.
- [ ] The brand orb `a` → replaced by the status strip's glyph; the brand lives in the window title.
- [ ] Model / picker / presets dialog foot copy: three sentences → one; the rest into Help.
- [ ] Empty-state orb → text-only, in the strip's idiom.

## Open Questions

- Version at ship: stay 2.9.0 (panel-only, no adapter-contract change — `AGENTS.md` rule 6) or bump to
  2.10.0 to mark the visible change? Decide at ship time, together with the `CHANGELOG.md` entry.
- Does the status strip *replace* the toolbar pill (recommended: toolbar = strip + gear) or join it?
- Settings: keep the bottom-sheet look as a `<dialog>`, or match the other dialogs' geometry?
- Which Plex weights and subsets ship: Sans variable (Latin) + Mono 400/500/600, or fewer?
- When can a live Arena smoke test happen, and who runs it?
- Which of the proposed cuts are approved?
