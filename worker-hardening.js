// worker-hardening.js — injection reliability and tab-lifecycle cleanup for the MV3 worker.
//
// ES module, imported by worker.js (the worker is already "type": "module"). Purely additive:
// it never sends anything into Arena and never touches the port protocol. It only answers one
// question — "is the adapter content script alive in this tab, and if not, load it" — and keeps
// worker-side state from leaking onto dead tabs and dead documents.
//
// Wire-up is three small edits in worker.js; see INTEGRATION.md for the exact anchors.
import { isArena } from './core.js';

const PROBE_PORT_NAME = 'arena-agent-probe-v1';
// Must match the manifest's content_scripts js list, in the same order.
const INJECT_FILES = ['content-hardening.js', 'attachment-policy.js', 'agent-dom.js', 'agent-content.js'];
const PROBE_WINDOW_MS = 350;   // a port to a listener-less tab disconnects almost immediately
const SETTLE_TIMEOUT_MS = 5000; // wait for tab.status === 'complete' before probing
const INJECT_THROTTLE_MS = 1200;

const tabGoneListeners = new Set();
const lastInjectAt = new Map(); // tabId -> timestamp, throttles injections into flapping tabs
let lifecycleInstalled = false;

function log(...args) {
  try { console.log('[arena-agent:worker-hardening]', ...args); } catch { /* worker console gone */ }
}

// ---- liveness probe -------------------------------------------------------------------------------
// chrome.tabs.connect to a tab whose content scripts register no runtime.onConnect listener fails
// fast: onDisconnect fires with "Could not establish connection. Receiving end does not exist."
// agent-content.js registers onConnect for as long as it is alive, so probe success == adapter
// alive. The probe port uses a name the adapter ignores, so a live adapter never treats it as a
// panel connection and the one-shot message channel is never involved.
export function probeContentScript(tabId, windowMs = PROBE_WINDOW_MS) {
  return new Promise(resolve => {
    let port = null;
    let settled = false;
    const done = alive => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch { /* already closed */ }
      resolve(alive);
    };
    // No disconnect inside the window => a listener exists => the adapter is alive.
    const timer = setTimeout(() => done(true), windowMs);
    try {
      port = chrome.tabs.connect(tabId, { name: PROBE_PORT_NAME });
      port.onDisconnect.addListener(() => {
        const detail = chrome.runtime.lastError?.message || '';
        const dead = /receiving end does not exist|context invalidated|the tab was closed|frame was removed|extension context/i.test(detail);
        done(!dead);
      });
    } catch {
      done(false); // tab vanished or is not connectable (chrome:// page, crashed tab, …)
    }
  });
}

async function waitForSettledTab(tabId) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch { return null; }
    if (!tab || tab.status === 'complete') return tab;
    if (Date.now() >= deadline) return tab; // probe anyway; a loading page can still host scripts
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// ---- ensureAgentLoaded ------------------------------------------------------------------------------
// Call before ATTACH (see INTEGRATION.md). Probe first, inject only when the probe says dead, then
// verify with a second probe. Retries are bounded and read-only: nothing is typed, clicked or sent.
// This is also the self-heal path after an extension update: the stale context was disposed by
// content-hardening.js, the probe sees "no receiving end", and a fresh, version-matched adapter is
// injected without the user reloading the Arena tab.
export async function ensureAgentLoaded(tabId, { force = false, attempts = 3 } = {}) {
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); }
  catch { throw Object.assign(new Error('The Arena tab closed before the connection could be prepared.'), { code: 'TAB_GONE' }); }
  if (!isArena(tab.url)) throw Object.assign(new Error('This tab is no longer on Arena. Reconnect to an Arena tab.'), { code: 'NOT_ARENA' });

  const settled = await waitForSettledTab(tabId);
  if (!settled) throw Object.assign(new Error('The Arena tab closed while the page was loading.'), { code: 'TAB_GONE' });

  if (!force && await probeContentScript(tabId)) return { injected: false, alive: true };

  // A tab that just refused an injection (crash, mid-navigation) should not be hammered.
  const now = Date.now();
  const recent = lastInjectAt.get(tabId) || 0;
  if (now - recent < INJECT_THROTTLE_MS) await new Promise(resolve => setTimeout(resolve, 400));

  let lastError = null;
  for (let i = 1; i <= attempts; i++) {
    lastInjectAt.set(tabId, Date.now());
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });
      await new Promise(resolve => setTimeout(resolve, 120)); // let the registration complete
      if (await probeContentScript(tabId)) {
        log(`content script ready in tab ${tabId} (attempt ${i})`);
        return { injected: true, alive: true, attempts: i };
      }
      lastError = new Error('injected, but the content script did not answer the probe');
    } catch (err) {
      lastError = err;
    }
    log(`injection attempt ${i}/${attempts} for tab ${tabId} failed: ${lastError?.message || lastError}`);
    if (i < attempts) await new Promise(resolve => setTimeout(resolve, 250 * i));
  }
  throw Object.assign(
    new Error(`The Agent content script could not be loaded into the Arena tab (${lastError?.message || 'unknown cause'}). Reload the tab and reconnect. Nothing was sent.`),
    { code: 'CONTENT_SCRIPT_UNAVAILABLE' }
  );
}

// ---- tab lifecycle ------------------------------------------------------------------------------------
// Worker-side state (staged-file grants in worker.js, the throttle map here) is keyed by tab and by
// document. Both die on a top-frame commit or a tab close; without cleanup, grants for dead
// documents linger until their own 20 s expiry and the throttle map grows forever.
export function onTabGone(listener) {
  tabGoneListeners.add(listener);
  return () => tabGoneListeners.delete(listener);
}

function notifyTabGone(tabId, reason, details = null) {
  for (const listener of [...tabGoneListeners]) {
    try { listener(tabId, reason, details); }
    catch (err) { log('tabGone listener failed:', err?.message); }
  }
}

export function installWorkerLifecycle() {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;

  chrome.tabs.onRemoved.addListener(tabId => {
    lastInjectAt.delete(tabId);
    notifyTabGone(tabId, 'removed');
  });

  if (chrome.webNavigation?.onCommitted) {
    // Top-frame commit == new document: the previous document's content script can never run again.
    // (SPA pushState navigation fires onHistoryStateUpdated instead and is deliberately ignored:
    // the adapter stays live across those and owns its own URL-change rules.)
    chrome.webNavigation.onCommitted.addListener(details => {
      if (details.frameId !== 0) return;
      notifyTabGone(details.tabId, 'navigated', { url: details.url, documentId: details.documentId });
    });
  } else {
    log('webNavigation permission unavailable; navigation cleanup limited to tab removal');
  }
}
