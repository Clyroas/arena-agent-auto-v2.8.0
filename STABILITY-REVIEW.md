# Stability review — Arena Auto Chat 2.8.0

Reviewed the extension end to end (13 modules, ~3,600 lines) for the failure modes that make it *stop
working* rather than do the wrong thing: hangs, dropped connections, races, unbounded work, and silent
degradation. The fail-closed behaviour that the code is deliberately built around (never guess, never
retry a click, never resend) was kept intact — every change below either removes a way to get stuck or
makes an existing guard reachable.

## Fixed in this review

| # | Issue | Why it mattered | Change |
|---|-------|-----------------|--------|
| 1 | `rpc()` in `panel.js` awaited `chrome.runtime.sendMessage` with no bound | A worker that is restarted, updated or killed mid-request can leave that promise pending forever. `action()` only clears its global `busy` flag in `finally`, and `busy` disables every control in the panel (including Disconnect), so one stuck request bricked the panel until it was closed and reopened. | Every worker request is bounded (`RPC_TIMEOUT_MS`, 20 s) with a message that says what to do; `withTimeout` also added to `core.js` and used for the client’s `ATTACH` (20 s) and `STAGE_GRANT` (10 s) calls. |
| 2 | Reconnect could be refused as `TAB_IN_USE`, permanently | The panel closes its port and reconnects immediately; the page clears its side of that port asynchronously. If the new connection arrived first, the content script refused it and the panel gave up for good — the user had to reconnect by hand, or lost a reply being tracked. | Content script now probes the existing owner port and takes over when it is dead (`portAlive`); the panel also retries `TAB_IN_USE` a few times with backoff before giving up. Verified: refused before, accepted after. |
| 3 | One full DOM scan per mutation batch | Arena mutates the page hundreds of times a second while streaming, and every scan reads layout (`getComputedStyle`, `getClientRects`, `innerText`). On a long conversation this is layout thrash: jank in the Arena tab and high CPU for the whole reply. | Scans are coalesced to at most one per `MIN_SCAN_MS` (120 ms); the 300 ms timer and the panel's heartbeats still force a scan, so nothing is missed. Measured: 40 mutations → **40 scans before, 2 after**. |
| 4 | Confirmation dialog could stack and throw | `showModal()` throws `InvalidStateError` on an already-open dialog. Two quick clicks on a model option or a response choice produced an unhandled rejection and a lost answer. | `showConfirm` allows one dialog at a time and treats an overlapping request as “not confirmed”; the model dialog is also guarded against re-opening. |
| 5 | Staged attachment could resolve to the wrong `File` | `files.find(...) || files[0]` fell back to the first file in the picker when metadata did not match exactly (for example a browser reporting an empty MIME type, or a filename with surrounding spaces). That would have sent a different file than the one the checks approved. | Exact match on name + size (+ type when reported); a file that cannot be matched is skipped with a visible note instead of being substituted. |
| 6 | `captureVisibleTab` quota aborted a whole screenshot | Chrome allows ~2 captures/second and a full-page shot needs up to 24. One quota rejection discarded every slice already taken, and the user saw a raw Chrome error. | Rate-limited calls are retried up to 4 times with a growing pause; a genuine failure is reported as a clean, coded error. |
| 7 | A dead port during teardown could throw out of `close()` | `sendMessage` throws synchronously once the extension context is invalidated. `close()`/`cancel()` are called from the connection-lost path, so the throw could break that path instead of just skipping a stale grant. | Best-effort `revokeStage()` that never throws. |
| 8 | Duplicate `pagehide` listener in `panel.js` | Registered twice verbatim, so `clear()` and `closeDialog(false)` ran twice on every panel close — redundant teardown work and a copy/paste artefact that hid the intended single registration. | One listener. |
| 9 | An exception while applying an event could freeze the view | `receive()` is called from the port listener; a throw mid-way left the panel on stale state with no rebuild and no explanation. | Guarded: the failure is logged, surfaced as a notice, and the view is rebuilt from the last known state. |
| 10 | Dead code and lint noise | `no-promise-executor-return` findings and an unused helper made it impossible to use lint as a signal. | Removed; `eslint.config.mjs` now has correct browser/worker/Node globals and runs clean. |

## Added alongside the fixes

- **`test/` (69 tests, `npm test`)** — the pure helpers (`core`, `attachment-policy`, `live-status`,
  `rich-view`, `screenshot`, `window-geometry`, `recent-models`), plus the paths that used to be
  untestable: the connection handover and scan coalescing in the content script (jsdom), the panel client’s
  hang/teardown paths (faked `chrome`), and a version-anchor check that fails if a future version bump
  misses one of the ten places the version is embedded. A mismatch there disables the extension at
  runtime (`VERSION_MISMATCH` / `SCRIPT_REGISTRATION_FAILED`), so it is worth a test.
- **`npm run lint` / `npm run check`, `package.json`, `.gitignore`, GitHub Actions CI** — the extension
  still has no build step and no runtime dependencies; these are dev-only.

## Findings left open (deliberately)

1. **Agent URL equality is exact** — `samePage()` requires an identical query string and hash for anything
   that is not an empty Direct chat, so a query parameter Arena adds mid-conversation stops the session
   with a clear message. This is the intended fail-closed tradeoff (better to stop than to attribute a
   reply to the wrong conversation); relaxing it needs evidence of what Arena actually rewrites.
2. **`visible()` cost** — it walks ancestors with `getComputedStyle` per element. The new coalescing limits
   how often that happens, but a per-scan computed-style cache inside `agent-dom.js` would cut it further.
   Worth doing with a benchmark against a real long conversation rather than blind.
3. **No watchdog on a silent (but open) port** — if the Arena tab is frozen by Chrome, heartbeats queue and
   the panel shows “last change N ago” from `live-status` but does not reattach. An automatic reattach here
   would false-positive on a legitimately frozen tab, so it was left as-is.
4. **`keepTabAwake` hand-back** — the Arena tab is marked `autoDiscardable: false` while connected and
   restored on a clean panel close; a browser crash can leave it non-discardable.
5. **No README** — the repository has no entry document at all. Useful, but out of scope for a stability pass.

## How to verify

```bash
npm install
npm run check   # eslint + 69 tests
```

The two behavioural fixes can also be re-checked against the pre-fix code by reverting the
`portAlive(owner)` takeover in `agent-content.js` (the reconnect is then refused as `TAB_IN_USE`) and the
coalescing block in `queueScan()` (40 mutations then produce 40 scans instead of 2).
