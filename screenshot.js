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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function withTimeout(promise, ms, code, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(shotError(code, message)), ms); })])
    .finally(() => clearTimeout(timer));
}
const LOAD_FAILED = 'The page could not be loaded (offline, blocked or not a web page). Nothing was attached.';
async function run(api, tabId, func, args = []) {
  try {
    const [first] = await withTimeout(api.scripting.executeScript({ target: { tabId }, func, args }), SHOT.scriptTimeoutMs,
      'PAGE_NOT_RESPONDING', 'The page stopped responding (for example a pop-up dialog). Nothing was attached.');
    return first?.result;
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
    const tab = await api.tabs.get(tabId).catch(() => null);
    if (!tab) throw shotError('WINDOW_CLOSED', 'The screenshot window was closed before the page loaded.');
    if (tab.status === 'complete') return tab;
    await sleep(250);
  }
  return api.tabs.get(tabId); // slow page: capture what has rendered after 30 s
}
// In-page helpers (serialized into the page by chrome.scripting; must be self-contained).
function pageMetrics() {
  const el = document.scrollingElement || document.documentElement;
  return { height: Math.max(el.scrollHeight, document.body?.scrollHeight || 0), view: innerHeight, width: innerWidth, title: document.title.slice(0, 200) };
}
function pageScroll(y) {
  (document.scrollingElement || document.documentElement).scrollTop = y; scrollTo(0, y);
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY))));
}
// After the first frame, fixed/sticky bars (headers, cookie banners) would repeat in every slice.
function pageHideFixed() {
  let count = 0;
  for (const el of document.querySelectorAll('body *')) {
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') { el.style.setProperty('visibility', 'hidden', 'important'); count++; }
  }
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(count))));
}

/**
 * Open `href` in a small popup window, capture the full page (stitched), close the window.
 * Returns { file, title, truncated, parts, width, height }.
 */
export async function captureLink(href, { api = chrome, onProgress = () => {}, signal } = {}) {
  const url = safeLink(href);
  if (!url) throw shotError('INVALID_LINK', 'Only http(s) links without embedded passwords can be captured.');
  if (!await hasShotAccess(api)) throw shotError('NO_ACCESS', 'Website access for screenshots is not granted.');
  const previous = await api.windows.getLastFocused().catch(() => null);
  onProgress({ phase: 'opening' });
  const win = await api.windows.create({ url, type: 'popup', width: SHOT.width, height: SHOT.height, focused: true });
  const windowId = win.id, tabId = win.tabs?.[0]?.id;
  const captures = [];
  let metrics;
  try {
    if (tabId == null) throw shotError('CAPTURE_FAILED', 'Chrome did not open the screenshot window.');
    onProgress({ phase: 'loading' });
    const tab = await waitLoaded(api, tabId, signal);
    if (!/^https?:/.test(tab.url || '')) throw shotError('PAGE_LOAD_FAILED', LOAD_FAILED);
    await sleep(SHOT.settleMs);
    metrics = await run(api, tabId, pageMetrics);
    if (!metrics?.view || !metrics?.width) throw shotError('CAPTURE_FAILED', 'The page has no visible area to capture.');
    const steps = planSteps(metrics.height, metrics.view);
    let lastY = -1, lastShot = 0;
    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) throw shotError('CANCELLED', 'Screenshot cancelled.');
      onProgress({ phase: 'capturing', part: i + 1, parts: steps.length });
      const y = await run(api, tabId, pageScroll, [steps[i]]);
      if (i > 0 && y <= lastY) break; // the page stopped scrolling (inner scroll area or shorter than reported)
      if (i === 1) await run(api, tabId, pageHideFixed);
      const wait = Math.max(0, SHOT.stepMs - (Date.now() - lastShot));
      await sleep(i === 0 ? 150 : wait);
      const dataUrl = await api.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastShot = Date.now(); lastY = y;
      captures.push({ y, dataUrl });
    }
  } finally {
    await api.windows.remove(windowId).catch(() => {});
    if (previous?.id != null) api.windows.update(previous.id, { focused: true }).catch(() => {});
  }
  if (!captures.length) throw shotError('CAPTURE_FAILED', 'Nothing could be captured from the page.');
  onProgress({ phase: 'stitching' });
  const bitmaps = await Promise.all(captures.map(item => createImageBitmap(dataUrlToBlob(item.dataUrl))));
  try {
    const scale = bitmaps[0].width / metrics.width; // device pixels per CSS px
    const last = captures.at(-1);
    const cssHeight = Math.min(last.y + metrics.view, SHOT.maxCssHeight);
    const truncated = metrics.height > cssHeight + 2;
    let fit = Math.min(1, SHOT.maxCanvas / (cssHeight * scale), SHOT.maxCanvas / bitmaps[0].width);
    for (;;) {
      const width = Math.max(1, Math.round(bitmaps[0].width * fit)), height = Math.max(1, Math.round(cssHeight * scale * fit));
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
      captures.forEach((item, i) => ctx.drawImage(bitmaps[i], 0, Math.round(item.y * scale * fit), width, Math.round(bitmaps[i].height * fit)));
      let blob = await canvas.convertToBlob({ type: 'image/png' });
      let name = shotName(url);
      if (blob.size > SHOT.maxBytes) { blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }); name = name.replace(/\.png$/, '.jpg'); }
      if (blob.size <= SHOT.maxBytes || fit < 0.3) {
        if (blob.size > SHOT.maxBytes) throw shotError('TOO_LARGE', 'The screenshot is larger than 8 MB even after shrinking. Nothing was attached.');
        const file = new File([blob], name, { type: blob.type });
        return { file, title: metrics.title || '', truncated, parts: captures.length, width, height, url };
      }
      fit *= 0.75;
    }
  } finally { bitmaps.forEach(bitmap => bitmap.close?.()); }
}
