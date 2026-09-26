// Link screenshots as message context (v2.6.0). Panel-only ES module.
// Runs ONLY after the user clicks a "screenshot this link" chip in the panel. The link opens in a small
// separate window with the user's normal Chrome profile, is scrolled and captured, and the window closes.
// The stitched image is staged like a pasted image: nothing is sent until the user's own Send.
// Needs the optional "<all_urls>" host permission (Chrome's requirement for tabs.captureVisibleTab);
// it is requested on first use and can be removed from Settings. Nothing is stored.

export const SHOT = Object.freeze({
  width: 1280, height: 900,          // popup window size (CSS px, roughly a laptop browser window)
  maxCssHeight: 15000,               // full-page cap; longer pages are cut off and marked as truncated
  maxCanvas: 16000,                  // max stitched bitmap height/width in device pixels
  maxPixels: 20000000,             // 80 MB RGBA canvas budget, independent of aspect ratio
  maxSlicePixels: 32000000,        // reject unexpectedly huge individual captures
  maxCaptureChars: 64 * 1024 * 1024, // aggregate encoded screenshot budget
  maxParts: 24,                      // hard cap on captures per page
  loadTimeoutMs: 30000, settleMs: 1200,
  stepMs: 600,                       // Chrome allows about 2 captureVisibleTab calls per second
  scriptTimeoutMs: 10000,
  maxBytes: 8 * 1024 * 1024,         // same limit as other staged attachments
});
export const SHOT_ORIGINS = Object.freeze(['<all_urls>']);

// ---------- pure helpers (unit-tested) ----------
const TRAILING = /[)\]}>.,;:!?'"’”]+$/;
export function safeLink(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || !url.hostname) return null; // never pass credentials in a link
  url.hash = '';
  return url.href;
}
export function findLinks(text, max = 3) {
  const found = [];
  for (const match of String(text || '').matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    let raw = match[0];
    // Keep balanced parentheses (Wikipedia-style links), drop sentence punctuation.
    while (TRAILING.test(raw)) {
      const last = raw.at(-1);
      if (last === ')' && (raw.match(/\(/g) || []).length >= (raw.match(/\)/g) || []).length) break;
      raw = raw.slice(0, -1);
    }
    const href = safeLink(raw);
    if (href && !found.includes(href)) found.push(href);
    if (found.length >= max) break;
  }
  return found;
}
export function hostLabel(href) {
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return 'page'; }
}
export function shotName(href, date = new Date()) {
  const host = hostLabel(href).replace(/[^a-z0-9.-]+/gi, '-').slice(0, 60) || 'page';
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `screenshot-${host}-${stamp}.png`;
}
// Scroll positions (CSS px) for a full-page capture: one per viewport, the last one clamped to the end.
export function planSteps(pageHeight, viewHeight, maxCss = SHOT.maxCssHeight, maxParts = SHOT.maxParts) {
  const view = Math.max(1, Math.floor(viewHeight));
  const total = Math.max(view, Math.min(Math.ceil(pageHeight), maxCss));
  const steps = [];
  for (let y = 0; y < total && steps.length < maxParts; y += view) steps.push(Math.min(y, total - view));
  return [...new Set(steps)];
}
export function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!match) throw shotError('CAPTURE_FAILED', 'Chrome returned an unreadable screenshot.');
  const binary = atob(match[2]), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}
export function shotError(code, message) { const error = new Error(message); error.code = code; return error; }

// ---------- permission ----------
export const hasShotAccess = (api = chrome) => api.permissions.contains({ origins: [...SHOT_ORIGINS] }).catch(() => false);
// Must be called from a user gesture (a click in the panel).
export const requestShotAccess = (api = chrome) => api.permissions.request({ origins: [...SHOT_ORIGINS] }).catch(() => false);
export const removeShotAccess = (api = chrome) => api.permissions.remove({ origins: [...SHOT_ORIGINS] }).catch(() => false);

// ---------- capture ----------
function checkAbort(signal) { if (signal?.aborted) throw shotError('CANCELLED', 'Screenshot cancelled.'); }
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(shotError('CANCELLED', 'Screenshot cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
const sleep = (ms, signal) => abortable(new Promise(resolve => { setTimeout(resolve, ms); }), signal);
// Chrome throttles captureVisibleTab to about two calls per second, and a full-page capture needs up to
// SHOT.maxParts of them. One quota rejection used to abort the whole run and throw away the slices
// already taken, so a rate-limited call is retried a few times with a growing pause first.
export const CAPTURE_RETRY_LIMIT = 4;
export const RATE_LIMITED = /max_capture_visible_tab_calls_per_second|too many.{0,40}capture|capture.{0,40}(?:rate|quota)|rate limit/i;
export async function captureSlice(api, windowId, { attempts = CAPTURE_RETRY_LIMIT, wait = sleep, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    checkAbort(signal);
    try { return await abortable(withTimeout(api.tabs.captureVisibleTab(windowId, { format: 'png' }), SHOT.scriptTimeoutMs, 'CAPTURE_TIMEOUT', 'Chrome did not return the screenshot in time.'), signal); }
    catch (error) {
      if (attempt >= attempts - 1 || !RATE_LIMITED.test(String(error?.message || error || ''))) throw error;
      await wait(350 * (attempt + 1), signal);
    }
  }
}
function withTimeout(promise, ms, code, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(shotError(code, message)), ms); })])
    .finally(() => clearTimeout(timer));
}
const LOAD_FAILED = 'The page could not be loaded (offline, blocked or not a web page). Nothing was attached.';
async function run(api, tabId, func, args = [], context = {}) {
  try {
    checkAbort(context.signal);
    const target = context.documentId ? { tabId, documentIds: [context.documentId] } : { tabId, frameIds: [0] };
    const [first] = await abortable(withTimeout(api.scripting.executeScript({ target, func, args }), SHOT.scriptTimeoutMs,
      'PAGE_NOT_RESPONDING', 'The page stopped responding (for example a pop-up dialog). Nothing was attached.'), context.signal);
    if (!first?.documentId || (context.documentId && context.documentId !== first.documentId))
      throw shotError('PAGE_CHANGED', 'The screenshot document changed. Nothing was attached.');
    context.documentId = first.documentId;
    return first.result;
  } catch (error) {
    if (error?.code) throw error;
    // Chrome shows its own error page for unreachable sites; scripts cannot run there.
    if (/error page/i.test(error?.message || '')) throw shotError('PAGE_LOAD_FAILED', LOAD_FAILED);
    if (/cannot be scripted|cannot access|extensions gallery/i.test(error?.message || '')) throw shotError('PAGE_NOT_ALLOWED', 'Chrome does not allow extensions to capture this page. Nothing was attached.');
    throw shotError('CAPTURE_FAILED', `The page could not be read (${String(error?.message || 'unknown error').slice(0, 160)}). Nothing was attached.`);
  }
}
async function waitLoaded(api, tabId, signal) {
  const deadline = Date.now() + SHOT.loadTimeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw shotError('CANCELLED', 'Screenshot cancelled.');
    const tab = await abortable(api.tabs.get(tabId).catch(() => null), signal);
    if (!tab) throw shotError('WINDOW_CLOSED', 'The screenshot window was closed before the page loaded.');
    if (tab.status === 'complete') return tab;
    await sleep(250, signal);
  }
  return api.tabs.get(tabId); // slow page: capture what has rendered after 30 s
}
// In-page helpers (serialized into the page by chrome.scripting; must be self-contained).
function pageMetrics() {
  const el = document.scrollingElement || document.documentElement;
  return { height: Math.max(el.scrollHeight, document.body?.scrollHeight || 0), view: innerHeight, width: innerWidth, title: document.title.slice(0, 200), href: location.href };
}
function pageScroll(y) {
  (document.scrollingElement || document.documentElement).scrollTop = y; scrollTo(0, y);
  return new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(() => resolve({ y: scrollY, view: innerHeight, width: innerWidth, href: location.href }))); });
}
// After the first frame, fixed/sticky bars (headers, cookie banners) would repeat in every slice.
function pageHideFixed() {
  let count = 0;
  for (const el of document.querySelectorAll('body *')) {
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') { el.style.setProperty('visibility', 'hidden', 'important'); count++; }
  }
  return new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(() => resolve(count))); });
}

/**
 * Open `href` in a small popup window, capture the full page (stitched), close the window.
 * Returns { file, title, truncated, parts, width, height }.
 */
export async function captureLink(href, { api = chrome, onProgress = () => {}, signal } = {}) {
  const url = safeLink(href);
  if (!url) throw shotError('INVALID_LINK', 'Only http(s) links without embedded passwords can be captured.');
  checkAbort(signal);
  if (!await abortable(hasShotAccess(api), signal)) throw shotError('NO_ACCESS', 'Website access for screenshots is not granted.');
  const previous = await abortable(api.windows.getLastFocused().catch(() => null), signal);
  checkAbort(signal);
  onProgress({ phase: 'opening' });
  // A Chrome window creation cannot be cancelled. If it resolves after cancellation, the finally below
  // still closes that exact window; no late result is attached to the draft.
  const win = await api.windows.create({ url, type: 'popup', width: SHOT.width, height: SHOT.height, focused: true });
  const windowId = win.id, tabId = win.tabs?.[0]?.id;
  const captures = [], context = { signal };
  let metrics, finalUrl, encodedChars = 0;
  let closePromise = null;
  const closeWindow = () => closePromise ||= api.windows.remove(windowId).catch(() => {});
  const onAbort = () => { void closeWindow(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    checkAbort(signal);
    if (tabId == null) throw shotError('CAPTURE_FAILED', 'Chrome did not open the screenshot window.');
    onProgress({ phase: 'loading' });
    await waitLoaded(api, tabId, signal);
    await sleep(SHOT.settleMs, signal);
    metrics = await run(api, tabId, pageMetrics, [], context);
    finalUrl = safeLink(metrics?.href);
    if (!finalUrl) throw shotError('PAGE_LOAD_FAILED', LOAD_FAILED);
    if (!Number.isFinite(metrics.view) || !Number.isFinite(metrics.width) || !Number.isFinite(metrics.height) || metrics.view <= 0 || metrics.width <= 0)
      throw shotError('CAPTURE_FAILED', 'The page has no visible area to capture.');
    const unchanged = position => {
      if (position.href !== metrics.href || position.width !== metrics.width || position.view !== metrics.view)
        throw shotError('PAGE_CHANGED', 'The page navigated or its viewport changed during capture. Nothing was attached.');
    };
    const verifyTab = async () => {
      const tab = await abortable(api.tabs.get(tabId), signal);
      if (!tab.active || tab.windowId !== windowId || tab.url !== metrics.href || tab.status === 'loading')
        throw shotError('PAGE_CHANGED', 'The screenshot tab changed during capture. Nothing was attached.');
      unchanged(await run(api, tabId, pageMetrics, [], context));
    };
    const steps = planSteps(metrics.height, metrics.view);
    let lastY = -1, lastShot = 0;
    for (let i = 0; i < steps.length; i++) {
      checkAbort(signal);
      onProgress({ phase: 'capturing', part: i + 1, parts: steps.length });
      const position = await run(api, tabId, pageScroll, [steps[i]], context);
      unchanged(position);
      const y = position.y;
      if (!Number.isFinite(y) || y < 0) throw shotError('CAPTURE_FAILED', 'The page returned an invalid scroll position.');
      if (i > 0 && y <= lastY) break;
      if (i === 1) await run(api, tabId, pageHideFixed, [], context);
      await sleep(i === 0 ? 150 : Math.max(0, SHOT.stepMs - (Date.now() - lastShot)), signal);
      await verifyTab();
      let dataUrl;
      try { dataUrl = await captureSlice(api, windowId, { signal }); }
      catch (error) {
        if (error.code) throw error;
        throw shotError('CAPTURE_FAILED', `Chrome did not return screenshot part ${i + 1}. Nothing was attached.`);
      }
      await verifyTab(); // discard, rather than label, any slice captured across navigation
      encodedChars += dataUrl.length;
      if (encodedChars > SHOT.maxCaptureChars) throw shotError('TOO_LARGE', 'The screenshot exceeded its memory budget. Nothing was attached.');
      lastShot = Date.now(); lastY = y;
      captures.push({ y, dataUrl });
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    const focused = await api.windows.getLastFocused().catch(() => null);
    await closeWindow();
    // Never pull the user back from a window they deliberately focused while capture was running.
    if (focused?.id === windowId && previous?.id != null) await api.windows.update(previous.id, { focused: true }).catch(() => {});
  }
  checkAbort(signal);
  if (!captures.length) throw shotError('CAPTURE_FAILED', 'Nothing could be captured from the page.');
  onProgress({ phase: 'stitching' });
  return stitchCaptures(captures, metrics, finalUrl, { signal });
}

// Decode only one slice at a time and close it even if drawing/encoding fails. Exported for budget and
// cancellation tests; browser APIs remain injectable dev-only dependencies, not runtime libraries.
export async function stitchCaptures(captures, metrics, url, {
  signal, decode = createImageBitmap, makeCanvas = (w, h) => new OffscreenCanvas(w, h)
} = {}) {
  const cssHeight = Math.min(captures.at(-1).y + metrics.view, SHOT.maxCssHeight);
  let fit = 1, scale = 1, sourceWidth = 0;
  for (;;) {
    checkAbort(signal);
    let canvas;
    try {
      for (const [index, item] of captures.entries()) {
        checkAbort(signal);
        const bitmap = await decode(dataUrlToBlob(item.dataUrl));
        try {
          checkAbort(signal);
          if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > SHOT.maxSlicePixels)
            throw shotError('TOO_LARGE', 'A screenshot slice exceeded its pixel budget. Nothing was attached.');
          if (index === 0) {
            sourceWidth = bitmap.width; scale = sourceWidth / metrics.width;
            fit = Math.min(fit, SHOT.maxCanvas / (cssHeight * scale), SHOT.maxCanvas / sourceWidth,
              Math.sqrt(SHOT.maxPixels / (sourceWidth * cssHeight * scale)));
            canvas = makeCanvas(Math.max(1, Math.floor(sourceWidth * fit)), Math.max(1, Math.floor(cssHeight * scale * fit)));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw shotError('CAPTURE_FAILED', 'The screenshot canvas could not be allocated.');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else if (bitmap.width !== sourceWidth) throw shotError('PAGE_CHANGED', 'The screenshot resolution changed between slices.');
          canvas.getContext('2d').drawImage(bitmap, 0, Math.round(item.y * scale * fit), canvas.width, Math.round(bitmap.height * fit));
        } finally { bitmap.close?.(); }
      }
      checkAbort(signal);
      let blob = await canvas.convertToBlob({ type: 'image/png' }), name = shotName(url);
      checkAbort(signal);
      if (blob.size > SHOT.maxBytes) {
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }); name = name.replace(/\.png$/, '.jpg');
        checkAbort(signal);
      }
      if (blob.size <= SHOT.maxBytes) return {
        file: new File([blob], name, { type: blob.type }), title: metrics.title || '',
        truncated: metrics.height > cssHeight + 2, parts: captures.length, width: canvas.width, height: canvas.height, url
      };
      if (fit < 0.3) throw shotError('TOO_LARGE', 'The screenshot is larger than 8 MB even after shrinking. Nothing was attached.');
      fit *= 0.75;
    } finally { if (canvas) { canvas.width = 1; canvas.height = 1; } }
  }
}
