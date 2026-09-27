# Spec: skill-selection

Status: **approved requirements and plan — implementation gated by task checkpoints**. Indexed by [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `skill-catalog`.

## Objective

Allow a user to find, inspect the **entire** skill text and explicitly select it for a task. Selecting must not send, alter the task draft without consent, or imply that the skill can grant Arena tools it lacks. The existing Task prompts picker stays available.

## Tech Stack

Existing `panel.html`/`floating.html` parity, `panel.js` ES module and `panel.css`; static catalog from `skill-catalog`. No network, additional permissions, runtime dependencies, chat persistence, or automatic task classification.

## Commands

- Project checks: `npm run check`
- Focused panel tests (to create): `node --test test/panel-skills.test.mjs`
- Synthetic Chromium fixtures: `npm run test:browser`

## Project Structure

- Add matching controls/dialog markup to `panel.html` and `floating.html` (both execute `panel.js`).
- Add localized UI state and event handlers in `panel.js`, styles in `panel.css`, and pure catalog filtering helpers alongside the catalog or in a small runtime module.
- Add Node/jsdom and synthetic browser tests in `test/`; document the UX in `README.md`.

## Code Style

Use stable IDs and safe DOM APIs. No HTML interpretation of skill bodies:

```js
const entry = catalog.find(item => item.id === selectedId);
if (!entry) throw new Error('The selected skill is unavailable. Nothing was sent.');
preview.textContent = entry.text;
```

Follow the existing model/preset dialog patterns for labelled buttons, list semantics, focus restoration and one open modal at a time.

## Testing Strategy

Test search/grouping, source/license badges, previewing a long skill, keyboard navigation/escape, focus, screen-reader labels, panel/floating parity, selecting/removing/replacing a skill, and cancellation. Spy on the chat port: mere browsing/selection must produce zero sends. Tests verify task draft, staged files and chat history are unchanged. Browser fixtures verify the full preview remains usable at narrow panel widths.

## Boundaries

- **Always:** The user initiates selection, sees complete text before application, and knows which skill is active; warn when a skill refers to tools/paths/references absent from Arena. Do not retain the selected skill with user task data in persistent storage.
- **Ask first:** Multiple simultaneously selected skills, default or automatic skill activation, replacing the existing 34 prompt presets, or suggesting skills from private chat content.
- **Never:** Modify Arena's page while browsing, hide or silently abridge the text, create a modal over another open modal, or persist task/chat/selection history.

## Success Criteria

1. A user can search all catalog entries, distinguish source and license, and review the full primary text even for long skills; the UI announces absent external resources.
2. Skill selection is explicit, changeable and removable before Send; nothing is sent or attached by selection alone. The task draft and user-picked files remain intact.
3. Both panel and floating window provide equivalent accessible behavior; existing Task prompts retain their previous behavior.
4. Selection is ephemeral to the current local task/session, with no chat-content persistence.

## Decisions Confirmed During Spec Review

- **One selected skill per task** in the first release. After a verified accepted Send, clear the active choice so the next task requires explicit selection; after cancellation/pre-send failure, preserve it so the user can correct and retry deliberately.
- Show the entire unmodified text in a **scrollable accessible viewer** when selecting. At Send show the selected name and a concise summary of what will be sent; do not force the entire preview again for inline delivery.
