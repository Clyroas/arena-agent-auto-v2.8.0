# UI review — panel, floating window and dev preview

Reviewed 2026-09-26 on `arena/01a0dbdf-arena-agent-auto-v2-8-0` from `main` `2f0400e`, with every version
anchor at 2.9.0.

**Surfaces in scope** — `panel.html`, `floating.html`, `panel.css`, `panel.js`, `conversation-view.js`,
`live-view.js`, `rich-view.js`, `live-status.js`, `copy.js`, `theme.js`, `customization.js`,
`recent-models.js`, `window-geometry.js`, `screenshot.js`, `dev/preview.html` + `dev/preview.js`.
`worker.js`, `agent-dom.js` and `agent-content.js` were read only where they define the UI contract
(the capability snapshot, the clarification/pair payloads, the picker state) — their own review is a
separate pass.

**Method** — the five-axis review from
[`.agents/skills/code-review-and-quality/SKILL.md`](../.agents/skills/code-review-and-quality/SKILL.md):
correctness, readability, architecture, security, performance, with the DOM/ARIA audit run against the
real markup in jsdom and the contrast ratios computed from the stylesheet's own tokens.

**What this review could not verify** — `npx playwright install chromium` fails in this sandbox
(`ECONNRESET` from `cdn.playwright.dev`), so `npm run test:browser` was not run and **nothing below is a
rendered-pixel claim**. Contrast numbers are computed from the token values in `panel.css`; the
rendering path, the motion layer in a real compositor and the floating window's geometry were read, not
watched. That is the same limitation README already documents for the original implementation sandbox.

## Summary

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| 1 | **Required** | Character counter and cut-paste warning survive `clear()` into the next session | `panel.js:86,207` |
| 2 | **Required** | Light-theme secondary/tertiary/accent text is below WCAG AA 4.5:1 across the whole panel | `panel.css:13,14,26` |
| 3 | **Required** | Option rows are `<button role="listitem">` — the button semantics are erased for AT | `panel.js:268,382` |
| 4 | **Required** | `#confirm-dialog` is the only dialog with no accessible name | `panel.html:89` |
| 5 | Optional | Any action button instantly clears the notice, including coded errors | `panel.js:774` |
| 6 | Optional | The scroll region is focusable but its focus indicator is removed | `panel.css:181` |
| 7 | Optional | A clarification card keeps its first snapshot of the question | `live-view.js:16-31,143` |
| 8 | Nit | A failed copy leaves `title` set on the button forever | `copy.js:12` |
| 9 | Nit | `body.floating-view` is styled by nothing | `floating.html:3` |
| 10 | Nit | Five-branch nested ternary in the transcript renderer | `conversation-view.js:116` |

No **Critical** findings: nothing in the UI layer leaks chat content, loses staged files or a draft,
or weakens a fail-closed guarantee.

---

## 1. Required — the character counter outlives the session it belongs to

`clear()` empties the composer (`panel.js:213`) but neither resets `promptCut` nor re-renders the
counter, and `render()` — which `clear()` does call — never calls `renderPromptCount()`
(`panel.js:86-102`, `panel.js:207-217`). Every `clear()` path therefore leaves the previous session's
counter on screen: **Disconnect**, **Open in a separate window**, *the connected Arena tab closed*
(`chrome.tabs.onRemoved`), and `pagehide`.

Reproduced against the real markup (`panel.js` + `panel.html` in jsdom, same harness the repo's own
`test/panel-lifecycle.test.mjs` uses):

```
1. long draft     -> counter hidden: false | text: "25,000 / 30,000 characters"
2. paste was cut  -> says: "was cut: 5,000 characters did not fit. Send the rest in a follow-up message…"
3. after clear()  -> prompt empty: true | counter hidden: false
                  -> still on screen: "25,000 / 30,000 characters · your paste …"
                  -> promptCut still set to: 5000
```

The user disconnects, the composer is empty, and the panel still tells them their paste was cut and
that they are 25,000 characters into a message that no longer exists. `data-full="true"` keeps the
text orange in the same state.

**Fix (1 line, in the place that already owns draft reset):** in `clear()`, next to
`$('prompt').value = ''`, add `promptCut = 0; renderPromptCount();`. Putting `renderPromptCount()`
into `render()` instead also works and covers every future path, at the cost of one extra DOM read per
live frame.

## 2. Required — the light theme's small text is below AA contrast

Computed from the tokens in `panel.css` (composited over the surface they sit on):

| Token | Light (on `--bg` / `--surface` / `--grouped`) | Dark (on `--bg` / `--surface` / `--grouped`) |
|-------|-----------------------------------------------|----------------------------------------------|
| `--secondary` (`panel.css:13`, dark `:41`) | **3.76 / 3.82 / 3.64** | 6.69 / 6.26 / 6.76 |
| `--tertiary` (`panel.css:14`, dark `:42`) | **2.04 / 2.05 / 2.01** | **2.73 / 2.82 / 2.61** |
| `--accent` as text on white (`panel.css:26`) | **4.02** | 4.66 |
| `--accent-ink` on `--accent` (filled buttons, the user's own bubble) | **4.02** | **3.65** (blue), **3.43** (green), **3.58** (amber) |
| white check on `--green` (`panel.css:245`) | **2.22** (needs 3:1 as a meaningful graphic) | 3.5+ |

WCAG AA needs 4.5:1 for text under 18.66px bold / 24px regular; every element below is 10.5–14px:
`--secondary` carries `.hint` (11.5px), `.message-meta` (11px), `.tool-activity` (12px),
`.question-option span` (12px), `.live-detail` (13px), `footer` (11.5px), `.field-label` (12px),
`.model-option-meta` (11px), `.group-title` (12px); `--tertiary` carries `#prompt::placeholder` (14px),
`.composer-note` (10.5px), `.message-index`, `.history-import-note`, `.pending-reply .hint`. So this is
not one rule to fix — it is the panel's entire secondary text layer in light mode, plus the dark
theme's tertiary layer.

The cause is that these are Apple's semantic label colours (`systemGray`/`tertiaryLabel`), which are
tuned for a compositor's blur and for 17px text, not for a 10.5px side-panel hint.

**Fix, one token change per theme** (values checked with the same maths):

- `--secondary` light → `rgba(60, 60, 67, .78)` (composites to `#66666c`, **5.52:1** on `--bg`).
- `--tertiary` → stop using it for text: at alpha `.65` it still only reaches 3.85:1. Either send the
  small-text users above to `#6e6e73` (**4.91:1**) / `--secondary`, or raise dark `--tertiary` to
  alpha `.62` (**6.72:1**) and give light `--tertiary` a fixed `#6e6e73`. Leaving `--tertiary` for
  hairlines, the spinner and icons is fine — those are decorative.
- `--accent` light `#007aff` → `#0071ed` (**4.58:1** with white, and as text on white); light
  `--green` `#248a3d` → `#23873c` (**4.56:1**). For the dark theme, flipping only the ink is enough:
  `#0a84ff` with a near-black (`#0a0a0c` = **5.42:1**) instead of white — keep the bright accent,
  change `--accent-ink` per theme.
- The `--green` status icon (white check on `#34c759` = 2.22:1) needs a darker green; `#2ba84a` clears
  3:1 (3.09:1) without losing the "done" hue.

None of this touches layout, motion or the accent's visual identity beyond a few percent of lightness.

## 3. Required — `role="listitem"` on a button deletes the button

`panel.js:268` (Direct model rows) and `panel.js:382` (repository/branch rows) both do:

```js
button.type = 'button'; button.className = 'model-option'; button.setAttribute('role', 'listitem');
```

An explicit `role` replaces the element's implicit role in the accessibility tree, so each row is
announced as a *list item*, not a *button* — the one thing the row actually is and the one thing the
user is meant to do with it. `listitem` is also not an allowed role for `<button>` under ARIA in HTML,
so this is a conformance violation and not only a preference; axe's `aria-allowed-role` would flag it.
Keyboard activation still works (native button behaviour is unaffected), which is why no test caught it.

The surrounding markup makes it worse: `#model-list` and `#picker-list` are `role="list"`
(`panel.html:82,87`) but also contain `<p class="model-group">` / `<p class="model-empty">` children that
are not list items, so the list announces children it does not own.

**Fix** — keep one of the two, not both. Cheapest and test-compatible (the repo's tests query
`#picker-list .model-option` as a descendant, so wrappers are safe):

```js
const row = document.createElement('div'); row.setAttribute('role', 'listitem');
row.append(button); return row;   // button keeps role=button and its accessible name
```

or drop `role="list"`/`role="listitem"` from this component entirely. If a real listbox is wanted
later, `role="option"` *is* an allowed role for a button, but it also requires `aria-selected` and
arrow-key navigation, so it is the larger change.

## 4. Required — the confirm dialog has no accessible name

`#settings-sheet` (`aria-labelledby="sheet-title"`), `#model-dialog`
(`aria-labelledby="model-dialog-title"`) and `#picker-dialog` (`aria-labelledby="picker-dialog-title"`)
all declare a name. `#confirm-dialog` (`panel.html:89`) does not — its `<h2 id="dialog-title">` and
`<p id="dialog-description">` are never referenced. That dialog is the one whose *visible* title and
body are swapped per call (`panel.js:223-234`), so the name cannot be inferred from static markup
either; AT announces an unnamed "dialog" for every clear-session/skip/continue confirmation.

**Fix:** `<dialog id="confirm-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description">`.
Both ids already exist. (Worth keeping: `showModal()` puts initial focus on `#dialog-cancel`, the
non-destructive action — that is right and should stay.)

## 5. Optional — action buttons wipe the notice they were meant to be acted on

`action()`'s opening line is `busy = true; notice(); render();` (`panel.js:774`), and `notice()` with no
text clears and hides the notice. Ten wired buttons behave this way (`refresh`, `float-window`, `open`,
`open-direct-tab`, `connect`, `focus`, `disconnect`, `reconnect`, `prepare`, `cancel`), so clicking
**Go to Arena tab** or **Refresh tabs** while reading a coded error such as
`COMPOSER_UNAVAILABLE: …` erases it before the user has finished the sentence — including the case where
the click itself fails and replaces it with a *different* message.

This contradicts the file's own documented intent two thirds of the way up: *"Info shrinks by itself
after a few seconds …; errors stay until you minimize them"* (`panel.js:104-105`). Either the comment or
the call is wrong. Suggested: `if ($('notice').dataset.kind !== 'error') notice();` so errors keep the
"stays until minimized" promise, or drop the call and let the next real message replace it.

## 6. Optional — the scroll region keeps the keyboard affordance but loses the focus ring

`#chat-scroll` is deliberately focusable (`tabindex="0"`, `role="region"`, `panel.html:18`) so a
keyboard user can scroll the transcript, and then `panel.css:181` sets `.chat-scroll:focus-visible {
outline: none; }`, leaving no visible focus at all (WCAG 2.4.7 / 2.4.11). Note the contrast with the
composer, where `#prompt:focus-visible { outline: none }` (`panel.css:356`) is fine because the ring
moves to the container via `.arena-composer:focus-within` — the scroller has no such replacement.

Suggested: swap the outline for an inset ring so the glass edge stays clean, e.g.
`box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent)`.

## 7. Optional — a clarification card never refreshes its own options

`createCard` (`live-view.js:16`) captures the first `question` object in its closure and `refresh()`
reads `question.options[index].disabled` from that snapshot; `render()` then only calls `item.refresh()`
(`live-view.js:143`) and never updates `item.question`. Labels, descriptions, per-option disabled
states and the radio `aria-checked` values therefore stay frozen for the lifetime of the card, even
though `readOnly`/`busy`/`answerState` are read fresh.

Impact is bounded and fail-closed — the content script re-resolves the card by fingerprint and refuses
with `QUESTION_CHANGED` if it has moved, so a stale row cannot click the wrong option (verified in
`agent-content.js:162-189` and `agent-dom.js:789-831`). What a user sees is a card whose wording can
disagree with Arena's, which is exactly the kind of drift the panel otherwise avoids. `refresh()` should
read `item.question = question` before rendering the locked states.

## 8. Nit — `copyText` leaves a stale tooltip behind

`copy.js:12` sets `button.title` on failure but the success path and the 1600 ms reset never clear it,
so a button that once failed keeps "Chrome did not allow the copy…" as its tooltip for the rest of the
session. Add `delete button.title` in the reset (or set the title only while `data-state="error"`).

## 9. Nit — `body.floating-view` is dead

`floating.html:3` is the only occurrence of `floating-view` in the repository: no rule in `panel.css`
and no code in `panel.js` reads it. Either a floating-only style was never written or a rule was
removed. Per the review checklist this is dead markup rather than a bug — **should I remove the class,
or was a `body.floating-view` rule intended?**

## 10. Nit — nested ternary chain in the transcript renderer

`conversation-view.js:116-119` selects one of five outcome strings with a nested `? :` chain inside a
template-literal assignment. It is correct, and it is the one place in the view layer that takes real
effort to read; a `const OUTCOMES = { cancelled: …, error: …, 'imported-no-reply': … }` lookup (with
`outcomeText` checked first) would flatten it to one line and make the wording table greppable.

---

## What the UI already does well (kept, not touched)

Not padding — these are the things a future change must not regress, so they are worth naming:

- **Fail-closed is visible.** Disabled controls carry the reason in `title` (`panel.js:156`), drift
  blocks Send before it happens (`panel.js:152,855`), and every coded error is shown verbatim rather than
  smoothed into "something went wrong".
- **Real accessibility machinery**: `inert` on the background plus a hand-rolled Tab trap for the sheet
  (`panel.js:48-70`), native `showModal()` dialogs, `sr-only` live regions for reply arrival, a
  `radiogroup`/`radio` pattern for clarification cards, `aria-pressed` mode toggle, `aria-current` on
  the selected model, deliberate focus return (`panel.js:52-56`), and a global
  `prefers-reduced-motion` kill-switch that `test/stylesheet.test.mjs` enforces.
- **Rendering is guarded, not re-run.** `ConversationView` and `LiveView` compare signatures before
  replacing nodes, the caret class only flips on a real state change, and rich replies are re-validated
  with `createElement`/`textContent` only (`rich-view.js`) — no `innerHTML` anywhere in the view layer.
- **The motion layer is honest**: state-keyed selectors only, compositor-only properties, and the
  stylesheet test fails the build if either drifts.
- **No new dependencies, no build step, no network**: the UI stays inside the MV3 CSP
  (`connect-src 'none'`), and the dev preview drives the production `panel.js` rather than a mock-up.

## Verification story

| Check | Result |
|-------|--------|
| `npm run lint` | pass (eslint) |
| `npm test` | **203/203 pass**, 0 fail (`node --test test/**/*.test.mjs`) |
| `npm run test:browser` | **not run** — Chromium cannot be downloaded in this sandbox |
| DOM/ARIA audit of `panel.html` in jsdom | ran; 50 interactive elements, 1 without an accessible name (`#attachment-input`, intentional: `aria-hidden`, `tabindex="-1"`, driven by `#attach-files`), every `aria-*` reference resolves, 4 dialog roles — findings 3 and 4 are the only violations |
| Contrast from `panel.css` tokens | ran; table in finding 2 |
| Stale-counter reproduction | ran; transcript in finding 1 |
| Rendered pixels / floating-window geometry / real compositor motion | **not verified** |

**Coverage gap that produced findings 1–4**: nothing in the suite asserts panel-wide UI invariants.
`test/stylesheet.test.mjs` checks CSS *structure* (braces, custom properties, keyframes, motion guards)
but never colour; `test/panel-lifecycle.test.mjs` drives behaviour but never roles; the counter reset is
untested. Three small guards would have caught all four, in the repo's existing Node/jsdom idiom:

1. `test/panel-aria.test.mjs` — load `panel.html` in jsdom; assert every dialog has a resolvable
   `aria-labelledby`, no `<button>` carries a role outside its allowed set, and every `aria-*` id
   reference resolves (the audit used here, ~30 lines).
2. extend `test/stylesheet.test.mjs` — parse the `:root` token blocks and assert the text/surface pairs
   used at ≤ 14px clear 4.5:1, so a palette tweak cannot silently re-break finding 2.
3. `test/panel-lifecycle.test.mjs` — after `clear()`, assert `#prompt-count` is hidden with the
   composer empty and the draft's cut counter is zero.

## Out of scope, noticed on the way (FYI)

Version strings inside the UI are correct and covered by `test/version-sync.test.mjs`, but three
prose references were not bumped past the 2.8.x era while everything else says 2.9.0:
`docs/architecture.md:28` (`ADAPTER_VERSION` / `VERSION` = `2.8.2`) and `:141` ("2.8.2 recovery
additions"), `docs/IMPLEMENTATION-STATUS.md:50` and `README.md:119` (`dist/arena-auto-chat-2.8.3`).
Documentation only — no runtime effect, no action taken here.

## Verdict

**Request changes** for items 1–4 (all small, all with a concrete fix above), and take or decline
5–10 individually. Nothing found blocks the 2.9.0 behaviour or the fail-closed contract, so this is not
a "stop the line" review — items 2 and 3 are the ones with real user reach, because between them they
affect every de-emphasised label in light mode and every row of the two new pickers.

Nothing in this pass changed runtime code, `.agents/`, `extension-files.json` or a version anchor; this
document is the only file added, and it is not packaged.
