// content-hardening.js — shared reliability layer for the Arena content scripts.
//
// Runs in Chrome's isolated extension world, first in the content_scripts list (see manifest.json).
// Purely additive: agent-content.js / agent-dom.js / attachment-policy.js work unchanged even if
// none of the INTEGRATION.md patches are applied. When the patches ARE applied, they consume the
// helpers exposed here as globalThis.ArenaAgentHardening.
//
// What it fixes on its own (no patches needed):
//   - duplicate script execution is counted, never re-run (boot guard)
//   - a zombie context (extension updated/reloaded while the tab stayed open) disposes the stale
//     adapter registration so the next ATTACH injection starts clean instead of hitting TAB_IN_USE
//   - a bfcache-restored page disposes its dead registration the same way
//   - unhandled promise rejections from the scan loop are captured into a ring buffer instead of
//     dying silently in the page console where nobody looks
//   - everything is observable later via diagnostics() (see the DIAG patch in INTEGRATION.md)
(() => {
  'use strict';

  // ---- boot guard: executeScript on top of the manifest injection must be a no-op --------------
  const previousBoot = globalThis.__ARENA_HARDENING_BOOT__;
  if (previousBoot) {
    try { previousBoot.boots += 1; } catch { /* frozen or dead world */ }
    return;
  }
  const VERSION = 'h1';
  const boot = { boots: 1, at: Date.now() };
  globalThis.__ARENA_HARDENING_BOOT__ = boot;

  // ---- logger with ring buffer ------------------------------------------------------------------
  const LOG_CAP = 120;
  const logBuffer = [];
  function safeDetail(detail) {
    try { return typeof detail === 'string' ? detail.slice(0, 300) : undefined; } catch { return undefined; }
  }
  function log(level, message, detail) {
    const entry = { at: Date.now(), level, message, detail: safeDetail(detail) };
    logBuffer.push(entry);
    if (logBuffer.length > LOG_CAP) logBuffer.shift();
    try {
      // Errors always surface; info/warn stay quiet unless you are watching the tab's console.
      if (level === 'error') console.error('[arena-agent:hardening]', message, detail ?? '');
      else if (level === 'warn') console.warn('[arena-agent:hardening]', message, detail ?? '');
    } catch { /* console unavailable */ }
  }

  // ---- timing primitives ------------------------------------------------------------------------
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  class TimeoutError extends Error {
    constructor(ms, label) { super(`${label || 'operation'} timed out after ${ms}ms`); this.code = 'HARDENING_TIMEOUT'; }
  }
  class AbortError extends Error {
    constructor(label) { super(`${label || 'operation'} aborted`); this.code = 'HARDENING_ABORT'; }
  }

  function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms); });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }

  // ---- retry with exponential backoff + jitter ---------------------------------------------------
  // For read-only recovery paths only (injection probes, late-element waits). Never wrap a click or
  // a Send with this: the adapter's fail-closed one-attempt rule must stay intact.
  async function retry(fn, opts = {}) {
    const {
      attempts = 4, baseMs = 200, maxMs = 4000, factor = 2, jitter = 0.3,
      label = 'operation', signal = null, onAttempt = null
    } = opts;
    let lastError = null;
    for (let i = 1; i <= attempts; i++) {
      if (signal?.aborted) throw new AbortError(label);
      try {
        return await fn(i);
      } catch (err) {
        lastError = err;
        if (err?.code === 'HARDENING_ABORT' || err?.name === 'AbortError') throw err;
        if (i === attempts) break;
        const exp = Math.min(maxMs, baseMs * factor ** (i - 1));
        const wait = Math.round(exp * (1 - jitter + Math.random() * jitter * 2));
        log('warn', `${label}: attempt ${i}/${attempts} failed (${err?.message || err}); retrying in ${wait}ms`);
        try { onAttempt?.(i, err, wait); } catch { /* observer hook must never break the loop */ }
        await sleep(wait);
      }
    }
    throw lastError;
  }

  // ---- waitFor: poll a cheap check until it holds or the budget runs out -------------------------
  async function waitFor(check, opts = {}) {
    const { timeoutMs = 8000, pollMs = 150, label = 'condition', signal = null } = opts;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) throw new AbortError(label);
      let ok = false;
      try { ok = !!check(); } catch { /* a throwing check is a false check */ }
      if (ok) return true;
      if (Date.now() >= deadline) throw new TimeoutError(timeoutMs, label);
      await sleep(pollMs);
    }
  }

  // ---- safe document observer with self-heal ------------------------------------------------------
  // Drop-in upgrade for `new MutationObserver(queueScan)` (see INTEGRATION.md patch A):
  //   - callback exceptions are captured, never thrown back into the observer loop
  //   - mutations are throttled (same 120 ms coalescing the adapter already uses)
  //   - if documentElement is replaced (aggressive SPA remount) or the observed root detaches,
  //     the observer re-attaches on the next 1 s health tick instead of watching a dead tree
  const observers = new Set();
  function observeDocument(onChange, opts = {}) {
    const { throttleMs = 120, attributeFilter = null, characterData = true } = opts;
    const handle = {
      stopped: false, callbacks: 0, errors: 0, reschedules: 0,
      root: null, observer: null, healthTimer: null, throttleTimer: null, queued: false, lastRun: 0
    };
    const options = attributeFilter
      ? { childList: true, subtree: true, characterData, attributes: true, attributeFilter }
      : { childList: true, subtree: true, characterData };

    const flush = () => {
      handle.throttleTimer = null;
      handle.queued = false;
      if (handle.stopped) return;
      handle.lastRun = Date.now();
      try { handle.callbacks += 1; onChange(); }
      catch (err) { handle.errors += 1; reportScanError(err); }
    };
    const schedule = () => {
      if (handle.queued || handle.stopped) return;
      handle.queued = true;
      const wait = Math.max(0, throttleMs - (Date.now() - handle.lastRun));
      handle.throttleTimer = setTimeout(flush, wait);
    };
    const attach = () => {
      if (handle.stopped) return;
      const root = document.documentElement;
      if (!root) return;
      try { handle.observer?.disconnect(); } catch { /* already gone */ }
      try {
        handle.observer = new MutationObserver(schedule);
        handle.observer.observe(root, options);
        handle.root = root;
      } catch (err) {
        log('error', 'observeDocument: observe() failed', err?.message);
      }
    };
    const health = () => {
      if (handle.stopped) return;
      const current = document.documentElement;
      if (!handle.root || handle.root !== current || !handle.root.isConnected) {
        handle.reschedules += 1;
        log('warn', 'observeDocument: observed root detached or replaced; re-attaching');
        attach();
      }
    };

    attach();
    handle.healthTimer = setInterval(health, 1000);
    handle.stop = () => {
      if (handle.stopped) return;
      handle.stopped = true;
      try { handle.observer?.disconnect(); } catch { /* already gone */ }
      clearInterval(handle.healthTimer);
      clearTimeout(handle.throttleTimer);
      observers.delete(handle);
    };
    observers.add(handle);
    return handle;
  }

  // ---- error capture ------------------------------------------------------------------------------
  const scanErrors = [];
  function reportScanError(err) {
    const message = String(err?.message || err).slice(0, 240);
    scanErrors.push({ at: Date.now(), message });
    if (scanErrors.length > 40) scanErrors.shift();
    log('error', 'captured async error from the scan path', message);
  }
  // The scan loop is async; a throw inside it used to vanish as an unhandled rejection in the page
  // console. Capture every one without changing rejection semantics (no preventDefault).
  window.addEventListener('unhandledrejection', event => reportScanError(event.reason), { passive: true });

  // ---- diagnostics ----------------------------------------------------------------------------------
  function registrationAlive() {
    try {
      const reg = globalThis.__ARENA_AGENT_REGISTRATION__;
      return !!(reg && typeof reg.isAlive === 'function' && reg.isAlive());
    } catch { return false; }
  }
  function diagnostics() {
    return {
      hardening: VERSION,
      boots: boot.boots,               // >1 means duplicate injection happened (counted, not re-run)
      bootedAt: boot.at,
      uptimeMs: Date.now() - boot.at,
      adapterAlive: registrationAlive(),
      observers: [...observers].map(o => ({
        callbacks: o.callbacks, errors: o.errors, reschedules: o.reschedules, stopped: o.stopped
      })),
      scanErrors: scanErrors.slice(-10),
      recentLog: logBuffer.slice(-20)
    };
  }

  // ---- zombie-context cleanup --------------------------------------------------------------------
  // After an extension update or reload this world's chrome.runtime is dead, but the page keeps
  // running the old adapter. Its listeners would only ever produce "context invalidated" failures
  // and can answer a probe port just long enough to confuse re-attachment. Dispose the registration
  // so the worker's next injection (triggered by ATTACH) rebuilds everything from scratch.
  let zombieTimer = setInterval(() => {
    let alive = false;
    try { alive = !!globalThis.chrome?.runtime?.id; } catch { alive = false; }
    if (alive) return;
    clearInterval(zombieTimer);
    zombieTimer = null;
    log('warn', 'extension context invalidated; disposing stale registration and observers');
    try { globalThis.__ARENA_AGENT_REGISTRATION__?.dispose?.(); } catch { /* already invalid */ }
    for (const observer of [...observers]) { try { observer.stop(); } catch { /* already stopped */ } }
  }, 2500);

  // bfcache restore: the panel's port is dead after the round trip; a fresh ATTACH is the clean path.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    log('warn', 'page restored from bfcache; disposing stale registration');
    try { globalThis.__ARENA_AGENT_REGISTRATION__?.dispose?.(); } catch { /* already invalid */ }
  }, { passive: true });

  // ---- public surface -------------------------------------------------------------------------------
  globalThis.ArenaAgentHardening = Object.freeze({
    version: VERSION,
    log, sleep, retry, waitFor, withTimeout, TimeoutError, AbortError,
    observeDocument, reportScanError, diagnostics,
    stopAllObservers() { for (const observer of [...observers]) { try { observer.stop(); } catch { /* noop */ } } }
  });
  log('info', 'hardening layer ready');
})();
