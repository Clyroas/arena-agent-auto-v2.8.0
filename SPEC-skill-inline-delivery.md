# Spec: skill-inline-delivery

Status: **approved requirements and plan — implementation gated by task checkpoints**. Indexed by [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `skill-catalog`, `skill-selection`.

## Objective

When the user presses Send with an explicitly selected skill, deliver the **complete** selected primary `SKILL.md` plus the task in one Arena message **if** it fits the existing 30,000-character limit. The agent should see the skill as task guidance, not an installed system prompt or proof of tool access. No selected skill means the existing send behavior is unchanged.

## Tech Stack

Existing MV3 panel → Arena content-script port and send validation. Pure ES module assembly for the message; no runtime network, new host access, bundler or storage. The extension's existing message confirmation, one-send and recovery logic remain authoritative.

## Commands

- Focused composition/send tests (to create): `node --test test/skill-inline-delivery.test.mjs`
- Existing preset and panel regressions: `node --test test/skill-presets.test.mjs test/panel-presets.test.mjs`
- Full verification: `npm run check`

## Project Structure

- Pure composition helper in a small extension-side module, using the static catalog from `skill-catalog`.
- `panel.js` invokes it only in the Send path with the selected skill; page adapter changes only if evidence requires them.
- `test/` covers assembly boundaries, panel interaction and existing ordinary sends; document delivery semantics in `README.md` and `docs/architecture.md`.

## Code Style

Composition is deterministic and non-truncating, returning an explicit result rather than silently mutating the draft:

```js
const composed = composeSkillMessage(task, selectedSkill, 30000);
if (!composed.ok) return showOverflowChoice(composed);
// Only the user's Send action may hand composed.text to the existing chat transport.
```

Keep the original task draft and selected skill separately in memory until the validated Send. Attribute the skill and explain external tool/reference limits outside the unmodified primary text.

## Testing Strategy

Write failing tests first for under/equal/over 30,000 characters, Unicode length as the actual DOM/adapter uses it, empty task, stale selection, draft edits between preview and Send, disconnect and cancelled send. Verify a no-skill Send is byte-for-byte the existing behavior and that single-send/reconnect remains single-send. Synthetic browser fixture checks that the page receives exactly one complete message; manual live Arena verification is required before shipping, not replaced by fixture success.

## Boundaries

- **Always:** Validate composition and connection/page readiness immediately before Send; full skill and task must travel together in one user-approved turn, with no truncation or persistence. Expose enough of the composed payload for the user to understand what will go to Arena.
- **Ask first:** Adding automatic selection, multiple simultaneous skills, changing ordinary prompt/attachment semantics, or changing the page-adapter wire contract (which requires synchronized version anchors if approved).
- **Never:** Silently shorten a skill, split messages, send before the user's Send action, retry a Send, claim Claude-specific tools are available, or fall back to a summary/link if full delivery is impossible.

## Success Criteria

1. Given a selected skill and nonempty task, the exact complete primary text plus task is sent once when the composed payload fits 30,000 characters; no-skill sending remains unchanged.
2. At the limit, full content is sent; beyond it, **nothing** is sent by this module and the user is offered `skill-attachment-overflow` instead.
3. A stale selection, changed draft, disconnected tab, page drift, rejected Send or invalid text produces an explicit failure and preserves recoverable local intent without resending.
4. Tests cover task/skill provenance and verify no static skill text or task is written to persistent chat storage.

## Decisions Confirmed During Spec Review

- Full unmodified text is previewed on selection; a **concise summary at Send** is sufficient for inline delivery. Do not re-open the full skill preview at every Send.
- A separate, clearly attributed **compatibility warning** is sufficient when the primary text mentions absent files or Claude-only tools. Do not edit the skill text or claim those tools exist. The user still chooses whether to use that skill.
