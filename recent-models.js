// Recently opened Direct models: names only (max 5), kept in this panel's localStorage alongside the
// theme and text-size preferences. No chat content, prompts or replies are ever stored here.
const RECENT_KEY = 'arena-auto-recent-models';
export const RECENT_MAX = 5;
const clean = name => (typeof name === 'string' ? name.trim() : '');
export function recentModels(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.map(clean).filter(n => n && n.length <= 120).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
export function rememberModel(name, storage = globalThis.localStorage) {
  const value = clean(name);
  if (!value || value.length > 120) return recentModels(storage);
  const list = [value, ...recentModels(storage).filter(n => n.toLowerCase() !== value.toLowerCase())].slice(0, RECENT_MAX);
  try { storage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* preference only */ }
  return list;
}
