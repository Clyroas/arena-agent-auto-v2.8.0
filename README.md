# Arena Auto Chat

An experimental Chrome extension (Manifest V3) that chats on [arena.ai](https://arena.ai) for you
from a side panel — in **Agent Mode** or a **Direct** chat. It sends once through Arena's own page
and captures the matching reply from the transcript. There is no manual fallback and no separate
API client: if the page can't be driven reliably, the extension fails closed with an explanation
instead of guessing.

Version 2.8.1 · no build step · no runtime dependencies.

## What it does

- **Side-panel chat** — the conversation lives in Chrome's side panel (`panel.html`), or in a
  detached **floating window** (`floating.html`) with remembered geometry. Connect to a signed-in
  Arena tab (Agent Mode or Direct) and send from the panel; replies stream back live.
- **Live activity view** — while Arena works, the panel shows the in-progress text (with a caret
  while genuinely still streaming), tool steps as they start, clarification cards you can answer,
  and response pairs you can choose between — all marked *not a final answer* until Arena finishes.
- **Staged files** — pick, paste or drop up to 4 files (8 MB each; images, PDF, text, code) in the
  panel. Bytes are held only in memory and inserted into Arena's own file input at the moment of
  your explicit Send, through a single-use, 20-second grant.
- **Link screenshots** (optional, opt-in permission) — turn a link into a full-page screenshot as
  message context. The page opens in a small popup window, is scrolled and captured in up to 24
  slices, stitched, and staged like a pasted image. Nothing is stored.
- **Copy buttons** — reply text as Markdown, and code blocks. Write-only: the clipboard is never
  read, and nothing is ever pasted into Arena this way.
- **Appearance** — light/dark/system theme, text size, accent colour, and a list of the last 5
  Direct model names you opened. That is everything the extension persists.

## Install (unpacked)

1. Chrome 116 or newer.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.

Then open the side panel from the extension's icon, open arena.ai in a tab, sign in, and press
**Set up connection**.

## How it works

Three Chrome contexts cooperate; the version string is part of their wire protocol, and a
mismatch anywhere refuses the connection (`VERSION_MISMATCH` / `SCRIPT_REGISTRATION_FAILED`).

```
side panel / floating window          MV3 service worker            arena.ai tab
panel.js  (ConversationView,          worker.js  (one-shot          agent-content.js + agent-dom.js
LiveView, agent-client.js)            requests only: attach/        (isolated world; owns the
        │                             inject, staged-file           connection, scans, typing,
        │  direct port                grants, floating window)      clicking, reading the page)
        ├──────────────────────────────┤                            │
        └────── chrome.tabs.connect ────────────────────────────────┘
```

- The panel holds a **direct port** to the tab's content script, so Chrome suspending the idle
  service worker can never drop a chat connection. The worker answers only short one-shot requests,
  each bounded by a timeout with a recovery message.
- The content script reads and drives Arena's DOM only from Chrome's **isolated world** — no site
  APIs or auth access. Every worker request and scan is bounded, scans are coalesced to at most one
  per 120 ms during streaming, and reconnects survive a racy port handover.
- Fail-closed rules run through everything: never guess, never retry a click, never resend, one
  dialog at a time, exact matches over fallbacks, and a coded, visible error instead of a silent
  degradation.

Details: [docs/architecture.md](docs/architecture.md). The stability pass that established many of
these guarantees is documented in [STABILITY-REVIEW.md](STABILITY-REVIEW.md), including the
findings deliberately left open.

## Privacy

- **Not stored, ever** — chat content, prompts, replies, file bytes, screenshots, account data.
- **Stored** — appearance only: theme, text size, accent (in the panel's `localStorage`), the last
  5 Direct model names, and the floating window's bounds.
- **Permissions** — `sidePanel` and `scripting` are required; `https://arena.ai/*` is the only host
  permission. The optional `<all_urls>` permission exists solely because Chrome requires it for
  `tabs.captureVisibleTab`; it is requested on first screenshot use and can be revoked in Settings.
- **Network** — extension pages declare `connect-src 'none'`: the extension itself makes no network
  requests. Everything that reaches Arena goes through Arena's own page.

## Development

The extension has no build step; dev tooling is Node-based and dev-only (`node >= 20`):

```bash
npm install
npm run check     # eslint + 98 tests (node --test)
npm run lint
npm test
```

To watch the panel's motion against a fake Arena tab — no live chat, no network — serve the folder
with any static server and open the dev preview:

```bash
python3 -m http.server 8080    # then open http://localhost:8080/ (forwards to /dev/preview.html)
```

The preview loads the real `panel.html`, `panel.css` and `panel.js` and answers their Chrome API
calls with fakes, so everything on screen is produced by the production code paths. See
[docs/development.md](docs/development.md) for the test-suite map, the version-bump checklist, and
the conventions CI enforces.

## Repository map

| Path | Role |
|------|------|
| `manifest.json` | MV3 manifest: side panel, content scripts, permissions, strict CSP |
| `worker.js` | Service worker: one-shot requests only (attach, staged-file grants, floating window) |
| `agent-content.js` | Content script: connection ownership, scans, transactions |
| `agent-dom.js` | Isolated-world DOM layer: reading the transcript, typing, clicking |
| `agent-client.js` | Panel-side connection client: the direct port, heartbeat, timeouts |
| `panel.js` / `panel.html` / `panel.css` | The side panel (and floating window) UI |
| `conversation-view.js`, `live-view.js`, `rich-view.js`, `live-status.js` | Transcript and live-activity rendering |
| `attachment-policy.js`, `attachment.js`, `stage-main.js` | Staged-file rules, worker attach, main-world insertion |
| `screenshot.js` | Link screenshots (optional permission, opt-in per use) |
| `core.js`, `copy.js`, `theme.js`, `customization.js`, `recent-models.js`, `window-geometry.js`, `floating-window.js` | Small shared modules |
| `dev/` | Dev-only motion preview (not part of the extension) |
| `test/` | 98 tests via `node --test` (jsdom where the DOM matters) |
| `STABILITY-REVIEW.md` | The end-to-end stability pass: fixes, additions, open findings |
| `docs/` | Architecture and development guides |
