# Spec: skill-attachment-overflow

Status: **approved requirements and plan — implementation gated by task checkpoints**. Indexed by [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `skill-inline-delivery`.

## Objective

When the selected full skill plus task exceeds Arena's 30,000-character composer limit, offer an explicitly approved `.md` attachment containing **only** that complete `SKILL.md` text; the task remains in the text composer. If local checks show Arena cannot accept the file or limits are hit, stop with a visible error before any Send click. Whether the agent actually reads an accepted attachment can only be established in runtime verification, not guaranteed in advance for each turn. Never silently split, trim, retry or send a task stripped of its selected skill.

## Tech Stack

Reuse the existing panel/worker/page staged-file path and `.md` attachment policy (four files total, up to 8 MiB each); create a transient `File` from packaged static skill text **only after user confirmation**. No new host permissions, runtime dependencies, persistent copies, or additional network traffic by the extension. Follow the existing one-shot staging and single-send semantics.

## Commands

- Focused attachment tests (to create): `node --test test/skill-attachment-overflow.test.mjs`
- Full regression suite: `npm run check`
- Synthetic browser tests: `npm run test:browser`
- Package audit: `npm run package:extension`

## Project Structure

- Panel-local overflow choice/confirmation UI in the existing panel/floating controls; a pure helper can build the transient `.md` File and validate capacity.
- Reuse `attachment-policy.js`, `attachment-state.js`, `stage-main.js`, `agent-client.js` and the page adapter where possible, without relaxing attachment validation.
- Add focused Node/jsdom and synthetic browser fixtures to `test/`; update `AGENTS.md`, `README.md` and `docs/architecture.md` to document the narrowly approved exception to user-picked files only.

## Code Style

Guard every action before staging and sending, with one explicit consent decision:

```js
if (!userConfirmed || !supportsMarkdown || remainingFiles < 1) {
  throw new Error('SKILL_ATTACHMENT_UNAVAILABLE: Nothing was sent.');
}
const file = new File([skill.text], `skill-${skill.name}.md`, { type: 'text/markdown' });
```

File identity, not filename or size metadata, controls restoration. Do not retain base64 or user data after transport, and avoid any auto-retry after an ambiguous Arena response.

## Testing Strategy

Test over-limit consent shown with exact source/name/size; cancel/no Send; accepted `.md` upload plus task in one turn; absence of file input, unsupported `accept`, full four-file slots, oversized/empty file, stale skill/draft, tab navigation, connection loss, staging success followed by uncertain send, and restoration of user-picked files on an unattempted send. Test that no user file is evicted to make room. Synthetic browser fixture validates attachment staging; a manual live Arena check must establish that the agent can **read** the attached skill, not merely see a chip. If live readability cannot be established, don't declare the feature shipped.

## Boundaries

- **Always:** Obtain a separate explicit confirmation for the generated attachment; show that it is the selected skill and that an existing file slot will be used; verify page input compatibility, four-file cap, size and page identity before attempted Send; preserve prior user files and draft if cancelled.
- **Ask first:** Raising file/size limits, bypassing page file-input checks, altering the adapter contract, any additional send/retry, or a different fallback if Arena cannot ingest Markdown.
- **Never:** Persist the skill file, attach it without consent, silently remove a user file, send the task alone after a staging failure, assume attachment upload implies the agent read it, or auto-resend after uncertainty.

## Success Criteria

1. On overflow, a user can explicitly consent to sending a full `SKILL.md` as a transient `.md` attachment with their task; the extension sends one turn at most and preserves file limits/permission boundaries.
2. Cancel, unsupported input/format, insufficient slots or an ambiguous page state sends nothing, displays a specific recovery message, and preserves the unsent task/selection/user files where safe.
3. No silent truncation, retry, persistent content, added network permissions or runtime dependencies. Existing user-picked files behave exactly as before.
4. Synthetic tests and a documented live Arena verification confirm the file is accepted **and its text accessible to the agent** before this module is considered ready to ship.

## Decisions Confirmed During Spec Review

- Show the full skill in the selection viewer and identify the chosen skill at Send. On **every overflow Send**, confirm creation and attachment of the generated `.md` file; do not stage it earlier or send it without this consent.
- If a file was staged but final submission is ambiguous, follow the existing fail-closed rule: **never retry or claim success**; say “check Arena before sending again” and keep recoverable local intent where safe.
