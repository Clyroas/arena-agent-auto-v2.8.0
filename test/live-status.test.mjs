import test from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, latestSentence, liveStatus } from '../live-status.js';

const NOW = 1_700_000_000_000;
const turn = (extra = {}) => ({ status: 'waiting', acceptedAt: NOW - 65_000, lastActivityAt: NOW - 1000, live: {}, ...extra });

test('formatElapsed reads as a clock, not a raw second count', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(9_400), '0:09');
  assert.equal(formatElapsed(65_000), '1:05');
  assert.equal(formatElapsed(3_725_000), '1:02:05');
  assert.equal(formatElapsed(-5), '0:00');
  assert.equal(formatElapsed('nonsense'), '0:00');
});

test('latestSentence keeps a readable tail', () => {
  assert.equal(latestSentence(''), '');
  assert.equal(latestSentence('One line only'), 'One line only');
  assert.equal(latestSentence('First sentence. Second one here.'), 'Second one here.');
  // A two-word fragment after a full stop is joined to the sentence before it.
  assert.equal(latestSentence('A full first sentence. Yes.'), 'A full first sentence. Yes.');
  assert.equal(latestSentence('x'.repeat(400), 20).startsWith('…'), true);
  assert.ok(latestSentence('x'.repeat(400), 20).length <= 21);
});

test('no turn, no status', () => {
  assert.equal(liveStatus(null, NOW), null);
});

test('states are named for the user, not for the adapter codes', () => {
  assert.equal(liveStatus(turn({ status: 'error' }), NOW).kind, 'error');
  assert.equal(liveStatus(turn({ phase: 'reconnecting' }), NOW).step, 'Reconnecting to Arena');
  assert.equal(liveStatus(turn({ status: 'sending', phase: 'upload' }), NOW).step, 'Uploading your files');
  assert.equal(liveStatus(turn({ status: 'sending', phase: 'review' }), NOW).kind, 'sending');
  assert.equal(liveStatus(turn({ status: 'sending' }), NOW).step, 'Sending your message');
});

test('elapsed time and quiet time are reported without ever claiming progress', () => {
  const status = liveStatus(turn({ lastActivityAt: NOW - 30_000 }), NOW);
  assert.match(status.meta, /1:05 elapsed/);
  assert.match(status.meta, /last change 0:30 ago/);
  assert.doesNotMatch(liveStatus(turn({ lastActivityAt: NOW - 5_000 }), NOW).meta, /last change/);
});

test('a reply pair, a question card and an unoperated control each get their own wording', () => {
  assert.equal(liveStatus(turn({ live: { pair: { prompt: 'Which?', ready: true } } }), NOW).kind, 'question');
  assert.equal(liveStatus(turn({ live: { pair: { prompt: '', ready: false } } }), NOW).step, 'Writing two responses');
  assert.equal(liveStatus(turn({ live: { questions: [{ token: 't' }] } }), NOW).step, 'Waiting for your answer');
  assert.equal(liveStatus(turn({ live: { interactionNotice: 'Arena shows something' } }), NOW).step, 'Waiting for you in Arena');
  assert.equal(liveStatus(turn({ pairChoice: 'skip', live: {} }), NOW).step, 'Waiting for Arena’s new response');
  assert.match(liveStatus(turn({ pairChoice: 'a', live: {} }), NOW).step, /Continuing with your choice/);
});

test('activity, tools and finished steps are summarized from what Arena shows', () => {
  const thinking = liveStatus(turn({ live: { thinking: { state: 'active', label: 'Thinking…' } } }), NOW);
  assert.equal(thinking.step, 'Thinking');
  const tool = liveStatus(turn({ live: { tools: [{ tool: 'Bash', status: 'activity', duration: '12s' }] } }), NOW);
  assert.equal(tool.step, 'Using Bash · 12s');
  const writing = liveStatus(turn({ textChangedAt: NOW - 500, live: { text: 'Streaming along. More text here.', generating: true } }), NOW);
  assert.equal(writing.step, 'Writing');
  assert.match(writing.detail, /More text here\./);
  const done = liveStatus(turn({ live: { text: 'Answer text', thinking: { state: 'done', label: 'Thought for 4s' } } }), NOW);
  assert.equal(done.step, 'Finishing up');
  assert.match(done.detail, /Thought for 4s/);
});

test('a security verification pauses the status instead of reporting a stop', () => {
  const held = liveStatus(turn({ securityHold: true }), NOW);
  assert.equal(held.step, 'Waiting for verification');
  assert.equal(held.kind, 'blocked');
  assert.match(held.detail, /resumes on its own/i);
  // It must outrank the ordinary "working" summaries while held.
  const alsoLive = liveStatus(turn({ securityHold: true, live: { text: 'Streaming along.', generating: true }, textChangedAt: NOW - 500 }), NOW);
  assert.equal(alsoLive.kind, 'blocked');
  // A genuine error is still reported as a stop.
  assert.equal(liveStatus(turn({ securityHold: true, status: 'error' }), NOW).kind, 'error');
});

test('while nothing visible has happened the panel says so and keeps waiting', () => {
  const idle = liveStatus(turn({ live: { generating: true } }), NOW);
  assert.equal(idle.step, 'Working');
  assert.equal(idle.kind, 'working');
  const quiet = liveStatus(turn({ live: {} }), NOW);
  assert.match(quiet.detail, /Waiting for Arena’s first visible update/);
});
