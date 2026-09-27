# Spec: Expressive Liquid Glass UI for Arena Auto Chat

Status: **approved design contract, UI plan and T1 visual preview — T2 production work pending**. This is a distinct visual initiative on the session's fixed branch and existing draft PR #22. It supersedes the *visual direction* proposed in `docs/ideas/instrument-panel-ui-revamp.md` (flat/no-blur/IBM Plex), not the repository's accessibility, privacy, packaging or fail-closed rules. That older idea document remains intact as historical context.

## Objective

Redesign the **entire side panel and floating window** into a visibly new, coherent interface inspired by Apple's layered Liquid Glass approach. The user is a daily Arena Agent/Direct chat operator who needs to understand connection state, read long replies, resolve errors, and send exactly once. Success means the UI feels intentional and materially different while preserving every existing task, control and safety message. This is a visual/interaction polish project, **not** a redesign of the Arena automation or a promise to reproduce Apple's proprietary native effect.

## Reference-led design contract

References examined (structure and principles, not assets to copy):

- [Apple HIG — Materials](https://developer.apple.com/design/human-interface-guidelines/materials): regular Liquid Glass over light/dark backgrounds and clear material over rich media. Separate interactive/navigation layers from reading content; use stronger fill for text-bearing surfaces and apply effects sparingly despite the expressive direction.
- [Apple HIG — Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars): the Notes wide/narrow toolbar examples establish priority and overflow at constrained widths. This panel retains its named status and recovery controls instead of copying the Notes layout.
- [Apple HIG — Color](https://developer.apple.com/design/human-interface-guidelines/color): light/dark and increased-contrast Notes examples demonstrate why a translucent control's foreground must adapt to its background. Arena's existing four accent choices stay distinct and meaningful.

**Screen job:** read a conversation and submit a deliberate message; connection status/recovery is immediately legible. **Primary action:** Send to Arena; never make a decorative element compete with it. **State matrix:** disconnected, connecting, ready, sending, waiting/streaming, reconnecting, error, staged attachments, open dialog/settings, and permission or unsupported-input notices.

**Visual hierarchy:** a calm spatial backdrop (not a colorful wallpaper), a translucent toolbar and composer dock above it, legible conversation content, and floating dialogs/sheets above both. Expressive glass also appears in settings groups, message bubbles and activity/clarification cards as controlled translucency, edge light and tonal depth. Dense reply text and coded errors sit on sufficiently opaque inner washes; do not put a uniform transparent panel under every text block. Use one restrained accent at a time, not a multicolor gradient or generic AI glow. Maintain product identity and original labels/icons rather than Apple branding or proprietary imagery.

**Material behavior:** CSS-only approximation using existing semantic tokens plus a small material scale (base, raised, floating, tinted). Keep the backdrop stable; don't animate blur, refraction, shadows or large paints. Do not apply `backdrop-filter` separately to every historical transcript row; use tinted fills and inset edge highlights for repeated content. The strongest blur belongs to a small number of fixed or modal surfaces. Provide solid, contrast-safe fallbacks when blur is unsupported or transparency/contrast is reduced.

**Typography and geometry:** keep the existing OS/system font stack, five saved chat text sizes, light/dark/system themes and four saved accents. Use consistent radii and spacing based on the current compact side-panel density; glass should not increase toolbar/dock height enough to hide the transcript at narrow widths. Avoid changing control labels or hiding fail-closed guidance without separate approval.

**Responsive/interaction rules:** side panel remains usable at 320–380 px; the floating window adapts across 620, 768, 1024 and 1440 px. Native buttons and dialogs retain keyboard/focus behavior, skip link, status text and screen-reader names. Effects respond to hover/focus/active without motion dependence. Reduced motion eliminates decorative animation; increased contrast/reduced transparency and no-filter modes use opaque surfaces and visible borders. No focus obscuration under dock or modal.

**Patterns rejected:** Apple logo/SF Symbols or copied proprietary assets; iOS clone; blur over entire transcript; many stacked translucent panels with low-contrast text; glass as the only indication of state; oversized radii, purple gradients, decorative shimmer, or component rewrites unrelated to appearance.

## Tech Stack

Existing MV3 plain HTML/CSS/ES modules with `panel.css` shared by `panel.html` and `floating.html`; existing `theme.js`/`customization.js` appearance preferences. No framework, bundler, runtime dependency, new permission, telemetry or external font/image request. CSS approximates an Apple-inspired material; it is not Apple's native compositing engine.

## Commands

- Baseline and regression checks: `npm run check`
- Focused color/material tests: `node --test test/palette-contrast.test.mjs test/stylesheet.test.mjs test/panel-aria.test.mjs`
- Synthetic browser fixtures (when Chromium is available): `npm run test:browser`
- Release allow-list: `npm run package:extension`
- Dev visual preview (existing fake Arena tab): `python3 -m http.server 8080 --bind 0.0.0.0` and open `/dev/preview.html`; never connect this preview to a real Arena account.

## Project Structure

- `panel.css`: semantic themes/material/spacing tokens, component treatments, solid fallbacks, responsive and motion guards.
- `panel.html` and `floating.html`: matched layout/ARIA structure; retain all existing IDs used by the shared `panel.js` and tests.
- `panel.js`, `conversation-view.js`, `live-view.js`: presentation-only state hooks if CSS/markup alone cannot express a required state; do not touch the adapter's send/selection logic.
- `dev/preview.*`: fake-port states for disconnected/ready/streaming/error, light/dark and panel/floating width review. Do not ship dev preview files.
- `test/palette-contrast.test.mjs`, `test/stylesheet.test.mjs`, `test/panel-aria.test.mjs` and browser fixtures: measure AA contrast, parity, focus and responsive behavior. Document final material tokens and verification in `docs/`/`README.md` after approval.

## Code Style

Extend semantic tokens rather than scattering hard-coded translucent whites and shadows:

```css
:root { --material-raised: rgba(255, 255, 255, .82); --material-edge: rgba(255, 255, 255, .62); }
:root[data-theme="dark"] { --material-raised: rgba(30, 31, 36, .88); --material-edge: rgba(255, 255, 255, .18); }
.card { background: var(--material-raised); border: 1px solid var(--material-edge); }
@media (prefers-contrast: more) { .card { background: var(--surface); } }
```

This is an illustrative contract, **not approved final palette values**; computed colors and contrast tests determine actual tokens. Keep CSS state selectors explicit; any JS changes should only map existing session state to presentation attributes.

## Testing Strategy

Begin with a thin visual slice in the **real existing preview**: toolbar, conversation with realistic content, composer and one error notice at narrow/wide widths and in both themes. Get owner review before rolling the material language through settings, dialogs, cards and all states. Write/update tests before each production slice where behavior/semantics change. Test computed foreground/background pairs against WCAG AA (4.5:1 normal text, 3:1 meaningful controls and focus) across themes and four accents; inspect dynamic backing content because static token contrast alone cannot prove translucent readability. Check keyboard order, open/close focus, reduced motion, high contrast/opaque fallback, high zoom, long replies/100-turn scroll, no console errors, and dark/light appearance. Verify panel/floating ID parity and no chat/permission changes. Run `npm run check`, browser fixtures if available, and `npm run package:extension`; request a live authorized Arena smoke test before shipping.

## Boundaries

- **Always:** Preserve original actions/labels, fail-closed notices, user-entered chat and staged files, appearance-only storage, one-send/no-retry behavior, light/dark and existing accent/text-size preferences. Keep scrolling and controls functional at 320 px with 200% zoom.
- **Ask first:** Removing/hiding controls or copy; changing product behavior, preview/transport, permissions or persistent storage; replacing bundled fonts/icons; changing the extension's theme or accent options; rewriting other initiative's task plan; major layout changes that shrink transcript utility.
- **Never:** Copy Apple assets/layout verbatim, add unrelated features, inject external CSS/JS, make glass the only signal of status/error, or let transparency compromise contrast/focus.

## Success Criteria

1. Side panel and floating window visibly share the approved expressive material language across toolbar, transcript/bubbles, composer, settings, dialogs and activity cards without loss of functionality or text legibility.
2. All interactive/error/empty/loading/permission states remain recognizable by label and shape as well as color; keyboard/focus/screen-reader contracts are maintained.
3. WCAG AA contrast passes for both themes and all four accents under expected backdrops, and opaque/high-contrast/reduced-motion/no-filter fallbacks are visually verified.
4. At 320/360/380/620/768/1024/1440 px, controls are reachable and text is not clipped; no meaningful transcript area is lost to extra decoration. A 100-turn fixture remains responsive without per-row blur cost.
5. Existing tests, new visual/ARIA regressions, package audit and applicable browser fixtures pass; no new runtime dependency, permission, persisted chat, or Arena adapter change. Final screenshot review and authorized live smoke check are documented before declaring done.

## Review gate

The owner approved this design contract. Next, review a separate UI task plan (do not overwrite the unrelated open task lists); after plan approval, build the preview slice, get visual approval, then implement production slices and verify. If expressive glass conflicts with legibility or performance in a real browser, show the trade-off and ask before reducing the requested intensity.
