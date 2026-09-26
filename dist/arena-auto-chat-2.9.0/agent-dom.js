// Runs only in Chrome's isolated extension world. No site APIs or auth access.
(() => {
  'use strict';
  const ROW = '[data-agent-transcript-message="true"][data-chat-message-id]';
  const USER = '[data-user-message-layout="true"]';
  const normalize = text => String(text).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  class DomError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const fail = (code, message) => { throw new DomError(code, message); };

  // ---- Direct chat (one model) --------------------------------------------------------------
  // Structure from the user's pasted Direct markup (v2.3.0). Direct rows carry no message IDs:
  //   user row:  .self-end group > .bg-surface-raised bubble > .prose
  //   reply:     card > .sticky header (span.font-mono > span.truncate = model name) + .prose body
  //              reasoning lives in a .not-prose collapsible and is never read;
  //              "Like this response" / "Dislike this response" appear in the finished card's footer.
  // Stable synthetic IDs are derived from position + prompt text, so a re-render keeps them.
  const DIRECT_PATH = /^\/(?:text\/direct\/?|c\/[^/]+\/?)$/;
  const DIRECT_OUTSIDE = 'form,nav,aside,[role="dialog"],[role="navigation"],[data-sidebar],[data-arena-agent-stage]';
  let directEls = new Set(), directReversed = false, directPairs = new Map(), pairCards = new Set();
  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function agentRowsPresent(doc) { return !!doc.querySelector(ROW); }
  function pageKind(doc = document) {
    const path = (doc.defaultView || globalThis).location.pathname;
    if (/^\/agent(?:\/|$)/.test(path) || agentRowsPresent(doc)) return 'agent';
    if (DIRECT_PATH.test(path)) return 'direct';
    return /^\/text\//.test(path) ? 'text-other' : 'agent';
  }
  // Mode switcher next to the composer shows "Direct", "Battle", "Side by Side"…
  function modeLabel(doc = document) {
    const box = [...doc.querySelectorAll('form button[role="combobox"]')].find(visible);
    return box ? normalize(box.innerText || box.textContent) : '';
  }
  function currentModel(doc = document) {
    const form = [...doc.querySelectorAll('form')].find(el => el.querySelector('textarea,[contenteditable="true"]') && visible(el));
    if (!form) return '';
    const button = [...form.querySelectorAll('button[aria-haspopup="dialog"]:not([aria-label])')].find(el => visible(el) && el.querySelector('span.truncate'));
    return button ? normalize(button.querySelector('span.truncate').textContent).slice(0, 120) : '';
  }
  function modelOf(card) { return normalize(card.querySelector('.sticky span.font-mono span.truncate')?.textContent || '').slice(0, 120); }
  // Arena's Direct list is an <ol class="flex-col-reverse"> holding messages NEWEST FIRST (its thread
  // array starts with the latest message), so DOM order is the reverse of reading order. Rows are
  // ordered as seen on screen: document order, inverted wherever the lowest container holding both
  // rows lays its children out in reverse (flex-direction: column-reverse / row-reverse).
  function reversedBox(el, doc, cache) {
    if (cache.has(el)) return cache.get(el);
    let reversed = false;
    try { const style = (doc.defaultView || globalThis).getComputedStyle(el);
      reversed = /flex/.test(style.display) && /-reverse$/.test(style.flexDirection || ''); } catch { /* treat as normal flow */ }
    cache.set(el, reversed); return reversed;
  }
  function commonAncestor(a, b) { let p = a.parentElement; while (p && !p.contains(b)) p = p.parentElement; return p; }
  function visualOrder(list, doc = document) {
    const cache = new Map();
    return [...list].sort((a, b) => {
      if (a === b) return 0;
      const before = (a.compareDocumentPosition(b) & 4) ? -1 : 1;
      const box = commonAncestor(a, b);
      return box && reversedBox(box, doc, cache) ? -before : before;
    });
  }
  function directRows(doc = document) {
    const users = new Set([...doc.querySelectorAll('.bg-surface-raised')]
      .filter(bubble => bubble.querySelector('.prose') && !bubble.closest(DIRECT_OUTSIDE))
      .map(bubble => bubble.closest('.self-end') || bubble));
    const found = [...doc.querySelectorAll('.sticky span.font-mono > span.truncate')]
      .filter(name => !name.closest(DIRECT_OUTSIDE)).map(name => name.closest('.sticky')?.parentElement).filter(Boolean);
    // "Battles in Direct": Arena sometimes answers with two anonymous cards (Response A / Response B) in
    // one carousel and asks which one to continue with. The carousel's wrapper is ONE reply row.
    const pairs = new Map(), loose = [];
    for (const card of new Set(found)) {
      const carousel = card.closest('[aria-roledescription="carousel"]');
      if (!carousel) { loose.push(card); continue; }
      const wrapper = carousel.parentElement || carousel;
      if (!pairs.has(wrapper)) pairs.set(wrapper, []);
      pairs.get(wrapper).push(card);
    }
    // Arena also has a side-by-side layout for the same two responses (no carousel), e.g. while they are
    // being written. Two cards that are direct siblings under one parent are that pair; a normal Direct
    // reply always sits alone in its own row.
    const byParent = new Map();
    for (const card of loose) { const parent = card.parentElement; if (parent) byParent.set(parent, [...(byParent.get(parent) || []), card]); }
    const cards = [];
    for (const card of loose) {
      const siblings = byParent.get(card.parentElement) || [];
      if (siblings.length !== 2 || users.has(card.parentElement) || [...users].some(user => card.parentElement.contains(user))) { cards.push(card); continue; }
      // The pair's row: climb while the ancestor holds only these two cards (so Arena's prompt heading,
      // when rendered next to them, belongs to the same row), but never up to the message list itself.
      let wrapper = card.parentElement;
      while (wrapper.parentElement && wrapper.parentElement.tagName !== 'OL' &&
        ![...users].some(user => wrapper.parentElement.contains(user)) &&
        found.filter(other => wrapper.parentElement.contains(other)).length === 2) wrapper = wrapper.parentElement;
      if (!pairs.has(wrapper)) pairs.set(wrapper, []);
      if (!pairs.get(wrapper).includes(card)) pairs.get(wrapper).push(card);
    }
    directPairs = new Map([...pairs].map(([wrapper, list]) => [wrapper, list.sort((x, y) => (x.compareDocumentPosition(y) & 4) ? -1 : 1)]));
    pairCards = new Set([...pairs.values()].flat());
    let all = [...new Set([...users, ...cards, ...pairs.keys()])].filter(el => visible(el));
    // Arena renders the conversation inside one <ol>. When that list is present, anything outside it
    // (a page header, a preview, a panel that reuses the card styling) is not a message row.
    const lists = new Map();
    for (const el of all) { const ol = el.closest('ol'); if (ol) lists.set(ol, (lists.get(ol) || 0) + (users.has(el) ? 2 : 1)); }
    const list = [...lists.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (list) all = all.filter(el => list.contains(el));
    directReversed = !!list && reversedBox(list, doc, new Map());
    const top = visualOrder(all.filter(el => !all.some(other => other !== el && other.contains(el))), doc);
    directEls = new Set(top);
    let u = 0, a = 0;
    return top.map(el => {
      const user = users.has(el);
      if (user) { u++; a = 0; } else a++;
      return { el, user, pair: directPairs.has(el), id: user ? `direct-u${u}-${hash(normalize(el.querySelector('.bg-surface-raised .prose')?.textContent || ''))}` : `direct-a${u}-${a}` };
    });
  }
  function rowOf(el) {
    const agent = el.closest(ROW);
    if (agent) return agent;
    for (let p = el; p; p = p.parentElement) if (directEls.has(p)) return p;
    return null;
  }
  const inTranscript = el => !!rowOf(el);
  // Keep the Direct row set current before any check that must ignore transcript content.
  function refreshRows(doc = document) { if (pageKind(doc) === 'direct') directRows(doc); else directEls = new Set(); }
  const containsRow = node => !!node.querySelector(ROW) || [...directEls].some(el => node.contains(el));
  const SHIMMER = /^(?:thinking|generating|using faster models)(?:\.{3}|…)?$/i;
  function directPending(card) {
    return [...card.querySelectorAll('span,p,div')].some(el => !el.children.length && !el.closest('.prose') &&
      SHIMMER.test(normalize(el.textContent)) && visible(el));
  }
  function directFeedback(card) {
    return [...card.querySelectorAll('button[aria-label]')].some(el => visible(el) &&
      /^(?:like this response|liked|dislike this response|disliked)$/i.test(normalize(el.getAttribute('aria-label'))));
  }
  // Arena renders failures with a "Copy trace ID" error block and stops with "Generation stopped".
  function directProblem(card) {
    const trace = card.querySelector('button[aria-label="Copy trace ID"]');
    if (trace && visible(trace)) {
      let box = trace.parentElement;
      for (let i = 0; i < 3 && box && normalize(box.textContent).length < 8; i++) box = box.parentElement;
      const text = normalize(box?.textContent || '').slice(0, 300);
      return { code: /rate limit|too many|limit reached|quota/i.test(text) ? 'RATE_LIMIT' : 'ARENA_ERROR', text };
    }
    const stopped = [...card.querySelectorAll('p')].find(el => !el.closest('.prose') && /^generation stopped$/i.test(normalize(el.textContent)) && visible(el));
    return stopped ? { code: 'GENERATION_STOPPED', text: 'Generation stopped' } : null;
  }
  // Same page, ignoring the model_a/model parameter Arena rewrites on an empty Direct chat.
  function samePage(a, b) {
    if (a === b) return true;
    try {
      const x = new URL(a), y = new URL(b);
      if (x.origin !== y.origin || x.pathname !== y.pathname || x.hash !== y.hash || !/^\/text\/direct\/?$/.test(x.pathname)) return false;
      const rest = u => { const p = new URLSearchParams(u.search); p.delete('model_a'); p.delete('model'); return p.toString(); };
      return rest(x) === rest(y);
    } catch { return false; }
  }
  // Arena's own model list, embedded in the Direct page's data. Read-only; nothing is requested.
  const catalogCache = new WeakMap();
  function extractArray(text, start) {
    let depth = 0, inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === '[' || c === '{') depth++;
      else if ((c === ']' || c === '}') && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }
  function modelCatalog(doc = document) {
    const scripts = [...doc.querySelectorAll('script:not([src])')];
    const cached = catalogCache.get(doc);
    if (cached && cached.count === scripts.length) return cached.list;
    let data = '';
    for (const script of scripts) {
      const code = script.textContent || '';
      const m = /^\s*self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/.exec(code);
      if (!m) continue;
      try { const part = JSON.parse(m[1]); if (part[0] === 1 && typeof part[1] === 'string') data += part[1]; } catch { /* not a data chunk */ }
      if (data.length > 8000000) break;
    }
    let list = [];
    const at = data.indexOf('"initialModels":');
    if (at >= 0) {
      try {
        const raw = JSON.parse(extractArray(data, data.indexOf('[', at)) || '[]');
        const seen = new Set();
        list = raw.filter(m => m && typeof m === 'object' && m.userSelectable !== false && m.capabilities?.outputCapabilities?.text &&
          m.rankByModality && Object.prototype.hasOwnProperty.call(m.rankByModality, 'chat'))
          .map(m => ({ id: String(m.id || ''), name: String(m.displayName || m.publicName || '').slice(0, 120), org: String(m.organization || '').slice(0, 60),
            rank: Number(m.rankByModality.chat) || 1e9, image: !!m.capabilities?.inputCapabilities?.image, file: !!m.capabilities?.inputCapabilities?.file }))
          .filter(m => m.name && !seen.has(m.name.toLowerCase()) && seen.add(m.name.toLowerCase()))
          .sort((a, b) => (a.name.toLowerCase() === 'max' ? -1 : b.name.toLowerCase() === 'max' ? 1 : a.rank - b.rank))
          .slice(0, 400);
      } catch { list = []; }
    }
    catalogCache.set(doc, { count: scripts.length, list });
    return list;
  }
  // ---- Repo & branch pickers (v2.9.0) ---------------------------------------------------------
  // Arena's Agent Mode can work on a GitHub repository: two dialog triggers beside the composer choose
  // which repository and which branch. They are recognised by their exact icon geometry (taken from
  // Arena's own markup) combined with the Radix trigger shape — an Arena redesign that renames the icon
  // becomes a named "picker not found" state, never a guessed button. Everything here drives Arena's own
  // controls; there is no GitHub API and no second source of truth.
  const PICKER_ICONS = {
    repo: 'M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143',
    branch: 'M18 8C19.1046 8 20 7.10457 20 6C20 4.89543 19.1046 4 18 4C16.8954 4 16 4.89543 16 6C16 7.10457 16.8954 8 18 8Z'
  };
  const PICKER_KINDS = ['repo', 'branch'];
  const pickerName = kind => (kind === 'repo' ? 'repository' : 'branch');
  const compressPath = value => String(value).replace(/\s+/g, ' ').trim();
  function pickerIconKind(button) {
    for (const path of button.querySelectorAll('svg path')) {
      const d = compressPath(path.getAttribute('d') || '');
      if (d === PICKER_ICONS.repo) return 'repo';
      if (d === PICKER_ICONS.branch) return 'branch';
    }
    return '';
  }
  // Both pickers at once: { repo, branch } each { el, label } or null, plus `ambiguous` when the same
  // picker is visible more than once (two live triggers are a refusal, not a first-match guess).
  function pickerTriggers(doc = document) {
    const found = { repo: null, branch: null }, counts = { repo: 0, branch: 0 };
    refreshRows(doc);
    for (const el of doc.querySelectorAll('button[aria-haspopup="dialog"][aria-controls]')) {
      const kind = pickerIconKind(el);
      if (!kind || !visible(el) || inTranscript(el) ||
        el.closest('[role="dialog"],[role="alertdialog"],nav,aside,[role="navigation"],[data-sidebar]')) continue;
      const label = el.querySelector('span.truncate');
      if (!label) continue;
      counts[kind]++;
      if (!found[kind]) found[kind] = { el, label: normalize(label.textContent).slice(0, 120) };
    }
    return { repo: found.repo, branch: found.branch, ambiguous: counts.repo > 1 || counts.branch > 1,
      duplicates: { repo: counts.repo > 1, branch: counts.branch > 1 } };
  }
  // Non-throwing snapshot for the panel's chips: which pickers the page shows, their current values and
  // whether Arena currently allows opening them. A missing picker is reported, never raised.
  function repoInfo(doc = document) {
    const empty = () => ({ present: false, value: '', disabled: false });
    try {
      const triggers = pickerTriggers(doc);
      const shape = (entry, kind) => entry && !triggers.duplicates[kind]
        ? { present: true, value: entry.label, disabled: !enabled(entry.el) || !!entry.el.closest('[inert]') }
        : empty();
      return { repo: shape(triggers.repo, 'repo'), branch: shape(triggers.branch, 'branch') };
    } catch { return { repo: empty(), branch: empty() }; }
  }
  // The picker's own popover, found only through the trigger that controls it (aria-controls + open
  // state), so a different dialog on the page can never be mistaken for it.
  function pickerDialog(kind, doc = document) {
    if (!PICKER_KINDS.includes(kind)) return null;
    const trigger = pickerTriggers(doc)[kind];
    if (!trigger || trigger.el.getAttribute('data-state') !== 'open') return null;
    const id = (trigger.el.getAttribute('aria-controls') || '').trim();
    if (!id || id.length > 80) return null;
    const dialog = doc.getElementById(id);
    return dialog && visible(dialog) ? dialog : null;
  }
  function pickersOpen(doc = document) {
    return PICKER_KINDS.filter(kind => !!pickerDialog(kind, doc));
  }
  // Option rows: Arena's command list uses role="option"; a plain button list inside a listbox is the
  // only accepted alternative. Anything else is an unrecognized picker, never a scraped guess.
  function pickerOptionItems(dialog) {
    let items = [...dialog.querySelectorAll('[role="option"]')].filter(visible);
    if (!items.length) {
      const list = [...dialog.querySelectorAll('[role="listbox"]')].find(visible);
      items = list ? [...list.querySelectorAll('button,[role="button"]')].filter(visible) : [];
    }
    return items;
  }
  // Label cap matches pickerTriggers' label cap exactly: the confirmed value must be able to equal what
  // the trigger later shows, or a long name could never be confirmed.
  const PICKER_LABEL_MAX = 120;
  const pickerLabelOf = item => {
    const truncate = item.querySelector('span.truncate');
    return normalize((truncate || item).textContent).slice(0, PICKER_LABEL_MAX);
  };
  function pickerQueryValue(dialog) {
    const input = [...dialog.querySelectorAll('input[type="search"],input[type="text"],input:not([type])')].find(visible);
    return input ? String(input.value || '').slice(0, 120) : '';
  }
  function readPickerOptions(dialog) {
    if (!dialog || !visible(dialog)) fail('PICKER_CLOSED', 'Arena’s picker is not open.');
    const options = pickerOptionItems(dialog).map(item => {
      const label = pickerLabelOf(item), full = normalize(item.textContent).slice(0, 400);
      const meta = full !== label && full.includes(label) ? normalize(full.replace(label, '')).slice(0, 200) : '';
      return { label, meta, disabled: !enabled(item) || !!item.closest('[inert]') };
    }).filter(option => option.label);
    if (!options.length)
      fail('PICKER_UNRECOGNIZED', 'Arena’s picker opened, but its option list does not match the supported structure. Pick directly in the Arena tab; nothing was clicked.');
    return { options: options.slice(0, 200), query: pickerQueryValue(dialog) };
  }
  // One exact-match click on Arena's own option row. No prefix, fuzzy or case-insensitive matching, and
  // a duplicate name refuses rather than picking the first.
  function pickPickerOption(dialog, value) {
    const want = normalize(value);
    if (!want || want.length > PICKER_LABEL_MAX) fail('INVALID_PICK', 'Choose one of the options Arena is currently showing.');
    const matches = pickerOptionItems(dialog)
      .map(item => ({ item, label: pickerLabelOf(item), full: normalize(item.textContent) }))
      .filter(entry => entry.label === want || entry.full === want);
    if (!matches.length) fail('PICKER_NOT_FOUND', 'That option is not in Arena’s current list (it may have been filtered out). Nothing was clicked.');
    if (matches.length > 1) fail('PICKER_AMBIGUOUS', 'More than one option in Arena’s list carries that name. Pick in the Arena tab; nothing was clicked.');
    const option = matches[0].item;
    if (!enabled(option) || option.closest('[inert]')) fail('PICKER_OPTION_DISABLED', 'That option is not available in Arena right now. Nothing was clicked.');
    option.click(); // Exactly one click on Arena’s own option. Never retried.
    return matches[0].label;
  }
  // One Escape keydown — the same gesture the site itself honours — dispatched only on the recognized
  // picker dialog. The caller verifies the dialog actually closed; nothing is dispatched twice.
  function closePickerDialog(dialog) {
    if (!dialog || !visible(dialog)) return;
    const win = dialog.ownerDocument.defaultView || globalThis;
    dialog.dispatchEvent(new win.KeyboardEvent('keydown',
      { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
  }
  function visible(el) {
    if (!el || !el.isConnected || el.closest('[hidden],[aria-hidden="true"]')) return false;
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return !!el.getClientRects().length;
  }
  // A security verification is transient: the user clears it in the Arena tab and the page returns to
  // normal. It therefore has to be *observable* separately from the hard blocks in checkBlocks(), so the
  // capture loop can pause and resume instead of stopping the turn. Non-throwing by construction.
  const SECURITY_TEXT = /captcha|verify (?:that )?you(?: are|'re) human|verification required|security (?:check|verification)|unusual traffic|checking your browser/i;
  const SECURITY_FRAME = /recaptcha.*\/bframe|hcaptcha.*challenge|challenges\.cloudflare\.com/i;
  const isSecurityText = text => SECURITY_TEXT.test(text);
  function isSecurityFrame(frame) {
    const src = frame.getAttribute('src') || '', rect = frame.getBoundingClientRect();
    return SECURITY_FRAME.test(src) && rect.width > 100 && rect.height > 70;
  }
  // Returns a short description while a verification is visible, otherwise ''. Never throws, so callers
  // can poll it safely while tracking a message.
  function securityNotice(doc = document) {
    for (const el of doc.querySelectorAll('[role="alert"],[role="dialog"],[data-sonner-toast],h1,h2')) {
      if (!visible(el) || inTranscript(el)) continue;
      if (isSecurityText(normalize(el.innerText || el.textContent).slice(0, 3000)))
        return 'Arena is showing a security verification.';
    }
    for (const frame of doc.querySelectorAll('iframe')) {
      if (visible(frame) && isSecurityFrame(frame)) return 'Arena is showing a security verification.';
    }
    return '';
  }
  // A security verification can clear while Arena is re-mounting the transcript: the row list is briefly
  // empty, which the exact-prefix check in matchTurn sees as an unrelated-conversation change. The
  // accepted message ID is a stronger anchor than the row list, so rebuild the baseline as the rows
  // before it and let matchTurn re-verify the row and prompt as usual (the same anchor watch() trusts).
  // Returns false when that anchor is gone, so a genuinely different conversation still stops.
  function reanchor(tx, doc = document) {
    if (!tx?.userId) return false;
    const list = rows(doc), index = list.findIndex(row => row.id === tx.userId && row.user);
    if (index < 0) return false;
    tx.baseline = list.slice(0, index).map(row => row.id);
    return true;
  }
  // Check UI notices, not chat text. Never copy these notices into a reply.
  function checkBlocks(doc = document) {
    refreshRows(doc);
    const ui = [...doc.querySelectorAll('[role="alert"],[role="dialog"],[data-sonner-toast],h1,h2')]
      .filter(el => visible(el) && !inTranscript(el));
    for (const el of ui) {
      const text = normalize(el.innerText || el.textContent).slice(0, 3000);
      if (isSecurityText(text))
        fail('SECURITY_CHECK', 'Complete the security verification in the Arena tab yourself. No retry or bypass was attempted. Check whether Arena accepted your prompt before sending again.');
      if (/rate limit|too many requests|quota exceeded|usage limit|try again (?:in|later)|limit reached/i.test(text))
        fail('RATE_LIMIT', 'Arena is limiting requests. Follow the wait time in the Arena tab. No automatic retry was attempted.');
      if (el.matches('[role="dialog"]') && /sign in|log in|login required/i.test(text))
        fail('SIGN_IN_REQUIRED', 'Sign in normally in the Arena tab, then reconnect. Never enter Google credentials in the extension.');
      if (el.matches('[role="alert"],[data-sonner-toast]') && /something went wrong|request failed|failed to generate|service unavailable/i.test(text))
        fail('ARENA_ERROR', 'Arena displayed a request error. Inspect the Arena tab before deciding whether to send again.');
    }
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      if (isSecurityFrame(frame))
        fail('SECURITY_CHECK', 'A security verification is visible in the Arena tab. Complete it yourself there. No retry or bypass was attempted.');
    }
  }
  function proseOf(row) {
    return [...row.querySelectorAll('.prose')].filter(el =>
      (rowOf(el) === row || (pairCards.has(row) && row.contains(el))) && !el.closest('.not-prose,[data-user-message-action],button,[role="dialog"]') &&
      !el.parentElement?.closest('.prose') && visible(el));
  }
  // Math is drawn twice by KaTeX (MathML + visual copy): keep only its TeX source. Emoji drawn as images
  // keep their alt text. Code line-number gutters are not text.
  function tidyClone(clone) {
    clone.querySelectorAll('.katex').forEach(el => {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      el.replaceWith(tex || '');
    });
    clone.querySelectorAll('img[alt]').forEach(el => { const alt = el.getAttribute('alt') || ''; if (isEmojiAlt(alt)) el.replaceWith(alt); });
    clone.querySelectorAll('.linenumber,.line-number,[data-line-number],.react-syntax-highlighter-line-number').forEach(el => el.remove());
    return clone;
  }
  const isEmojiAlt = alt => !!alt && alt.length <= 16 && !/[\p{L}\p{N}]/u.test(alt) && /\p{Extended_Pictographic}/u.test(alt);
  function answerText(row) {
    const nodes = proseOf(row);
    const parts = nodes.map(el => {
      const clone = tidyClone(el.cloneNode(true));
      clone.querySelectorAll('.not-prose,button,script,style,iframe,[hidden],[aria-hidden="true"],input,textarea,select').forEach(e => e.remove());
      // Preserve basic paragraph/code line breaks without rendering arbitrary HTML.
      clone.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
      clone.querySelectorAll('p,pre,li,blockquote,h1,h2,h3,h4,tr').forEach(e => e.append('\n'));
      return clone.textContent.trim();
    });
    const text = parts.filter(Boolean).join('\n\n');
    if (text.length > 200000) fail('REPLY_TOO_LARGE', 'The reply exceeds 200,000 characters. Read it in Arena instead.');
    return text;
  }
  // ---- Formatted reply (v2.7.0) ------------------------------------------------------------------
  // The reply's visible structure as a small JSON tree, so the panel can show headings, lists, bold,
  // code blocks, tables and links like Arena does. Only whitelisted elements survive; attributes are
  // limited to a checked link target, a code language and a list start. The panel rebuilds it with
  // createElement/textContent (never innerHTML). Node: string | [tag, attrs, ...children].
  const RICH_TAGS = { p: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', ul: 'ul', ol: 'ol', li: 'li',
    blockquote: 'blockquote', table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot', tr: 'tr', th: 'th', td: 'td',
    hr: 'hr', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em', del: 'del', s: 'del', code: 'code', kbd: 'kbd',
    sup: 'sup', sub: 'sub', mark: 'mark', u: 'u', a: 'a', div: 'div', section: 'div', article: 'div', figure: 'div', details: 'div', summary: 'p' };
  const RICH_SKIP = 'button,script,style,iframe,svg,canvas,video,audio,object,embed,template,noscript,input:not([type="checkbox"]),textarea,select,form,[hidden],[aria-hidden="true"],[role="dialog"],[data-user-message-action]';
  const LIVE_RICH_MS = 500;
  const RICH_MAX_NODES = 20000, RICH_MAX_DEPTH = 40, RICH_MAX_CHARS = 200000;
  function safeHref(value) {
    try { const url = new URL(value, 'https://arena.ai/'); return /^(?:https?:|mailto:)$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  }
  function richOf(row) {
    const budget = { nodes: 0, chars: 0 };
    const over = () => budget.nodes > RICH_MAX_NODES || budget.chars > RICH_MAX_CHARS;
    const codeBlock = pre => {
      const code = pre.querySelector('code');
      const lang = ((code?.className || pre.className || '').match(/(?:^|\s)(?:language|lang)-([\w+#.-]{1,30})/) || [])[1] || pre.getAttribute('data-language') || code?.getAttribute('data-language') || '';
      // Line-number gutters and copy buttons are not code.
      const clone = pre.cloneNode(true);
      clone.querySelectorAll('button,[aria-hidden="true"],.linenumber,.line-number,[data-line-number],.react-syntax-highlighter-line-number').forEach(e => e.remove());
      const text = clone.textContent.replace(/\n$/, '');
      budget.nodes++; budget.chars += text.length;
      return ['pre', lang ? { lang: lang.slice(0, 30) } : {}, text];
    };
    const math = el => {
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      if (!tex) return null;
      budget.nodes++; budget.chars += tex.length;
      return ['code', { math: el.closest('.katex-display') ? 'block' : 'inline' }, tex];
    };
    const walk = (node, depth) => {
      if (over() || depth > RICH_MAX_DEPTH) return [];
      if (node.nodeType === 3) { const text = node.nodeValue; if (!text) return []; budget.nodes++; budget.chars += text.length; return [text]; }
      if (node.nodeType !== 1) return [];
      const el = node, tag = el.tagName.toLowerCase();
      if (el.classList.contains('katex')) { const m = math(el); return m ? [m] : []; }
      if (el.matches(RICH_SKIP) || el.classList.contains('sr-only')) return [];
      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return [];
      if (tag === 'input') return [el.checked ? '☑ ' : '☐ '];
      if (tag === 'img') { const alt = normalize(el.getAttribute('alt') || ''); return !alt ? [] : isEmojiAlt(alt) ? [alt] : [`[image: ${alt.slice(0, 200)}]`]; }
      if (tag === 'pre') return [codeBlock(el)];
      // A nested not-prose block inside the answer is a custom widget (e.g. a code block with a header):
      // keep only its code and tables, never its buttons or labels.
      if (el.classList.contains('not-prose')) {
        const kept = [...el.querySelectorAll('pre,table')].filter(item => { const outer = item.parentElement?.closest('pre,table'); return !outer || !el.contains(outer); });
        return kept.flatMap(item => walk(item, depth + 1));
      }
      const children = [...el.childNodes].flatMap(child => walk(child, depth + 1));
      const mapped = RICH_TAGS[tag];
      if (!mapped) return children; // span and other inline wrappers are transparent
      budget.nodes++;
      const attrs = {};
      if (mapped === 'a') { const href = safeHref(el.getAttribute('href') || ''); if (!href) return children; attrs.href = href; }
      if (mapped === 'ol') { const start = parseInt(el.getAttribute('start') || '', 10); if (start > 1 && start < 1e6) attrs.start = start; }
      if (mapped === 'code' && !children.length) return [];
      return [[mapped, attrs, ...children]];
    };
    const blocks = proseOf(row).map(el => ['div', {}, ...[...el.childNodes].flatMap(child => walk(child, 1))]);
    return over() || !blocks.length ? null : blocks;
  }
  function rows(doc = document) {
    if (pageKind(doc) === 'direct') return directRows(doc);
    directEls = new Set();
    const list = [...doc.querySelectorAll(ROW)].filter(visible).map(el => ({
      el, id: el.getAttribute('data-chat-message-id'), user: !!el.querySelector(USER)
    }));
    if (new Set(list.map(r => r.id)).size !== list.length)
      fail('AMBIGUOUS_TRANSCRIPT', 'Duplicate visible message IDs were found. Open one Agent conversation and reconnect.');
    return list;
  }
  function ended(row) {
    if (directEls.has(row)) return !directPending(row) && !running(row.ownerDocument) && (directFeedback(row) || !!answerText(row));
    // Observed in the user's completed Agent reply. Copy and bottom markers alone are insufficient.
    return [...row.querySelectorAll('[aria-label]')].some(el =>
      !el.closest('.prose,.not-prose') && visible(el) && /\bResponse ended\b/i.test(el.getAttribute('aria-label') || ''));
  }
  function running(doc = document) {
    return [...doc.querySelectorAll('button[aria-label]')].some(el => visible(el) &&
      /^(?:stop|stop generating|stop generation|stop response|stop agent|cancel generation)$/i.test(el.getAttribute('aria-label')?.trim() || ''));
  }
  const EDITABLE = '[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]';
  const EXCLUDED_SEL = `${ROW},[data-user-message-action],[role="dialog"],[role="search"],[role="navigation"],nav,aside,pre,code,.monaco-editor,.cm-editor,.CodeMirror`;
  const excluded = el => !!el.closest(EXCLUDED_SEL) || inTranscript(el);
  function editorHost(el) {
    if (!el.matches(EDITABLE)) return false;
    // A nested editable node is not a second editor when its ancestor is already editable.
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.getAttribute('contenteditable') === 'false') break;
      if (p.matches(EDITABLE)) return false;
    }
    return true;
  }
  function fieldHints(el) {
    return ['name','aria-label','placeholder','data-placeholder','data-testid'].map(a => el.getAttribute(a) || '').join(' ');
  }
  function semanticComposer(el) { return /\b(?:message|prompt|chat|composer|ask|describe (?:a |your |the )?(?:task|project))\b/i.test(fieldHints(el)); }
  function eligibleFields(doc = document) {
    refreshRows(doc);
    return [...doc.querySelectorAll(`textarea,${EDITABLE}`)].filter(el =>
      visible(el) && !excluded(el) && (el.tagName === 'TEXTAREA' || editorHost(el)) &&
      !/\b(?:search|find|filter)\b/i.test(fieldHints(el)));
  }
  function buttonName(el) {
    const direct = el.getAttribute('aria-label') || el.getAttribute('title');
    if (direct) return normalize(direct);
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ');
    return normalize(labelled || el.innerText || el.textContent);
  }
  function labelledSends(doc = document) {
    return [...doc.querySelectorAll('button,[role="button"]')].filter(el => visible(el) && !excluded(el) &&
      /^(?:send|send message|send prompt|submit message)(?:\s*\((?:enter|return)\))?$/i.test(buttonName(el)));
  }
  function localTo(field, button, fields) {
    if (field.form && button.form === field.form && fields.filter(el => field.form.contains(el)).length === 1) return true;
    for (let node = field.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node === field.ownerDocument.body || node === field.ownerDocument.documentElement || node.matches('main,[role="main"]')) break;
      if (containsRow(node)) break;
      if (node.contains(button) && fields.filter(el => node.contains(el)).length === 1) return true;
    }
    return false;
  }
  // A picker input is routinely display:none on itself; what must not be hidden is its ancestor region,
  // otherwise we would target a template or another closed surface.
  function inputLaidOut(el) {
    for (let p = el.parentElement; p && p.nodeType === 1; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (p === el.ownerDocument.body || p === el.ownerDocument.documentElement) return true;
    }
    return true;
  }
  function composerAnchors(field, doc) {
    const anchors = new Set([field]);
    const form = field.form || field.closest('form');
    if (form) { anchors.add(form); for (const inner of form.querySelectorAll('input,button,textarea,[contenteditable]')) anchors.add(inner); }
    return anchors;
  }
  function nearComposer(el, field, doc) {
    const anchors = composerAnchors(field, doc);
    for (let node = el.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node === doc.body || node === doc.documentElement || node.matches('main,[role="main"]')) break;
      if (containsRow(node)) break;
      for (const anchor of anchors) if (anchor === node || node.contains(anchor)) return true;
    }
    return false;
  }
  function composerFileInputs(field, doc = document) {
    if (!field) return [];
    refreshRows(doc);
    // Every composer-local picker counts, including ones we would reject: a second input means we
    // could attach to the wrong control, so ambiguity is resolved by refusing rather than filtering.
    return [...doc.querySelectorAll('input[type="file"]')].filter(el =>
      el.disabled !== true && el.closest('.not-prose') === null &&
      !el.closest('[role="dialog"],[role="search"],[role="navigation"],nav,aside') && !inTranscript(el) && inputLaidOut(el) &&
      nearComposer(el, field, doc));
  }
  function fileInputsFor(field, doc = document) {
    // One drop-zone may expose two identical inputs (button picker + drag area); anything else is ambiguous.
    const inputs = composerFileInputs(field, doc);
    const single = inputs.length === 1 ? inputs : inputs.length === 2 && inputs[0].accept === inputs[1].accept &&
      inputs[0].multiple === inputs[1].multiple ? [inputs[0]] : [];
    return single.filter(el => !el.accept ||
      (globalThis.ArenaAgentAttachments ? globalThis.ArenaAgentAttachments.acceptAllows(el.accept) : true));
  }
  function uploadsFor(field, doc = document) {
    const inputs = fileInputsFor(field, doc);
    if (inputs.length) return { input: inputs[0], button: null, kind: 'input' };
    if (composerFileInputs(field, doc).length) return { input: null, button: null, kind: 'unsupported' };
    // Some pages open their picker through a button with no inspectable file input.
    const buttons = field ? [...field.ownerDocument.querySelectorAll('button,[role="button"]')].filter(el => visible(el) && !excluded(el) &&
      /^(?:attach|upload|add (?:files?|attachments?)|attach files?|upload files?|\u{1f4ce})$/iu.test(buttonName(el)) && nearComposer(el, field, doc)) : [];
    if (buttons.length === 1) return { input: null, button: buttons[0], kind: 'button-only' };
    return { input: null, button: null, kind: 'none' };
  }
  function stageRequestFor(field, pairs) {
    const A = globalThis.ArenaAgentAttachments;
    const target = fileInputsFor(field)[0];
    if (!target) fail('UPLOAD_UNAVAILABLE', 'Arena has no single file input attached to its composer, so the extension cannot place files there. Attach them in the Arena tab and send there; nothing was inserted and no Send click was attempted.');
    if (!A) fail('ADAPTER_ERROR', 'The attachment policy is unavailable. Nothing was inserted or sent.');
    const checked = A.validateAttachments(pairs);
    if (checked.rejected.length || checked.accepted.length !== pairs.length) fail('INVALID_ATTACHMENT', checked.rejected[0]?.reason || 'One of the files is not supported. Nothing was inserted or sent.');
    if (checked.accepted.some(file => !A.acceptsFile(target.accept, file)))
      fail('UPLOAD_TYPE_UNSUPPORTED', 'One of the staged files does not match Arena’s file input. Nothing was inserted or sent.');
    if (pairs.length > 1 && !target.multiple) fail('UPLOAD_MULTIPLE_UNSUPPORTED', `That Arena file input accepts one file at a time. Send ${pairs.length} files separately in the Arena tab; nothing was inserted or sent.`);
    const token = crypto.randomUUID();
    target.setAttribute('data-arena-agent-stage', token);
    return { input: target, token, names: checked.accepted.map(item => item.name) };
  }
  // A modal Arena dialog (terms, notices, model info…) hides the rest of the page from assistive tech with
  // aria-hidden/inert, which also hides the message box from us. Report it; never click it.
  // Returns null when there is none, otherwise the dialog's own short title ('' if it has none).
  function blockingDialog(doc = document) {
    const dialog = [...doc.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')].find(visible);
    if (!dialog) return null;
    const labelled = (dialog.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => doc.getElementById(id)?.textContent || '').join(' ');
    const heading = dialog.querySelector('h1,h2,h3,[id$="-title"]');
    const title = normalize(labelled || dialog.getAttribute('aria-label') || heading?.textContent || '');
    return title.length > 100 ? `${title.slice(0, 99)}…` : title;
  }
  function hiddenFieldCount(doc = document) {
    return [...doc.querySelectorAll('textarea')].filter(el => el.getClientRects().length && el.closest('[aria-hidden="true"],[inert]')).length;
  }
  function composerSummary(doc = document) {
    const all = eligibleFields(doc);
    let upload = 'no file input';
    try { const field = composer(doc); if (field) { const kinds = { input: 'one composer file input', 'button-only': 'an upload button but no usable file input', none: 'no recognizable upload control' }; upload = kinds[uploadsFor(field, doc).kind]; } } catch { /* composer itself is broken */ }
    const hidden = hiddenFieldCount(doc);
    return `Visible eligible controls: ${all.filter(el => el.tagName === 'TEXTAREA').length} textarea(s), ${all.filter(el => el.tagName !== 'TEXTAREA').length} editable host(s), ${labelledSends(doc).length} labelled Send control(s); upload: ${upload}.${hidden ? ` ${hidden} textarea(s) are covered by an overlay.` : ''} Page: ${location.pathname}.`;
  }
  function composer(doc = document) {
    const fields = eligibleFields(doc), sends = labelledSends(doc);
    // Editable hosts require semantic chat hints OR a unique local Send relationship.
    let candidates = fields.filter(el => el.tagName === 'TEXTAREA' || semanticComposer(el) || sends.some(button => localTo(el, button, fields)));
    const semantic = candidates.filter(semanticComposer);
    if (semantic.length) candidates = semantic;
    if (candidates.length > 1) {
      const paired = candidates.filter(el => sends.some(button => localTo(el, button, fields)));
      if (paired.length === 1) candidates = paired;
    }
    if (!candidates.length) {
      const dialog = blockingDialog(doc);
      if (dialog !== null) fail('ARENA_DIALOG_OPEN', `Arena is showing a dialog${dialog ? ` (“${dialog}”)` : ''} over the message box. Read it and close or answer it in the Arena tab yourself — the extension never clicks it. The panel connects by itself once it is gone. Nothing was sent.`);
    }
    if (!candidates.length) fail('COMPOSER_NOT_FOUND', `No eligible message input is ready. ${composerSummary(doc)} Supports native textareas and identifiable contenteditable chat editors; excludes transcript, search, dialogs, and workspace code editors.`);
    if (candidates.length !== 1) fail('AMBIGUOUS_COMPOSER', `Found ${candidates.length} possible message inputs. ${composerSummary(doc)} Refusing to guess which field to edit.`);
    const el = candidates[0];
    if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true' || el.closest('[inert]'))
      fail('COMPOSER_UNAVAILABLE', 'The Arena composer is unavailable. Check sign-in, pending agent questions, or security verification in the tab.');
    return el;
  }
  function sendButton(doc = document, field = composer(doc)) {
    const fields = eligibleFields(doc), sends = labelledSends(doc);
    const local = sends.filter(button => localTo(field, button, fields));
    if (local.length === 1) return local[0];
    if (local.length > 1) fail('AMBIGUOUS_SEND_BUTTON', 'Multiple Send controls are associated with the selected composer. No Send click was attempted.');
    // An unlabelled submit is acceptable only in the same explicit form as a single
    // semantically identified chat input, with no other data-entry controls or submit choices.
    const form = field.form || field.closest('form');
    if (form && semanticComposer(field) && fields.filter(el => form.contains(el)).length === 1) {
      const others = [...form.querySelectorAll('input,select,textarea')].filter(el => el !== field && visible(el) && !el.matches('input[type="hidden"],input[type="file"]'));
      const submits = [...form.querySelectorAll('button[type="submit"]')].filter(el => visible(el) && !excluded(el));
      if (!others.length && submits.length === 1 && !buttonName(submits[0])) return submits[0];
    }
    if (sends.length === 1 && fields.length === 1) return sends[0];
    if (sends.length > 1) fail('AMBIGUOUS_SEND_BUTTON', 'Multiple page Send controls exist, and none can be uniquely tied to this composer. No Send click was attempted.');
    fail('SEND_BUTTON_NOT_FOUND', `No labelled Send control or unambiguous chat-form submit is associated with the composer. ${composerSummary(doc)} No Send click was attempted.`);
  }
  function composerText(field) {
    return field.tagName === 'TEXTAREA' ? field.value : (field.innerText ?? field.textContent ?? '');
  }
  function writeComposer(field, text) {
    if (composerText(field).trim()) fail('DRAFT_EXISTS', 'The composer gained an unsent draft. Nothing was overwritten or clicked.');
    field.focus();
    const doc = field.ownerDocument, win = doc.defaultView;
    if (field.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) fail('COMPOSER_NOT_FOUND', 'The native textarea setter is unavailable. No Send click was attempted.');
      setter.call(field, text);
      field.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return;
    }
    if (!editorHost(field) || !field.isContentEditable) fail('COMPOSER_UNAVAILABLE', 'The selected rich-text input is not editable. No Send click was attempted.');
    const selection = doc.getSelection();
    if (!selection || typeof doc.execCommand !== 'function') fail('RICH_EDITOR_UNSUPPORTED', 'This browser cannot perform a native rich-editor insertion. No Send click was attempted.');
    const anchor = [...field.querySelectorAll('p')].find(el => !el.closest('[contenteditable="false"]')) || field;
    const range = doc.createRange(); range.selectNodeContents(anchor); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    // Use Chrome's editing pipeline so ProseMirror/Lexical-style input handlers run.
    // Never replace innerHTML/textContent or issue an Enter fallback.
    const inserted = doc.execCommand('insertText', false, text);
    if (!inserted || normalize(composerText(field)) !== normalize(text))
      fail('RICH_EDITOR_REJECTED', 'The rich-text editor did not accept the requested text. No Send click was attempted. Inspect the Arena composer; no second insertion or Send retry was attempted.');
  }
  function enabled(button) {
    return !button.disabled && button.getAttribute('aria-disabled') !== 'true' && getComputedStyle(button).pointerEvents !== 'none';
  }
  function checkAgent(doc = document) {
    if (location.origin !== 'https://arena.ai') fail('WRONG_PAGE', 'Only https://arena.ai is supported.');
    const kind = pageKind(doc);
    if (kind === 'direct') {
      const mode = modeLabel(doc);
      if (mode && !/^direct(?:[\s-]*battle)?$/i.test(mode)) fail('WRONG_PAGE', `This Arena chat is in ${mode} mode. Automatic capture supports Agent Mode and Direct (one model) chats only.`);
      return;
    }
    if (kind === 'text-other') fail('WRONG_PAGE', 'Battle and Side-by-Side are not supported. Use Direct (one model) or Agent Mode.');
    if (!/^\/agent\/?$/.test(location.pathname) && !rows(doc).length)
      fail('WRONG_PAGE', 'Open an Agent or Direct conversation. No verified transcript markers were found on this page.');
  }
  function reviewPanel(doc = document) {
    const closers = [...doc.querySelectorAll('button[aria-label="Close review panel"]')]
      .filter(el => visible(el) && !el.closest(`${ROW},.not-prose,nav,aside,[role="navigation"]`));
    if (!closers.length) return null;
    const matches = [];
    for (const close of closers) {
      for (let root = close.parentElement, depth = 0; root && depth < 6; root = root.parentElement, depth++) {
        if (root === doc.body || root === doc.documentElement || root.matches('main,[role="main"]') || root.closest(ROW)) break;
        const question = [...root.querySelectorAll('span,p,legend,h1,h2,h3')].some(el =>
          visible(el) && !el.closest('button') && normalize(el.innerText || el.textContent).toLowerCase() === 'was this task successful?');
        if (!question) continue;
        const buttons = [...root.querySelectorAll('button')].filter(visible);
        const options = buttons.filter(el => el !== close).map(el => normalize(el.innerText || el.textContent).toLowerCase());
        if (buttons.length === 4 && ['yes', 'no', 'keep working'].every(name => options.filter(value => value === name).length === 1)) {
          matches.push({ root, close }); break;
        }
      }
    }
    if (matches.length > 1 || closers.length > 1)
      fail('AMBIGUOUS_REVIEW_PANEL', 'Multiple visible task-review close controls were found. Open Arena and resolve the review yourself. No control from this ambiguous set will be clicked.');
    if (!matches.length)
      fail('UNRECOGNIZED_REVIEW_PANEL', 'A review close control is visible, but its surrounding panel does not match the supplied task-success review. Nothing will be dismissed automatically. Open Arena to continue.');
    return matches[0];
  }
  function conversationReady(doc = document) {
    checkBlocks(doc); checkAgent(doc);
    const list = rows(doc);
    if (running(doc)) fail('AGENT_BUSY', 'Arena is already generating. Wait in the Arena tab before sending another prompt.');
    const last = list.at(-1);
    const settled = row => directEls.has(row.el) ? !directPending(row.el) && (ended(row.el) || !!directProblem(row.el)) : ended(row.el);
    if (last && (last.user || !settled(last))) fail('AGENT_BUSY', 'The last turn in this Arena chat is not marked complete. Finish it in Arena before sending another prompt.');
    return list;
  }
  function inspectControls(doc = document) {
    checkBlocks(doc); checkAgent(doc);
    if (reviewPanel(doc)) return { inputKind: 'review panel', reviewPending: true, uploadKind: 'unknown' };
    const field = composer(doc), button = sendButton(doc, field);
    return { field, button, inputKind: field.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable', uploadKind: uploadsFor(field, doc).kind, fileInputCount: fileInputsFor(field, doc).length };
  }
  // Semantic capability snapshot: which named Arena capabilities this page currently exposes, using the
  // same primitives the adapter drives. A control that Arena renames or removes then shows up as a named
  // gap ("unsupported page layout") instead of only surfacing later as a generic error. Pure and
  // non-throwing — a diagnostic must never be able to break an otherwise usable connection.
  function capabilities(doc = document) {
    const safe = fn => { try { return fn(); } catch { return null; } };
    const field = safe(() => composer(doc));
    const upload = safe(() => (field ? uploadsFor(field, doc) : { kind: 'none' }));
    const visibleAny = selector => [...doc.querySelectorAll(selector)].some(visible);
    return {
      pageKind: pageKind(doc),
      mode: safe(() => modeLabel(doc)) || '',
      checks: {
        composer: !!field,
        send: field ? safe(() => !!sendButton(doc, field)) === true : false,
        transcript: pageKind(doc) === 'direct'
          ? safe(() => { directRows(doc); return directEls.size > 0; }) === true
          : agentRowsPresent(doc),
        questions: visibleAny('[role="radiogroup"][aria-label]'),
        responsePairs: visibleAny('[aria-roledescription="carousel"]') || visibleAny('.sticky span.font-mono > span.truncate'),
        reviewPanel: visibleAny('button[aria-label="Close review panel"]'),
        upload: upload?.kind === 'input',
        uploadPicker: upload?.kind === 'button-only'
      }
    };
  }
  function preflight(doc = document) {
    const list = conversationReady(doc);
    if (reviewPanel(doc)) fail('REVIEW_PANEL_VISIBLE', 'The task-review panel still covers the composer. Close it in Arena before continuing. No feedback option was selected and no Send click was attempted.');
    const field = composer(doc);
    if (composerText(field).trim()) fail('DRAFT_EXISTS', 'Arena already has an unsent draft. Send or clear it yourself; the extension will not overwrite it.');
    sendButton(doc, field); // Existence only: an empty composer normally has a disabled Send.
    return { list, field };
  }
  // Only the supplied clarification-card structure, inside an attributed assistant row.
  function questionsFor(row) {
    const groups = [...row.querySelectorAll('[role="radiogroup"][aria-label]')].filter(group =>
      visible(group) && rowOf(group) === row && !group.closest('.prose,pre,code,nav,aside,[role="dialog"]'));
    const found = [];
    for (const group of groups) {
      const root = group.parentElement, question = normalize(group.getAttribute('aria-label'));
      if (!question || question.length > 1200) continue;
      const header = root?.firstElementChild && root.firstElementChild !== group ? root.firstElementChild : null;
      // A follow-up card in the same conversation may arrive without the supplied header at all.
      const skip = header ? [...header.querySelectorAll('button')].filter(visible) : [];
      const heading = header ? [...header.querySelectorAll('span')].find(el => visible(el) && normalize(el.textContent) === question) : null;
      if (header && !heading) continue;
      // Only a Skip control is tolerated in the header; any other labelled control fails recognition.
      if (skip.length > 1 || (skip.length === 1 && normalize(skip[0].textContent) !== 'Skip')) continue;
      const buttons = [...group.querySelectorAll('button[role="radio"]')].filter(visible);
      // Sequential questions can offer a single choice, so one radio is accepted.
      if (buttons.length < 1 || buttons.length > 6) continue;
      if (root.querySelectorAll('[role="radiogroup"]').length !== 1) continue;
      const options = buttons.map(button => {
        const parts = [...button.querySelectorAll('.body-sm')].filter(visible);
        if (parts.length < 1 || parts.length > 2 || !['true','false'].includes(button.getAttribute('aria-checked'))) return null;
        const label = normalize(parts[0].textContent), description = normalize(parts[1]?.textContent || '');
        return label && label.length <= 500 && description.length <= 1500 ? { label, description, disabled: !enabled(button) || !!button.closest('[inert]'), checked: button.getAttribute('aria-checked') === 'true' } : null;
      });
      if (options.some(option => !option) || new Set(options.map(o => o.label)).size !== options.length) continue;
      const inputs = [...group.querySelectorAll('input[type="text"][placeholder="Revise options or write your own..."][maxlength="2000"]')].filter(visible);
      const submits = [...group.querySelectorAll('button[aria-label="Submit custom response"]')].filter(visible);
      const custom = inputs.length === 1 && submits.length === 1;
      if (!custom && (inputs.length || submits.length)) continue;
      const fields = [...root.querySelectorAll('input,textarea,select,[contenteditable]')].filter(visible);
      if (fields.some(field => !custom || field !== inputs[0])) continue;
      const allowedButtons = new Set([...buttons, ...submits, ...skip]);
      if ([...root.querySelectorAll('button')].filter(visible).some(button => !allowedButtons.has(button))) continue;
      const sensitive = /\b(captcha|verification|password|credential|secret|token|sign[ -]?in|log[ -]?in|permission|approv\w*|authoriz\w*|payment|purchase|delete|destructive|execut\w*)\b|\brun\b.{0,35}\b(command|script|code|bash|shell)\b/i.test([question,...options.map(o=>o.label+' '+o.description)].join(' '));
      const answered = options.some(option => option.checked);
      const readOnly = sensitive || answered;
      const data = { rowId: row.getAttribute('data-chat-message-id'), question, options, custom, readOnly, answered, sensitive,
        reason: sensitive ? 'This may be an approval, sensitive action or security question. Handle it in Arena.' : readOnly ? 'An option is already selected in Arena. Wait there or check its state.' : '' };
      found.push({ root, group, buttons, input: custom ? inputs[0] : null, submit: custom ? submits[0] : null, data, fingerprint: JSON.stringify(data) });
    }
    if (new Set(found.map(q => q.fingerprint)).size !== found.length)
      fail('AMBIGUOUS_QUESTION', 'Duplicate clarification cards were found. Answer them in Arena; no option was selected.');
    return found;
  }
  // Visible thinking label only (e.g. "Thinking…", "Thought for 12s"). The collapsed body is never
  // opened, read or copied; hidden reasoning is not extracted. English wording heuristic.
  const THINKING_ACTIVE = /^(?:thinking|reasoning)(?:\s*(?:\.{3}|…))?$/i;
  const THINKING_DONE = /^(?:thought|reasoned)\s+for\s+(?:\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?)|a (?:few seconds|second|moment))$/i;
  function thinkingStatus(row) {
    let found = null;
    const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(), seen = 0; node && seen < 5000; node = walker.nextNode(), seen++) {
      const raw = node.nodeValue.trim();
      if (!raw || raw.length > 40 || !/^(?:thinking|reasoning|thought|reasoned)\b/i.test(raw)) continue;
      const host = node.parentElement;
      if (!host || host.closest('.prose,pre,code,[role="radiogroup"],textarea,input') || rowOf(host) !== row || !visible(host)) continue;
      const classify = label => THINKING_ACTIVE.test(label) ? 'active' : THINKING_DONE.test(label) ? 'done' : '';
      // The text node alone may be the label (its container can also hold the collapsed body, which
      // is never read); otherwise widen over at most three inline ancestors while the text still matches.
      let best = classify(normalize(raw)) ? { state: classify(normalize(raw)), label: normalize(raw) } : null;
      for (let el = host, depth = 0; el && el !== row && depth < 3; el = el.parentElement, depth++) {
        const label = normalize(el.textContent);
        if (label.length > 60) break;
        const state = classify(label);
        if (state) best = { state, label };
      }
      if (best) found = { state: best.state, label: best.label.replace(/\.{3}$/, '…') };
    }
    return found;
  }
  function toolActivity(row) {
    return [...row.querySelectorAll('button[aria-expanded][aria-label="Expand"],button[aria-expanded][aria-label="Collapse"]')]
      .filter(button => visible(button) && rowOf(button) === row && !button.closest('.prose,pre,code,[role="radiogroup"]'))
      .map(button => {
        const labels = [...button.querySelectorAll('.body-sm')].filter(visible).map(el => normalize(el.textContent));
        if (labels.length !== 2 || labels[0] !== 'used' || labels[1] !== 'Bash') return null;
        const duration = normalize(button.querySelector('.font-mono')?.textContent || '');
        if (duration && !/^(?:exit -?\d+ )?\d+(?:\.\d+)?(?:ms|s|m)$/.test(duration)) return null;
        return { tool: 'Bash', duration, status: button.querySelector('.text-interactive-negative') ? 'error' : button.querySelector('.text-interactive-positive') ? 'done' : 'activity' };
      }).filter(Boolean).slice(0,100);
  }
  // With a staged upload the page usually renders its own attachment chips inside the user row.
  // Only a short suffix made of that chip text is tolerated; any change of wording fails closed.
  // Arena renders the user's message as Markdown: **bold**, list numbers, link URLs and code-fence
  // languages disappear on screen. Compare letters and digits only, against the raw prompt and against
  // the prompt with that Markdown syntax removed. Any different wording still fails closed.
  const letters = text => String(text).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
  function promptForms(prompt) {
    const raw = String(prompt).normalize('NFKC');
    const rendered = raw.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:```|~~~)[^\n]*$/gm, '')
      .replace(/^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s+/gm, '').replace(/^\s{0,3}(?:#{1,6}|>)\s*/gm, '');
    // Arena's Markdown drops raw HTML-looking tags such as <br> or <div class="x"> from the message.
    const untagged = raw.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, ' ');
    return [...new Set([letters(raw), letters(rendered), letters(untagged)])].filter(Boolean);
  }
  function promptMatches(tx, text) {
    const shown = normalize(text), expected = normalize(tx.prompt);
    if (shown === expected) return true;
    const shownLetters = letters(shown), forms = promptForms(tx.prompt);
    if (forms.includes(shownLetters)) return true;
    // With a staged upload the page may show its own attachment chip text before or after the prompt.
    return !!tx.attachmentLabels && forms.some(form => (shownLetters.startsWith(form) || shownLetters.endsWith(form)) &&
      shownLetters.length - form.length <= 200) && shown.length - expected.length <= 200;
  }
  // The user's own message row, including code boxes (Arena may draw indented/fenced code in a separate
  // widget). User rows hold no reasoning; buttons and hidden/screen-reader labels are still dropped.
  function userRowText(row) {
    return proseOf(row).map(el => {
      const clone = tidyClone(el.cloneNode(true));
      clone.querySelectorAll('button,script,style,iframe,svg,[hidden],[aria-hidden="true"],.sr-only,input,textarea,select').forEach(e => e.remove());
      clone.querySelectorAll('br').forEach(e => e.replaceWith('\n'));
      clone.querySelectorAll('p,pre,li,blockquote,h1,h2,h3,h4,tr,div').forEach(e => e.append('\n'));
      return clone.textContent.trim();
    }).filter(Boolean).join('\n\n');
  }
  // Is this new user row the message we sent? Strict for short prompts; for long ones (code, logs) Arena's
  // Markdown rendering can drop or move a few pieces, so compare the words both share. Only called for the
  // single new user row that appeared after our one Send click; anything clearly different still fails.
  const words = text => String(text).normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
  const EXPAND = /^(?:show more|read more|see more|expand|show full message|show all)$/i;
  function userRowMatches(tx, texts, truncated = false) {
    if (texts.some(text => promptMatches(tx, text))) return true;
    const untagged = String(tx.prompt).replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, ' ');
    return [tx.prompt, untagged].some(prompt => wordsMatch({ ...tx, prompt }, texts, truncated));
  }
  function wordsMatch(tx, texts, truncated) {
    const want = words(tx.prompt);
    if (!want.length) return false;
    const allowance = tx.attachmentLabels ? 200 : 0;
    return texts.some(text => {
      const got = words(text), pool = new Map();
      for (const word of want) pool.set(word, (pool.get(word) || 0) + 1);
      let common = 0, extraChars = 0;
      for (const word of got) {
        const left = pool.get(word) || 0;
        if (left) { pool.set(word, left - 1); common++; } else extraChars += word.length;
      }
      // Arena's version may lose Markdown syntax, but must not be much longer than what was sent.
      const longer = normalize(text).length - normalize(tx.prompt).length;
      // A long message Arena shows collapsed ("Show more"): the visible start must be ours, word for word.
      if (truncated && got.length >= 30 && common === got.length && want.slice(0, 5).join(' ') === got.slice(0, 5).join(' ')) return true;
      if (want.length < 20) return common === want.length && extraChars <= allowance && longer <= 10 + allowance;
      const letters = want.reduce((sum, word) => sum + word.length, 0), slack = Math.max(40, letters * 0.1);
      return common / want.length >= 0.85 && extraChars <= slack + allowance && longer <= slack + allowance;
    });
  }
  // For the error message only: where the sent text and Arena's rendering first differ (the user's own words).
  function promptDiff(prompt, text) {
    const sent = normalize(prompt), shown = normalize(text);
    let i = 0; while (i < sent.length && i < shown.length && sent[i] === shown[i]) i++;
    const snip = value => { const part = value.slice(Math.max(0, i - 12), i + 18); return `${i > 12 ? '…' : ''}${part}${i + 18 < value.length ? '…' : ''}`; };
    return ` [Sent ${sent.length} chars; Arena shows ${shown.length}${shown ? `; first difference at char ${i + 1}: sent “${snip(sent)}”, Arena shows “${snip(shown)}”` : ' (empty)'}]`;
  }
  // ---- Battles in Direct (two anonymous responses; the user picks which one continues) -----------
  const PAIR_PROMPT = /^which response do you prefer\??$/i;
  const CHOICE_TEXT = /^continue with ([ab])$/i;
  const SKIP_TEXT = /^skip$/i;
  function pairInfo(row) {
    const cards = directPairs.get(row.el) || [];
    if (cards.length !== 2) fail('AMBIGUOUS_REPLY', `Arena showed a response comparison with ${cards.length} response(s) instead of two. Read it in Arena; nothing was chosen.`);
    const doc = row.el.ownerDocument;
    const sides = cards.map((card, index) => {
      const text = answerText(card), label = modelOf(card) || `Response ${index ? 'B' : 'A'}`;
      const problem = directProblem(card);
      return { side: index ? 'b' : 'a', label, text, failed: !!problem, done: !directPending(card) && !running(doc) && !!text && !problem, el: card };
    });
    const prompt = [...row.el.querySelectorAll('h1,h2,h3,h4,p')].some(el => visible(el) && PAIR_PROMPT.test(normalize(el.textContent)));
    return { sides, prompt };
  }
  const buttonText = button => normalize(button.innerText || button.textContent || '');
  // 'a' | 'b' for Arena's "Continue with A/B", 'skip' for the Skip button that sits in the same vote bar
  // (a "Skip" anywhere else on the page is not this control), '' otherwise.
  function choiceSide(button) {
    if (!button || button.closest(DIRECT_OUTSIDE.replace('form,', '')) || inTranscript(button)) return '';
    const text = buttonText(button), match = CHOICE_TEXT.exec(text);
    if (match) return match[1].toLowerCase();
    if (!SKIP_TEXT.test(text)) return '';
    for (let box = button.parentElement, i = 0; box && i < 4; box = box.parentElement, i++)
      if ([...box.querySelectorAll('button')].some(other => other !== button && CHOICE_TEXT.test(buttonText(other)))) return 'skip';
    return '';
  }
  // Arena's own vote bar above the composer: "Continue with A" / "Skip" / "Continue with B".
  function choiceButtons(doc = document) {
    const found = { a: [], b: [], skip: [] };
    for (const button of doc.querySelectorAll('button')) {
      if (!visible(button)) continue;
      const side = choiceSide(button);
      if (side) found[side].push(button);
    }
    return found;
  }
  // Structure only, for bug reports: row kinds in reading order plus model names. No message text.
  function rowSummary(added, total) {
    const kinds = added.slice(0, 8).map(row => row.user ? 'you' : row.pair ? 'pair(A|B)' : directEls.has(row.el) ? `reply(${modelOf(row.el) || '?'})` : 'reply');
    const direct = added.some(row => directEls.has(row.el));
    return ` [Seen: ${kinds.join(' · ') || 'nothing'}${added.length > 8 ? ' …' : ''}; ${total} row(s) on page${direct ? `; list ${directReversed ? 'newest-first' : 'top-down'}` : ''}]`;
  }
  function matchTurn(tx, doc = document) {
    const list = rows(doc), ids = list.map(r => r.id);
    // Exact prefix, not a page text diff. Virtualization or conversation changes fail closed.
    if (tx.baseline.some((id, i) => ids[i] !== id))
      fail('CONVERSATION_CHANGED', `The Agent transcript changed or was virtualized. Capture stopped to avoid an unrelated reply. Inspect the Arena tab.${rowSummary(list.slice(tx.baseline.length), list.length)}`);
    const added = list.slice(tx.baseline.length);
    // Once Arena has accepted the message, its rows vanishing is a page change (the caller may allow a
    // brief re-render on Direct pages), never "not sent yet".
    if (!added.length && tx.userId) fail('CONVERSATION_CHANGED', `Tracked turn rows were removed or reordered. Live capture stopped.${rowSummary(added, list.length)}`);
    if (!added.length) return { accepted: false };
    const users = added.filter(r => r.user);
    if (users.length !== 1 || !added[0].user)
      fail('AMBIGUOUS_TURN', `Another turn or an unexpected message appeared. Capture stopped rather than associate the wrong reply.${rowSummary(added, list.length)}`);
    const user = users[0];
    const shownPrompt = userRowText(user.el);
    const truncated = [...user.el.querySelectorAll('button,[role="button"]')].some(el => visible(el) && EXPAND.test(normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || '')));
    if (!userRowMatches(tx, [shownPrompt, answerText(user.el)], truncated))
      fail('PROMPT_MISMATCH', `Arena showed a different user message. Capture stopped. Check the tab; the extension will not retry.${promptDiff(tx.prompt, shownPrompt)}`);
    if (tx.userId && tx.userId !== user.id)
      fail('CONVERSATION_CHANGED', 'The submitted message ID changed. Capture stopped.');
    if (tx.seenRows?.some((id, index) => added[index]?.id !== id))
      fail('CONVERSATION_CHANGED', `Tracked turn rows were removed or reordered. Live capture stopped.${rowSummary(added, list.length)}`);
    const assistants = added.slice(1).filter(r => !r.user);
    // After a choice in a response pair, Arena may redraw the pair as plain cards. A card that still shows
    // a response that was NOT chosen (or either old response after Skip) is history, not a new reply.
    const choiceMade = tx.pairChoice === 'a' || tx.pairChoice === 'b' || tx.pairChoice === 'skip';
    const oldTexts = !choiceMade || !tx.pairTexts ? [] : tx.pairChoice === 'skip'
      ? [tx.pairTexts.a, tx.pairTexts.b] : [tx.pairTexts[tx.pairChoice === 'a' ? 'b' : 'a']];
    const stale = text => !!text && oldTexts.some(old => old && normalize(old) === normalize(text)) &&
      !(tx.pairChoice !== 'skip' && normalize(tx.pairTexts?.[tx.pairChoice] || '') === normalize(text));
    const classified = assistants.map(row => {
      if (row.pair) return { row, questions: [], tools: [], text: '', pair: pairInfo(row) };
      const text = answerText(row.el);
      if (stale(text)) return { row, questions: [], tools: [], text: '', stale: true };
      return { row, questions: questionsFor(row.el), tools: toolActivity(row.el), text };
    });
    const cardGroups = item => [...item.row.el.querySelectorAll('[role="radiogroup"]')].filter(group => visible(group) && !group.closest('.prose,pre,code')).length;
    // v2.8.1: an answered clarification row is history, not a competing reply. After the user picks an
    // option (here or in Arena), Arena may hide or remove that card while its preamble text stays in the
    // row. Without remembering it, the old row looks like a plain reply and the new answer makes two,
    // which used to stop capture with AMBIGUOUS_REPLY. Rows that ever held a recognized card (tracked in
    // tx.questionRows across scans, or passed back on WATCH resume) stay interaction rows forever, as do
    // rows that still carry any card remnants outside prose (visible or hidden) for resumes without history.
    const knownQuestions = new Set(Array.isArray(tx.questionRows) ? tx.questionRows.filter(id => typeof id === 'string') : []);
    const hasRemnants = el => [...el.querySelectorAll('[role="radiogroup"],button[role="radio"],input[placeholder="Revise options or write your own..."]')]
      .some(node => !node.closest('.prose,pre,code,nav,aside,[role="dialog"]'));
    // Only recognized clarification/tool-only rows may surround the one prose reply. An unanswered,
    // unrecognized or already-answered question card is interaction UI, never a competing final reply candidate.
    const interaction = item => item.questions.length > 0 || cardGroups(item) > 0 || knownQuestions.has(item.row.id) || hasRemnants(item.row.el);
    const replyLike = item => !item.pair && !item.stale && !interaction(item) && (!!item.text || ended(item.row.el));
    const replies = classified.filter(replyLike);
    if (replies.length > 1) fail('AMBIGUOUS_REPLY', `Multiple ungrouped assistant replies followed this prompt. Read the result in Arena; capture stopped rather than guessing.${rowSummary(added, list.length)}`);
    const pairs = classified.filter(item => item.pair);
    // After Skip, Arena writes a new response; the old pair (if still drawn) is history.
    if (pairs.length > 1 || (pairs.length && replies.length && tx.pairChoice !== 'skip'))
      fail('AMBIGUOUS_REPLY', `Arena showed more than one set of responses for this prompt. Read the result in Arena; nothing was chosen.${rowSummary(added, list.length)}`);
    const pair = pairs[0]?.pair || null;
    const proseOnly = classified.filter(item => item.text);
    // A second live text row is normal while a turn is still running; only two completed prose
    // rows are ambiguous, because either could claim to be this prompt's final answer.
    if (!replies.length && proseOnly.length > 1 && proseOnly.some(item => ended(item.row.el)))
      fail('AMBIGUOUS_REPLY', `The assistant produced more than one ungrouped reply for this prompt. Read the result in Arena; capture stopped rather than guessing.${rowSummary(added, list.length)}`);
    if (added[0].user && directEls.has(added[0].el)) {
      for (const item of classified) {
        if (item.pair || item.stale) continue; // a failed side of a pair is shown on the pair card; Skip stays possible
        const problem = directProblem(item.row.el);
        if (problem?.code === 'GENERATION_STOPPED') fail('GENERATION_STOPPED', 'The reply was stopped in Arena before it finished. Nothing was retried; read or rerun it in Arena.');
        if (problem) fail(problem.code, `Arena reported a problem with this reply${problem.text ? `: “${problem.text}”` : ''}. Nothing was retried. Check the Arena tab.`);
      }
    }
    const reply = replies[0];
    if (reply && tx.assistantId && tx.assistantId !== reply.row.id) {
      // The preamble row can look like a plain reply before its cards render (assistantId points at it),
      // then become a question row once they do. When the previously tracked row is now history, the new
      // reply takes over; any other ID change is still a hard stop.
      const prev = classified.find(item => item.row.id === tx.assistantId);
      if (!prev || (!prev.stale && !prev.pair && !interaction(prev) && !knownQuestions.has(tx.assistantId)))
        fail('AMBIGUOUS_REPLY', 'The assistant message ID changed. Capture stopped.');
    }
    const questions = classified.flatMap(item => item.questions);
    if (questions.length > 12) fail('TOO_MANY_QUESTIONS', 'More than twelve clarification cards are visible. Continue in Arena.');
    const liveText = classified.map(item => item.text).filter(Boolean).join('\n\n');
    if (liveText.length > 200000) fail('REPLY_TOO_LARGE', 'Live output exceeds 200,000 characters. Read it in Arena instead.');
    const tools = classified.flatMap(item => item.tools).slice(-100);
    const thinking = assistants.map(row => thinkingStatus(row.el)).filter(Boolean).at(-1) || null;
    const unknownQuestions = classified.some(item => cardGroups(item) > item.questions.length);
    // A response pair completes only after the user's own choice has gone through in Arena: the prompt
    // and Arena's Continue buttons are gone and the chosen response is finished. Nothing is guessed.
    let pairState = null, pairDone = false, pairText = '', pairModel = '', pairEl = null;
    if (pair) {
      const buttons = choiceButtons(doc), ready = pair.sides.every(side => side.done);
      const offered = buttons.a.length === 1 && buttons.b.length === 1;
      const choice = choiceMade ? tx.pairChoice : '';
      const settled = !pair.prompt && !buttons.a.length && !buttons.b.length && !buttons.skip.length;
      const skipOffered = buttons.skip.length === 1;
      pairState = { prompt: pair.prompt, ready, offered, choice,
        enabled: { a: offered && enabled(buttons.a[0]), b: offered && enabled(buttons.b[0]) },
        skip: { offered: skipOffered, enabled: skipOffered && enabled(buttons.skip[0]) },
        sides: pair.sides.map(({ side, label, text, done, failed }) => ({ side, label: label.slice(0, 120), text, done, failed })),
        unknownChoice: !choice && settled && pair.sides.every(side => side.done || side.failed) };
      const chosen = choice && choice !== 'skip' && pair.sides.find(side => side.side === choice);
      if (chosen && settled && chosen.done && !running(doc)) { pairDone = true; pairText = chosen.text; pairModel = chosen.label; pairEl = chosen.el; }
    }
    // An answered card (an option already checked in Arena) no longer blocks completion: the agent has
    // what it asked for and the turn can finish. Unanswered cards (including sensitive ones the panel
    // never touches) and unrecognized card groups still do.
    const pendingQuestions = questions.filter(q => !q.data.answered);
    const pendingCards = classified.some(item => {
      const groups = cardGroups(item);
      if (!groups) return false;
      if (groups > item.questions.length) return true;
      return item.questions.some(q => !q.data.answered);
    });
    const complete = pairDone || (!!reply && ended(reply.row.el) && !running(doc) && !pendingQuestions.length && !pendingCards);
    // The formatted version is only built for a finished reply (it is what the panel keeps).
    const rich = complete ? richOf(pairDone ? pairEl : reply.row.el) : null;
    // v2.8.0: the live preview is formatted too. Rebuilt only when the text changed, at most about twice a
    // second (reading the page structure costs more than reading text); the plain text is always sent.
    let liveRich = null;
    if (!complete && liveText && tx) {
      const now = Date.now();
      if (liveText !== tx.liveRichText && (!tx.liveRichAt || now - tx.liveRichAt >= LIVE_RICH_MS)) {
        const parts = classified.filter(item => item.text).map(item => richOf(item.row.el)).filter(Boolean);
        tx.liveRich = parts.length ? parts.flat(1) : null; // each part is a node list
        tx.liveRichText = liveText; tx.liveRichAt = now;
      }
      // A slightly older formatted copy is fine for a preview; a very stale one is not.
      liveRich = tx.liveRich && tx.liveRichText && liveText.startsWith(tx.liveRichText.slice(0, Math.max(0, tx.liveRichText.length - 200))) ? tx.liveRich : null;
    }
    return { accepted: true, userId: user.id, assistantId: reply?.text ? reply.row.id : pairDone ? pairs[0].row.id : undefined, pair: pairState,
      turnIds: added.map(row => row.id), questionRows: classified.filter(item => item.questions.length).map(item => item.row.id), questions, tools,
      interactionNotice: unknownQuestions ? 'Some question controls do not match the supported card. Answer those in Arena; they will not be clicked here.' : '',
      liveText, liveRich, thinking, generating: running(doc),
      complete, rich,
      text: pairDone ? pairText : reply?.text || '', model: pairDone ? pairModel : reply && directEls.has(reply.row.el) ? modelOf(reply.row.el) : '',
      choice: pairDone ? pairState.choice : reply && choiceMade ? tx.pairChoice : '' };
  }

  // Read-only import of the open conversation's earlier turns, on explicit request only.
  // Each user row is paired with the assistant rows up to the next user row, using the same reply
  // rules as live capture: exactly one plain prose row is the reply; question/tool/summary rows are
  // activity; anything else is reported as unclear instead of guessed. Nothing is clicked or scrolled.
  const HISTORY_MAX_TURNS = 200, HISTORY_MAX_CHARS = 2000000;
  function historyTurns(doc = document) {
    checkBlocks(doc); checkAgent(doc);
    const list = rows(doc);
    const firstUser = list.findIndex(row => row.user);
    const result = { turns: [], startMissing: firstUser !== 0 && list.length > 0, truncated: false, inProgressSkipped: false, total: 0 };
    let chars = 0;
    for (let i = Math.max(firstUser, 0); firstUser >= 0 && i < list.length; i++) {
      if (!list[i].user) continue;
      const user = list[i], assistants = [];
      for (let j = i + 1; j < list.length && !list[j].user; j++) assistants.push(list[j]);
      // The newest turn is still being produced: leave it to live capture instead of importing half of it.
      const isLast = !list.slice(i + 1).some(row => row.user);
      if (isLast && (running(doc) || !assistants.length)) { result.inProgressSkipped = true; break; }
      result.total++;
      const prompt = answerText(user.el);
      const classified = assistants.map(row => ({ row, text: answerText(row.el),
        groups: [...row.el.querySelectorAll('[role="radiogroup"]')].filter(g => visible(g) && !g.closest('.prose,pre,code')).length,
        tools: toolActivity(row.el), thinking: thinkingStatus(row.el) }));
      const replies = classified.filter(item => item.text && !item.groups && !item.row.pair);
      const paired = classified.some(item => item.row.pair);
      const status = !prompt ? 'unreadable' : paired ? 'pair' : replies.length === 1 ? 'complete' : replies.length ? 'ambiguous' : 'no-reply';
      const reply = status === 'complete' ? replies[0].text : '';
      if (result.turns.length >= HISTORY_MAX_TURNS || chars + prompt.length + reply.length > HISTORY_MAX_CHARS) { result.truncated = true; break; }
      chars += prompt.length + reply.length;
      result.turns.push({ userMessageId: user.id, assistantMessageId: status === 'complete' ? replies[0].row.id : undefined,
        prompt, reply, rich: status === 'complete' ? richOf(replies[0].row.el) : null, status, model: status === 'complete' && directEls.has(replies[0].row.el) ? modelOf(replies[0].row.el) : '',
        tools: classified.flatMap(item => item.tools).slice(-100),
        thinking: classified.map(item => item.thinking).filter(Boolean).at(-1) || null });
    }
    return result;
  }
  function historyCount(doc = document) {
    try { return rows(doc).filter(row => row.user).length; } catch { return 0; }
  }

  globalThis.ArenaAgentDOM = { version: '2.9.0', ROW, DomError, fail, visible, checkBlocks, rows, ended, running,
    richOf, userRowText, userRowMatches, composer, sendButton, enabled, reviewPanel, conversationReady, inspectControls, preflight, matchTurn, questionsFor, toolActivity, thinkingStatus, historyTurns, historyCount, answerText, normalize, composerText, writeComposer, composerSummary, fileInputsFor, composerFileInputs, uploadsFor, stageRequestFor, nearComposer, promptMatches,
    pageKind, modeLabel, currentModel, modelCatalog, samePage, choiceButtons, choiceSide, capabilities, securityNotice, reanchor,
    pickerTriggers, repoInfo, pickerDialog, pickersOpen, readPickerOptions, pickPickerOption, closePickerDialog, pickerName };
})();
