# Changelog

## Unreleased

Interface revamp on 2.9.0. No protocol change — the version stays 2.9.0, so Arena tabs do not need a reload for this panel-only update.

- The conversation is the first surface. Connection setup opens from **Set up connection**, the status pill, or after disconnect, instead of covering the chat on launch.
- The mode chip and a minimized notice sit in the composer dock. They used to float above it, outside the height the transcript measures, and could cover the last reply and the jump control.
- Working, empty, and assistant marks use the accent you chose. The spinning rainbow edge is gone, so a live reply stays readable and the focus ring is the thing that moves.
- Narrow panels stack the connection actions. A long error cannot take more than a short slice of the chat. Staged files show a count on Attach. The composer only remeasures when the draft or its width changes, so a streaming reply does not thrash layout.

## 2.9.0 — 2026-09-26

Agent Mode **repository & branch pickers**, mirrored from Arena's own composer. Reload the extension **and Arena tabs** after updating (older adapters are rejected by the version handshake).

### Added

- When Arena's Agent Mode shows its repository and branch pickers (its GitHub integration), the panel mirrors both buttons beside its composer — same icons, same current values — and hides them on Direct chats and pages without them.
- Opening a chip opens **Arena's own picker** in the Arena tab and lists its options in the panel; searching in the panel only filters that list. Choosing an option clicks Arena's option row **exactly once** (exact-match only; unknown, duplicate-named or unavailable options are refused with a coded error and nothing is clicked) and the change is confirmed from what the trigger button then shows — never from the click alone. Cancelling dismisses Arena's picker with one Escape, and a picker that will not close is reported instead of forced.
- The pickers are recognised by their exact icon geometry from Arena's markup plus the Radix trigger shape; a redesigned picker becomes a named "not showing" state, not a guessed button. Two visible copies of one picker are ambiguity and are refused.
- A Send is refused with `PICKER_OPEN` while Arena's picker is open, and picker actions are refused with `PICKER_BUSY` while a turn is being tracked, so the two never interleave on the page. Losing the panel connection closes a picker it left open (one best-effort Escape).
- Wire: `PICKER` port requests (`open`/`pick`/`close`) and `PICKER_STATE`/`PICKER_ERROR` frames, each tied to one action id so a stale dialog can never act as the current one; picker state rides along on `READY`/`MODEL_INFO` as normalized `repoPickers`. No new permissions, no new storage, no GitHub requests — everything goes through Arena's own page.

### Validation

- New suites against the real adapter and content script under jsdom, built from the supplied Arena trigger markup: recognition (including decoys, dialog-scoped and duplicate triggers), option reading, one-click picking and refusal paths, Escape dismissal, `PICKER_BUSY`/`PICKER_OPEN`, stale action ids, disconnect cleanup; plus panel tests for the chips, dialog, filtering, confirmation and Send blocking (196 Node/jsdom tests, ESLint clean). Live-site behaviour of Arena's picker popover still needs an authorized smoke test, like the rest of the extension.

## 2.8.3 — 2026-09-25

Resume fix for the security-verification pause added in 2.8.2. Reload the extension **and Arena tabs** after updating.

### Fixed

- Passing a captcha / "verify you are human" check no longer stops tracking. Clearing the interstitial usually re-mounts Arena's transcript, so the first scan afterwards saw an empty row list and raised `CONVERSATION_CHANGED` ("…0 row(s) on page") — ending the turn exactly when the user had just cleared the check. A bounded settle window now re-anchors on the accepted message ID and continues on its own, with no manual reconnect.
- A transcript remount that outlasts the window, or a page where the accepted message ID is gone, still stops rather than capturing blind.

## 2.8.2 — 2026-09-25

Correctness and recovery work from the improvement review. Reload the extension **and Arena tabs** after updating; older adapters are rejected rather than mixing staging protocols.

### Fixed

- Distinct files with equal metadata retain their original bytes and order.
- MIME aliases, per-input file restrictions, wildcards and the exact 8 MiB boundary are handled correctly.
- File overflow and all-invalid selections display actionable feedback.
- Repeated policy injection is idempotent; synchronous Chrome attachment errors cannot race client initialization.
- Completed/cancelled/interrupted turns release original file references; transport payloads are not retained in turn history.
- Main-world staging uses the native file input setter, consumes its marker once and rejects expired requests.
- Staging and history waits are bounded; cancellation/timeout prevents late Send continuation.
- Connection handshake timing starts after attachment. A dialog wait has a deadline and accessible cancel/open-tab actions.
- Screenshot completion cannot attach into a cleared/changed draft. Capture cancellation closes its popup best-effort.
- Screenshot slices are document-bound and checked for navigation/viewport changes; final redirect URLs are reported.
- Screenshot stitching releases each bitmap promptly and enforces memory/pixel budgets.
- Tab discardability is restored to its prior value, including asynchronous release/reacquire races.

### Added / improved

- Same-conversation reconnect preserves local history and draft; verified accepted messages are re-watched read-only.
- Silent-port warning pauses new sends without resending or imposing a generation deadline.
- Requested-model mismatch requires explicit confirmation before Send.
- Settings keyboard focus boundary and opener restoration.
- Expanded Node/jsdom regression coverage, synthetic Chromium extension tests and a CI browser job.
- `npm run package:extension` creates an allow-listed unpacked extension under `dist/`.

### Validation / remaining work

Node checks and packaging pass. Chromium execution was blocked in the implementation sandbox by browser download/system-library availability, but all four Chromium fixture tests subsequently passed in GitHub Actions after correcting a test-harness import context. Authorized live Arena smoke testing remains required. See [implementation status](docs/IMPLEMENTATION-STATUS.md) for precise coverage and the remaining roadmap. No fivefold performance improvement is claimed.
