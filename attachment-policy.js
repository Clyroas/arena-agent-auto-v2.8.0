// Pure attachment rules shared by the panel UI and the page adapter.
// Files are only ever read from a user pick/paste/drop in this panel; no filesystem access.
// Dual format: an ESM module for the extension pages and a window global for the classic content script.
(() => {
  'use strict';
  const VERSION = '2.8.2';
  if (globalThis.ArenaAgentAttachments?.version === VERSION) return;
  const ATTACHMENT_POLICY = Object.freeze({
    maxFiles: 4, maxBytes: 8 * 1024 * 1024,
    accept: '.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.csv,.html,.htm,.xml,.css,.js,.json',
    types: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain',
      'text/markdown', 'text/csv', 'text/html', 'application/xml', 'text/css', 'text/javascript',
      'application/javascript', 'application/json']),
  });
  const EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html',
    htm: 'text/html', xml: 'application/xml', css: 'text/css', js: 'text/javascript', json: 'application/json' };
  // Accept attributes may be extensions (.png), MIME types (image/png) or the generic 'file'.
  function isAcceptedToken(token) {
    const value = String(token).trim().toLowerCase();
    if (!value || value === 'file' || value === '*/*' || value === 'image/*' || value === 'text/*') return true;
    if (/^\.[a-z0-9]+$/.test(value)) return Object.hasOwn(EXT, value.slice(1));
    return ATTACHMENT_POLICY.types.includes(value);
  }
  function acceptAllows(accept) {
    const tokens = String(accept || '').split(/[,\s]+/).filter(Boolean);
    return tokens.every(isAcceptedToken);
  }
  const canonicalMime = type => String(type || '').toLowerCase() === 'application/javascript' ? 'text/javascript' : String(type || '').toLowerCase();
  function acceptsFile(accept, file) {
    if (!acceptAllows(accept)) return false;
    const tokens = String(accept || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
    const type = canonicalMime(file.type);
    return !tokens.length || tokens.some(token => token === 'file' || token === '*/*' ||
      (token.startsWith('.') ? String(file.name).toLowerCase().endsWith(token) :
        token.endsWith('/*') ? type.startsWith(token.slice(0, -1)) : canonicalMime(token) === type));
  }
  function attachmentKind(name = '', type = '') {
    const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (Object.hasOwn(EXT, ext)) return EXT[ext];
    const mime = String(type).toLowerCase();
    return ATTACHMENT_POLICY.types.includes(mime) ? mime : '';
  }
  function validateAttachments(files = [], limit = ATTACHMENT_POLICY.maxFiles) {
    const accepted = [], rejected = [];
    for (const [sourceIndex, file] of Array.from(files).entries()) {
      const name = String(file.name || '').trim();
      const type = attachmentKind(name, file.type);
      if (!name || name.length > 240) { rejected.push({ name: name || 'Unnamed file', reason: 'The filename is missing or too long.' }); continue; }
      if (!type) { rejected.push({ name, reason: 'This type is not in the supported list.' }); continue; }
      if (!Number.isSafeInteger(Number(file.size)) || !(Number(file.size) > 0)) { rejected.push({ name, reason: 'The file is empty.' }); continue; }
      if (file.size > ATTACHMENT_POLICY.maxBytes) { rejected.push({ name, reason: `The file is larger than ${Math.round(ATTACHMENT_POLICY.maxBytes / 1048576)} MB.` }); continue; }
      accepted.push({ name, type, size: Number(file.size), sourceIndex });
    }
    const capacity = Math.max(0, Math.min(ATTACHMENT_POLICY.maxFiles, Number.isInteger(limit) ? limit : 0));
    if (accepted.length > capacity) {
      for (const file of accepted.splice(capacity)) rejected.push({ name: file.name, reason: `Only ${ATTACHMENT_POLICY.maxFiles} files fit in one message.` });
    }
    return { accepted, rejected };
  }
  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(binary);
  }
  function base64ToBytes(text) {
    const binary = atob(String(text));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function decodeAttachment(item) {
    if (!item || typeof item.name !== 'string' || typeof item.type !== 'string' || typeof item.data !== 'string' ||
        item.data.length > 4 * Math.ceil(ATTACHMENT_POLICY.maxBytes / 3)) throw new Error('Invalid encoded attachment or size.');
    const bytes = base64ToBytes(item.data);
    const { accepted, rejected } = validateAttachments([{ name: item.name, type: item.type, size: bytes.byteLength }]);
    if (rejected.length) throw new Error(rejected[0].reason);
    return { name: accepted[0].name, type: accepted[0].type, bytes };
  }
  function formatBytes(size) {
    const value = Number(size);
    if (!Number.isFinite(value) || value < 0) return 'unknown size';
    if (value < 1024) return `${value} B`;
    if (value < 1048576) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
    return `${(value / 1048576).toFixed(1)} MB`;
  }
  globalThis.ArenaAgentAttachments = Object.freeze({ version: VERSION, ATTACHMENT_POLICY, isAcceptedToken, acceptAllows, acceptsFile, attachmentKind, validateAttachments, decodeAttachment, bytesToBase64, base64ToBytes, formatBytes });
})();
