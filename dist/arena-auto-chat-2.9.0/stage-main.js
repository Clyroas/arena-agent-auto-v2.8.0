// Serialized into Arena's main world once for an explicitly approved, single-use staged-file send.
// Reads only our marker and bytes. No page storage, account data, credentials or private APIs.
export async function arenaAgentStageFiles(request) {
  'use strict';
  const fail = reason => ({ ok: false, reason });
  try {
    const token = String(request?.token || ''), expiresAt = request?.expiresAt;
    const files = Array.isArray(request?.files) ? request.files : null;
    if (!/^[0-9a-f-]{36}$/.test(token) || !files?.length || files.length > 4 ||
        !Number.isFinite(expiresAt) || Date.now() >= expiresAt || expiresAt > Date.now() + 20000)
      return fail('The staging request is malformed or expired.');
    const allowed = ['png','jpg','jpeg','webp','gif','pdf','txt','md','csv','html','htm','xml','css','js','json'];
    const mimes = ['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/markdown','text/csv','text/html','application/xml','text/css','text/javascript','application/javascript','application/json'];
    const matches = [...document.querySelectorAll(`input[type="file"][data-arena-agent-stage="${token}"]`)];
    if (matches.length !== 1) return fail('The staged file input was replaced, cancelled or duplicated.');
    const input = matches[0];
    if (input.disabled || input.closest('[inert]')) return fail('The page file input is unavailable.');
    if (files.length > 1 && !input.multiple) return fail('The page file input accepts only one file.');
    const tokens = String(input.accept || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
    const known = token => ['file', '*/*', 'image/*', 'text/*'].includes(token) ||
      (token.startsWith('.') ? allowed.includes(token.slice(1)) : mimes.includes(token));
    if (!tokens.every(known)) return fail('The page file input has unsupported restrictions.');
    const canonical = type => type === 'application/javascript' ? 'text/javascript' : type;
    const accepts = (name, type) => !tokens.length || tokens.some(token => token === 'file' || token === '*/*' ||
      (token.startsWith('.') ? name.toLowerCase().endsWith(token) :
        token.endsWith('/*') ? type.startsWith(token.slice(0, -1)) : canonical(token) === canonical(type)));
    const transfer = new DataTransfer();
    for (const item of files) {
      const name = item?.name, type = item?.type;
      if (typeof name !== 'string' || !name.trim() || name.length > 240 || !mimes.includes(type) ||
          typeof item.data !== 'string' || item.data.length > 4 * Math.ceil(8 * 1024 * 1024 / 3) || !accepts(name, type))
        return fail('A staged file does not match the supported types or the page input.');
      const binary = atob(item.data), bytes = new Uint8Array(binary.length);
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) return fail('A staged file was empty or too large.');
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], name, { type }));
    }
    // Recheck immediately before touching the input. There are no awaits between this check and insertion.
    if (Date.now() >= expiresAt || !input.isConnected || input.getAttribute('data-arena-agent-stage') !== token)
      return fail('The staging request expired or was cancelled.');
    input.removeAttribute('data-arena-agent-stage'); // consume before dispatching any page events
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (!setter) return fail('This browser has no supported file input setter.');
    setter.call(input, transfer.files); // native FileList, no own-property shadow or retained override
    const seen = [...input.files].map(file => ({ name: file.name, size: file.size, type: file.type }));
    if (seen.length !== files.length || seen.some((file, i) => file.name !== files[i].name || file.type !== files[i].type))
      return fail('The page file input did not report the staged files.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // This acknowledges native insertion, not completion of Arena's network upload.
    return { ok: true, files: seen };
  } catch { return fail('The file staging step failed in the page.'); }
}
