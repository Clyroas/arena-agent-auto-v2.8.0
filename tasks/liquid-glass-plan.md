# Implementation Plan: Expressive Liquid Glass UI

Status: **approved UI plan — T1 dev-only preview awaiting owner visual approval; production UI unchanged**. Source of truth: [SPEC-liquid-glass-ui.md](../SPEC-liquid-glass-ui.md). Detailed tasks: [liquid-glass-todo.md](liquid-glass-todo.md).

This is a distinct visual initiative on the fixed session branch and draft PR #22 (owner approved sharing that PR). The unfinished `tasks/plan.md`, `tasks/todo.md`, `tasks/skill-delivery-plan.md` and `tasks/skill-delivery-todo.md` remain untouched. Do not use `/build`'s default task target for this initiative: explicitly use these two UI files.

## Overview

Redesign the entire side panel and floating window using the owner-approved **expressive** Apple-inspired material direction. Keep all controls, safety copy, themes, accents, text-size preferences, IDs and chat/attachment behavior. A browser-only approximation will use semantic CSS material tokens, controlled translucency, illuminated edges and solid/contrast-safe reading layers, not Apple assets or proprietary UI. One preview-only slice is reviewed before touching production UI; then production changes are small and testable.

## Architecture decisions proposed for review

- **Reference-led, not a clone:** Apple's HIG Materials (light/dark regular glass), Toolbars (narrow Notes grouping) and Color (increased-contrast Notes) inform hierarchy and legibility, not exact visual copying. Material goes on the shell, settings and selected content cards; long reply text remains on controlled foreground washes.
- **Dev-only first:** add `dev/liquid-glass-prototype.css` loaded *after* real `panel.css` when `dev/preview.html?design=glass` is opened. The existing fake-port preview still renders production markup and JS; opt-in CSS is never allow-listed in `extension-files.json`. Extend its controls only enough to compare key states/themes. A human must approve the real-browser preview before T2.
- **Shared CSS, mirrored markup:** consolidate the final look in `panel.css` using semantic light/dark material tokens and existing theme/accent APIs; mirrored `panel.html`/`floating.html` IDs and ARIA semantics stay intact. Only presentation state hooks in `panel.js`/view modules if CSS cannot express a state. No adapter/protocol/permission change.
- **Expressive but bounded:** compositor blur only on a few toolbar/dock/dialog surfaces; bubbles/cards/settings groups use depth, tonal translucency and edge highlights without per-turn `backdrop-filter` in scroll lists. Never animate blur or filter. Increased contrast/reduced transparency/no-filter fallback surfaces are solid and preserve hierarchy. If this interpretation is not expressive enough in the preview, stop and request the owner's direction rather than increasing blur everywhere.
- **Measured finish gate:** retain existing contrast tests for two themes × four accents, add token and reduced-effect checks. Run keyboard/ARIA, state, width and long-transcript browser review. When browser automation is unavailable, show the dev preview and name the unverified checks; do not claim visual QA passed.

## Dependency graph

```text
T1 dev-only reference preview → Human visual sign-off
            │
            └→ T2 theme/material tokens + AA checks → T3 shell/composer + empty/error state
                                                        │
                                                        └→ T4 bubbles/activity cards → T5 settings/dialogs
                                                                                     │
                                                                                     └→ T6 fallback/ARIA states
                                                                                           │
                                                                                           └→ T7 responsive/browser finish gate
                                                                                                 │
                                                                                                 └→ T8 docs/package/live smoke
```

Tasks T2–T6 touch shared `panel.css`, so stay sequential. UI changes must land with focused tests; a separate screenshot review occurs after T1 and at final. Use `test/package.test.mjs` for panel/floating parity. Work on the old instrument concept and skill-delivery features remains out of scope.

## Ordered task index

| Stage | Task(s) | Gate |
|---|---|---|
| Preview | T1: dev-only actual-panel prototype, three representative states | Owner reviews visual direction before production |
| Materials | T2: tokens/AA; T3: shell/composer | AA + narrow-panel checkpoint |
| Components | T4: transcript/cards; T5: settings/dialogs | Content/keyboard checkpoint |
| Finish | T6: reduced effects/ARIA; T7: responsiveness/browser verification; T8: docs/package/live smoke | Definition of Done + owner ship review |

## Risks and mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Glass on dense text lowers readability across varied underlays | High | Use opaque inner washes; verify actual backdrops at AA thresholds and high contrast, not just translucent tokens. |
| Many blurred bubbles cause jank on a long transcript | High | Zero per-turn backdrop-filter; limit blur to fixed/modal surfaces; inspect 100-turn scroll/typing in browser. |
| Layout rework hides safety/error copy or shrinks transcript | High | Preserve all IDs/copy, measured dock layout and existing interaction tests; narrow-width review before shipping. |
| Existing panel/floating markup drifts | Medium | Update both together; existing parity test stays green. |
| Current browser environment lacks Chromium | Medium | Use user-facing preview and attempt browser install/run; report missing visual/axe QA honestly. |
| Prior approved instrument concept and unfinished skill PR collide | Medium | Preserve the earlier idea as historical context; keep UI task files separate; do not modify skill-delivery code/tasks or default plan. |

## Verification commands and checkpoints

Each task: add a focused guard or fixture where behavior/semantics change; run its Node test(s) and `npm run check`. Run `npm run package:extension` for release-file changes/final audit. Run `npm run test:browser` for fixtures if Chromium is available; manual visual review at 320/360/380/620/768/1024/1440 px, two themes, four accents, zoom, reduced motion, high contrast, error/permission states. After T1 show the live dev preview for owner approval; do not move to T2 merely because tests pass. After T8 seek live authorized Arena smoke review before release. The standing `.agents/references/definition-of-done.md` applies.

## Decisions confirmed at plan review

- First produce a preview-only opt-in stylesheet against the real fake-port panel; production files remain unchanged until owner visual review.
- Keep the expressive glass appearance on bubbles/cards/settings using tint and rim light, while limiting actual backdrop filters to a few fixed/modal surfaces for performance and legibility. Ask again if this is not visually expressive enough.
- Execute the approved 8-task checklist one task at a time, with separate owner preview and ship gates.
