# Architecture

How Arena Auto Chat 2.9.0 is put together: the three Chrome contexts, the wire between them, and
the paths a message, a file and a screenshot take. Companion to [STABILITY-REVIEW.md](../STABILITY-REVIEW.md),
which documents why the guarantees below exist.

## Contexts

| Context | Files | Lifetime | Role |
|---------|-------|----------|------|
| Extension pages | `panel.html` + `panel.js`, `floating.html`, `theme.js`, `customization.js` | For as long as the panel/window is open | All UI and user intent; holds the chat connection |
| Service worker | `worker.js` (+ `attachment.js`, `floating-window.js`, `stage-main.js`, `core.js`) | Ephemeral (MV3) | Short one-shot requests only — never on the chat path |
| Content script | `attachment-policy.js`, `agent-dom.js`, `agent-content.js` | The Arena tab | Owns the page: reads the transcript, types, clicks, scans |

Two structural decisions shape everything else:

- **The chat connection bypasses the worker.** Since v2.2.0 the panel opens a direct port to the
  tab's content script (`chrome.tabs.connect` from the extension page). The MV3 worker can be
  suspended at any time, so nothing long-lived may depend on it; it answers only one-shot requests
  (attach/inject, staged-file grants, floating-window creation), each with a timeout.
- **The DOM is touched only from the isolated world.** `agent-dom.js` and `agent-content.js` run in
  Chrome's isolated extension world with no site APIs or auth access. The one exception is
  `stage-main.js`, a self-contained function serialized into the **main world** by
  `chrome.scripting` once per explicit staged-file Send (see below).

## The wire

The version string is part of the protocol (`ADAPTER_VERSION` / `VERSION` = `2.8.2`, checked across the runtime
files by `test/version-sync.test.mjs`). The panel refuses an adapter that reports a
different version, and the worker refuses a page whose injected script did not register.

Panel ⇄ content script port messages include `PROBE`, `READY`, `PING`/`PONG`, `MODEL`/`MODEL_INFO`,
`SEND`, `CANCEL`/`CANCELLED`, `ANSWER_QUESTION`, `CHOOSE_RESPONSE`, `LOAD_HISTORY`, `PICKER`
(repo/branch picker `open`/`pick`/`close`, answered by `PICKER_STATE`/`PICKER_ERROR`), and streamed
event frames. The port itself provides liveness (it closes with the panel or the page); a heartbeat
every 10 s keeps state flowing, and a 5-minute lease in the content script guards against a silent
panel — sized to survive Chrome's once-a-minute timer throttling. The panel separately reports 90 seconds without inbound frames as a nonresponsive tab and pauses new sends; it does not terminate generation or resend.

Panel ⇄ worker one-shots (`chrome.runtime.sendMessage`) are bounded by `RPC_TIMEOUT_MS` (20 s) in
the panel, so a worker that is restarted mid-request cannot leave the panel stuck in `busy` (which
disables every control, including Disconnect). The client's `ATTACH` (20 s) and `STAGE_GRANT` (10 s)
calls are bounded the same way.

## Connection lifecycle

1. **Probe and attach** — the panel probes candidate tabs, verifies origin, page kind
   (`isArena` / `isDirect`) and adapter version, then connects.
2. **Handover** — when the panel reconnects, its old port closes and the page's side clears
   asynchronously. If the new connection arrived first it would be refused as `TAB_IN_USE`; the
   content script therefore probes the existing owner port and takes over when it is dead, and the
   panel retries `TAB_IN_USE` a few times with backoff before giving up.
3. **Streaming** — the content script watches the transcript with a `MutationObserver`. Scans (which
   read layout via `getComputedStyle`/`getClientRects`/`innerText`) are coalesced to at most one per
   `MIN_SCAN_MS` (120 ms); the 300 ms timer and panel heartbeats still force a scan so nothing is
   missed. Events flow to the panel, where `LiveView` renders tool steps, clarification cards and
   response pairs, and `live-status.js` derives "last change N ago".
4. **Teardown** — on panel close the port drops, staged grants are revoked best-effort (never
   throwing out of `close()`), and the Arena tab's `autoDiscardable` flag is restored.

Fail-closed rules: never guess (uncertain DOM state is a coded `DomError` from `agent-dom.js`, not a
best effort), never retry a click, never resend, one confirm dialog at a time (an overlapping request
is treated as *not confirmed*), and page equality is exact (`samePage()`) so a reply can never be
attributed to the wrong conversation.

## Staged files

Files are only ever read from a user pick/paste/drop in the panel, validated by the shared pure
policy in `attachment-policy.js` (max 4 files, 8 MB each, fixed MIME allow-list; dual format — ESM
for extension pages, `window.ArenaAgentAttachments` for the classic content script).

On **Send with files**: the panel asks the worker for a single-use grant keyed by
`tabId:documentId` with a 20-second window; the worker injects `stage-main.js` into the main world;
the helper finds the file input marked with the grant token, checks the request expiry, inserts exactly the approved bytes with the native FileList setter, consumes the marker, and
returns only file metadata. The content-side wait is limited to 10 seconds; cancellation/timeout removes the marker so a delayed helper cannot use it. This acknowledges insertion, not completion of a site upload. Grants are pruned eagerly and released per document. A staged file that
cannot be matched exactly (name + size + type when reported) is skipped with a visible note — never
substituted. Bytes are never stored, logged, cached, or sent anywhere else.

## Link screenshots

`screenshot.js` runs only after the user clicks a "screenshot this link" chip. The link opens in a
small popup window (1280×900), is scrolled and captured with `tabs.captureVisibleTab` in slices
(max 24 parts, 15 000 CSS px / 16 000 device px caps), stitched, and staged like a pasted image.
Chrome's ~2 captures/second quota is handled with up to 4 rate-limit retries at a growing pause; a
genuine failure surfaces as a clean, coded error. Requires the optional `<all_urls>` host
permission, requested on first use and revocable in Settings. Nothing is stored.

## Repo & branch pickers

Arena's Agent Mode can work on a GitHub repository; its composer then shows a repository and a branch
picker (Radix popovers). Since 2.9.0 the panel mirrors both. `agent-dom.js` recognises the triggers by
their exact icon geometry plus the trigger shape (`aria-haspopup="dialog"`, `aria-controls`, one
truncated label), reports them read-only through `READY`/`MODEL_INFO` as `repoPickers`, and exposes the
drive primitives. Every panel action goes through Arena's own controls on the tab's direct port:

- **open** — one click on the trigger (or adoption of an already-open popover, since a second click would
  toggle it closed), then the option rows are read from the popover its `aria-controls` names. Only
  `role="option"` rows, or buttons inside a `role="listbox"`, are accepted; anything else is a coded
  `PICKER_UNRECOGNIZED` and the popover is left for the user.
- **pick** — one exact-match click on one option row; unknown, duplicate or disabled options are refused
  with nothing clicked. Confirmation is read back from the page: the popover closed **and** the trigger's
  label now shows the chosen value. Anything else is `PICK_NOT_CONFIRMED` — never re-clicked.
- **close** — one Escape keydown on the recognized popover, then verification that it closed.

One action id per dialog ties the panel and the tab together, so a frame from a closed dialog can never
act as the current one. A Send while a picker is open fails closed (`PICKER_OPEN`), picker actions while
a turn is tracked fail closed (`PICKER_BUSY`), and a lost panel connection closes a popover it left open
with one best-effort Escape. There is no GitHub API, no extra permission and no storage: repo and branch
names are read from the page the user already trusts, capped at 120 characters, and never persisted.

## State and storage

| Data | Where | Notes |
|------|-------|-------|
| Theme (`light`/`dark`/`system`) | panel `localStorage` (`arenaAgentTheme`) | Appearance only |
| Text size, accent | panel `localStorage` (`arenaAgentAppearance`) | Whitelist-normalized on load |
| Recent Direct models (names, max 5) | panel `localStorage` (`arena-auto-recent-models`) | Names only, ≤ 120 chars |
| Floating window bounds | `localStorage` via `window-geometry.js` | Numeric normal-window bounds only |
| Staged file bytes | panel memory | Only for the current Send; single-use grant |
| Chat content, prompts, replies, screenshots, account data | — | Never stored anywhere |

Extension pages declare `connect-src 'none'`: the extension itself makes no network requests.
`copy.js` writes to the clipboard on the user's click. The panel handles explicit text/image paste events but never performs background clipboard reads.

## Module index

| Module | Exports / role |
|--------|----------------|
| `core.js` | `AGENT_URL`, `DIRECT_URL`, `isArena`/`isDirect`/`isDirectChat`, `directModelUrl`, `samePage`, `tabLabel`, `withTimeout`, `capabilitySummary` |
| `agent-dom.js` | `globalThis.ArenaAgentDOM`: selectors, transcript reading, typing, clicking, coded `DomError`s, `capabilities()` — a non-throwing semantic snapshot of which named controls the page currently exposes — and the repo/branch picker primitives (`pickerTriggers`, `repoInfo`, `pickerDialog`, `readPickerOptions`, `pickPickerOption`, `closePickerDialog`) |
| `agent-content.js` | Connection ownership, heartbeat lease, scan coalescing, registration guard |
| `agent-client.js` | `AgentClient`: the panel's direct port, heartbeat, bounded worker calls, normalized `repoPickers` state |
| `conversation-view.js` | Transcript rendering against the real `panel.html` markup contract |
| `live-view.js` / `rich-view.js` / `live-status.js` | Live activity, rich (Markdown/code) rendering, status derivation |
| `panel.js` | Panel bootstrap: tabs, state machine, notices, dialogs, settings |
| `attachment-policy.js` / `attachment.js` / `stage-main.js` | Policy (pure), worker attach, main-world staging |
| `screenshot.js` | Popup capture + stitching pipeline |
| `worker.js` | One-shot router: attach, staged grants, floating window |
| `floating-window.js` / `window-geometry.js` | Popup window creation and bound fitting |
| `theme.js` / `customization.js` / `recent-models.js` / `copy.js` | Appearance, recents, clipboard write |

## 2.8.2 recovery additions

- `attachment-state.js` preserves source File identity, transfers unsent originals back to a draft, and drops historical references. Transport payloads stay local to the send operation and are released in `finally`.
- `tab-awake.js` serializes acquire/release and restores the original tab flag; worker navigation does not change discardability.
- ATTACH and handshake have separate budgets (20 s and 15 s). WAITING for an Arena dialog allows at most 120 s, with independent Open Arena / Cancel connection controls. History requests have a 15 s deadline.
- Screenshot operations carry a session epoch, exact draft and AbortController. Capture is document-bound; stitching decodes one bitmap at a time and caps total canvas pixels. User focus is restored only if the capture window still held it.
- Same-page explicit reconnect preserves local content and re-watches only verified accepted message IDs. A different conversation still requires confirmation and a new connection.

See [implementation status](IMPLEMENTATION-STATUS.md) for test coverage, browser-validation limitations and work deliberately not yet implemented.
