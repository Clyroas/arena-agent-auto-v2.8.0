import { renderRich } from './rich-view.js';
import { copyText } from './copy.js';
// Live activity. Options are local selections until the user explicitly submits.
export class LiveView {
  constructor(parent, onAnswer, onChoose = () => {}) {
    this.doc = parent.ownerDocument; this.onCopy = copyText; this.onAnswer = onAnswer; this.onChoose = onChoose; this.cards = new Map();
    this.root = this.node('section', 'live-output'); this.root.setAttribute('aria-label', 'Live Agent activity');
    this.heading = this.node('h3', 'live-heading', 'Live activity · not a final answer');
    this.notice = this.node('p', 'live-notice hint');
    this.text = this.node('div', 'live-text'); this.tools = this.node('ul', 'live-tools'); this.questions = this.node('div', 'live-questions');
    this.thinking = this.node('p', 'live-thinking');
    this.pair = this.buildPair();
    this.root.append(this.heading, this.thinking, this.text, this.tools, this.notice, this.questions, this.pair.card); parent.append(this.root); this.root.hidden = true;
  }
  node(tag, className, text = '') { const el = this.doc.createElement(tag); el.className = className; el.textContent = text; return el; }
  createCard(question, turnId) {
    const card = this.node('section', 'question-card'); card.setAttribute('aria-label', question.question);
    const title = this.node('h4', 'question-title', question.question);
    const group = this.node('div', 'question-options'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', question.question);
    const checked = question.options.findIndex(option => option.checked);
    const item = { card, question, buttons: [], selected: checked >= 0 ? checked : null, mode: 'option', submitted: false };
    const refresh = () => {
      const locked = item.locked || item.submitted;
      item.buttons.forEach((button, index) => { button.disabled = locked || question.options[index].disabled; button.setAttribute('aria-checked', String(item.mode === 'option' && item.selected === index)); });
      if (item.input) item.input.disabled = locked;
      item.submit.disabled = locked || (item.mode === 'custom' ? !item.input?.value.trim() : item.selected === null);
      item.submit.textContent = item.mode === 'custom' ? 'Submit custom answer' : 'Submit selected answer';
    };
    question.options.forEach((option, index) => {
      const button = this.node('button', 'question-option'); button.type = 'button'; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false');
      button.append(this.node('strong', '', option.label), this.node('span', '', option.description));
      button.addEventListener('click', () => { item.selected = index; item.mode = 'option'; refresh(); });
      group.append(button); item.buttons.push(button);
    });
    card.append(title, group);
    if (question.custom) {
      const label = this.node('label', 'custom-answer-label', 'Or write your own answer');
      const input = this.node('input', 'custom-answer'); input.type = 'text'; input.maxLength = 2000; input.placeholder = 'Your answer…';
      label.append(input); card.append(label); item.input = input;
      input.addEventListener('input', () => { item.mode = 'custom'; refresh(); });
    }
    item.submit = this.node('button', 'primary question-submit', 'Submit selected answer'); item.submit.type = 'button';
    item.status = this.node('p', 'question-status', 'Nothing is sent until you submit.'); item.status.setAttribute('role', 'status');
    item.submit.addEventListener('click', () => {
      if (item.submit.disabled || item.submitted) return;
      item.submitted = true; item.status.textContent = 'Sending your chosen answer once…'; refresh();
      this.onAnswer(turnId, { token: question.token, kind: item.mode, ...(item.mode === 'custom' ? { text: item.input.value } : { index: item.selected }) });
    });
    card.append(item.submit, item.status); item.refresh = refresh; refresh(); return item;
  }
  // Battles in Direct: Arena shows two anonymous responses and asks which one continues the chat.
  buildPair() {
    const card = this.node('section', 'pair-card'); card.hidden = true; card.setAttribute('aria-label', 'Arena asks which response to continue with');
    const title = this.node('h4', 'pair-title', '');
    const hint = this.node('p', 'pair-hint hint', 'Arena answered with two anonymous responses (Battle in Direct). The one you choose continues this conversation. Nothing is chosen for you.');
    const options = this.node('div', 'pair-options');
    const sides = ['a', 'b'].map(side => {
      const box = this.node('article', 'pair-option'); box.dataset.side = side;
      const label = this.node('h5', 'pair-label', `Response ${side.toUpperCase()}`);
      const text = this.node('div', 'pair-text');
      const button = this.node('button', 'pair-choose', `Continue with ${side.toUpperCase()}`); button.type = 'button';
      button.addEventListener('click', () => { if (!button.disabled) this.onChoose(this.turnId, side); });
      box.append(label, text, button); options.append(box);
      return { side, box, label, text, button };
    });
    const skip = this.node('button', 'pair-skip', 'Skip'); skip.type = 'button'; skip.hidden = true;
    skip.title = 'Skip both responses: Arena writes a new response instead';
    skip.addEventListener('click', () => { if (!skip.disabled) this.onChoose(this.turnId, 'skip'); });
    // Arena shows no Skip: a panel-only way out that never touches Arena (confirmed and worded as such).
    const dismiss = this.node('button', 'pair-dismiss', 'Skip here'); dismiss.type = 'button'; dismiss.hidden = true;
    dismiss.title = 'Stop waiting for a choice in the panel only — nothing is clicked or sent in Arena';
    dismiss.addEventListener('click', () => { if (!dismiss.disabled) this.onChoose(this.turnId, 'dismiss'); });
    const status = this.node('p', 'pair-status', ''); status.setAttribute('role', 'status');
    card.append(title, hint, options, skip, dismiss, status);
    return { card, title, sides, skip, dismiss, status };
  }
  renderPair(pair, active) {
    const view = this.pair;
    view.card.hidden = !pair;
    if (!pair) return;
    for (const item of view.sides) {
      const data = (pair.sides || []).find(side => side.side === item.side) || { label: `Response ${item.side.toUpperCase()}`, text: '', done: false };
      if (item.label.textContent !== data.label) item.label.textContent = data.label;
      const text = data.text || (data.failed ? 'This response failed in Arena.' : data.done ? '' : 'Writing…');
      if (item.text.textContent !== text) item.text.textContent = text;
      item.box.dataset.chosen = String(pair.choice === item.side);
      item.button.disabled = !active || !pair.prompt || !pair.ready || !!pair.busy || !!pair.choice || !pair.enabled?.[item.side];
    }
    view.skip.hidden = !pair.skip?.offered && pair.choice !== 'skip';
    view.skip.disabled = !active || !!pair.busy || !!pair.choice || !pair.skip?.enabled;
    view.skip.dataset.chosen = String(pair.choice === 'skip');
    view.dismiss.hidden = !active || !!pair.skip?.offered || !!pair.choice || !!pair.dismissed;
    view.dismiss.disabled = !!pair.busy;
    const failed = (pair.sides || []).some(side => side.failed);
    view.title.textContent = pair.dismissed ? 'Skipped here · not sent to Arena' : pair.choice === 'skip' ? 'Skipped · waiting for Arena’s new response' : pair.choice ? `Continuing with Response ${pair.choice.toUpperCase()}` : pair.prompt ? 'Which response do you prefer?' : 'Arena is writing two responses';
    const locked = active && pair.prompt && pair.ready && pair.offered && !pair.choice && !pair.enabled?.a && !pair.enabled?.b;
    view.status.textContent = pair.choiceState
      || (!active ? 'Tracking stopped. Choose in Arena.'
        : failed && pair.skip?.offered ? 'A response failed in Arena. Skip to get a new response, or choose in Arena.'
        : !pair.ready ? `Both responses are still being written.${pair.skip?.offered ? ' You can also Skip.' : ''}`
        : locked ? 'Arena unlocks its choice after both responses have been viewed on the page. Open the Arena tab and look at both — or choose there directly.'
        : pair.prompt && !pair.offered ? 'Arena’s Continue buttons are not visible right now. Choose in Arena.'
        : pair.prompt ? 'Nothing is chosen until you click Continue.' : '');
  }
  render(turn, active) {
    this.turnId = turn.id;
    const live = turn.live || { text: '', tools: [], questions: [] };
    const preview = turn.reply ? '' : live.text || '';
    this.heading.textContent = turn.imported ? 'Activity shown on the Arena page' : turn.reply ? 'Activity during this turn' : active ? 'Live activity · not a final answer' : 'Stopped activity · not a final answer';
    // Formatted like Arena while it writes (v2.8.0) when the structure was read; otherwise plain text.
    const rich = preview && live.rich ? live.rich : null;
    if (preview !== this.shownText || rich !== this.shownRich) {
      const formatted = rich ? renderRich(this.doc, rich, { onCopy: this.onCopy }) : null;
      if (formatted) this.text.replaceChildren(formatted); else this.text.textContent = preview;
      this.text.classList.toggle('rich', !!formatted);
      this.shownText = preview; this.shownRich = rich;
    }
    this.text.hidden = !preview;
    const signature = JSON.stringify(live.tools || []);
    if (signature !== this.toolSignature) {
      this.tools.replaceChildren(...(live.tools || []).map(tool => this.node('li', `tool-activity tool-${tool.status}`, `Used ${tool.tool}${tool.duration ? ' · ' + tool.duration : ''}${tool.status === 'error' ? ' · error reported' : tool.status === 'done' ? ' · completed' : ''}`)));
      this.toolSignature = signature;
    }
    this.tools.hidden = !live.tools?.length;
    // Only Arena's visible label is mirrored; its collapsed thought text is never opened or copied.
    const thinking = live.thinking?.label ? `${live.thinking.label} · thought text stays collapsed in Arena` : '';
    if (this.thinking.textContent !== thinking) this.thinking.textContent = thinking;
    this.thinking.hidden = !thinking; this.thinking.dataset.state = live.thinking?.state || '';
    this.notice.textContent = live.interactionNotice || ''; this.notice.hidden = !live.interactionNotice;
    const tokens = new Set((live.questions || []).map(question => question.token));
    for (const [token, item] of this.cards) if (!tokens.has(token)) { item.card.remove(); this.cards.delete(token); }
    for (const question of live.questions || []) {
      let item = this.cards.get(question.token);
      if (!item) { item = this.createCard(question, turn.id); this.cards.set(question.token, item); this.questions.append(item.card); }
      item.locked = !active || question.readOnly || question.busy || !!question.answerState;
      if (question.answerState || question.reason || !active) item.status.textContent = question.answerState || question.reason || 'Tracking stopped. Handle this question in Arena.';
      item.refresh();
    }
    this.renderPair(turn.reply ? null : live.pair || null, active);
    this.root.hidden = !preview && !live.tools?.length && !live.questions?.length && !live.interactionNotice && !thinking && !(live.pair && !turn.reply);
  }
}
