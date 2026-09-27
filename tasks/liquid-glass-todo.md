# Expressive Liquid Glass UI — Task Checklist

Status: **approved task list — T1 preview approved by owner; T2 production tokens pending**. Companion to [liquid-glass-plan.md](liquid-glass-plan.md). This is not the unfinished `tasks/todo.md` or `tasks/skill-delivery-todo.md`. Production UI work remains pending.

### T1 — Preview the material direction against the actual panel (dev-only) ✅
- [x] Opt-in `/dev/preview.html?design=glass` renders the real panel HTML/JS with a preview-only material stylesheet; default dev preview and packaged extension remain unchanged.
- [x] Show realistic ready/streaming/error with readable message/card/toolbar/composer at 360 px and wide floating sizes, light and dark; owner approved the visual direction before T2. Browser automation remains unverified due to Chromium download failure.
- [x] Test that the opt-in CSS is dev-only and no preview path enters the release allow-list.
- Dependencies: approved spec and plan. Candidate files: `dev/preview.html`, `dev/preview.js`, `dev/liquid-glass-prototype.css`, `test/ui-preview.test.mjs` (4).
- Verify: `node --test test/ui-preview.test.mjs`; `npm run check`; browser/manual owner review on dev preview URL.

### Checkpoint V1 — Owner visual decision ✅
- [x] Owner explicitly approved the live preview's visual direction before production changes.
- [x] Existing default preview and release artifact remain visually/behaviorally unchanged; package audit confirms no dev-only study files ship.

### T2 — Establish accessible material tokens
- [ ] Define light/dark base, raised, floating and edge tokens in production CSS while preserving four accents and saved themes/sizes.
- [ ] Contrast tests cover text and meaningful edges/focus over both theme backgrounds and new material treatments; no failing existing palette pairs.
- Dependencies: T1 + V1. Candidate files: `panel.css`, `test/palette-contrast.test.mjs`, `test/stylesheet.test.mjs` (3).
- Verify: `node --test test/palette-contrast.test.mjs test/stylesheet.test.mjs`; `npm run check`.

### T3 — Redesign toolbar and composer shell
- [ ] Toolbar, status/reconnect, composer and primary Send share the expressive material hierarchy; focus and narrow layout remain usable without clipping or lost transcript area.
- [ ] All existing control labels, IDs, help/privacy copy and one-send behavior stay intact in panel and floating view.
- Dependencies: T2. Candidate files: `panel.css`, `panel.html`, `floating.html`, `test/panel-aria.test.mjs`, `test/package.test.mjs` (5).
- Verify: `node --test test/panel-aria.test.mjs test/package.test.mjs`; `npm run check`; preview at 320/360/380 px.

### Checkpoint V2 — Shell and safety
- [ ] Text/focus contrast and layout verified in light/dark and four accents; notices still show coded errors and Send remains primary.
- [ ] Human reviews the production shell before the content-layer changes.

### T4 — Carry expressive depth through messages and cards
- [ ] User bubbles, assistant content, tool activity, clarification/pair cards get controlled translucency/rim light; long reply text and coded errors stay on contrast-safe inner washes.
- [ ] Repeated transcript rows do **not** each get a backdrop filter; tests enforce the performance boundary.
- Dependencies: T3. Candidate files: `panel.css`, `test/stylesheet.test.mjs`, `test/palette-contrast.test.mjs` (3); view JS only after review if semantics require it.
- Verify: `node --test test/stylesheet.test.mjs test/palette-contrast.test.mjs`; `npm run check`; real preview tool/error/question scenarios.

### T5 — Carry the language through settings and dialogs
- [ ] Settings groups and all existing dialogs use the same material scale; text-bearing controls have strong enough washes, clear boundaries and visible focus.
- [ ] Dialog open/close/focus recovery, options, acknowledgements and complete safety/privacy copy remain unchanged in panel and floating window.
- Dependencies: T4. Candidate files: `panel.css`, `panel.html`, `floating.html`, `test/panel-aria.test.mjs`, `test/panel-lifecycle.test.mjs` (5).
- Verify: `node --test test/panel-aria.test.mjs test/panel-lifecycle.test.mjs`; `npm run check`; keyboard-only settings/dialog run.

### Checkpoint V3 — Whole-product visual review
- [ ] Human checks connected/disconnected, waiting, error, question/response pair, settings and modal states in both themes.
- [ ] All state labels, focus rings and assistive names still convey meaning without glass/color.

### T6 — Add graceful solid and reduced-effect modes
- [ ] No-backdrop-filter, increased contrast/reduced transparency and reduced-motion paths use opaque legible surfaces; focus never disappears.
- [ ] Realized colors pass AA for normal text (4.5:1) and meaningful component/focus edges (3:1) across themes/accents and representative underlays.
- Dependencies: T5. Candidate files: `panel.css`, `test/palette-contrast.test.mjs`, `test/stylesheet.test.mjs`, `test/panel-aria.test.mjs` (4).
- Verify: focused color/style/ARIA tests; `npm run check`; manual high-contrast/no-filter inspection.

### T7 — Browser-responsive and performance finish gate
- [ ] Browser fixtures cover 320/360/380/620/768/1024/1440 px and 200% zoom, focus/scroll, light/dark, dialog and error states, with no clipped controls.
- [ ] Inspect 100-turn scroll and typing for jank; do not claim the UI is verified if Chromium/runtime checks are unavailable.
- Dependencies: T6. Candidate files: `test/browser/extension.spec.mjs`, `test/browser/fixtures/agent.html`, `dev/preview.js` (up to 3).
- Verify: `npm run test:browser` when available; manual/screenshots on the live dev preview; `npm run check`.

### T8 — Document and verify the release
- [ ] Document tokens/material purpose and high-contrast fallbacks, mark older instrument direction superseded without deleting it, update appearance guidance/status.
- [ ] `npm run check`, `npm run package:extension`, browser check (if available) pass; evidence and unverified live Arena points are recorded for owner ship review.
- Dependencies: T7. Candidate files: `docs/design-system.md`, `docs/ideas/instrument-panel-ui-revamp.md`, `README.md`, `docs/IMPLEMENTATION-STATUS.md` (4).
- Verify: `npm run check`; `npm run package:extension`; `npm run test:browser` if available; owner screenshot and authorized live smoke review.

### Checkpoint V4 — Ship readiness, not automatic deployment
- [ ] All spec criteria and standing Definition of Done checked, with no permission/storage/send/adapter changes.
- [ ] Owner approves visuals and any explicitly documented environment limitations; do not claim release-ready before accessibility and browser checks.
