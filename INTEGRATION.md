# Integration guide — hardening pass for Arena Auto Chat (2.9.0)

All edits are **additive** and preserve the fail-closed contract: no retry around clicks, no
resend, no guess. Every patch block below is anchored to an exact line in the current source so it
can be applied with a text search. Apply in order; each block is independently testable.

New files (copy into the repo root):

| File | Loaded by | Role |
| --- | --- | --- |
| `content-hardening.js` | manifest `content_scripts` (first entry) | Isolated-world reliability layer: boot guard, backoff helpers, self-healing observer, zombie-context + bfcache cleanup, diagnostics |
| `worker-hardening.js` | `worker.js` (ES import) | Content-script liveness probe, bounded inject-and-verify, tab/document lifecycle cleanup |
| `manifest.json` | Chrome | Same manifest + `webNavigation` permission + `content-hardening.js` in the script list |

---

## Patch 0 — replace `manifest.json`

Use the provided `refinements/manifest.json` as-is. The only deltas versus the shipped 2.9.0
manifest:

1. `"webNavigation"` added to `permissions` — lets the worker notice top-frame commits so
   staged-file grants and injection state for dead documents are dropped immediately instead of
   waiting out their 20 s expiry. The extension still talks only to `https://arena.ai/*`;
   `webNavigation` grants observation, not access.
2. `"content-hardening.js"` prepended to the `content_scripts.js` list.

Keep the version at `2.9.0`. If you later bump it, remember the three-version gate: `manifest.json`,
`const VERSION` in `agent-content.js`, and `ADAPTER_VERSION` in `agent-client.js` must all match,
or connections refuse with `VERSION_MISMATCH`.

## Patch 1 — `worker.js`

### 1a. Import and install (top of file, with the other imports)

Find:

```js
import { AGENT_URL, DIRECT_URL, isArena, isDirectChat } from './core.js';
```

Add directly below it:

```js
import { ensureAgentLoaded, installWorkerLifecycle, onTabGone } from './worker-hardening.js';

installWorkerLifecycle();
// Drop single-use stage grants as soon as their tab or document is gone, not at their 20 s expiry.
onTabGone(tabId => {
  for (const key of [...stageGrants.keys()]) if (key.startsWith(`${tabId}:`)) stageGrants.delete(key);
});
```

(`stageGrants` is declared above this point in the current file, so the reference is safe. If you
move the block, keep it after the `stageGrants` declaration.)

### 1b. Probe-before-attach (ATTACH case)

Find:

```js
      case 'ATTACH': {
        if (!Number.isInteger(message.tabId)) throw new Error('Choose an Arena tab first.');
        const attached = await attachAgent(message.tabId, message.expectedUrl);
        return { documentId: attached.documentId };
      }
```

Replace with:

```js
      case 'ATTACH': {
        if (!Number.isInteger(message.tabId)) throw new Error('Choose an Arena tab first.');
        // Ensure the adapter is alive first: probe, inject only if dead, verify. This also heals a
        // stale context after an extension update without a manual tab reload. Failures are not
        // fatal here — attachAgent keeps its own error path and wording.
        try { await ensureAgentLoaded(message.tabId); }
        catch (error) { console.warn('ensureAgentLoaded:', error.message); }
        const attached = await attachAgent(message.tabId, message.expectedUrl);
        return { documentId: attached.documentId };
      }
```

That is the entire worker change. The one-shot-only nature of the worker is preserved: the probe
uses a throwaway port named `arena-agent-probe-v1`, which `agent-content.js` ignores.

## Patch 2 — `agent-content.js`

### 2a. Hardening handle (top of the IIFE)

Find:

```js
  const VERSION = '2.9.0';
```

Add below it:

```js
  const H = globalThis.ArenaAgentHardening; // absent only if the manifest edit was skipped
```

### 2b. Safe, self-healing observer (onConnect)

Find the two lines:

```js
    observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'disabled', 'aria-disabled', 'hidden', 'data-chat-message-id', 'aria-checked', 'aria-expanded'] });
```

Replace with:

```js
    const OBSERVER_OPTS = { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'disabled', 'aria-disabled', 'hidden', 'data-chat-message-id', 'aria-checked', 'aria-expanded'] };
    if (H) {
      // Callback errors are captured into the diagnostics buffer instead of killing scans silently,
      // and a 1 s health tick re-attaches if Arena ever replaces <html> under the observer.
      // `disconnect` aliases `stop` so the existing cleanup() keeps working unchanged.
      observer = Object.assign(H.observeDocument(queueScan, { throttleMs: 120, attributeFilter: OBSERVER_OPTS.attributeFilter }),
        { disconnect() { this.stop(); } });
      observedRoot = document.documentElement;
    } else {
      observer = new MutationObserver(() => { try { queueScan(); } catch (err) { H?.reportScanError(err); } });
      observer.observe(document.documentElement, OBSERVER_OPTS);
      observedRoot = document.documentElement;
    }
```

And declare the companion variable next to the other connection state near the top
(`let owner = null, transaction = null, …`):

```js
  let observedRoot = null;
```

`cleanup()` needs no change: it calls `observer?.disconnect()`, which both paths support.

### 2c. Self-heal check + safe periodic scan (the 300 ms timer)

Find:

```js
    timer = setInterval(() => { if (Date.now() - lastHeartbeat > LEASE_MS) return cleanup(); scan(); }, 300);
```

Replace with:

```js
    timer = setInterval(() => {
      if (Date.now() - lastHeartbeat > LEASE_MS) return cleanup();
      // The hardening observer self-heals on its own tick; this covers the fallback path only.
      if (!H && observer && observedRoot !== document.documentElement) {
        observer.disconnect();
        observedRoot = document.documentElement;
        observer.observe(observedRoot, OBSERVER_OPTS);
      }
      try { scan(); } catch (err) { H?.reportScanError(err); }
    }, 300);
```

(`OBSERVER_OPTS` is in scope: the timer is created in the same `onConnect` function as patch 2b.)
Throws inside the async body of `scan()` itself are captured globally by
`content-hardening.js`'s `unhandledrejection` listener — no per-call-site edits needed.

### 2d. Passive capture-phase click listener

Find:

```js
    document.addEventListener('click', onPageClick, true);
```

Replace with:

```js
    document.addEventListener('click', onPageClick, { capture: true, passive: true });
```

`onPageClick` never calls `preventDefault()` or `stopPropagation()`, so marking it passive only
removes the compositor-blocking hint; behavior is identical.

### 2e. Backoff while the composer hydrates (probe)

Find the tail of the `probe()` retry path:

```js
        if (!['COMPOSER_NOT_FOUND', 'SEND_BUTTON_NOT_FOUND'].includes(e.code) || Date.now() >= deadline) {
          error(e, null);
          return;
        }
        await sleep(200);
```

Replace `await sleep(200);` with:

```js
        probeDelay = Math.min(1200, probeDelay * 1.6);
        await sleep(probeDelay);
```

And declare the initial value where the probe loop starts — find:

```js
    let deadline = Date.now() + 12000, waiting = '';
```

Replace with:

```js
    let deadline = Date.now() + 12000, waiting = '', probeDelay = 125; // first wait stays ~200 ms
```

Same 12 s budget, fewer wasted layout reads while the page is still mounting.

### 2f. Diagnostics over the existing port

Find:

```js
    else if (message?.type === 'LOAD_HISTORY') loadHistory(message);
```

Add a line after it:

```js
    else if (message?.type === 'DIAG') emit({ type: 'DIAG', data: H?.diagnostics?.() || null });
```

From the panel devtools (or a browser test) you can now `port.postMessage({ type: 'DIAG' })` and
read back boot count (duplicate-injection evidence), observer callback/error/reschedule counters,
the last 10 scan errors, and the last 20 hardening log lines. Read-only; no state changes.

## Optional — `agent-client.js` / panel

No change is required: the panel already owns reconnection (direct port, heartbeat, WATCH-based
resume). If you want the diagnostics in the UI, handle the `DIAG` event in the panel's
`onEvent` switch and render `event.data` in a debug section. Do not gate any send path on it.

## Verification checklist

1. `chrome://extensions` → reload the extension. Open `https://arena.ai`, open DevTools on the
   Arena tab → Console: expect one `[arena-agent:hardening]` info line and no errors.
2. **Late-load retry**: open a Direct chat on a throttled profile; the panel should connect via
   the (now backoff) probe instead of fixed 200 ms polling.
3. **Zombie context**: with an Arena tab connected, reload *only* the extension. The tab's
   console should log `extension context invalidated; disposing stale registration` within ~3 s.
   Press **Set up connection** again — it should attach *without* reloading the tab (previously:
   `VERSION_MISMATCH`/dead-context failures until a manual tab reload).
4. **Duplicate injection**: with the tab connected, trigger any ATTACH. In the tab console run
   `ArenaAgentHardening.diagnostics().boots` — `2` means the second injection was counted and
   correctly no-op'd; the adapter must not double-register (no `TAB_IN_USE` on the panel).
5. **Navigation cleanup**: stage files, then navigate the Arena tab away (`https://arena.ai/`
   home). In the worker console (`Inspect views: service worker`) the grant map entry should be
   gone immediately (add a temporary `console.log` in the `onTabGone` hook to confirm), not after
   20 s.
6. **bfcache**: enable back/forward cache in `chrome://flags`, navigate away and back, then
   reconnect — the adapter should dispose and re-attach cleanly.
7. **Fail-closed regression**: run `npm test` — nothing in this pass touches send/click semantics,
   so the full Node suite must pass unchanged.
