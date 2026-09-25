# Arena Auto Chat — prioritized improvement review

Reviewed: 2026-09-25 · repository version: 2.8.1

> **Historical audit snapshot:** the findings below describe 2.8.1 before implementation. Work has now started in 2.8.2; see [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) for completed fixes, verification limits and the remaining roadmap. Original line references refer to the audited baseline.

## Executive summary

This extension has good foundations: a direct panel-to-content-script port avoids putting the service worker on the streaming path; ambiguous replies fail closed; automatic resends are forbidden; permissions are relatively narrow by default; and rich replies are reconstructed with an allow-list instead of injecting HTML. Preserve those decisions.

The largest improvement opportunity is **correctness and recovery**, followed by **real-browser compatibility testing**, **performance**, and **workflow continuity**. More animation or a framework rewrite should not be the first investment.

“5× better” is an objective, not an established result. Establish a baseline, then target fivefold reductions in avoidable failures and long-conversation processing cost where measurements support that goal.

## Scope and verification

- Inspected the manifest, panel, worker, client, DOM adapter, content-script transaction logic, attachment path, screenshot pipeline, renderers, documentation, and tests.
- Ran `npm ci` and `npm run check`: **ESLint passed; all 107 tests passed**. npm reported zero known dependency vulnerabilities in that install, but emitted deprecation warnings for ESLint 9.39.5 and a transitive encoding package.
- Ran additional Node/VM probes against the actual attachment policy and extracted, unmodified panel functions. Findings below distinguish reproductions from source-path analysis.
- **Did not run a signed-in Arena session or load the extension in Chrome.** Real-browser impact, layout, permissions, and current Arena compatibility still need browser validation. Passing jsdom tests is not evidence of current live-site compatibility.
- No implementation files changed during the original review. Subsequent implementation is tracked separately in the status document linked above.

Priorities: **P1** = fix before relying on the affected workflow; **P2** = important reliability/product improvement; **P3** = smaller improvement. Effort estimates are rough engineering effort including focused tests, not delivery commitments.

## Major fixes

### 1. Preserve exact file identity; never rematch by metadata — P1

**Evidence:** `panel.js:673–689`, especially the `files.find(...)` at line 683; normalization in `attachment-policy.js:27–47`.

Validation returns metadata and the panel searches the original batch for a matching File. Name, size, and MIME are not unique identifiers.

**Reproduced:** two different File objects named `same.txt`, both five bytes and `text/plain`, containing `alpha` and `bravo`, stage as **`alpha`, `alpha`**. Dropping files from separate directories is one way users can encounter equal metadata. This is a wrong-file problem, not just a usability issue.

A second reproduction: `code.js` with MIME `application/javascript` is normalized to `text/javascript`, then fails the metadata rematch. It is not staged, and the warning is immediately erased by the final status assignment. Dropping five valid files also silently ignores the fifth because the list is sliced before validation can report the excess.

**Fix:** have validation retain the original File reference or original index alongside normalized metadata. Normalize wire metadata without replacing source identity. Aggregate all rejection/skip reasons once, including over-capacity files.

**Acceptance:** distinct equal-metadata files preserve their bytes and order; supported MIME aliases stage correctly; every skipped file has a visible reason. **Effort: small, roughly 1–2 days.**

### 2. Make repeated script injection safe — P1 compatibility risk

**Evidence:** `manifest.json` automatically injects the three content scripts; `attachment.js:21–26` injects them again on every attach. `attachment-policy.js:4` declares a top-level `const ArenaAgentAttachments`, unlike the IIFE-wrapped DOM/content scripts.

**Reproduced in a shared classic-script VM context:** executing `attachment-policy.js` twice throws `SyntaxError: Identifier 'ArenaAgentAttachments' has already been declared`. The attachment code describes repeated injection as idempotent, but that shared-scope execution is not.

The exact result of Chrome's multi-file injection/error reporting must be tested in the real isolated world; do not assume the VM reproduction proves every connection currently fails.

**Fix:** wrap the entire policy registration in an IIFE with a version-aware, idempotent global registration. Consider a registration probe before reinjection. Avoid merely changing `const` to a mutable global.

**Acceptance:** automatic injection followed by attach, reconnect, second-panel attach, and same-document upgrade all complete without redeclaration errors. Test the entire injection bundle, not only `agent-content.js`. **Effort: small.**

### 3. Release attachment bytes after the send lifecycle — P1

**Evidence:** `panel.js:655–669` stores `payload` and `files` on each turn. `panel.js:525–528` and `558–563` do not clear them on acceptance/completion. The only explicit clearing is in a particular pre-click error branch at line 582. Cancellation also leaves the turn in history with these references.

**Reproduced:** applying the actual COMPLETE branch leaves both `turn.payload` and `turn.files` populated.

Four maximum-size files represent 32 MiB of original data and about 42.7 million base64 characters before additional message/decoding copies. Repeated sends retain these objects for the panel's lifetime. This is unnecessary in-memory retention, not evidence of disk persistence or exfiltration.

**Fix:** separate attachment metadata from temporary transport buffers; discard encoded payloads once safely handed off; keep original Files only as long as needed for an explicitly supported pre-send recovery. Centralize release on acceptance, completion, cancellation, interrupted sends, and terminal errors. Drop references rather than claiming JavaScript can guarantee secure memory erasure.

Also examine `stage-main.js:36`: its own-property override of `input.files` can retain the staged FileList and shadow the native getter. Prefer the supported native setter where viable; if an override is necessary, define and test its cleanup without breaking Arena's asynchronous reads.

**Acceptance:** historical turns hold metadata only; success and every terminal path release references; a repeated-upload heap test does not grow linearly with file bytes. **Effort: medium, roughly 2–3 days.**

### 4. Give every preparation phase a deadline and an exit — P1

**Evidence:**

- `agent-content.js:115` awaits `STAGE_FILES` without an application timeout. The grant timeout in `agent-client.js` does not bound this later worker call.
- `agent-content.js:248` skips scans before `tx.clicked`; the send acknowledgement deadline is only installed at line 411. A stuck staging call therefore has no transaction watchdog.
- `agent-client.js` clears its handshake timeout on WAITING. `panel.js:605–615` holds global `busy` while awaiting readiness; `panel.js:140` disables Focus, Disconnect, and other action buttons while busy. An Arena dialog can leave the panel indefinitely waiting without those escape controls.
- `panel.js:619–624` starts history loading without a response deadline.

**Fix:** introduce phase-specific deadlines and cancellation tokens. Keep “Open Arena” and “Cancel connection” usable while connecting. Handle slow generation separately from a dead transport—legitimate generation need not have a hard completion deadline. Add a history timeout that releases the loading state.

Timeout is **not cancellation of a Chrome API call**: reject late callbacks, expire staging markers/tokens, and make the main-world helper refuse stale requests before insertion. Never automatically retry Send after an uncertain outcome.

**Acceptance:** simulated missing responses cannot strand the UI; cancellation prevents late UI updates and any later Send click; a late staging response is reported safely. **Effort: medium, roughly 3–5 days.**

### 5. Bind screenshots to the draft/session that requested them — P1

**Evidence:** `panel.js:758–782` starts `captureLink` without an AbortSignal or epoch check. `clear()` at lines 179–186 neither cancels capture nor resets `shotDone`. Sending and model switching are not gated on `shotBusy`. `stageFiles()` itself does not reject a stale screenshot result.

**Source-path risk:** capture can finish after Disconnect, Send, or a conversation switch and stage an image into a different draft/session. Removing a screenshot also leaves its URL in `shotDone`, so its chip can remain unavailable for the rest of that panel's lifetime.

**Fix:** give each capture an operation ID, draft/session identity, and AbortController; cancel on clear/close; discard stale results before staging. Offer an explicit Cancel capture button. Define Send semantics while capture runs: either disable Send or ask to send without the unfinished capture. Scope deduplication to currently staged attachments, not a permanent set.

In `screenshot.js:178–237`, also pin/check the intended tab/document, detect navigation and viewport changes between slices, and record the final redirect URL. Do not label a redirected page solely with its original URL. Recheck cancellation during decode/stitching, not just the capture loop.

**Acceptance:** clear/switch/send during capture cannot contaminate another draft; cancellation closes the capture popup; removed screenshots can be captured again; navigation produces an explicit warning or safe failure. **Effort: medium, roughly 3–5 days.**

### 6. Make attachment eligibility reflect the actual target input — P2

**Evidence:** `attachment-policy.js:17–25`, `agent-dom.js:429–457`, `stage-main.js:14–20`, and `agent-content.js:82`.

The current `acceptAllows` asks whether every token belongs to the extension's vocabulary, not whether the selected file satisfies the actual input's accept list. Consequently a `.png`-only input is classified as usable even for a staged PDF; standard `image/*` is rejected altogether. The main-world helper repeats this logic rather than checking each file.

**Reproduced boundary bug:** an exactly 8 MiB file produces a base64 string whose `Math.round(length * 3 / 4)` estimate is **8,388,609 bytes**, one byte over the stated maximum. It is rejected before exact decoding even though its true size is **8,388,608**.

**Fix:** validate each file against extension policy AND the selected input's restrictions, including case-insensitive extensions, MIME aliases, and safe wildcard matching. Handle unknown constraints fail-closed. Bound encoded length first, then decode and validate the exact byte count, accounting for padding.

After staging, distinguish FileList insertion from Arena upload readiness. A fixed 300 ms delay plus an enabled Send button does not independently establish that every file upload completed. Add a bounded adapter-specific acknowledgement where the page exposes one.

**Acceptance:** test 8 MiB − 1, exactly 8 MiB, and 8 MiB + 1; `.png` versus PDF; `image/*`; MIME aliases; delayed/failed upload acknowledgement. **Effort: medium.**

### 7. Add real extension/browser tests around the highest-risk paths — P1 enabler

**Evidence:** CI runs ESLint and Node tests only. `test/content-script.test.mjs` substitutes a fake DOM adapter; it does not execute the full injection bundle. There are useful real DOM tests for question history and rendering, but no Chrome extension lifecycle suite or end-to-end attachment/screenshot workflow suite.

**Fix:** add a dev-only Playwright/Chromium extension harness and sanitized, versioned Agent/Direct fixtures. Use real extension pages, service-worker injection, isolated worlds, permissions, and ports. A fake-port UI preview remains useful, but is not a substitute.

High-value cases:

1. Auto-inject → attach → reconnect → detach/reattach.
2. One Send click under duplicate events, delayed callbacks, and reconnect races.
3. Distinct equal-metadata attachments and byte-for-byte transfer checks.
4. Worker suspension during staging and lost/silent ports.
5. Tab reload/navigation during send, response-pair selection, and clarification answers.
6. Screenshot permission denial/revocation, navigation, cancellation, and large images.
7. Keyboard-only setup/recovery and narrow/high-zoom panels.

Keep signed-in live-site smoke testing opt-in and explicitly authorized; never put credentials or private conversations in fixtures. **Effort: large initial investment, roughly 5–10 days for a focused suite.**

## Larger improvements worth building

### A. Explicit state machine and typed message contracts — P2

`panel.js` coordinates `state`, `busy`, `pending`, `switching`, `epoch`, and recovery state across many asynchronous callbacks. Extract a tested session controller with explicit connection and turn phases. Keep rendering separate from side effects. Use JSDoc plus `checkJs` and discriminated message types if keeping the no-build design; a framework migration is unnecessary.

Validate message shapes and limits at boundaries, attach an operation/session identity, and centrally enforce invariants: one in-flight send, no stale-session mutations, and no resend after an ambiguous submission.

### B. Make DOM compatibility a maintained subsystem — P2

`agent-dom.js:67–117` depends on presentation classes such as `.bg-surface-raised`, `.sticky`, `.font-mono`, and `.truncate`; Direct row IDs depend on position and a prompt hash. `modelCatalog()` reads framework hydration data. `matchTurn()` deliberately stops on prefix changes/virtualization.

Separate Agent and Direct adapters, prefer semantic attributes where available, maintain sanitized layout fixtures, and expose capability checks for composer/send/upload/questions/response pairs. Show “unsupported page layout” rather than a generic error when appropriate.

Do not loosen reply identity checks to make failures disappear. Any virtualization-tolerant tracking must preserve an independently verified conversation/turn anchor and refuse ambiguous matches. Never use private APIs or bypass sign-in/security checks as a fallback.

### C. Measure and reduce long-conversation cost — P2

`visible()` repeatedly walks ancestor styles (`agent-dom.js:204–210`), Direct scans rebuild row sets, live updates serialize full trees (`agent-content.js:65–69`), and the view iterates all turns on each render (`conversation-view.js:77–124`). Coalescing already helps, but the 300 ms timer and PING paths bypass the mutation scheduler's minimum-spacing gate.

Use per-scan style/visibility caches, scan-local row indexes, transcript-scoped mutation observation with safe remount detection, and a single scheduling gate. Render only changed turns and consider `content-visibility` or measured windowing for older turns, preserving accessibility/find/copy behavior.

For screenshots, cap total decoded pixels, not just each canvas dimension; decode/draw/release slices incrementally instead of `Promise.all` over every bitmap. Ensure partial decode failures close already-created bitmaps.

Benchmark 10/100/500-turn fixtures, p95 scan time, UI latency, long tasks, and heap growth before claiming an improvement factor.

### D. Recovery that preserves work — P2

Opening the floating window currently clears the local session and explicitly does not transfer history (`panel.js:627–629`). Reconnect similarly clears local content. Add memory-only ownership handoff between extension pages and a read-only reattach action that preserves visible history and draft where identity is verifiable. Never transfer permission to send silently.

Useful additional features: user-triggered Markdown/JSON export, in-panel conversation search, “copy prompt,” draft restoration after a verified pre-click failure, and “open this conversation in Arena.” Keep persistence off by default; any future saved drafts/history need explicit opt-in, retention limits, deletion controls, and updated privacy text.

### E. Useful, private diagnostics — P2

Record bounded in-memory diagnostic events: adapter/protocol version, phase transitions, timing, capability counts, error code, and whether Send was attempted/accepted. Offer an explicit redacted support export. Exclude prompts, replies, filenames, full URLs/query strings, account information, and file data. No default telemetry backend is needed.

## Minor fixes and polish

| Priority | Finding | Recommendation |
|---|---|---|
| P2 | No response watchdog on an open but silent port; PONG is not used for health tracking. | Track last inbound acknowledgement, show a distinct “tab not responding” state with foreground/resume controls, and reattach read-only when appropriate. Do not equate slow answer generation with connection loss. |
| P2 | `MODEL_NOT_CONFIRMED` only displays a notice after `connect()` has already enabled Send (`panel.js:306–313`). | If the user requested a specific model, require confirmation of the actual model or explicit acceptance before Send. |
| P2 | `keepTabAwake()` restores `autoDiscardable` to `true`, not the tab's previous value (`panel.js:413–416`). | Snapshot/restore the prior value, handle failed switch/connect paths, and release keep-awake when no longer needed. |
| P2 | The screenshot pipeline restores an old foreground window unconditionally; model-switch restoration can likewise override intervening user navigation. | Restore focus only if the user has not deliberately changed it since the operation began. |
| P3 | The 15-second handshake timer starts before a possible 20-second ATTACH (`agent-client.js` constructor/start). | Start handshake timing after attachment or define a clear total connection budget; make every connection timeout configurable in tests. |
| P3 | Settings declares `aria-modal="true"` but only makes the chat region inert; toolbar controls remain outside the modal focus boundary (`panel.js:40–46`, `panel.html`). | Use a native dialog or implement a complete focus boundary, restore focus to the opener, and test Escape/Tab/Shift+Tab and screen-reader announcements. |
| P3 | `attachment-status` is inside the hidden attachments container. If every selected file is rejected, there may be no visible error. | Keep validation feedback visible even when zero attachments are staged; test all-invalid selections. |
| P3 | Version strings and panel/floating markup are repeated across files. | Centralize runtime protocol/version configuration and add markup parity checks or generate both shells from a shared dev-time template, while keeping load-unpacked output available. |
| P3 | Model catalog cache invalidates only when inline-script count changes (`agent-dom.js:175–177`). | Tie invalidation to relevant data changes or explicit refresh, with bounded parsing cost. |
| P3 | README says 98 tests; the historical stability review has stale open findings; architecture says window geometry uses `chrome.storage` although implementation uses `localStorage`. | Update current documentation, clearly label historical findings, and avoid manually maintained test-count claims. Clarify that explicit paste events are handled, rather than claiming clipboard data is never read in any sense. |
| P3 | Dev dependency installation reports deprecations; release CI does not produce a reviewed extension-only artifact. | Evaluate a supported ESLint version against the Node support policy; add a packaging allow-list excluding tests, dev preview, Git metadata, and dependencies. Add browser/OS smoke-check and release notes. |
| P3 | Shortcuts are fixed, and useful workflow features are missing. | Offer Enter-vs-Ctrl/⌘+Enter preference, shortcut help, prompt copying, conversation search, and explicit export before adding further visual effects. |

## Recommended implementation order

1. **Correctness patch:** exact File identity, visible rejection reasons, 8 MiB boundary, safe repeated injection, and attachment lifecycle cleanup.
2. **Recovery patch:** staging/history deadlines, cancellable connection setup, screenshot session ownership, and stale-callback rejection.
3. **Browser confidence:** automate full injection, file staging, one-click/no-resend invariants, reload/reconnect, and screenshot cancellation in real Chromium.
4. **Scalability:** establish performance baselines, then implement per-scan caches, incremental rendering, and bounded screenshot decode.
5. **Product improvements:** verified memory-only dock/float handoff, non-destructive reconnect, diagnostics, search/export, accessibility, and documentation/release cleanup.

## What “5× better” should mean in practice

Use repeatable local benchmarks and an explicitly authorized smoke-test checklist, not a subjective score:

- **Correctness:** zero wrong-file substitutions, wrong-turn associations, or duplicate automatic sends in the regression suite.
- **Reliability:** target one-fifth the avoidable failures of a measured baseline on representative supported workflows; report tested scope and sample size.
- **Responsiveness:** target up to one-fifth the p95 adapter/render processing cost on a fixed long-conversation fixture, without delaying streamed updates.
- **Memory:** no retained attachment transport buffers after terminal states; no linear file-byte growth over repeated completed sends.
- **Recovery:** no stuck preparation/history operation without a bounded outcome and a usable exit; reconnects never resend.
- **Workflow:** preserve the user's draft/history during supported reattach and dock/float transitions, with sensitive data still memory-only by default.

Those outcomes would make the extension substantially more dependable without sacrificing its best property: refusing to guess when an action or reply cannot be verified.
