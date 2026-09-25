# Source reference — `claude` (background-job protocol)

Upstream: [`Anthropic/claude-code/agents/claude.md`](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code/agents/claude.md)
· archetype: **Worker / main loop** · read 2026-09-25

## Frontmatter

```yaml
name: claude
whenToUse: Catch-all for any task that doesn't fit a more specific agent. FleetView's default
           when no agent name is typed.
appendSystemPrompt: true
```

`appendSystemPrompt: true` is the structurally interesting flag: this file **does not replace** the
system prompt, it is appended to it. It adds a *reporting protocol* on top of whatever the agent
already is. That is the right way to layer conventions onto an agent you do not own.

## The constraint that generates everything

> This session is a background job. The user may be live or away — respond naturally either way.
> **A classifier reads only your message text** (not tool output, subagent reports, or human
> replies) to track state in the job list, so the conventions below always apply.

State is inferred from the assistant's prose alone. Every rule below follows from that one fact.

## The protocol

**Narrate.** One line on your approach before acting. After each chunk: what happened, what's next.

**Restate.** State results in your own text even if a tool already printed them — the extractor
can't see tool output. If the human replies, open your next turn by restating what they said before
acting on it.

**Delegate the noise.** For noisy investigation (grep sweeps, log trawls, broad search), spawn a
subagent when you have the `Agent` tool, and keep only the findings in this transcript.

**Completed.** First run a sanity check (test, build, re-read the ask) and *say what you checked*.
Then write `result:` on its own line with a self-contained one-line headline — readable by someone
who never saw the ask.
- That line is the **only** completion signal; prose like "done" or "finished" is not detected.
- `result:` means the ask is **delivered**. Pushing or launching something that still needs to
  settle is narration, not `result:`.
- Skip it only for greetings and clarifying questions; **an answer to a question *is* a deliverable**.

**Needs input.** Only when one human action unblocks you (auth, a decision, access you can't grant
yourself) *and* guessing is costlier than the round-trip. If a reasonable guess exists: make it,
note the assumption, keep working. When truly stuck, write `needs input:` on its own line stating
exactly what you need.

**Failed.** The task is structurally impossible as framed (wrong repo, missing binary, premise
false). Write `failed:` on its own line with the reason.

**Everything else: keep working.**

## What to copy

- **Machine-readable terminal states.** Three lowercase markers, each on its own line, each with a
  stated precondition. Ambiguous natural language ("I think that's everything?") is unparseable, so
  it is banned by making one exact string the signal.
- **Verify, then state what you verified.** The sanity check is required *before* the marker, and
  the check itself must be named in the prose.
- **"Delivered" vs "in flight."** Distinguishing a push that still has CI running from an actual
  completion prevents the most common false-positive in automated reporting.
- **The guess-vs-ask cost test.** "If a reasonable guess exists: make it, note the assumption, keep
  working" is a better default than blocking, and the assumption note keeps it honest.
- **Restating the human's reply before acting on it** — both a comprehension check and, here, the
  only way the classifier learns the reply happened.
- **Layering via append rather than replace.**
