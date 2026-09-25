// Dev-only motion preview. NOT part of the extension: nothing in manifest.json references this folder.
//
// It loads the real panel.html and panel.css, injects the real panel.js, and answers its Chrome API calls
// with a fake service worker and a fake Arena port. Everything on screen is then produced by the
// production code paths - ConversationView, LiveView, live-status, rich-view, the notice and dialog
// logic - so the animations can be judged against the real interface instead of a mock-up. No network
// requests, no chat content stored, and no Arena tab is touched.
//
//   python3 -m http.server 8080     (or any static server)   →   /dev/preview.html

const wait = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const log = line => {
  const box = document.getElementById('dev-log');
  if (!box) return;
  const row = document.createElement('div');
  row.textContent = line;
  box.append(row);
  while (box.children.length > 6) box.firstElementChild.remove();
  console.info('[preview]', line);
};

const URL_AGENT = 'https://arena.ai/agent';
const tab = { id: 1, windowId: 1, title: 'Arena · Agent Mode', url: URL_AGENT, discarded: false, status: 'complete' };

// ---------- fake Arena content-script port --------------------------------------
let portHandler = null;
let run = null; // per-send handlers the current act installs (answer/choose)
const sent = [];
const usedSends = new Set();

const port = {
  name: 'arena-agent-content-v3',
  posted: [],
  onMessage: { addListener: fn => { portHandler = fn; } },
  onDisconnect: { addListener: () => {} },
  postMessage(message) {
    if (message.type === 'SEND') { sent.push(message); run = { requestId: message.requestId }; }
    if (message.type === 'PROBE') emitReady();
    if (message.type === 'PING') emit({ type: 'PONG' });
    if (message.type === 'MODEL') emit({ type: 'MODEL_INFO', url: URL_AGENT, pageKind: 'agent', model: '', models: [] });
    if (message.type === 'ANSWER_QUESTION') run?.answer?.(message);
    if (message.type === 'CHOOSE_RESPONSE') run?.choose?.(message);
    if (message.type === 'LOAD_HISTORY') emitHistory(message.requestId);
    if (message.type === 'CANCEL') emit({ type: 'CANCELLED', requestId: message.requestId });
  },
  disconnect() {}
};
function emit(event) { portHandler?.({ documentId: 'dev-document', adapterVersion: '2.8.0', ...event }); }
function emitReady() {
  emit({ type: 'READY', url: URL_AGENT, inputKind: 'textarea', reviewPending: false, uploadKind: 'input', fileInputCount: 1, historyCount: 3,
    pageKind: 'agent', model: '', models: [], blocked: '' });
}
// Waits for the SEND the panel just posted (with attachments it is posted after a worker round-trip).
async function nextSend() {
  for (let i = 0; i < 80; i++) {
    const message = sent.find(item => !usedSends.has(item.requestId));
    if (message) { usedSends.add(message.requestId); return message.requestId; }
    await wait(50);
  }
  throw new Error('the panel never posted a SEND');
}

// ---------- fake service worker -------------------------------------------------
const worker = {
  LIST_TABS: () => ({ ok: true, value: [tab] }),
  GET_TAB: () => ({ ok: true, value: tab }),
  FOCUS_TAB: () => ({ ok: true, value: true }),
  ATTACH: () => ({ ok: true, value: { documentId: 'dev-document' } }),
  STAGE_GRANT: () => ({ ok: true, value: true }),
  STAGE_REVOKE: () => ({ ok: true, value: true }),
  OPEN_ARENA: () => ({ ok: true, value: { id: 2 } }),
  OPEN_FLOATING: () => ({ ok: true, value: true }),
  NAVIGATE_TAB: () => ({ ok: true, value: true })
};

globalThis.chrome = {
  runtime: {
    id: 'dev-preview',
    lastError: undefined,
    getURL: path => new URL(`../${path}`, import.meta.url).href,
    sendMessage: async message => worker[message?.type]?.() ?? { ok: true, value: true }
  },
  tabs: {
    connect: () => port,
    create: async ({ url }) => { window.open(url, '_blank', 'noopener'); return { id: 99 }; },
    update: async () => ({}),
    query: async () => [tab],
    onUpdated: { addListener: () => {}, removeListener: () => {} },
    onRemoved: { addListener: () => {}, removeListener: () => {} }
  },
  permissions: {
    contains: async () => false,
    request: async () => false,
    remove: async () => false,
    onAdded: { addListener: () => {} }, onRemoved: { addListener: () => {} }
  },
  windows: { getCurrent: async () => ({ id: 1, type: 'normal' }), update: async () => ({}), onBoundsChanged: { addListener: () => {}, removeListener: () => {} } },
  scripting: { executeScript: async () => [] }
};

// ---------- load the real panel -------------------------------------------------
const panelUrl = new URL('../panel.html', import.meta.url);
const asset = path => new URL(path, panelUrl).href;
document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: asset('../panel.css') }));
document.head.append(Object.assign(document.createElement('base'), { href: new URL('../', panelUrl).href }));

const load = (src, type = '') => new Promise((resolve, reject) => {
  const script = Object.assign(document.createElement('script'), { src, ...(type ? { type } : {}) });
  script.onload = resolve;
  script.onerror = () => reject(new Error(`${src} failed to load`));
  document.body.append(script);
});

async function boot() {
  const response = await fetch(panelUrl);
  if (!response.ok) throw new Error(`panel.html could not be fetched (${response.status}). Serve this folder over http:// (for example: python3 -m http.server 8080), not file://`);
  const markup = await response.text();
  // The body tag carries attributes (<body data-sheet="open">), so match the tag, not a literal string.
  const body = markup.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  if (!body.includes('id="prepare"')) throw new Error('panel.html did not contain the panel markup');
  document.body.insertAdjacentHTML('afterbegin', body.replace(/<script[\s\S]*?<\/script>/g, ''));
  await load(asset('theme.js'));
  await load(asset('customization.js'));
  await load(asset('panel.js'), 'module');
}

// A dev harness must never fail silently: if anything throws, say so on the page.
function fail(error) {
  console.error('[preview]', error);
  const box = document.getElementById('dev-bar');
  if (box) box.innerHTML = '';
  const message = document.createElement('span');
  message.className = 'dev-label';
  message.textContent = `Preview failed: ${error?.message || error}`;
  (box || document.body).append(message);
  const log = document.getElementById('dev-log');
  if (log) { log.style.pointerEvents = 'auto'; log.textContent = String(error?.stack || error); }
}

// ---------- connect to the fake tab ---------------------------------------------
const $ = id => document.getElementById(id);
try { await boot(); } catch (error) { fail(error); throw error; }
const until = async (predicate, tries = 100) => { for (let i = 0; i < tries; i++) { if (predicate()) return true; await wait(50); } return false; };
await until(() => $('tabs').value === '1');
$('confirmed').checked = true;
$('authorize').checked = true;
$('confirmed').dispatchEvent(new Event('change'));
$('connect').click();
await until(() => $('connected').hidden === false);
log('connected to the fake Arena tab');

// ---------- scenario helpers ----------------------------------------------------
const emitAfter = (ms, event) => wait(ms).then(() => emit(event));
const userId = requestId => `user-${requestId.slice(0, 8)}`;
const toolList = count => Array.from({ length: count }, (_, index) => ({ tool: 'Bash', duration: `${3 + index * 2}s`, status: index === count - 1 ? 'activity' : 'done' }));

async function streamReply(requestId, text, { rich = null, model = '', tools = 0, thinking = false } = {}) {
  await emitAfter(150, { type: 'SENDING', requestId });
  await emitAfter(250, { type: 'ACCEPTED', requestId, userMessageId: userId(requestId) });
  if (thinking) await emitAfter(320, { type: 'LIVE_UPDATE', requestId, text: '', rich: null, tools: [], questions: [], interactionNotice: '', thinking: { state: 'active', label: 'Thinking…' }, generating: true, pair: null });
  for (let step = 1; step <= tools; step++) {
    await emitAfter(560, { type: 'LIVE_UPDATE', requestId, text: '', rich: null, tools: toolList(step), questions: [], interactionNotice: '', thinking: { state: step > 1 ? 'done' : 'active', label: step > 1 ? `Thought for ${step + 2}s` : 'Thinking…' }, generating: true, pair: null });
  }
  const words = text.split(' ');
  for (let size = 2; size <= words.length; size += 3) {
    await emitAfter(170, { type: 'LIVE_UPDATE', requestId, text: words.slice(0, size).join(' '), rich: null, tools: tools ? toolList(tools) : [], questions: [], interactionNotice: '', thinking: tools ? { state: 'done', label: 'Thought for 4s' } : null, generating: true, pair: null });
  }
  await emitAfter(450, { type: 'COMPLETE', requestId, userMessageId: userId(requestId), assistantMessageId: `assistant-${requestId.slice(0, 8)}`, text, rich, url: URL_AGENT, model, choice: '' });
}

async function send(text) {
  $('prompt').value = text;
  $('prompt').dispatchEvent(new Event('input'));
  await wait(80);
  $('prepare').click();
  return nextSend();
}

const RICH = [
  ['h3', {}, 'Streaming, captured live'],
  ['p', {}, 'The panel mirrors what Arena shows while it writes, then keeps the finished reply.'],
  ['ul', {}, ['li', {}, 'Live text with a writing caret'], ['li', {}, 'Tool steps as they arrive'], ['li', {}, 'Question cards when Arena asks']],
  ['pre', { lang: 'js' }, 'chrome.tabs.connect(tabId, { name: "arena-agent-content-v3" });']
];
const RICH_TEXT = RICH.map(node => (typeof node[2] === 'string' ? node[2] : '')).join('\n');

function emitHistory(requestId) {
  emit({ type: 'HISTORY', requestId, url: URL_AGENT, startMissing: false, truncated: false, inProgressSkipped: false, turns: [
    { userMessageId: 'old-1', assistantMessageId: 'old-a1', prompt: 'Summarize yesterday’s standup.', reply: 'Three items were closed and one is blocked on review.', rich: null, status: 'complete', model: '', tools: [], thinking: null },
    { userMessageId: 'old-2', assistantMessageId: 'old-a2', prompt: 'Draft the follow-up email.', reply: 'Drafted and saved to the workspace.', rich: null, status: 'complete', model: '', tools: [], thinking: null },
    { userMessageId: 'old-3', assistantMessageId: undefined, prompt: 'What changed in the API?', reply: '', rich: null, status: 'ambiguous', model: '', tools: [], thinking: null }
  ] });
}

// ---------- the scenarios the dev bar runs --------------------------------------
const acts = {
  async reply() {
    await streamReply(await send('How does this extension capture a reply?'), 'The reply is read from your own Arena tab and mirrored here.', { thinking: true });
    await wait(600);
    await streamReply(await send('Show me a formatted reply.'), RICH_TEXT, { rich: RICH, model: 'GPT-5' });
    log('plain reply, then a formatted one');
  },
  async tools() {
    await streamReply(await send('Run the tests and summarize.'), 'Both suites passed: 70 tests, 0 failures.', { tools: 3, thinking: true });
    log('three tool steps, each sliding in as it starts');
  },
  async question() {
    const requestId = await send('Set up the project database.');
    run = {
      answer: message => {
        emit({ type: 'QUESTION_SENT', requestId, token: message.token });
        setTimeout(() => emit({ type: 'LIVE_UPDATE', requestId, text: 'Using Postgres with migrations.', rich: null, tools: [], questions: [], interactionNotice: '', thinking: null, generating: true, pair: null }), 500);
        setTimeout(() => emit({ type: 'COMPLETE', requestId, userMessageId: userId(requestId), assistantMessageId: 'assistant-question', text: 'Using Postgres with migrations.', rich: null, url: URL_AGENT, model: '', choice: '' }), 1500);
      }
    };
    emit({ type: 'SENDING', requestId });
    await emitAfter(250, { type: 'ACCEPTED', requestId, userMessageId: userId(requestId) });
    await emitAfter(420, { type: 'LIVE_UPDATE', requestId, text: '', rich: null, tools: [], interactionNotice: '', thinking: { state: 'active', label: 'Thinking…' }, generating: true, pair: null,
      questions: [{ token: 'q-db', question: 'Which database should this project use?', custom: true, readOnly: false, reason: '', busy: false, answerState: '',
        options: [{ label: 'Postgres', description: 'Managed instance with migrations', disabled: false, checked: false },
          { label: 'SQLite', description: 'A local file, no server needed', disabled: false, checked: false }] }] });
    log('question card slid in — pick an option and submit it');
  },
  async pair() {
    const requestId = await send('Which of the two answers is better?');
    run = {
      choose: message => {
        emit({ type: 'CHOICE_SENT', requestId, side: message.side });
        setTimeout(() => emit({ type: 'COMPLETE', requestId, userMessageId: userId(requestId), assistantMessageId: 'assistant-pair', text: 'Continuing with the response you chose.', rich: null, url: URL_AGENT, model: '', choice: message.side }), 800);
      }
    };
    emit({ type: 'SENDING', requestId });
    await emitAfter(250, { type: 'ACCEPTED', requestId, userMessageId: userId(requestId) });
    await emitAfter(520, { type: 'LIVE_UPDATE', requestId, text: '', rich: null, tools: [], questions: [], interactionNotice: '', thinking: null, generating: false,
      pair: { prompt: 'Which response do you prefer?', ready: true, offered: true, choice: '', unknownChoice: false, enabled: { a: true, b: true }, skip: { offered: true, enabled: true },
        sides: [{ side: 'a', label: 'Response A', text: 'The database is Postgres.', done: true, failed: false },
          { side: 'b', label: 'Response B', text: 'This project uses Postgres: a managed relational database with migrations, backups and point-in-time recovery available out of the box.', done: true, failed: false }] } });
    log('response pair slid in — Continue with A/B opens the confirm dialog');
  },
  async error() {
    const requestId = await send('Summarize the last deployment.');
    emit({ type: 'SENDING', requestId });
    await emitAfter(250, { type: 'ACCEPTED', requestId, userMessageId: userId(requestId) });
    await emitAfter(700, { type: 'ERROR', requestId, code: 'RATE_LIMIT', clicked: true, accepted: true,
      message: 'Arena is limiting requests. Follow the wait time in the Arena tab. No automatic retry was attempted.' });
    log('capture stopped with a rate limit — no retry, by design');
  },
  async attach() {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Arena Auto Chat motion preview.\n'], 'arena-agent-notes.txt', { type: 'text/plain' }));
    const input = $('attachment-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    log('staged a file — the chip pops in and Send grows its label');
    await wait(1000);
    await streamReply(await send('Keep this file in mind.'), 'Noted: arena-agent-notes.txt is staged beside the message.');
  },
  async history() {
    $('load-history').click();
    log('earlier turns imported above this session');
  }
};

document.getElementById('dev-bar').addEventListener('click', async event => {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  for (const other of button.parentElement.querySelectorAll('button')) other.dataset.active = String(other === button);
  try { await acts[button.dataset.act](); }
  catch (error) { log(`act failed: ${error.message}`); console.error(error); }
  button.dataset.active = 'false';
});

// A short tour on load, then the dev bar takes over.
try {
  await acts.reply();
  await wait(700);
  await acts.tools();
  log('ready — pick a scenario above');
} catch (error) {
  fail(error);
}
