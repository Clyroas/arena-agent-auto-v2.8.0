export const AGENT_URL = 'https://arena.ai/agent';
export function isArena(url) {
  try { return new URL(url).origin === 'https://arena.ai'; } catch { return false; }
}
export const DIRECT_URL = 'https://arena.ai/text/direct';
// Battle / Side-by-Side and other text modes (not supported). Direct chats are supported since v2.3.0.
export function isDirect(url) {
  try { return isArena(url) && /^\/text\//.test(new URL(url).pathname) && !isDirectChat(url); } catch { return false; }
}
export function isDirectChat(url) {
  try { return isArena(url) && /^\/text\/direct\/?$/.test(new URL(url).pathname); } catch { return false; }
}
export function directModelUrl(name) {
  const url = new URL(DIRECT_URL);
  if (name) url.searchParams.set('model_a', name);
  return url.href;
}
// Same page, ignoring the model_a/model parameter Arena rewrites on an empty Direct chat.
export function samePage(a, b) {
  if (a === b) return true;
  try {
    const x = new URL(a), y = new URL(b);
    if (x.origin !== y.origin || x.pathname !== y.pathname || x.hash !== y.hash || !/^\/text\/direct\/?$/.test(x.pathname)) return false;
    const rest = u => { const p = new URLSearchParams(u.search); p.delete('model_a'); p.delete('model'); return p.toString(); };
    return rest(x) === rest(y);
  } catch { return false; }
}
export function tabLabel(tab) {
  let address = '';
  try { const u = new URL(tab.url); address = u.host + u.pathname; } catch { /* absent URL */ }
  return `Tab ${tab.id} · ${tab.title || 'Arena'} · ${address}`;
}
// Chrome extension messaging settles on its own in normal operation, but a service worker that is
// terminated (or replaced by an extension update) while a request is in flight can leave the response
// promise pending forever. Every panel request is therefore bounded: a caller must always get either a
// result or an error, so a stuck request can never leave the panel permanently busy. The original
// promise is left untouched — the work may still complete in Chrome; only the caller stops waiting.
export class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; this.code = 'TIMEOUT'; }
}
export function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}
