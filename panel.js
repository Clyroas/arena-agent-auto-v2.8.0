import { selectAttachments, releaseTurnAttachments, restoreTurnAttachments } from './attachment-state.js';
import { TabAwakeLease } from './tab-awake.js';
import { setupFloatingGeometry } from './window-geometry.js';
import { ConversationView } from './conversation-view.js';
import { AgentClient, normalizePickers } from './agent-client.js';
import { AGENT_URL, isArena, isDirect, tabLabel, samePage, directModelUrl, withTimeout, capabilitySummary } from './core.js';
import { liveStatus, questionState } from './live-status.js';
import { recentModels, rememberModel } from './recent-models.js';
import { findLinks, hostLabel, captureLink, hasShotAccess, requestShotAccess, removeShotAccess } from './screenshot.js';
import './attachment-policy.js'; // Registers ArenaAgentAttachments (same text the page adapter loads).
const { ATTACHMENT_POLICY, bytesToBase64, formatBytes } = globalThis.ArenaAgentAttachments;
const $ = id => document.getElementById(id);
const floating = location.pathname === '/floating.html';
if (floating) setupFloatingGeometry();
const conversation = new ConversationView(document, answerQuestion, chooseResponse);
let tab = null, client = null, pending = null, turns = [], state = 'disconnected';
let busy = false, epoch = 0, dialogResolve = null, switching = false;
let historyRequest = null, historyTimer = null;
let actionId = 0, requestedModel = '';
// One repo/branch picker dialog at a time: { actionId, kind, options, phase, error }. The actionId ties
// panel and tab together, so a frame from a dialog the user already closed can never act as the current one.
let pickerAction = null;
const awakeLease = new TabAwakeLease();
const staged = []; // Staged files live in memory only, until an accepted send or a local reset.
let shotAccess = false, shotBusy = '', shotProgress = '', shotSignature = ''; // link screenshots (v2.6.0)
let shotOperation = null;
$('attachment-input').accept = ATTACHMENT_POLICY.accept;
const labels = { disconnected: 'Disconnected', connecting: 'Checking controls…', reconnecting: 'Reconnecting…', ready: 'Auto ready', sending: 'Sending…', waiting: 'Waiting for Arena', error: 'Stopped · check tab' };
// One-shot worker requests are always bounded (see withTimeout in core.js). A suspended, restarting or
// updated service worker must never leave this panel permanently busy: a late answer is ignored and the
// caller gets a clear error it can show, instead of a spinner that never ends.
const RPC_TIMEOUT_MS = 20000;
const rpc = async (type, extra = {}) => {
  let result;
  try {
    result = await withTimeout(chrome.runtime.sendMessage({ type, ...extra }), RPC_TIMEOUT_MS,
      `${type} did not answer within ${Math.round(RPC_TIMEOUT_MS / 1000)} seconds. Chrome may have restarted the extension worker. Reload the Arena tab and try again; nothing was sent to Arena.`);
  } catch (error) {
    if (error?.name === 'TimeoutError') throw error;
    // Most often “Extension context invalidated”: the panel outlived an extension reload/update.
    throw new Error(`${type} could not reach the extension worker (${error?.message || 'no response'}). Reload this panel with the extension’s Reload button and try again; nothing was sent to Arena.`);
  }
  if (!result?.ok) throw new Error(result?.error || 'The extension worker did not respond. Reload the extension and Arena tab.');
  return result.value;
};
let sheetOpener = null;
// Settings sheet: slides up under the toolbar; the chat stays the focus when it is closed.
function setSheet(open, { restoreFocus = true } = {}) {
  const sheet = $('settings-sheet'), was = sheet.dataset.open === 'true';
  sheet.dataset.open = String(open); document.body.dataset.sheet = open ? 'open' : '';
  if (open && !was) sheetOpener = document.activeElement;
  sheet.inert = !open; document.querySelector('.app').inert = open;
  for (const id of ['settings-button', 'status-pill']) $(id).setAttribute('aria-expanded', String(open));
  if (open && (!was || !sheet.contains(document.activeElement))) requestAnimationFrame(() => { if (sheet.dataset.open === 'true' && !document.querySelector('dialog[open]')) $('sheet-done').focus({ preventScroll: true }); });
  if (!open && was && restoreFocus && sheet.contains(document.activeElement)) (sheetOpener?.isConnected && !sheetOpener.disabled && sheetOpener !== document.body ? sheetOpener : !$('prompt').disabled ? $('prompt') : $('settings-button')).focus({ preventScroll: true });
}
const toggleSheet = () => setSheet($('settings-sheet').dataset.open !== 'true');
$('settings-button').addEventListener('click', toggleSheet);
$('status-pill').addEventListener('click', toggleSheet);
$('sheet-done').addEventListener('click', () => setSheet(false));
$('sheet-backdrop').addEventListener('click', () => setSheet(false));
$('empty-connect').addEventListener('click', () => setSheet(true));
document.addEventListener('keydown', event => {
  if (event.key === 'Tab' && $('settings-sheet').dataset.open === 'true' && !document.querySelector('dialog[open]')) {
    const controls = [...$('settings-sheet').querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')]
      .filter(el => el.getClientRects().length && !el.closest('[hidden],[inert]'));
    const first = controls[0], last = controls.at(-1);
    if (first && event.shiftKey && (document.activeElement === first || !$('settings-sheet').contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (first && !event.shiftKey && (document.activeElement === last || !$('settings-sheet').contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  // Ctrl/⌘+K opens the model picker (only when connected and idle; the chip's own rules apply).
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k' && !event.repeat) {
    if (document.querySelector('dialog[open]') || $('settings-sheet').dataset.open === 'true') return;
    event.preventDefault(); openModelDialog(); return;
  }
  if (event.key === 'Escape' && $('settings-sheet').dataset.open === 'true' && !$('confirm-dialog').open) { event.preventDefault(); setSheet(false); }
});
// The composer grows with its text up to a cap, like Messages.
function fitPrompt() { const field = $('prompt'); field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; }
$('prompt').addEventListener('input', fitPrompt);
$('prompt').addEventListener('input', () => { if (shotOperation) { cancelScreenshot('Screenshot cancelled because the draft changed.'); render(); } else renderShotChips(); });
// Arena's message box takes up to 30,000 characters here; show the count near the limit and say so when a
// paste had to be cut (the browser silently drops the rest at maxlength).
const PROMPT_LIMIT = 30000;
let promptCut = 0;
function renderPromptCount() {
  const length = $('prompt').value.length, box = $('prompt-count');
  const show = length >= PROMPT_LIMIT * 0.8 || promptCut > 0;
  box.hidden = !show;
  // Nothing to report: drop the text as well as the node, so a reset can never leave the previous
  // draft's count sitting invisibly in the markup.
  if (!show) { box.textContent = ''; return; }
  box.dataset.full = String(length >= PROMPT_LIMIT);
  box.textContent = `${length.toLocaleString('en-US')} / ${PROMPT_LIMIT.toLocaleString('en-US')} characters`
    + (promptCut ? ` · your paste was cut: ${promptCut.toLocaleString('en-US')} characters did not fit. Send the rest in a follow-up message or attach it as a .txt file.` : '');
}
$('prompt').addEventListener('paste', event => {
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!text) return;
  const field = $('prompt'), room = PROMPT_LIMIT - (field.value.length - (field.selectionEnd - field.selectionStart));
  promptCut = Math.max(0, text.length - room);
  setTimeout(renderPromptCount, 0);
});
$('prompt').addEventListener('input', event => { if (event.inputType !== 'insertFromPaste') promptCut = 0; renderPromptCount(); });
setSheet(true); // Disconnected on open: show the connection setup.
// Messages appear in full, then tuck away into a small dot in the chat corner. Info shrinks by itself
// after a few seconds (not while hovered/focused); errors stay until you minimize them.
const NOTICE_AUTO_MS = 6000;
let noticeTimer = null;
function noticeKind(text) {
  if (state === 'error' || /^[A-Z][A-Z0-9_]{3,}:/.test(text)) return 'error';
  return state === 'reconnecting' ? 'warning' : 'info';
}
function setNoticeOpen(open) {
  const box = $('notice'), dot = $('notice-dot'), has = !!$('notice-text').textContent;
  box.hidden = !has || !open; dot.hidden = !has || open;
  dot.dataset.kind = box.dataset.kind || 'info';
  box.dataset.minimized = String(has && !open);
}
function armNoticeTimer() {
  clearTimeout(noticeTimer);
  if ($('notice').dataset.kind === 'error' || !$('notice-text').textContent) return;
  noticeTimer = setTimeout(() => {
    const box = $('notice');
    if (box.matches(':hover') || box.contains(document.activeElement)) return armNoticeTimer();
    setNoticeOpen(false);
  }, NOTICE_AUTO_MS);
}
function notice(text = '') {
  $('notice-text').textContent = text;
  const kind = noticeKind(text);
  $('notice').dataset.kind = kind;
  $('notice').setAttribute('role', kind === 'error' ? 'alert' : 'status');
  setNoticeOpen(!!text);
  if (text) { $('notice-dot').classList.remove('fresh'); void $('notice-dot').offsetWidth; $('notice-dot').classList.add('fresh'); }
  armNoticeTimer();
}
$('notice-minimize').addEventListener('click', () => { clearTimeout(noticeTimer); setNoticeOpen(false); $('notice-dot').focus({ preventScroll: true }); });
$('notice-dot').addEventListener('click', () => { $('notice-dot').classList.remove('fresh'); setNoticeOpen(true); armNoticeTimer(); });
$('notice').addEventListener('mouseleave', armNoticeTimer);
function render() {
  // Semantic capability / drift check for the connected tab (see core.js capabilitySummary). A page that
  // no longer exposes a control the adapter drives blocks Send with a coded reason instead of failing
  // later, mid-send. Missing upload support is not drift: text chat still works.
  const drift = client?.ready ? capabilitySummary(client.capabilities) : null;
  $('status').textContent = labels[state]; $('status').dataset.state = state;
  document.body.dataset.working = String(!!pending && pending.status !== 'error');
  document.body.dataset.connected = String(!!client?.ready);
  $('connected').hidden = !tab;
  $('connect').disabled = busy || !!tab || !$('tabs').value || !$('confirmed').checked || !$('authorize').checked;
  $('tabs').disabled = busy || !!tab;
  $('confirmed').disabled = busy || !!tab; $('authorize').disabled = busy || !!tab;
  $('prepare').disabled = busy || switching || !!shotOperation || !!requestedModel || !!pickerAction || !!drift?.drift || !!client?.silent || state !== 'ready' || !client?.ready || !!pending;
  // While reattaching, the draft stays editable; Send waits for the verified connection.
  $('prompt').disabled = pending ? true : busy || (state !== 'reconnecting' && (state !== 'ready' || !client?.ready));
  const uploadReady = client?.ready && client.uploadKind === 'input';
  $('attach-files').disabled = busy || !!pending || !!pickerAction || state !== 'ready' || !uploadReady;
  $('attach-files').title = uploadReady ? 'Attach images or files from your computer' : 'Staged files can only be sent after the Arena tab exposes its composer file input. Attach them in Arena until then.';
  $('prepare').textContent = staged.length ? `Send to Arena · ${staged.length} file${staged.length > 1 ? 's' : ''}` : 'Send to Arena';
  $('prepare').title = staged.length ? 'Send this message together with the staged files' : '';
  $('prompt').placeholder = state === 'ready' ? 'Type a message to send to Arena…' : state === 'reconnecting' && !pending ? 'Reconnecting to Arena… you can keep typing' : questionState(pending?.live?.questions) === 'answerable' ? 'Answer the question cards above to continue…' : pending ? 'Arena is working on this task…' : 'Connect your Arena tab to start…';
  for (const id of ['refresh', 'open', 'open-direct-tab', 'focus', 'reconnect', 'disconnect', 'cancel', 'float-window']) $(id).disabled = busy;
  $('connection-escape').hidden = !['connecting', 'reconnecting'].includes(state);
  $('connection-focus').disabled = !tab;
  $('model-confirmation').hidden = !requestedModel;
  $('model-confirmation-text').textContent = requestedModel ? `Requested “${requestedModel}”; Arena shows “${client?.model || 'unknown'}”. Send is blocked until you confirm the actual model.` : '';
  $('accept-current-model').disabled = busy || switching || !client?.ready || !client.model;
  for (const button of document.querySelectorAll('.attachment-remove')) button.disabled = busy || !!pending;
  $('pending').hidden = !pending;
  $('connection-info').hidden = !tab;
  $('connection-summary-text').textContent = tab ? `Tab ${tab.id} · ${tab.title || 'Arena'}` : 'Choose your Arena tab';
  $('connection-summary-text').title = tab ? tabLabel(tab) : '';
  $('connected-tab-short').textContent = tab ? `Tab ${tab.id}` : '';
  $('connected-tab-short').title = tab?.url || '';
  $('pending').dataset.state = pending?.status || '';
  $('pending').dataset.question = String(questionState(pending?.live?.questions) === 'answerable' && pending?.status !== 'error');
  $('tab-name').textContent = tab ? tabLabel(tab) : '';
  $('tab-url').textContent = tab?.url || '';
  $('adapter-state').textContent = client?.ready ? (client.reviewPending ? 'Agent task-review panel detected. On your next Send, only its Close control will be used; no feedback will be selected.' : `${client.pageKind === 'direct' ? 'Direct' : 'Agent'} content script v2.9.0 verified · ${client.inputKind} input · upload: ${client.uploadKind === 'input' ? 'composer file input ready' : client.uploadKind === 'unsupported' ? 'a restricted or ambiguous file input — staged files cannot be sent' : client.uploadKind === 'button-only' ? 'site picker only — attach in Arena' : 'not detected — staged files cannot be sent'}${drift ? ` · ${drift.text}` : ''}`) : 'Agent control check not ready. Reconnect after fixing the reported issue.';
  $('adapter-state').dataset.drift = String(!!drift?.drift);
  $('progress').textContent = pending?.status === 'error' ? 'Capture stopped. Read the error above and check the Arena tab. No manual reply entry is available.' : pending?.securityHold ? 'Tracking is paused until Arena’s security verification is completed in the Arena tab. It resumes automatically; nothing is resent.' : pending?.phase === 'review' ? 'Closing the task-review panel and waiting for the composer. No feedback is selected.' : questionState(pending?.live?.questions) === 'answerable' ? 'Review the question cards above. Select an answer, then submit it explicitly. Sensitive or unsupported actions stay in Arena.' : pending?.status === 'waiting' ? 'Your message is in Arena. The status above follows its visible activity; the final reply appears separately — no response time limit. Approvals and unsupported controls stay in Arena.' : pending?.phase === 'upload' ? 'Placing your staged files into the Arena composer, then attempting exactly one Send click…' : 'Preparing the Arena composer and attempting exactly one Send click…';
  const found = client?.ready ? client.historyCount || 0 : 0, imported = turns.filter(t => t.imported).length;
  $('history-import').hidden = !client?.ready || (!found && !imported);
  $('load-history').disabled = busy || !!historyRequest || !!pending || state !== 'ready';
  $('load-history').textContent = historyRequest ? 'Loading earlier messages…' : imported ? 'Reload earlier messages' : `Load earlier messages (${found} found)`;
  $('history-import-note').textContent = imported ? `${imported} imported from the Arena page` : 'Read-only · from this Arena chat';
  renderModelChip();
  renderPickerBar();
  conversation.render(turns, pending, state);
  updateLiveStatus();
  fitPrompt();
  renderShotChips();
}
// Real-time status: ticks once a second, touching only the pending card's three text nodes.
let statusTimer = null;
function updateLiveStatus() {
  if (!pending) { clearInterval(statusTimer); statusTimer = null; $('pending').dataset.kind = ''; return; }
  const status = liveStatus(pending);
  if ($('pending-title').textContent !== status.step) $('pending-title').textContent = status.step;
  if ($('live-detail').textContent !== status.detail) $('live-detail').textContent = status.detail;
  $('live-detail').hidden = !status.detail;
  if ($('live-elapsed').textContent !== status.meta) $('live-elapsed').textContent = status.meta;
  $('pending').dataset.kind = status.kind;
  if (!statusTimer && pending.status !== 'error') statusTimer = setInterval(updateLiveStatus, 1000);
  if (statusTimer && pending.status === 'error') { clearInterval(statusTimer); statusTimer = null; }
}

function closeClient() { client?.close(); client = null; }
function clear() {
  epoch++; cancelScreenshot(); clearHistoryRequest(); closeClient(); stopRecovery(); if (awakeTab !== null) keepTabAwake(awakeTab, false);
  for (const turn of turns) releaseTurnAttachments(turn);
  tab = null; pending = null; turns = []; state = 'disconnected'; requestedModel = '';
  $('attachment-status').textContent = ''; $('shot-status').textContent = '';
  $('connection-details').open = true; setSheet(true);
  $('prompt').value = ''; promptCut = 0; renderPromptCount(); // the counter belongs to the draft, not to the panel
  $('confirmed').checked = false; $('authorize').checked = false;
  for (const file of staged) if (file.url) URL.revokeObjectURL(file.url);
  staged.length = 0; renderAttachments();
  notice(); render();
}
function hasContent() { return !!(turns.length || $('prompt').value || staged.length); }
// Exactly one confirmation may be open at a time. showModal() throws InvalidStateError on an
// already-open dialog, which used to surface as an unhandled rejection and could lose the answer meant
// for the first caller (two rapid clicks on a choice, or on a model option). A second request is simply
// treated as “not confirmed” — it never overwrites the pending one and never throws.
function showConfirm({ title, text, ok, cancel }) {
  const dialog = $('confirm-dialog');
  if (dialog.open || dialogResolve) return Promise.resolve(false);
  $('dialog-title').textContent = title; $('dialog-description').textContent = text;
  $('dialog-ok').textContent = ok; $('dialog-cancel').textContent = cancel;
  try { dialog.showModal(); } catch { return Promise.resolve(false); }
  return new Promise(resolve => { dialogResolve = resolve; });
}
function askConfirm(title, text, ok = 'Continue', cancel = 'Cancel') { return showConfirm({ title, text, ok, cancel }); }
function askClear(text) {
  if (!hasContent()) return Promise.resolve(true);
  return showConfirm({ title: 'Clear this session?', text, ok: 'Continue', cancel: 'Keep session' });
}
function closeDialog(value) { $('confirm-dialog').close(); dialogResolve?.(value); dialogResolve = null; }
$('dialog-ok').onclick = () => closeDialog(true);
$('dialog-cancel').onclick = () => closeDialog(false);
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(false); });
// ---- Chat mode & model (v2.3.0) ---------------------------------------------------------------
// Direct model choice uses Arena's own link: /text/direct?model_a=<name> opens a NEW empty chat with
// that model. The panel never changes the model of an existing chat and never sends anything here.
function renderModelChip() {
  const chip = $('model-chip'), ready = !!client?.ready && !!tab;
  chip.hidden = !ready && !switching;
  chip.disabled = busy || switching || !!pending || !ready;
  const direct = client?.pageKind === 'direct';
  $('model-mode').textContent = switching ? 'Switching' : direct ? 'Direct' : 'Agent';
  $('model-name').textContent = switching ? 'Opening in Arena…' : direct ? (client.model || 'Model') : 'Agent Mode';
  chip.dataset.kind = direct ? 'direct' : 'agent';
  chip.title = pending ? 'Wait for the current reply before switching' : 'Choose a Direct model or Agent Mode (opens a new chat in Arena) · Ctrl/⌘+K';
}
function modelGroup(text) {
  const label = document.createElement('p'); label.className = 'model-group'; label.textContent = text;
  // The list's non-option content stays out of the list semantics the rows carry (see optionFor).
  label.setAttribute('role', 'presentation'); return label;
}
function renderModelList() {
  const direct = client?.pageKind === 'direct', models = client?.models || [];
  $('mode-direct').setAttribute('aria-pressed', String(direct)); $('mode-agent').setAttribute('aria-pressed', String(!direct));
  $('model-picker').hidden = !direct || !models.length;
  $('model-agent-note').hidden = direct && models.length > 0;
  $('model-agent-note').querySelector('p').textContent = direct
    ? 'Arena’s model list was not found on this page. Use Arena’s own model picker, or open a new Direct chat.'
    : 'Arena lists its models on Direct chat pages. Open a new Direct chat to pick one — it will appear here.';
  const query = $('model-search').value.trim().toLowerCase(), current = (client?.model || '').toLowerCase();
  const shown = models.filter(m => !query || m.name.toLowerCase().includes(query) || m.org.toLowerCase().includes(query));
  const recentNames = query ? [] : recentModels().map(n => n.toLowerCase());
  const recent = recentNames.map(n => shown.find(m => m.name.toLowerCase() === n)).filter(Boolean);
  const rest = recent.length ? shown.filter(m => !recent.includes(m)) : shown;
  const optionFor = model => {
    // One row per option: the list owns the row, the button keeps its own semantics. `role="listitem"`
    // directly on a <button> would replace the button role in the accessibility tree, so these rows used
    // to be announced as list items with nothing to activate.
    const row = document.createElement('div'); row.className = 'model-row'; row.setAttribute('role', 'listitem');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'model-option';
    button.dataset.name = model.name; button.setAttribute('aria-current', String(model.name.toLowerCase() === current));
    const name = document.createElement('span'); name.className = 'model-option-name'; name.textContent = model.name;
    const meta = document.createElement('span'); meta.className = 'model-option-meta';
    meta.textContent = [model.org, model.image ? 'images' : '', model.file ? 'files' : ''].filter(Boolean).join(' · ');
    button.append(name, meta);
    button.addEventListener('click', () => switchChat('direct', model.name));
    row.append(button);
    return row;
  };
  $('model-list').replaceChildren(...(recent.length
    ? [modelGroup('Recent'), ...recent.map(optionFor), modelGroup('All models'), ...rest.slice(0, 200).map(optionFor)]
    : rest.slice(0, 200).map(optionFor)));
  if (!shown.length && models.length) { const empty = document.createElement('p'); empty.className = 'model-empty'; empty.setAttribute('role', 'presentation'); empty.textContent = 'No model matches that search.'; $('model-list').append(empty); }
}
function openModelDialog() {
  if ($('model-chip').disabled) return;
  if ($('model-dialog').open) return; // Ctrl/⌘+K again while it is open: showModal() would throw
  try { client?.queryModel(); } catch { /* reported by the connection */ }
  $('model-search').value = ''; renderModelList(); $('model-dialog').showModal();
  (client?.pageKind === 'direct' && client.models?.length ? $('model-search') : $('model-close')).focus();
}
$('model-chip').addEventListener('click', openModelDialog);
$('model-close').addEventListener('click', () => $('model-dialog').close());
$('model-search').addEventListener('input', renderModelList);
$('mode-agent').addEventListener('click', () => { if (client?.pageKind !== 'direct') { $('model-dialog').close(); return; } switchChat('agent'); });
$('mode-direct').addEventListener('click', () => { if (client?.pageKind === 'direct') return; switchChat('direct', ''); });
$('open-direct').addEventListener('click', () => switchChat('direct', ''));
function waitForTabLoad(tabId, timeoutMs = 30000) {
  let cleanup;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('The Arena tab did not finish loading. Open Settings to reconnect.')); }, timeoutMs);
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const onRemoved = id => { if (id === tabId) { cleanup(); reject(new Error('The Arena tab was closed.')); } };
    cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); chrome.tabs.onRemoved.removeListener(onRemoved); };
    chrome.tabs.onUpdated.addListener(onUpdated); chrome.tabs.onRemoved.addListener(onRemoved);
  });
  return { done, cancel: () => cleanup() };
}
const sameModel = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
async function confirmModel(name) {
  // Arena applies ?model_a= after the page hydrates; give it a few seconds, then report what it shows.
  // While an Arena dialog covers the page, keep waiting (no limit) — the user closes it in Arena.
  const version = epoch;
  for (let i = 0; i < 16 && client?.ready && epoch === version; i++) {
    if (sameModel(client.model, name)) return true;
    if (client.blocked) { if (!$('notice-text').textContent.startsWith('ARENA_DIALOG_OPEN')) notice(`ARENA_DIALOG_OPEN: ${client.blocked}`); }
    try { client.queryModel(); } catch { return false; }
    await new Promise(r => { setTimeout(r, 500); });
  }
  return sameModel(client?.model, name);
}
async function switchChat(kind, name = '') {
  if (!tab || pending || busy || switching) return;
  const target = kind === 'agent' ? AGENT_URL : directModelUrl(name);
  const title = kind === 'agent' ? 'Open Agent Mode?' : name ? `New chat with ${name}?` : 'Open a new Direct chat?';
  const body = `Your connected Arena tab will open ${kind === 'agent' ? 'Agent Mode' : name ? `a new Direct chat with “${name}” selected by Arena` : 'a new Direct chat'}. Arena is brought to the foreground automatically so the page can load, then your previous page is restored. Nothing is sent. This panel’s chat view is cleared; your Arena history is unchanged.${$('prompt').value || staged.length ? ' Your draft and staged files stay here.' : ''}`;
  $('model-dialog').close();
  if (!await askConfirm(title, body, 'Open', 'Cancel')) return;
  const tabId = tab.id;
  switching = true; epoch++; cancelScreenshot(); clearHistoryRequest(); closeClient(); stopRecovery();
  const switchEpoch = epoch, switchOperation = ++actionId; requestedModel = kind === 'direct' ? name : '';
  for (const turn of turns) releaseTurnAttachments(turn);
  pending = null; turns = []; historyRequest = null; state = 'connecting';
  notice(kind === 'agent' ? 'Opening Agent Mode in your Arena tab…' : `Opening a new Direct chat${name ? ` with ${name}` : ''} in your Arena tab…`); render();
  const load = waitForTabLoad(tabId);
  let nav = null;
  try {
    nav = await rpc('NAVIGATE_TAB', { tabId, url: target });
    await load.done;
    if (epoch !== switchEpoch) return;
    await connect(tabId);
    if (switchOperation !== actionId || !client?.ready) return;
    if (kind === 'direct' && name) {
      const confirmed = await confirmModel(name);
      if (switchOperation !== actionId || !client?.ready) return;
      if (confirmed) { requestedModel = ''; rememberModel(client.model); }
      notice(confirmed ? `New Direct chat with ${client.model}. Send a message below — nothing has been sent yet.`
        : `MODEL_NOT_CONFIRMED: Arena shows “${client?.model || 'an unknown model'}” instead of “${name}”. Check or change the model in Arena’s picker before sending — the extension will not switch it for you.`);
    } else notice(client.pageKind === 'direct' ? `New Direct chat${client.model ? ` with ${client.model}` : ''}. Pick a model from the chip above the message box if you like.` : 'Agent Mode is ready. Send a message below.');
  } catch (error) {
    load.cancel(); if (switchOperation === actionId) { state = 'error'; notice(error.message || 'Could not open that Arena page. Open Settings to reconnect.'); }
  } finally {
    if (nav) await rpc('RESTORE_TAB', nav).catch(() => {});
    if (switchOperation === actionId) { switching = false; render(); }
  }
}
// Keep the chip current if the model is changed in Arena's own picker.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && client?.ready) { try { client.queryModel(); } catch { /* ignore */ } } });

// ---- Arena Agent Mode repo & branch pickers (v2.9.0) -------------------------------------------
// When Arena's agent is connected to a GitHub repository, its composer shows a repository and a branch
// picker. The panel mirrors the two buttons; clicking one opens Arena's own picker in the Arena tab,
// reads its option list, and shows it here. Choosing an option clicks Arena's option exactly once and
// is confirmed from what its button then shows — the same "drive the page, verify, never guess" rules
// as every other control. Nothing is requested from GitHub and nothing is sent.
function renderPickerBar() {
  const pickers = client?.ready ? client.repoPickers : null;
  const agent = !!client?.ready && client.pageKind !== 'direct';
  const bar = $('picker-bar');
  bar.hidden = !(agent && (pickers?.repo?.present || pickers?.branch?.present));
  const setChip = kind => {
    const chip = $(`${kind}-chip`), label = $(`${kind}-chip-label`), entry = pickers?.[kind];
    chip.disabled = busy || switching || !!pending || !!pickerAction || !entry?.present || !!entry?.disabled;
    label.textContent = entry?.value || (kind === 'repo' ? 'Repository' : 'Branch');
    label.title = entry?.value || '';
    chip.title = !entry?.present ? `Arena is not showing its ${kind === 'repo' ? 'repository' : 'branch'} picker here`
      : entry?.disabled ? `Arena’s ${kind === 'repo' ? 'repository' : 'branch'} picker is unavailable right now`
      : pending ? 'Wait for the current reply before switching'
      : `Choose the ${kind === 'repo' ? 'GitHub repository' : 'branch'} Arena works on — uses Arena’s own picker`;
  };
  setChip('repo'); setChip('branch');
}
function pickerOptionRow(option, kind, phase) {
  // Same row/button split as the model list: the row is the list item, the button is the control.
  const row = document.createElement('div'); row.className = 'model-row'; row.setAttribute('role', 'listitem');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'model-option';
  const current = client?.repoPickers?.[kind]?.value || '';
  button.setAttribute('aria-current', String(option.label === current));
  button.dataset.name = option.label;
  const name = document.createElement('span'); name.className = 'model-option-name'; name.textContent = option.label;
  const meta = document.createElement('span'); meta.className = 'model-option-meta'; meta.textContent = option.meta || '';
  button.append(name, meta);
  button.disabled = !!option.disabled || phase !== 'open';
  button.title = option.disabled ? 'Arena lists this option as unavailable right now' : `Switch Arena’s ${kind === 'repo' ? 'repository' : 'branch'} to ${option.label}`;
  button.addEventListener('click', () => pickFromDialog(option.label));
  row.append(button);
  return row;
}
function renderPickerDialog() {
  if (!pickerAction || !$('picker-dialog').open) return;
  const { kind, options, phase, error } = pickerAction;
  const status = $('picker-status');
  status.dataset.kind = error ? 'error' : 'info';
  status.textContent = error || (phase === 'opening' ? 'Opening Arena’s picker in the Arena tab…' : phase === 'picking' ? `Asking Arena to switch ${kind === 'repo' ? 'repository' : 'branch'}…` : options.length ? '' : 'Arena’s picker is open, but no options were found.');
  const query = $('picker-search').value.trim().toLowerCase();
  const shown = options.filter(option => !query || option.label.toLowerCase().includes(query) || (option.meta || '').toLowerCase().includes(query));
  $('picker-list').replaceChildren(...shown.map(option => pickerOptionRow(option, kind, phase)));
  if (!shown.length && options.length) { const empty = document.createElement('p'); empty.className = 'model-empty'; empty.setAttribute('role', 'presentation'); empty.textContent = 'No option matches that search.'; $('picker-list').append(empty); }
}
function openPickerDialog(kind) {
  const chip = $(`${kind}-chip`);
  if (chip.disabled || $('picker-dialog').open || !client?.ready) return;
  pickerAction = { actionId: crypto.randomUUID(), kind, options: [], phase: 'opening', error: '' };
  try { client.picker(pickerAction.actionId, kind, 'open'); }
  catch (error) { pickerAction = null; notice(error.message || 'The picker could not be opened. Check the Arena tab.'); render(); return; }
  $('picker-dialog-title').textContent = kind === 'repo' ? 'Repository' : 'Branch';
  $('picker-search').value = '';
  try { $('picker-dialog').showModal(); } catch { /* already closing */ }
  renderPickerDialog();
  render();
}
function pickFromDialog(value) {
  if (!pickerAction || pickerAction.phase !== 'open' || !client?.ready) return;
  pickerAction.phase = 'picking'; pickerAction.error = '';
  try { client.picker(pickerAction.actionId, pickerAction.kind, 'pick', value); }
  catch (error) { pickerAction.phase = 'open'; pickerAction.error = error.message || 'The choice could not be sent. Check the Arena tab.'; notice(pickerAction.error); }
  renderPickerDialog();
}
// Closing the panel dialog (Done, Escape, backdrop, or a finished pick) also dismisses Arena's own
// picker in the tab. One close request, best effort; the tab reports if Arena kept it open.
function endPickerDialog() {
  const action = pickerAction;
  if (!action) return;
  pickerAction = null;
  try { client?.picker(action.actionId, action.kind, 'close'); } catch { /* the connection reports its own state */ }
  render();
}
function receivePicker(event) {
  if (!pickerAction || event.actionId !== pickerAction.actionId) return; // a frame from a dialog already closed
  if (event.type === 'PICKER_ERROR') {
    pickerAction.error = `${event.code}: ${event.message}`;
    if (pickerAction.phase === 'picking') pickerAction.phase = 'open'; // the option list is still valid
    if (event.repoPickers && client) client.repoPickers = normalizePickers(event.repoPickers);
    notice(pickerAction.error);
    renderPickerDialog(); return;
  }
  if (event.repoPickers && client) client.repoPickers = normalizePickers(event.repoPickers);
  if (event.phase === 'open') {
    pickerAction.options = Array.isArray(event.options) ? event.options.slice(0, 200) : [];
    pickerAction.phase = 'open'; pickerAction.error = '';
    renderPickerDialog();
  } else if (event.phase === 'done') {
    pickerAction = null;
    try { $('picker-dialog').close(); } catch { /* already closed */ }
    notice(`Arena switched its ${event.kind === 'repo' ? 'repository' : 'branch'} to ${event.value || 'your choice'}. Nothing was sent.`);
  } else if (event.phase === 'closed') {
    pickerAction = null;
    try { $('picker-dialog').close(); } catch { /* already closed */ }
  }
}
$('repo-chip').addEventListener('click', () => openPickerDialog('repo'));
$('branch-chip').addEventListener('click', () => openPickerDialog('branch'));
$('picker-close').addEventListener('click', () => $('picker-dialog').close());
$('picker-dialog').addEventListener('close', endPickerDialog);
$('picker-search').addEventListener('input', renderPickerDialog);

async function refresh() {
  const selected = $('tabs').value, tabs = await rpc('LIST_TABS');
  $('tabs').replaceChildren();
  if (!tabs.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = 'No Arena tabs — open Agent or Direct below'; $('tabs').append(option);
  }
  for (const item of tabs) {
    const option = document.createElement('option'); option.value = String(item.id);
    option.textContent = tabLabel(item) + (isDirect(item.url) ? ' · unsupported text mode' : ''); $('tabs').append(option);
  }
  if (tabs.some(item => String(item.id) === selected)) $('tabs').value = selected;
  render();
}
// Battles in Direct: continuing with A or B records the user's preference in Arena, so it needs an
// explicit click here plus a confirmation. The page then gets exactly one click on Arena's own button.
async function chooseResponse(turnId, side) {
  if (!pending || pending.id !== turnId || pending.status !== 'waiting' || state === 'error' || !client?.ready) return;
  const pair = pending.live?.pair;
  if (!pair || pair.busy || pair.choice || !['a', 'b', 'skip', 'dismiss'].includes(side)) return;
  if (side === 'skip' ? !pair.skip?.enabled : !pair.prompt || !pair.ready) return;
  if (side === 'dismiss') return dismissPair(turnId, pair);
  const label = side.toUpperCase();
  if (side === 'skip') {
    if (!await askConfirm('Skip both responses?', 'Arena records a Skip for this comparison (no preference for A or B) and writes a new response with your model. The panel clicks Arena’s Skip button once. You can also skip in the Arena tab instead.', 'Skip', 'Cancel')) return;
  } else if (!await askConfirm(`Continue with Response ${label}?`, `Arena records this as your preferred response and continues the conversation with it. The panel clicks Arena’s “Continue with ${label}” button once. You can also choose in the Arena tab instead.`, `Continue with ${label}`, 'Cancel')) return;
  if (!pending || pending.id !== turnId || !client?.ready || pending.live?.pair !== pair) return;
  pair.busy = true; pair.choiceState = side === 'skip' ? 'Asking Arena to skip…' : `Asking Arena to continue with Response ${label}…`; pending.liveRevision = (pending.liveRevision || 0) + 1;
  try { client.choose(turnId, side); }
  catch { pair.busy = false; pair.choiceState = 'Connection lost before choosing. Choose in Arena; nothing was clicked.'; }
  render();
}
// When Arena shows no Skip button there is nothing to click in Arena. The panel can only stop waiting —
// it says so plainly and leaves the comparison in the Arena tab untouched.
async function dismissPair(turnId, pair) {
  if (pair.skip?.offered) return;
  if (!await askConfirm('Skip here without choosing?', 'Arena is not showing a Skip button for this comparison, so nothing can be skipped on Arena itself. This only stops the panel waiting: nothing is clicked or sent, and “Which response do you prefer?” stays in the Arena tab. Arena may ask you to choose there before your next message.', 'Skip here', 'Keep waiting')) return;
  if (!pending || pending.id !== turnId || pending.live?.pair !== pair || pair.choice || pair.busy) return;
  client?.cancel(pending.id); releaseTurnAttachments(pending); pending.status = 'cancelled'; pending = null;
  pair.dismissed = true; pair.choiceState = 'Skipped here only. Nothing was sent to Arena; the question is still in the Arena tab.';
  state = client?.ready ? 'ready' : 'error';
  notice('Skipped in the panel only. Arena still shows its A/B question — choose or skip there if it blocks your next message.');
  render();
}
function answerQuestion(turnId, answer) {
  if (!pending || pending.id !== turnId || pending.status !== 'waiting' || state === 'error' || !client?.ready) return;
  const question = pending.live?.questions?.find(q => q.token === answer.token);
  if (!question || question.readOnly || question.answerState || question.busy) return;
  for (const card of pending.live.questions) card.busy = true;
  question.answerState = 'Submitting your answer…'; pending.liveRevision = (pending.liveRevision || 0) + 1;
  try { client.answer(turnId, answer); }
  catch { question.answerState = 'Connection lost while answering. Check Arena; no automatic retry.'; }
  render();
}
// Earlier turns are a read-only snapshot of the open conversation, kept above this panel's own turns.
function receiveHistory(event) {
  if (!historyRequest || event.requestId !== historyRequest) return;
  clearHistoryRequest();
  if (event.type === 'HISTORY_ERROR') { notice(`${event.code}: ${event.message}`); return; }
  if (tab && event.url && !samePage(event.url, tab.url)) { notice('The Arena conversation changed while loading. Reconnect before loading its history.'); return; }
  const own = turns.filter(t => !t.imported);
  const ownIds = new Set(own.map(t => t.userMessageId).filter(Boolean));
  const list = Array.isArray(event.turns) ? event.turns : [];
  const firstOwn = list.findIndex(t => ownIds.has(t.userMessageId));
  const earlier = (firstOwn >= 0 ? list.slice(0, firstOwn) : list).filter(t => !ownIds.has(t.userMessageId));
  const importedTurns = earlier.map(t => ({
    id: `arena-${t.userMessageId}`, imported: true, prompt: String(t.prompt || ''), reply: t.status === 'complete' ? String(t.reply || '') : '', rich: t.status === 'complete' && Array.isArray(t.rich) ? t.rich : null,
    status: t.status === 'complete' ? 'complete' : `imported-${t.status}`, userMessageId: t.userMessageId, assistantMessageId: t.assistantMessageId,
    model: typeof t.model === 'string' ? t.model.slice(0, 120) : '', mode: client?.pageKind === 'direct' ? 'direct' : 'agent',
    live: (t.tools?.length || t.thinking) ? { text: '', tools: t.tools || [], questions: [], interactionNotice: '', thinking: t.thinking || null } : undefined
  }));
  turns = [...importedTurns, ...own];
  const unclear = importedTurns.filter(t => t.status !== 'complete').length;
  const parts = [importedTurns.length ? `Loaded ${importedTurns.length} earlier turn${importedTurns.length === 1 ? '' : 's'} from this Arena chat.` : 'No earlier turns were found on the page.'];
  if (unclear) parts.push(`${unclear} had no single clear reply and are marked — read those in Arena.`);
  if (event.startMissing) parts.push('The start of this chat may not be loaded on the page: scroll up in Arena, then click Reload earlier messages.');
  if (event.truncated) parts.push('Only the first 200 turns / 2 million characters were loaded.');
  if (event.inProgressSkipped) parts.push('The newest turn is still running in Arena and was not imported.');
  notice(parts.join(' '));
}
// ---- Staying connected -------------------------------------------------------------------------
// The panel↔tab port can still drop if Arena reloads, Chrome discards/freezes the tab, or the page
// is replaced. Then the panel reattaches to the SAME tab and SAME conversation URL on its own, with
// backoff. It never resends: an accepted message is re-watched read-only; one that was mid-send is
// marked for you to check in Arena. A different page, a closed tab or another panel stops it.
const RECOVERY_DELAYS = [0, 2000, 5000, 15000, 30000, 60000];
let recovery = { attempt: 0, timer: null, running: false };
let awakeTab = null;
function keepTabAwake(tabId, keep) {
  if (keep) {
    if (awakeTab !== null && awakeTab !== tabId) void awakeLease.release(awakeTab);
    awakeTab = tabId; void awakeLease.acquire(tabId);
  } else {
    if (awakeTab === tabId) awakeTab = null;
    void awakeLease.release(tabId);
  }
}
function clearHistoryRequest() { clearTimeout(historyTimer); historyTimer = null; historyRequest = null; }
function restoreUnsentDraft(turn) {
  if (!turn) return;
  if (!$('prompt').value) $('prompt').value = turn.prompt;
  const restored = restoreTurnAttachments(turn);
  if (!staged.length) {
    for (const item of restored) {
      if (item.type.startsWith('image/')) { try { item.url = URL.createObjectURL(item.file); } catch { /* preview only */ } }
      staged.push(item);
    }
  }
  renderAttachments(); renderPromptCount();
}

function stopRecovery() { clearTimeout(recovery.timer); recovery = { attempt: 0, timer: null, running: false }; }
function scheduleRecovery(delay) {
  clearTimeout(recovery.timer);
  recovery.timer = setTimeout(recoverNow, delay ?? RECOVERY_DELAYS[Math.min(recovery.attempt, RECOVERY_DELAYS.length - 1)]);
}
function interrupt(turn, text) {
  releaseTurnAttachments(turn);
  turn.status = 'error'; turn.code = 'CONNECTION_INTERRUPTED'; turn.outcomeText = text;
  if (pending === turn) pending = null;
}
function giveUp(message, turnText) {
  if (awakeTab !== null) keepTabAwake(awakeTab, false);
  stopRecovery(); state = 'error';
  if (pending) interrupt(pending, turnText || 'The connection ended before the reply arrived. Read it in Arena; nothing was resent.');
  notice(message);
}
function connectionLost(event) {
  clearHistoryRequest();
  pickerAction = null; try { $('picker-dialog').close(); } catch { /* already closed */ }
  const old = client; client = null; old?.close();
  if (!tab || !event.wasReady) {
    state = 'error'; if (pending) { pending.status = 'error'; releaseTurnAttachments(pending); };
    notice(`${event.code ? event.code + ': ' : ''}${event.message}`); return;
  }
  if (pending) {
    if (pending.status === 'waiting' && pending.userMessageId) { pending.phase = 'reconnecting'; pending.resume = true; }
    else interrupt(pending, 'The connection dropped while this message was being sent. Check Arena before sending it again — it may or may not have been submitted.');
  }
  state = 'reconnecting';
  notice('Lost the connection to the Arena tab. Reconnecting automatically — nothing will be resent.');
  scheduleRecovery(0);
}
async function recoverNow() {
  if (state !== 'reconnecting' || !tab || recovery.running) return;
  recovery.running = true; recovery.attempt++;
  const version = epoch; let next = null;
  try {
    const current = await rpc('GET_TAB', { tabId: tab.id });
    if (epoch !== version || state !== 'reconnecting') return;
    if (current.discarded) throw new Error('Chrome put the Arena tab to sleep. Click “Go to Arena tab” in Settings to wake it; the panel reattaches by itself.');
    if (current.status === 'loading') throw new Error('The Arena tab is still loading.');
    if (!samePage(current.url, tab.url)) {
      giveUp('The Arena tab is now on a different page, so the panel did not reattach automatically. Open Settings and use Reconnect to connect to that page.',
        'The Arena tab moved to a different page while this reply was being tracked. Read it in Arena; nothing was resent.');
      return;
    }
    next = new AgentClient(tab.id, event => {
      if (epoch !== version || client !== next) return;
      if (!next.ready && event.type === 'ERROR' && !event.requestId) return; // reported through readiness below
      receive(event);
    }, tab.url);
    client = next;
    await next.readiness;
    if (epoch !== version || client !== next) return;
    stopRecovery(); keepTabAwake(tab.id, true);
    if (pending?.resume) {
      pending.resume = false; pending.phase = ''; pending.resumed = true; state = 'waiting';
      next.watch(pending.id, pending.prompt, pending.userMessageId, tab.url, !!pending.attachments?.length, pending.questionRowIds);
      notice('Reconnected to the Arena tab. Still tracking your message — nothing was resent.');
    } else { state = 'ready'; notice('Reconnected to the Arena tab automatically. Nothing was resent.'); }
  } catch (error) {
    if (next && client === next) { client = null; next.close(); }
    if (epoch !== version || state !== 'reconnecting') return;
    const text = error.message || '';
    if (/no tab with id/i.test(text)) { giveUp('The Arena tab was closed. Open Arena and connect again from Settings.', 'The Arena tab was closed before the reply arrived.'); return; }
    // The page clears its side of a closed port asynchronously, so a reconnect that races the previous
    // connection can be refused once. That is transient: retry a few times with backoff before ending
    // the session and asking the user to reconnect by hand.
    if (/TAB_IN_USE|Another extension panel/i.test(text) && recovery.attempt < 4) {
      notice(`Reconnecting to the Arena tab… (attempt ${recovery.attempt}) the previous connection is still closing.`);
      scheduleRecovery(Math.max(1000, RECOVERY_DELAYS[Math.min(recovery.attempt, RECOVERY_DELAYS.length - 1)]));
      return;
    }
    if (/no longer on Arena|TAB_IN_USE/i.test(text)) { giveUp(`${text} Open Settings to connect again.`); return; }
    notice(`Reconnecting to the Arena tab… (attempt ${recovery.attempt}) ${text}`.trim());
    scheduleRecovery();
  } finally { recovery.running = false; render(); }
}
const nudgeRecovery = () => { if (state === 'reconnecting' && !recovery.running) scheduleRecovery(0); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nudgeRecovery(); });
window.addEventListener('focus', nudgeRecovery);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (tab && tabId === tab.id && info.status === 'complete') nudgeRecovery(); });

// An event that cannot be applied must never leave the panel frozen on stale state or - worse - kill the
// port listener it arrived on: the failure is logged, reported, and the view is rebuilt from what the
// panel knows.
function receive(event) {
  try { handleEvent(event); }
  catch (error) {
    console.error('Arena Auto Chat could not apply an event:', event?.type, error);
    try { notice(`${event?.type || 'EVENT'}_FAILED: The panel could not update itself (${error?.message || error}). Reconnect in Settings if this keeps happening.`); } catch { /* the panel DOM is unusable */ }
    try { render(); } catch { /* already reported above */ }
  }
}
function handleEvent(event) {
  if (event.type === 'TRANSPORT_HEALTH') {
    notice(event.responsive ? 'The Arena tab is responding again. Nothing was resent.' : 'TAB_NOT_RESPONDING: The Arena tab has not answered the connection heartbeat. Open it from Settings to wake it. Send is paused; nothing will be resent.');
    render(); return;
  }
  if (event.type === 'MODEL_INFO') { render(); if ($('model-dialog').open) renderModelList(); return; }
  if (event.type === 'PICKER_STATE' || event.type === 'PICKER_ERROR') { receivePicker(event); render(); return; }
  if (event.type === 'BRIDGE_LOST') { connectionLost(event); render(); return; }
  if (event.type === 'WAITING') { notice(`${event.code}: ${event.message}`); render(); return; }
  if (event.type === 'ERROR' && !event.requestId) {
    state = 'error'; if (pending) { pending.status = 'error'; releaseTurnAttachments(pending); };
    notice(`${event.code ? event.code + ': ' : ''}${event.message}`); render(); return;
  }
  if (event.type === 'HISTORY' || event.type === 'HISTORY_ERROR') { receiveHistory(event); render(); return; }
  const turn = pending;
  if (!turn || event.requestId !== turn.id) return;
  switch (event.type) {
    case 'REVIEW_HANDLING': state = 'sending'; turn.status = 'sending'; turn.phase = 'review'; notice('Closing Arena’s task-review panel to restore the composer. No Yes/No feedback is selected.'); break;
    case 'SENDING': state = 'sending'; turn.status = 'sending'; turn.phase = ''; break;
    case 'SENT_WORKING':
      releaseTurnAttachments(turn);
      state = 'waiting'; turn.status = 'waiting'; turn.acceptedAt ||= Date.now(); turn.lastActivityAt = Date.now();
      notice(`Arena took your message (${event.evidence || 'it is working'}) but has not shown it in the conversation yet — normal while a new Agent chat starts up. Waiting with no time limit. To stop waiting: Settings → Stop tracking.`); break;
    case 'ACCEPTED':
      releaseTurnAttachments(turn);
      state = 'waiting'; turn.status = 'waiting'; turn.userMessageId = event.userMessageId;
      turn.acceptedAt ||= Date.now(); turn.lastActivityAt = Date.now();
      notice('Arena accepted your message. Live updates and supported question cards appear below; the final reply stays separate.'); break;
    case 'LIVE_UPDATE':
      { const now = Date.now();
        if ((event.text || '') !== (turn.live?.text || '')) turn.textChangedAt = now;
        turn.lastActivityAt = now; turn.acceptedAt ||= now;
        turn.live = { text: event.text, rich: event.rich || null, tools: event.tools, questions: event.questions, interactionNotice: event.interactionNotice, thinking: event.thinking || null, generating: !!event.generating, pair: event.pair || null };
        // v2.8.1: remember every row that ever held a card, so a reconnect after an answer can still
        // tell the answered row (now plain text) from the new reply instead of stopping as ambiguous.
        if (Array.isArray(event.questions)) {
          const seen = event.questions.map(q => q.rowId).filter(Boolean);
          if (seen.length) turn.questionRowIds = [...new Set([...(turn.questionRowIds || []), ...seen])].slice(-64);
        }
        if (event.pair?.prompt && event.pair.ready && !turn.pairNoticed) { turn.pairNoticed = true; notice('Arena answered with two responses and asks which one to continue with. Choose below or in Arena — nothing is chosen for you.'); }
        turn.liveRevision = (turn.liveRevision || 0) + 1; }
      break;
    case 'QUESTION_ERROR':
      { const question = turn.live?.questions?.find(q => q.token === event.token); if (question) question.answerState = event.message;
        turn.liveRevision = (turn.liveRevision || 0) + 1; notice(event.message); }
      break;
    case 'CHOICE_SENT':
      turn.pairChoice = event.side; turn.liveRevision = (turn.liveRevision || 0) + 1;
      notice(event.side === 'skip' ? 'Skipped — Arena’s Skip button was clicked once. Waiting for Arena’s new response.' : `Continuing with Response ${String(event.side).toUpperCase()} — Arena’s button was clicked once. Waiting for that response to continue.`); break;
    case 'CHOICE_SEEN':
      turn.pairChoice = event.side; turn.liveRevision = (turn.liveRevision || 0) + 1;
      notice(event.side === 'skip' ? 'You skipped both responses in Arena. Capturing its new response.' : `You chose Response ${String(event.side).toUpperCase()} in Arena. Capturing it.`); break;
    case 'CHOICE_ERROR':
      if (turn.live?.pair) { turn.live.pair.choiceState = event.message; turn.live.pair.busy = false; turn.liveRevision = (turn.liveRevision || 0) + 1; }
      notice(event.message); break;
    case 'QUESTION_SENT': notice('Your answer was attempted once and Arena’s question changed. Continuing to track this task.'); break;
    case 'BLOCKED':
      // A transient security verification, not a failure: keep the turn alive and just say why it paused.
      turn.securityHold = true; turn.lastActivityAt = Date.now();
      state = 'waiting'; turn.status = 'waiting';
      notice(`${event.code}: ${event.message} Tracking is paused, not stopped — it resumes on its own once the verification passes in Arena.`);
      break;
    case 'SECURITY_CLEARED':
      turn.securityHold = false; turn.lastActivityAt = Date.now();
      notice('The Arena verification passed. Tracking resumed automatically; nothing was resent.');
      break;
    case 'URL_BOUND': tab.url = event.url; break;
    case 'COMPLETE':
      releaseTurnAttachments(turn);
      turn.reply = event.text; turn.rich = Array.isArray(event.rich) ? event.rich : null; turn.status = 'complete'; turn.userMessageId = event.userMessageId; turn.assistantMessageId = event.assistantMessageId;
      turn.model = typeof event.model === 'string' ? event.model.slice(0, 120) : '';
      turn.choice = ['a', 'b', 'skip'].includes(event.choice) ? event.choice : '';
      tab.url = event.url; pending = null; state = 'ready';
      notice('Reply received automatically.'); break;
    case 'STAGED': turn.phase = 'upload'; break;
    case 'WATCHING': turn.phase = ''; break;
    case 'ERROR':
      if (turn.resumed && client?.ready) {
        // Re-watching after a reconnect failed (e.g. the message is gone after a reload). The
        // connection itself is fine, so finish this turn and keep the chat usable. Nothing is resent.
        releaseTurnAttachments(turn);
        turn.status = 'error'; turn.code = event.code; turn.outcomeText = `${event.message}`; pending = null; state = 'ready';
        notice(`${event.code}: ${event.message}`); break;
      }
      state = 'error'; turn.status = 'error'; turn.code = event.code;
      if (!event.clicked) restoreUnsentDraft(turn); else releaseTurnAttachments(turn);
      notice(turn.resumed ? `${event.code}: ${event.message}` : `${event.code}: ${event.message} ${event.clicked ? 'Send was attempted once. Check Arena before resending.' : 'No Send click was attempted for this request. Text may remain in the Arena composer.'}`); break;
  }
  render();
}
async function connect(id) {
  const version = ++epoch;
  clearHistoryRequest(); closeClient(); state = 'connecting'; render();
  const selected = await rpc('GET_TAB', { tabId: id });
  if (epoch !== version) return;
  if (!isArena(selected.url) || isDirect(selected.url)) throw new Error('Battle and Side-by-Side are not supported. Open Agent Mode or a Direct (one model) chat. It will not fall back to manual copying.');
  tab = selected; render();
  const next = new AgentClient(id, event => { if (epoch === version && client === next) receive(event); }, selected.url);
  client = next;
  try { await next.readiness; }
  catch (error) { next.close(); if (client === next) client = null; throw error; }
  if (version !== epoch) return;
  state = 'ready'; $('connection-details').open = false; setSheet(false); keepTabAwake(selected.id, true);
  notice('Connected. Send a message below — replies appear right here.');
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    if (busy || switching) return;
    // A coded error stays until the user minimizes it (see noticeKind/setNoticeOpen above): an action
    // click must not wipe the message the user is still reading. Anything else makes way for the result.
    busy = true; if ($('notice').dataset.kind !== 'error') notice(); render(); const operation = ++actionId;
    try { await fn(); }
    catch (error) {
      // Never convert a failure into manual mode or request pasted replies.
      if (operation === actionId) {
        if (pending || !client?.ready) state = 'error'; if (pending) pending.status = 'error'; notice(error.message || 'Unexpected extension error. Check Arena before resending.');
      }
    } finally { if (operation === actionId) { busy = false; render(); } }
  });
}
$('connection-cancel').addEventListener('click', () => {
  if (!['connecting', 'reconnecting'].includes(state)) return;
  actionId++; epoch++; closeClient(); stopRecovery(); clearHistoryRequest(); cancelScreenshot();
  if (awakeTab !== null) keepTabAwake(awakeTab, false);
  if (pending) interrupt(pending, 'Connection setup cancelled. Nothing was resent; check Arena for any accepted message.');
  busy = false; switching = false; state = tab ? 'error' : 'disconnected';
  notice('Connection setup cancelled. Your local draft and history are kept.'); render();
});
$('connection-focus').addEventListener('click', () => {
  if (tab) rpc('FOCUS_TAB', { tabId: tab.id }).catch(error => notice(error.message));
});
$('accept-current-model').addEventListener('click', async () => {
  if (!requestedModel || !client?.ready || !client.model || busy || switching) return;
  const version = epoch, model = client.model;
  if (await askConfirm('Use Arena’s current model?', `You requested “${requestedModel}”. Send future messages using “${model}” instead?`, 'Use this model', 'Cancel')) {
    if (epoch === version && client?.ready && client.model === model) { requestedModel = ''; notice(`Model confirmed: ${model}. Nothing was sent.`); render(); }
  }
});
for (const id of ['tabs', 'confirmed', 'authorize']) $(id).addEventListener('change', render);
$('load-history').addEventListener('click', () => {
  if ($('load-history').disabled || !client?.ready || !tab) return;
  historyRequest = crypto.randomUUID();
  historyTimer = setTimeout(() => { clearHistoryRequest(); notice('HISTORY_TIMEOUT: Earlier messages did not arrive. Open Arena or try the read-only history request again.'); render(); }, 15000);
  try { client.loadHistory(historyRequest, tab.url); }
  catch (error) { clearHistoryRequest(); notice(error.message); }
  render();
});
action('refresh', refresh);
action('float-window', async () => {
  if (!await askClear('Open the floating window and clear this local session? History is not transferred. Any request already sent continues in Arena; wait for it to finish before switching.')) return;
  clear(); await rpc('OPEN_FLOATING'); notice('Floating window opened. Connect your Arena tab there.'); await refresh();
});
action('open', async () => { await rpc('OPEN_ARENA'); await refresh(); notice('Agent Mode opened in a new tab. Sign in and select your model there, then connect that tab here.'); });
action('open-direct-tab', async () => { await rpc('OPEN_ARENA', { kind: 'direct' }); await refresh(); notice('A Direct chat opened in a new tab. Sign in there, then connect that tab here — you can pick the model from the chip above the message box.'); });
action('connect', async () => {
  if (!$('confirmed').checked || !$('authorize').checked) throw new Error('Review both confirmations before connecting.');
  await connect(Number($('tabs').value));
});
action('focus', async () => { if (tab) await rpc('FOCUS_TAB', { tabId: tab.id }); });
action('disconnect', async () => {
  if (!await askClear('Disconnect and clear this panel? Any request already accepted by Arena may continue there.')) return;
  clear(); await refresh(); notice('Disconnected. The local session was cleared; Arena history is unchanged.');
});
action('reconnect', async () => {
  if (!tab) return;
  const id = tab.id, expectedUrl = tab.url, operation = actionId;
  const current = await rpc('GET_TAB', { tabId: id });
  if (operation !== actionId) return;
  if (!samePage(current.url, expectedUrl)) {
    if (!await askClear('Arena is on a different conversation. Clear this local session and choose that tab again? Nothing will be resent.')) return;
    clear(); await refresh(); $('tabs').value = String(id);
    notice('Choose the current conversation and confirm it before connecting.'); return;
  }
  if (pending && !await askConfirm('Reattach without resending?', 'Your current request may continue in Arena. Only an already-verified message can be tracked again; nothing will be resent. Your local chat and draft stay here.', 'Reattach', 'Cancel')) return;
  if (operation !== actionId) return;
  const tracked = pending?.userMessageId ? pending : null;
  if (pending && !tracked) interrupt(pending, 'Tracking interrupted before message acceptance could be verified. Check Arena; nothing was resent.');
  cancelScreenshot();
  await connect(id);
  if (operation !== actionId || !client?.ready) return;
  if (tracked) {
    pending = tracked; tracked.status = 'waiting'; tracked.resumed = true; state = 'waiting';
    client.watch(tracked.id, tracked.prompt, tracked.userMessageId, tab.url, !!tracked.attachments?.length, tracked.questionRowIds);
  }
  notice('Reattached to the same conversation. Your local chat and draft are kept; nothing was resent.');
});

action('prepare', async () => {
  if (shotOperation || requestedModel || switching) throw new Error('Finish or cancel the screenshot and confirm the selected model before sending.');
  if (state !== 'ready' || !client?.ready || pending || !tab) throw new Error('Connect and verify the Agent controls before sending.');
  const capability = capabilitySummary(client.capabilities);
  if (capability.drift) throw new Error(`The Arena page no longer matches this adapter (missing: ${capability.required.join(', ')}). Verify the Arena tab and update/reload the extension before sending. No prompt was sent.`);
  const text = $('prompt').value.trim();
  if (!text || text.length > 30000) throw new Error('Enter a message of 1–30,000 characters with any attachments.');
  if (staged.length && !client?.ready) throw new Error('Connect and verify the Arena tab before sending staged files.');
  if (staged.length && client?.uploadKind !== 'input') throw new Error(client?.uploadKind === 'unsupported' ? 'The Arena composer file input restricts file types or is ambiguous, so staged files cannot be placed there. Attach them in the Arena tab; nothing was sent.' : 'The connected Arena tab does not expose a usable composer file input, so staged files cannot be sent. Remove them here or attach them in the Arena tab; nothing was sent.');
  const version = epoch, connection = client, selectedTab = tab, snapshot = staged.slice();
  const files = snapshot.map(item => item.file), payload = [];
  try {
    for (const item of snapshot) {
      const buffer = await withTimeout(item.file.arrayBuffer(), 10000, 'File reading timed out. Nothing was sent.');
      if (version !== epoch || client !== connection) return;
      if (!buffer.byteLength || buffer.byteLength > ATTACHMENT_POLICY.maxBytes) throw new Error(`"${item.name}" could not be read within the size limit. Nothing was sent.`);
      payload.push({ name: item.name, type: item.type, data: bytesToBase64(new Uint8Array(buffer)) });
    }
    const current = await rpc('GET_TAB', { tabId: selectedTab.id });
    if (version !== epoch || client !== connection) return;
    if (!samePage(current.url, tab.url)) { closeClient(); throw new Error('The Arena URL changed. Reconnect to verify the current Arena conversation.'); }
    tab.url = current.url; // Arena may rewrite ?model_a= on an empty Direct chat; same page.
    const turn = { id: crypto.randomUUID(), mode: client?.pageKind === 'direct' ? 'direct' : 'agent', prompt: text, reply: '', status: 'sending', attachments: snapshot.map(({ name, size, type }) => ({ name, size, type })), files };
    turns.push(turn); pending = turn; state = 'sending'; $('prompt').value = ''; promptCut = 0; renderPromptCount();
    for (const item of staged.splice(0)) if (item.url) URL.revokeObjectURL(item.url);
    renderAttachments();
    try { await connection.send(turn.id, turn.prompt, tab.url, payload); }
    catch (error) { if (version === epoch && pending === turn) restoreUnsentDraft(turn); else releaseTurnAttachments(turn); throw error; }
    if (version !== epoch || client !== connection) return;
    notice(turn.attachments.length ? `Submitting your message and ${turn.attachments.length} staged file${turn.attachments.length > 1 ? 's' : ''} through Arena’s visible controls.` : 'Submitting through Arena’s visible controls. No copy/paste action is required.');
  } finally { for (const item of payload) item.data = ''; payload.length = 0; }
});
function formatName(name) { const text = String(name); return text.length > 34 ? `${text.slice(0, 14)}…${text.slice(-16)}` : text; }
function stageFiles(list, origin) {
  if (busy || pending || state !== 'ready' || !client?.ready) return false;
  const { accepted, rejected } = selectAttachments(list, ATTACHMENT_POLICY.maxFiles - staged.length);
  for (const item of accepted) {
    if (item.type.startsWith('image/')) { try { item.url = URL.createObjectURL(item.file); } catch { /* preview only */ } }
    staged.push(item);
  }
  $('attachment-status').textContent = rejected.map(item => `“${formatName(item.name)}”: ${item.reason}`).join(' ');
  renderAttachments(); render();
  return accepted.length > 0;
}

function renderAttachments() {
  const chips = $('attachment-chips');
  chips.replaceChildren(...staged.map((item, index) => {
    const chip = document.createElement('span'); chip.className = 'attachment-chip';
    if (item.url) {
      // Click the thumbnail to review the image full size in a tab before sending (e.g. a link screenshot).
      const view = document.createElement('button'); view.type = 'button'; view.className = 'attachment-thumb';
      view.title = `View ${item.name}`; view.setAttribute('aria-label', `View ${item.name}`);
      view.onclick = () => { chrome.tabs.create({ url: item.url }).catch(() => {}); };
      const thumb = document.createElement('img'); thumb.src = item.url; thumb.alt = ''; view.append(thumb); chip.append(view);
    }
    const label = document.createElement('span'); label.className = 'attachment-name';
    label.textContent = `${formatName(item.name)} · ${formatBytes(item.size)}`; label.title = item.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'attachment-remove';
    remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${item.name}`);
    remove.onclick = () => { if (busy || pending) return; const [gone] = staged.splice(index, 1); if (gone?.url) URL.revokeObjectURL(gone.url); $('attachment-status').textContent = ''; renderAttachments(); render(); };
    chip.append(label, remove); return chip;
  }));
  $('attachments').hidden = !staged.length && !$('attachment-status').textContent;
}
// ---------- Link screenshots (v2.6.0) ----------
// A chip per link found in the draft. Nothing is opened or captured unless the user clicks a chip.
async function refreshShotAccess() {
  shotAccess = await hasShotAccess();
  $('shot-access-state').textContent = shotAccess ? 'Granted' : 'Not granted';
  $('shot-access-remove').disabled = !shotAccess;
}
chrome.permissions?.onAdded?.addListener(() => refreshShotAccess());
chrome.permissions?.onRemoved?.addListener(async () => {
  await refreshShotAccess();
  if (!shotAccess && shotOperation) { cancelScreenshot('Screenshot cancelled because website access was removed.'); render(); }
});
refreshShotAccess();
$('shot-access-remove').addEventListener('click', async () => {
  cancelScreenshot('Screenshot cancelled because website access was removed.'); render();
  await removeShotAccess(); await refreshShotAccess();
  notice(shotAccess ? 'Chrome kept website access; remove it at chrome://extensions if needed.' : 'Website access for link screenshots was removed. Chrome will ask again next time.');
});
function cameraIcon() {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linejoin', 'round');
  const body = document.createElementNS(ns, 'path'); body.setAttribute('d', 'M4 8h3l2-3h6l2 3h3v11H4z');
  const lens = document.createElementNS(ns, 'circle'); lens.setAttribute('cx', '12'); lens.setAttribute('cy', '13'); lens.setAttribute('r', '3.5');
  svg.append(body, lens); return svg;
}
function setShotStatus(text) { $('shot-status').textContent = text; shotSignature = ''; renderShotChips(); }
function renderShotChips() {
  const links = findLinks($('prompt').value).filter(href => !staged.some(item => item.sourceUrl === href) || shotBusy === href);
  const full = staged.length >= ATTACHMENT_POLICY.maxFiles, locked = $('prompt').disabled;
  const signature = JSON.stringify([links, shotBusy, shotProgress, full, locked, $('shot-status').textContent]);
  if (signature === shotSignature) return;
  shotSignature = signature;
  $('shot-chips').replaceChildren(...links.map(href => {
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'shot-chip'; chip.title = href;
    const label = document.createElement('span');
    // Two links on the same site: show the path too, so the chips can be told apart.
    const sameHost = links.filter(other => hostLabel(other) === hostLabel(href)).length > 1;
    let place = hostLabel(href);
    if (sameHost) { const { pathname, search } = new URL(href); const rest = `${pathname}${search}`; place += rest.length > 32 ? `${rest.slice(0, 31)}…` : rest; }
    label.textContent = shotBusy === href ? shotProgress : `Attach screenshot of ${place}`;
    chip.dataset.state = shotBusy === href ? 'busy' : 'idle';
    chip.disabled = !!shotBusy || full || locked;
    chip.append(cameraIcon(), label);
    chip.addEventListener('click', () => { if (!chip.disabled) screenshotLink(href); });
    return chip;
  }));
  $('cancel-shot').hidden = !shotOperation;
  $('link-shots').hidden = !links.length && !$('shot-status').textContent && !shotOperation;
}
const SHOT_STEPS = { opening: 'Opening page…', loading: 'Loading page…', stitching: 'Putting the screenshot together…' };
function cancelScreenshot(message = '') {
  const operation = shotOperation; shotOperation = null;
  operation?.controller.abort();
  shotBusy = ''; shotProgress = ''; shotSignature = '';
  if (message) setShotStatus(message);
}
$('cancel-shot').addEventListener('click', () => { cancelScreenshot('Screenshot cancelled. Nothing was attached.'); render(); });
async function screenshotLink(href) {
  if (shotOperation || busy || pending || state !== 'ready') return;
  if (staged.length >= ATTACHMENT_POLICY.maxFiles) { setShotStatus(`Only ${ATTACHMENT_POLICY.maxFiles} files fit in one message.`); return; }
  const operation = { controller: new AbortController(), epoch, draft: $('prompt').value };
  shotOperation = operation; shotBusy = href; shotProgress = SHOT_STEPS.opening; render();
  const current = () => shotOperation === operation && epoch === operation.epoch &&
    $('prompt').value === operation.draft && !operation.controller.signal.aborted;
  try {
    if (!shotAccess) {
      const ok = await askConfirm('Allow link screenshots?', 'Chrome will ask you to let Arena Auto Chat “read and change all your data on all websites”. It is only used when you click a screenshot chip. Pages open with your normal sign-ins, so check the screenshot before you send. You can remove this access in Settings.', 'Continue', 'Not now');
      if (!current()) return;
      if (!ok) { setShotStatus('No screenshot was taken; website access was not requested.'); return; }
      await requestShotAccess(); await refreshShotAccess();
      if (!current()) return;
      if (!shotAccess) { setShotStatus('Chrome did not grant website access, so no screenshot was taken.'); return; }
    }
    setShotStatus('');
    const result = await captureLink(href, { signal: operation.controller.signal, onProgress: step => {
      if (!current()) return;
      shotProgress = step.phase === 'capturing' ? `Capturing ${step.part} of ${step.parts}…` : SHOT_STEPS[step.phase] || shotProgress;
      renderShotChips();
    } });
    if (!current() || busy || pending || state !== 'ready') return;
    const before = staged.length;
    stageFiles([result.file], 'screenshot');
    if (staged.length > before) {
      staged.at(-1).sourceUrl = href;
      setShotStatus(`Attached a ${result.truncated ? 'partial (top of the page) ' : 'full-page '}screenshot of ${hostLabel(result.url)}${result.url !== href ? ` (redirected from ${hostLabel(href)})` : ''}${result.title ? ` — “${result.title}”` : ''}. Click its thumbnail to check it before you send.`);
    } else setShotStatus('The screenshot could not be attached (see the attachment note).');
  } catch (error) {
    if (current()) setShotStatus(error?.code ? `${error.code}: ${error.message}` : `The screenshot failed (${error?.message || 'unknown error'}). Nothing was attached.`);
  } finally {
    if (shotOperation === operation) { shotOperation = null; shotBusy = ''; shotProgress = ''; shotSignature = ''; render(); }
  }
}

$('attach-files').addEventListener('click', () => { if (!$('attach-files').disabled) $('attachment-input').click(); });
$('attachment-input').addEventListener('change', () => { stageFiles($('attachment-input').files, 'picker'); $('attachment-input').value = ''; });
$('prompt').addEventListener('paste', event => {
  const list = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter(Boolean);
  // Only intercept pasted images; text pastes must reach the caret untouched.
  if (list.length) { event.preventDefault(); stageFiles(list, 'paste'); }
});
const composer = document.querySelector('.arena-composer');
composer.addEventListener('dragover', event => { if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); composer.dataset.dragging = 'true'; } });
composer.addEventListener('dragleave', event => { if (!composer.contains(event.relatedTarget)) composer.dataset.dragging = 'false'; });
composer.addEventListener('drop', event => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault(); composer.dataset.dragging = 'false'; stageFiles(event.dataTransfer.files, 'drop');
});
// Keyboard shortcut is local to the panel composer, never a synthetic Enter in Arena.
// Reuse the button path so connection, busy, draft and single-send checks stay identical.
let composingPrompt = false;
$('prompt').addEventListener('compositionstart', () => { composingPrompt = true; });
$('prompt').addEventListener('compositionend', () => { composingPrompt = false; });
$('prompt').addEventListener('blur', () => { composingPrompt = false; });
$('prompt').addEventListener('keydown', event => {
  if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  // IME Enter confirms a candidate; it must not submit the chat.
  if (composingPrompt || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (event.repeat || $('prompt').disabled || $('prepare').disabled || !$('prompt').value.trim()) return;
  $('prepare').click();
});
action('cancel', async () => {
  if (!pending) return;
  if (!await askClear('Stop tracking this turn? This does not stop generation in Arena. Check the tab before another send.')) return;
  client?.cancel(pending.id); releaseTurnAttachments(pending); pending.status = 'cancelled'; pending = null;
  state = client?.ready ? 'ready' : 'error';
  notice('Local tracking stopped. Nothing was retried. Check Arena before sending another message.');
});
chrome.tabs.onRemoved.addListener(id => {
  if (tab?.id === id) { actionId++; busy = false; closeDialog(false); clear(); notice('The connected Arena tab closed. This session was cleared.'); }
  refresh().catch(error => notice(error.message));
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (tab?.id !== id || pending) return; // Pending navigation is guarded by the content script.
  // A reload of the same page is handled by the automatic reattach above (history is kept).
  // Moving to a different page stops the connection but keeps this chat visible until you reconnect.
  if (change.url && !samePage(change.url, tab.url) && (client || state === 'reconnecting') && !switching) {
    const old = client; client = null; old?.close(); stopRecovery(); if (awakeTab !== null) keepTabAwake(awakeTab, false); state = 'error';
    notice('The Arena tab moved to a different page. Your chat here is kept; open Settings → Reconnect to connect to the page now shown in Arena.');
    render();
  }
});
// Minimizing, covering or switching tabs keeps the session; closing the panel/window ends it (the port closes with the page).
window.addEventListener('pagehide', () => { actionId++; closeDialog(false); clear(); });
refresh().catch(error => { state = 'error'; notice(error.message); render(); });
