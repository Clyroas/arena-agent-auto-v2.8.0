// Panel-side connection. Since v2.2.0 the panel holds a DIRECT port to the Arena tab's top-frame
// content script (chrome.tabs.connect from this extension page). The MV3 service worker is only
// used for short one-shot requests (attach/inject, staged-file grants), so Chrome suspending the
// idle worker can no longer drop the chat connection.
import { withTimeout } from './core.js';

export const ADAPTER_VERSION = '2.8.3';
export const HEARTBEAT_MS = 10000;
// Worker requests made while a Send is being prepared must not wait forever: the panel would otherwise
// stay in “Sending…” with the staged bytes held in memory. Both are bounded well below the point where a
// user would retry by hand.
export const ATTACH_TIMEOUT_MS = 20000;
export const GRANT_TIMEOUT_MS = 10000;
export const HANDSHAKE_TIMEOUT_MS = 15000;
export const DIALOG_TIMEOUT_MS = 120000;
export const SILENT_PORT_MS = 90000;

export class AgentClient {
  // `timeouts` exists so tests can exercise the failed-worker paths without waiting out the real ones;
  // the panel always uses the defaults.
  constructor(tabId, onEvent, expectedUrl, timeouts = {}) {
    this.closed = false; this.ready = false; this.onEvent = onEvent; this.tabId = tabId; this.port = null;
    this.timeouts = { attach: timeouts.attach ?? ATTACH_TIMEOUT_MS, grant: timeouts.grant ?? GRANT_TIMEOUT_MS,
      handshake: timeouts.handshake ?? HANDSHAKE_TIMEOUT_MS, dialog: timeouts.dialog ?? DIALOG_TIMEOUT_MS, silent: timeouts.silent ?? SILENT_PORT_MS };
    this.readiness = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.readiness.catch(() => {}); // callers await it; avoid unhandled rejections after close
    // Attachment has its own budget. Do not spend the handshake budget before a port exists.
    // Defer callbacks until the caller has assigned its client reference, even if Chrome throws
    // synchronously (for example an extension context invalidated by an update).
    Promise.resolve().then(() => this.start(expectedUrl)).catch(error => {
      if (!this.closed) this.lost(error?.message || 'The connection could not start.');
    });
  }
  async start(expectedUrl) {
    if (this.closed) return;
    let attached;
    try {
      const result = await withTimeout(chrome.runtime.sendMessage({ type: 'ATTACH', tabId: this.tabId, expectedUrl }), this.timeouts.attach,
        `The extension worker did not answer the connection request within ${Math.round(this.timeouts.attach / 1000)} seconds. It may have been restarted or updated; reload the Arena tab and reconnect. No prompt was sent.`);
      if (!result?.ok) throw Object.assign(new Error(result?.error || 'The extension worker did not respond. Reload the extension and the Arena tab.'), { code: result?.code || 'CONNECTION_FAILED' });
      attached = result.value;
    } catch (error) {
      if (this.closed) return;
      const message = `${error.code || 'CONNECTION_FAILED'}: ${error.message}`;
      this.fail(message); this.close(); this.onEvent({ type: 'ERROR', code: error.code || 'CONNECTION_FAILED', message: error.message, clicked: false });
      return;
    }
    if (this.closed) return;
    this.documentId = attached.documentId; this.lastInbound = Date.now();
    this.armHandshake(this.timeouts.handshake);
    try { this.port = chrome.tabs.connect(this.tabId, { name: 'arena-agent-content-v3', documentId: attached.documentId }); }
    catch (error) { this.lost(`Chrome could not open a connection to the Arena tab (${error.message}).`); return; }
    this.port.onMessage.addListener(event => this.handle(event));
    this.port.onDisconnect.addListener(() => {
      const detail = chrome.runtime.lastError?.message;
      this.lost(`The Arena tab connection closed.${detail ? ' Browser detail: ' + detail : ''}`);
    });
    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      this.checkHealth();
      try { this.port.postMessage({ type: 'PING' }); } catch { this.lost('The Arena tab connection closed.'); }
    }, HEARTBEAT_MS);
    this.post({ type: 'PROBE' });
  }
  checkHealth() {
    if (this.ready && !this.closed && !this.silent && Date.now() - this.lastInbound > this.timeouts.silent) {
      this.silent = true;
      this.onEvent({ type: 'TRANSPORT_HEALTH', responsive: false });
    }
  }
  armHandshake(ms) {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (this.closed || this.ready) return;
      const message = 'Connection setup timed out. Open the Arena tab, close any dialog, then reconnect. No prompt was sent.';
      this.fail(`ADAPTER_HANDSHAKE_TIMEOUT: ${message}`);
      this.close();
      this.onEvent({ type: 'ERROR', code: 'ADAPTER_HANDSHAKE_TIMEOUT', message, clicked: false });
    }, ms);
  }
  handle(event) {
    if (this.closed || !event || typeof event.type !== 'string') return;
    this.lastInbound = Date.now();
    if (this.silent) { this.silent = false; this.onEvent({ type: 'TRANSPORT_HEALTH', responsive: true }); }
    if (event.type === 'READY') {
      if (event.adapterVersion !== ADAPTER_VERSION) {
        const message = 'Wrong content-script version. Reload the Arena tab after updating the extension, then reconnect.';
        this.fail(message); this.onEvent({ type: 'ERROR', code: 'VERSION_MISMATCH', message, clicked: false }); this.close(); return;
      }
      this.ready = true; this.inputKind = event.inputKind || 'unknown'; this.reviewPending = !!event.reviewPending; this.uploadKind = event.uploadKind || 'none';
      this.fileInputCount = event.fileInputCount || 0; this.historyCount = event.historyCount || 0;
      this.setModelInfo(event); clearTimeout(this.timeout); this.resolve(event);
    }
    if (event.type === 'MODEL_INFO') this.setModelInfo(event);
    // Give a human time to close an Arena dialog, but never wait forever or reset on repeated WAITING.
    if (event.type === 'WAITING' && !this.ready && !this.waitingForDialog) {
      this.waitingForDialog = true; this.armHandshake(this.timeouts.dialog);
    }
    if (event.type === 'SENDING') { this.reviewPending = false; this.inputKind = event.inputKind || this.inputKind; }
    if (event.type === 'ERROR' && !this.ready) this.fail(`${event.code || 'CONNECTION_FAILED'}: ${event.message}`);
    this.onEvent(event);
  }
  setModelInfo(event) {
    this.pageKind = event.pageKind === 'direct' ? 'direct' : 'agent';
    this.model = typeof event.model === 'string' ? event.model : '';
    this.blocked = typeof event.blocked === 'string' ? event.blocked : '';
    // Semantic capability snapshot (see core.js capabilitySummary). Absent on older adapters, in which
    // case the panel simply reports that no capability check was sent rather than inventing one.
    if (event.capabilities && typeof event.capabilities === 'object') this.capabilities = event.capabilities;
    if (Array.isArray(event.models) && (event.models.length || !this.models?.length)) this.models = event.models.slice(0, 400);
  }
  queryModel() { this.post({ type: 'MODEL' }); }
  // Unexpected loss (tab reloaded/discarded, page closed). The panel decides whether to reattach.
  lost(message) {
    if (this.closed) return;
    const wasReady = this.ready;
    this.fail(message); this.close();
    this.onEvent({ type: 'BRIDGE_LOST', code: 'CONNECTION_LOST', message, wasReady });
  }
  post(message) { if (this.closed || !this.port) throw new Error('The Arena connection is not ready.'); this.port.postMessage(message); }
  fail(message) { clearTimeout(this.timeout); this.reject(new Error(message)); }
  async send(requestId, prompt, url, attachments) {
    if (this.closed || !this.ready || this.silent) throw new Error('The Agent adapter is not responding. Open the Arena tab before sending.');
    if (attachments?.length) {
      // Single-use, 20-second permission for the page-context file insertion of this one Send. Bounded,
      // so a restarting worker cannot leave the panel stuck with the bytes still staged.
      let grant;
      try {
        grant = await withTimeout(chrome.runtime.sendMessage({ type: 'STAGE_GRANT', tabId: this.tabId, documentId: this.documentId }), this.timeouts.grant,
          `The extension worker did not confirm the staged files within ${Math.round(this.timeouts.grant / 1000)} seconds. Reload the Arena tab and try again. Nothing was sent.`);
      } catch (error) {
        if (error?.name === 'TimeoutError') throw error;
        throw new Error(`The extension worker could not confirm the staged files (${error?.message || 'no response'}). Reload this panel and the Arena tab, then try again. Nothing was sent.`);
      }
      if (!grant?.ok) throw new Error(grant?.error || 'The staged files could not be prepared. Nothing was sent.');
      if (this.closed || !this.ready) throw new Error('The Arena connection closed before sending. Nothing was sent.');
    }
    this.post({ type: 'SEND', requestId, prompt, url, ...(attachments?.length ? { attachments } : {}) });
  }
  // Resume tracking an already-accepted message after a reconnect. Read-only: never clicks or resends.
  watch(requestId, prompt, userMessageId, url, hadAttachments, knownQuestionRows) {
    if (this.closed || !this.ready) throw new Error('The Arena connection is not ready.');
    this.post({ type: 'WATCH', requestId, prompt, userMessageId, url, hadAttachments: !!hadAttachments,
      ...(Array.isArray(knownQuestionRows) && knownQuestionRows.length ? { knownQuestionRows: knownQuestionRows.filter(id => typeof id === 'string').slice(0, 64) } : {}) });
  }
  answer(requestId, answer) {
    if (this.closed || !this.ready) throw new Error('The Arena connection is not ready.');
    this.post({ type: 'ANSWER_QUESTION', requestId, ...answer });
  }
  choose(requestId, side) {
    if (this.closed || !this.ready) throw new Error('The Arena connection is not ready.');
    this.post({ type: 'CHOOSE_RESPONSE', requestId, side });
  }
  loadHistory(requestId, url) {
    if (this.closed || !this.ready) throw new Error('The Arena connection is not ready.');
    this.post({ type: 'LOAD_HISTORY', requestId, url });
  }
  cancel(requestId) {
    if (this.closed) return;
    try { this.port?.postMessage({ type: 'CANCEL', requestId }); } catch { /* already closed */ }
    this.revokeStage();
  }
  // Best effort and never throws: this runs from teardown paths (cancel, close, connection lost), where a
  // synchronous “Extension context invalidated” error from sendMessage would break the caller instead of
  // just skipping a stale grant the worker drops on its own after 20 seconds.
  revokeStage() {
    if (!this.documentId) return;
    try { chrome.runtime.sendMessage({ type: 'STAGE_REVOKE', tabId: this.tabId, documentId: this.documentId })?.catch(() => {}); }
    catch { /* extension context already gone */ }
  }
  shutdown() {
    this.closed = true; this.ready = false;
    clearInterval(this.heartbeat); clearTimeout(this.timeout);
  }
  close() {
    if (this.closed) return;
    this.shutdown();
    this.reject(new Error('Agent connection closed.'));
    try { this.port?.disconnect(); } catch { /* already closed */ }
    this.revokeStage();
  }
}
