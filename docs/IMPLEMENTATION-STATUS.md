# Improvement implementation status — 2.8.2

Updated 2026-09-25. Tracks the first implementation batch from [IMPROVEMENT-REVIEW.md](IMPROVEMENT-REVIEW.md).

This is a correctness/recovery release, **not completion of the entire roadmap and not a measured 5× performance claim**. The original review remains an audit of 2.8.1; its line references describe that baseline.

## Implemented

| Review area | Changes | Verification |
|---|---|---|
| Exact File identity | Validation carries source indexes; the panel retains exact original File references. MIME normalization no longer causes a rematch. Overflow and all-invalid selections remain visible. | Policy, attachment-state and actual panel-handler regression tests. |
| Repeated injection | Attachment policy is an IIFE with immutable, version-aware registration; repeated evaluation is safe and stale registration is replaceable. Adapter/version anchors updated to 2.8.2. | Shared classic-script VM tests; Chromium isolated-world test passes in CI; local browser execution remains blocked (see below). |
| Byte lifetime | No encoded payload is stored on panel turns. Local payloads are released in finally blocks; original Files are released on acceptance, completion, cancellation, interruption and terminal errors, or returned once to an explicitly unsent local draft. Main-world insertion uses the native FileList setter, not an own-property override. | Attachment-state, panel and serialized main-world helper tests. Native Chrome test added. |
| Staging deadline/cancellation | Content-side STAGE_FILES wait is bounded to 10 seconds and abortable. Cancellation/timeout removes its marker. Worker clamps expiry to its single-use grant. Main-world helper rechecks token, connection and expiry immediately before native insertion. Late completion cannot trigger Send. | Timeout/cancel/late-response content tests, serialized helper tests. |
| Connection/history escape paths | Handshake starts after ATTACH; an Arena dialog gets a bounded 120-second window. Dedicated Open Arena / Cancel connection buttons bypass the global busy lock. History loading times out after 15 seconds and ignores late responses. | Client and panel tests; browser dialog cancellation test added. |
| Screenshot ownership | A capture belongs to an operation, session epoch and exact draft. Clear, switch, explicit cancel, draft edit and permission removal cancel local capture; Send waits for capture to finish or be cancelled. Removed screenshots can be recaptured. | Actual panel handlers tested with late capture completions. |
| Screenshot capture safety | Pin document IDs, check the active tab/URL/viewport before and after slices, use the final redirect URL, bound capture response waits, and avoid unconditional focus restoration. | Mocked browser API navigation/cancellation tests. Real screenshot workflow still needs Chrome verification. |
| Screenshot memory | Decode/draw/release one bitmap at a time; cap canvas area at 20 million pixels, individual decoded slices at 32 million pixels, and encoded capture data at 64 MiB of characters. Check cancellation through decode and encoding. | Incremental decode, partial failure, cancellation and pixel-budget tests. |
| Attachment eligibility | Per-file target accept checking, case-insensitive extensions/MIME aliases, supported image/text wildcards, and exact decoded size validation at 8 MiB. Independent validation in the serialized main-world helper. | Boundary, type restriction and atomic rejection tests. |
| Silent transport | After 90 seconds without an inbound frame, report a nonresponsive tab and pause new sends without terminating generation or resending. Any inbound frame clears that transport warning. | Client heartbeat-health tests. |
| Security-verification pause/resume | A visible captcha / "verify you are human" interstitial now pauses an in-flight turn instead of stopping it: `agent-dom.js` exposes a non-throwing `securityNotice()` alongside the fatal `checkBlocks()`, `agent-content.js` holds the turn and emits `BLOCKED`/`SECURITY_CLEARED`, and the panel shows a distinct paused status. The connect handshake waits through the notice (bounded) rather than failing, so the panel learns when the site passed verification. A pre-Send notice is waited out on a 2-minute budget; other blocks (rate limit, sign-in, Arena error) stay fatal. | Adapter `securityNotice()` tests against real `agent-dom.js` under jsdom; content-script pause/resume, handshake-wait and hard-stop tests; `live-status` and real-panel `BLOCKED`/`SECURITY_CLEARED` tests. |
| Non-destructive reconnect | Explicit reattach to the same conversation preserves draft/history and only re-watches a verified accepted message. Changing conversation still requires explicit clearing/confirmation. | Panel same-conversation reconnect regression. |
| Model verification | Requested model mismatch blocks Send until the user explicitly accepts the actual displayed model or makes another model choice. | UI and send-path guards; live model-picker smoke test remains required. |
| Tab wake settings | Memory-only serialized lease restores the original autoDiscardable flag, including acquire/release races. Navigation no longer changes the flag outside that lease. | True/false restoration and asynchronous race tests. |
| Modal keyboard behavior | Settings makes the entire background app inert, confines Tab/Shift+Tab, and remembers its opener for focus restoration. | Real-browser/screen-reader manual check still required. |
| Release hygiene | Explicit extension-file allow-list, dependency-closure/markup parity tests, clean unpacked artifact generation, Playwright fixture suite and CI browser job. | Node checks and packaging run locally; browser execution limitation below. |

## Verification commands and results

```bash
npm ci
npm run check                 # ESLint + Node/jsdom regressions
npm run package:extension     # dist/arena-auto-chat-2.8.2 (load this folder unpacked)
npm run test:browser -- --list
npx playwright install --with-deps chromium
npm run test:browser
```

- ESLint and the Node/jsdom suite pass locally. The suite covers the actual panel bootstrap/handlers as well as pure modules and content-side transactions.
- Packaging succeeds and includes the CSS SVG dependencies. `dist/`, browser traces/results, and dependencies are ignored by Git.
- Four browser tests are discoverable: full-bundle repeated injection, real file staging/one Send/reconnect, expired staging refusal, and dialog-wait cancellation.
- **Browser execution is not verified in this workspace.** Playwright's Chromium download failed with a TLS connection reset. An alternate local headless binary also lacked required system libraries. `npm run test:browser` failed at browser launch, before application assertions. The committed CI job installs Chromium and its system dependencies before running those tests.
- **CI browser validation subsequently passed:** all four Chromium tests pass in [GitHub Actions run 36138378920](https://github.com/Clyroas/arena-agent-auto-v2.8.0/actions/runs/36138378920). The initial CI failure was a test-harness dynamic import in `ServiceWorkerGlobalScope`; importing the packaged helper from the extension page fixes it without weakening any assertions. The real helper still executes in the Arena fixture’s MAIN world. GitHub annotations now expose future failure details independently of artifact downloads.
- No signed-in Arena automation, credentials, private transcripts, or live-site compatibility claims are involved. Browser tests intercept web requests with a synthetic fixture.

## Important boundaries

- A security verification that appears **after** the one Send click is still treated as a hard stop, not a pause: the page state at that moment is unknown, so the extension must not keep driving it. The pre-Send notice is instead waited out on a bounded 2-minute budget and then refused with an explicit code. Verification itself is never solved, bypassed or retried by the extension.
- A timeout cannot undo a Chrome API operation or a site upload already performed. Expiring/removing staging markers prevents late insertion where the helper has not yet run. If insertion already happened, the UI tells the user to inspect Arena; **there is never an automatic Send retry**.
- Native FileList insertion is not proof of completed network upload. The existing visible Send readiness checks remain; adapter-specific upload acknowledgement needs real, sanitized page evidence before it can be safely implemented.
- Dropping JS references is not guaranteed secure memory erasure. Content intentionally handed to Arena remains subject to Arena's own lifecycle.
- Clean teardown restores tab flags best-effort; browser/process crashes remain outside that guarantee.
- Changes to native file staging should be smoke-tested on a real authorized Arena session before distributing this release.

## Semantic capability diagnostics and drift detection

Added: `agent-dom.js` exports a non-throwing `capabilities()` snapshot of which named controls the page currently exposes (composer, Send control, transcript rows, clarification cards, response pairs, task-review panel, composer file input, site upload picker). It is reported in the `READY`/`MODEL_INFO` frames, stored on `AgentClient`, and summarised by the pure `capabilitySummary()` in `core.js`.

- When the snapshot is missing a control the adapter cannot send without (composer or Send control), the panel refuses Send with a coded, named gap and marks the connection-adapter line as drift (`#adapter-state[data-drift="true"]`). This turns an Arena markup change into an explicit "unsupported page layout" state instead of a generic failure mid-send.
- Only the composer and its Send control are required. A fresh conversation legitimately has no transcript rows yet, and clarification cards, response pairs, the review panel and upload are transient or optional for a text send; their absence is reported in the adapter line but never blocks. Requiring any of these would refuse the first send into a brand-new chat.
- An absent snapshot (a diagnostic that could not run, e.g. an older adapter) is reported but never blocks: adapter identity is already guarded by the version handshake, and a missing diagnostic must not turn a working connection into a refused send.

Verified by `test/capabilities.test.mjs` (the real `agent-dom.js` under jsdom, fed into the panel's summary helper), `test/core.test.mjs` and a `panel-lifecycle` case that asserts Send is blocked on a reported gap and released when the gap is optional.

## Still open / next batches
1. Extend the passing four-test Chromium suite to Direct, response pairs, clarification answers, worker suspension, screenshot permissions and extension updates; perform an authorized live-site smoke test.
2. Obtain evidence for Arena's upload completion/error UI and add bounded per-file acknowledgement without guessing.
3. Extract the broader session state machine and typed/validated message contracts. This release only extracts attachment ownership and tab-awake lifecycle helpers.
4. Split/maintain Agent and Direct DOM adapters; strengthen semantic capability diagnostics and tested virtualization behavior. *(Partial: the semantic capability/drift diagnostic is implemented — see the section above. Adapter split and virtualization remain.)*
5. Benchmark long conversations before implementing per-scan style caches, incremental transcript indexing/rendering and a unified scan scheduler. No DOM scan speedup is claimed here.
6. Memory-only dock/floating-window handoff (opening the floating window still asks to clear the local session).
7. Redacted diagnostics export, conversation search/export, prompt copying and configurable shortcuts.
8. Centralize duplicated version/markup sources, improve model catalog cache invalidation, and make mode-switch focus restoration respect intervening user navigation.
9. Evaluate supported ESLint/transitive tooling updates alongside the Node support policy; installation warnings are not yet eliminated.
10. Real-browser keyboard, high-zoom, screen-reader and target Chrome-version smoke testing.
