# Reliability refinements — Arena Auto Chat 2.9.0 → hardening pass h1

Drop-in hardening for the extension in
[Clyroas/arena-agent-auto-v2.8.0](https://github.com/Clyroas/arena-agent-auto-v2.8.0).
Two new modules, one manifest replacement, and six small anchored patches to existing files
(see [INTEGRATION.md](./INTEGRATION.md)). No build step added, no runtime dependencies, no
protocol changes: the port contract (`READY`, `WAITING`, `SENDING`, `WATCH`, picker events, …)
and every fail-closed rule (one click, no resend, exact matches, coded errors) are untouched.

## Contents

| File | What it is |
| --- | --- |
| `manifest.json` | Full manifest replacement: adds `webNavigation`, prepends `content-hardening.js` to the content script list. Everything else identical. |
| `content-hardening.js` | Isolated-world reliability layer (first content script). Works standalone; the patches in INTEGRATION.md light up the rest. |
| `worker-hardening.js` | Worker ES module: content-script liveness probe, bounded inject-and-verify, tab/document lifecycle cleanup. |
| `INTEGRATION.md` | Exact patch blocks for `worker.js` and `agent-content.js`, anchored to current source lines, plus a verification checklist. |

## What was weak, and what changed

| Concern | Before | After |
| --- | --- | --- |
| **Injection reliability** | Scripts existed only via manifest `document_idle` injection or whatever `attachAgent` did; a dead context (extension update, tab restore) meant manual tab reloads. | `ensureAgentLoaded()` probes liveness with a throwaway port, injects only when dead, verifies after injecting — bounded, throttled, read-only. Wired in front of `ATTACH` (patch 1b). |
| **DOM observation** | Single `MutationObserver` on `documentElement`; if the root was replaced or the callback threw, scans degraded silently. | `observeDocument()`: same 120 ms coalescing, callback errors captured to a ring buffer, 1 s health tick re-attaches when the observed root detaches or `<html>` is replaced (patch 2b). |
| **Element detection** | Fixed 200 ms poll while the composer hydrated against a 12 s deadline. | Exponential backoff capped at 1.2 s inside the same deadline — same budget, a third of the layout reads (patch 2e). Generic `waitFor()`/`retry()` helpers available for future detection paths. |
| **Retry for late elements** | None general-purpose; per-site deadlines only. | `ArenaAgentHardening.retry()` (exponential backoff + jitter + abort signal) and `waitFor()` — deliberately exposed **only** for read-only recovery paths; never wraps a click or a Send. |
| **Cleanup on navigate away** | `pagehide` covered the tab; worker-side state (stage grants, per-tab maps) waited out the 20 s TTL on dead documents. | Worker lifecycle: `tabs.onRemoved` and top-frame `webNavigation.onCommitted` notify `onTabGone` hooks; grants for dead tabs/documents are dropped immediately (patch 1a). SPA pushState is intentionally ignored — the adapter owns those URL rules. |
| **Duplicate injection** | `__ARENA_AGENT_REGISTRATION__` guard already prevented double-registration; duplicates were invisible. | `content-hardening.js` counts re-executions (`diagnostics().boots`), zombie contexts are disposed within ~2.5 s of an extension reload, and probe-before-inject avoids redundant `executeScript` calls entirely. |
| **Safer mutation observers** | Callback exceptions became unhandled rejections in the page console. | Observer callbacks wrapped; a global `unhandledrejection` capture in the hardening layer records every async scan failure without changing semantics; all observers registered with the layer are stopped together on teardown. |
| **Error handling** | Good at the protocol level; internal async failures were invisible. | Ring-buffered logger + `scanErrors` + `diagnostics()` exposed over the existing port as a `DIAG` message (patch 2f). Read-only, no send path depends on it. |
| **Host-page interference** | Capture-phase `click` listener without `passive`; listeners re-registered only on cleanup. | Click listener is `{ capture: true, passive: true }` (patch 2d); bfcache restores dispose the stale registration instead of keeping dead listeners; still zero page-world globals, zero injected UI, isolated world only. |
| **Context separation** | Already clean (panel ↔ port ↔ worker one-shots). | Preserved and made explicit: the worker module never touches the port protocol; the content layer never sends; the probe port name (`arena-agent-probe-v1`) is ignored by the adapter. |

## Deliberately unchanged

- Fail-closed rules: no retry around any click, no resend, one dialog at a time, exact matches.
- The 120 ms scan coalescing and heartbeat-rescan design.
- The `VERSION_MISMATCH` gate and all coded error strings the panel renders.
- Privacy posture: no new storage, no network, `connect-src 'none'` intact; the only new
  permission (`webNavigation`) observes navigation events for `arena.ai` tabs and grants no
  content access.

## Merging

1. Copy `manifest.json`, `content-hardening.js`, `worker-hardening.js` to the repo root
   (manifest replaces the existing one).
2. Apply patches 1a–1b to `worker.js` and 2a–2f to `agent-content.js` per INTEGRATION.md.
3. `npm run check` — lint and the Node/jsdom suite must pass unchanged.
4. Walk the verification checklist in INTEGRATION.md against a live Arena tab.

If you package via `extension-files.json`, add the two new files to the include list.

## Known limits

- `chrome.tabs.connect` probing requires the adapter's `onConnect` registration to be the
  liveness signal; if a future version defers that registration, `probeContentScript` must be
  re-pointed (e.g. at a named one-shot message).
- The worker cannot observe bfcache transitions directly; the content side handles them
  (`pageshow` with `persisted`).
- Kept at version `2.9.0` to avoid tripping the three-way version gate; bump manifest,
  `agent-content.js VERSION`, and `agent-client.js ADAPTER_VERSION` together when you release.
