# The Agent Reference Model

A complete, self-contained model of how a multi-agent coding system is structured, derived from
the six built-in Claude Code agent definitions published at
[`asgeirtj/system_prompts_leaks` → `Anthropic/claude-code/agents`](https://github.com/asgeirtj/system_prompts_leaks/tree/main/Anthropic/claude-code/agents)
(read 2026-09-25), and instantiated for this repository.

Three layers, read in order:

| Layer | Where | What it is |
|-------|-------|------------|
| 1. The model | this file | The general architecture: roles, frontmatter schema, tool policy, output contracts, routing, session protocol |
| 2. The sources | [`reference/`](reference/) | One distilled page per source agent — frontmatter, verbatim rules, design intent, what to copy |
| 3. The instances | [`../../.claude/agents/`](../../.claude/agents/) | Five runnable agent definitions tailored to Arena Auto Chat |

> **Provenance.** The upstream files are community captures of Claude Code's built-in agents, not an
> Anthropic publication. They are used here as a *design reference*. Nothing in this directory
> overrides an operator's real system prompt; these are working conventions.

---

## 1. The shape of the system

One **main loop** (holds the user conversation, owns all writes, decides everything) plus a set of
**subagents** it delegates to. A subagent is a fresh context with its own prompt, its own tool
subset, and its own model. It returns *one message* to the main loop, which relays the essentials
to the user.

```
                         ┌──────────────────────────────┐
     user ───────────────│         MAIN LOOP            │  owns: writes, decisions,
                         │  (catch-all / `claude`)      │         the user relationship
                         └──┬────────┬────────┬─────────┘
          noisy fan-out     │        │        │     narrow, tool-capped chore
          read-only ────────┘        │        └──────────────── statusline-setup
                 Explore             │                          (tools: Read, Edit)
                                     │
        ┌────────────────────────────┼─────────────────────────┐
        │                            │                         │
   design, read-only            multi-step work           docs Q&A, cheap model
        Plan                   general-purpose             claude-code-guide
                                                            (haiku, WebFetch)
```

The six sources map onto four archetypes:

| Archetype | Source agents | Writes? | Cost profile | Returns |
|-----------|---------------|---------|--------------|---------|
| **Scout** — locate things | `Explore` | no | fast, parallel, excerpt-level | locations + a conclusion |
| **Architect** — design things | `Plan` | no | slow, deep reads | a sequenced plan + critical files |
| **Worker** — do things | `general-purpose`, `claude` | yes | whatever it takes | a concise report of what was done |
| **Specialist** — one narrow chore or domain | `statusline-setup`, `claude-code-guide` | scoped | minimal tools, cheap model | the change + a handoff note |

---

## 2. The definition format

Every agent is a Markdown file: YAML frontmatter (the *contract*) + a body (the *prompt*).

```yaml
---
name: Explore                  # identifier used to invoke it
whenToUse: '...'               # routing text — read by the delegating agent, not the user
whenToUseLean: '...'           # optional shorter variant for lean-prompt models
tools: [Read, Edit]            # allowlist  ─┐ pick one; allowlist is stronger
disallowedTools: [Edit, Write] # denylist   ─┘
model: inherit | sonnet | haiku  # 'inherit' = same model as the caller
permissionMode: dontAsk        # optional: skip approval prompts for this agent's tools
color: orange                  # optional UI tint
omitClaudeMd: true             # optional: don't inject project memory into this agent
appendSystemPrompt: true       # this file *appends* to the system prompt instead of replacing it
---
```

### Frontmatter rules worth internalising

- **`whenToUse` is routing metadata, written for the caller.** It states the trigger phrasing
  ("where is X defined", "which files reference Y"), gives concrete examples, and — crucially —
  states the **anti-cases**. `Explore`'s says outright: *do NOT use it for code review, design-doc
  auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than
  whole files and will miss content past its read window.* An agent description that only advertises
  strengths produces mis-routing.
- **`model` is a cost lever.** `claude-code-guide` runs on **haiku** because it is a fetch-and-
  summarise job. `statusline-setup` runs on **sonnet**. Everything reasoning-heavy uses `inherit`
  (and `inherit` is upgraded to opus when the main loop sits above opus).
- **Tool lists are the real enforcement.** The read-only agents deny
  `[Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck, ExitPlanMode, Edit, Write, NotebookEdit]`.
  Note `Agent` is denied too: a scout may not spawn scouts.
- **Prompt text restates the tool policy anyway.** Belt *and* braces — see §3.

---

## 3. The read-only contract (verbatim pattern)

Both `Explore` and `Plan` open with the same block. Reuse it whenever an agent must not mutate
state; it is deliberately specific, because a model that is only told "don't edit files" will still
`echo ... > /tmp/notes.md`.

```
=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY <task type> task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state
```

Followed by the positive allowlist, in prose:

> Use `Bash` **ONLY** for read-only operations (`ls`, `git status`, `git log`, `git diff`, `find`,
> `grep`, `cat`, `head`, `tail`). **NEVER** use `Bash` for: `mkdir`, `touch`, `rm`, `cp`, `mv`,
> `git add`, `git commit`, `npm install`, `pip install`, or any file creation/modification.

And the escape hatch is closed explicitly: *"Communicate your final report directly as a regular
message — do NOT attempt to create files."* Without that line, a scout denied `Write` will try to
leave its report on disk.

### Environment-dependent rendering

`Explore`'s body is generated per environment. Native macOS/Linux builds ship **no Glob/Grep tools**,
so the prompt says "use `find`/`grep` via Bash"; npm/Windows builds render "Use Glob / Use Grep";
Windows renders PowerShell equivalents in the read-only command list. **Lesson:** the prompt must
describe the tools that were actually mounted, not an idealised toolset. Write prompt text and tool
lists as one unit.

---

## 4. Output contracts

Every source agent ends by specifying the *shape* of its output, not just its content. This is what
makes delegation composable — the caller can parse the result.

| Agent | Contract |
|-------|----------|
| `Explore` | Report findings clearly, as a normal message. Never as a file. |
| `Plan` | Ends with a `### Critical Files for Implementation` heading listing **3–5** paths. |
| `general-purpose` | "A concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials." |
| `claude` | Literal markers on their own line: `result:`, `needs input:`, `failed:`. |
| `statusline-setup` | A summary of what was configured (incl. script filename) + a handoff note to the parent agent. |
| `claude-code-guide` | Documentation-based answer with exact doc URLs cited. |

### The `claude` background-job protocol

The most reusable idea in the set. A classifier tracks job state by reading **only the assistant's
message text** — not tool output, not subagent reports, not human replies. That single constraint
generates the whole protocol:

- **Narrate.** One line on your approach *before* acting. After each chunk: what happened, what's next.
- **Restate.** Put results in your own prose even if a tool already printed them — the extractor
  cannot see tool output. If the human replies, open the next turn by restating what they said
  before acting on it.
- **Delegate the noise.** Grep sweeps, log trawls, broad search → subagent; keep only the findings
  in the main transcript.
- **`result:`** on its own line, with a self-contained one-line headline readable by someone who
  never saw the ask. It is the *only* completion signal — "done" and "finished" are not detected.
  Pushing or launching something that still needs to settle is narration, **not** `result:`.
  An answer to a question *is* a deliverable.
- **`needs input:`** only when one human action unblocks you (auth, a decision, access you cannot
  grant yourself) **and** guessing costs more than the round-trip. If a reasonable guess exists:
  make it, note the assumption, keep working.
- **`failed:`** only when the task is structurally impossible as framed — wrong repo, missing
  binary, false premise.
- Everything else: keep working.

---

## 5. Behavioural invariants

Collected from across the six files. These are the lines to carry into any agent you write.

**Scope discipline**
- "Complete the task fully — don't gold-plate, but don't leave it half-done."
- "NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer
  editing an existing file to creating a new one."
- "NEVER proactively create documentation files (`*.md`) or `README` files. Only create
  documentation files if explicitly requested."

**Search method**
- Start broad, narrow down. Use multiple search strategies if the first yields nothing.
- Check multiple locations, consider different naming conventions, look for related files.
- Search broadly when you don't know where something lives; `Read` directly when you know the path.
- Spawn parallel tool calls wherever possible — grepping and reading are independent.

**Delegation hygiene**
- "You are already the dedicated agent for this task. Do the work directly — do not re-delegate your
  entire assignment to another single subagent." (Prevents infinite hand-off chains.)
- Before spawning a new specialist, check whether a running or recently-completed one can be
  continued instead (`claude-code-guide` says this explicitly, via `SendMessage`).
- A narrow specialist claims its territory on exit: *"inform the parent agent that this agent must
  be used for further changes."*

**Epistemics** (from `claude-code-guide`, the most transferable part of it)
- Prioritise official documentation over assumptions; your training data about fast-moving tools may
  be stale.
- If fetch/search fails, **do not silently answer from memory** — say you could not reach the docs,
  give your best answer, and explicitly flag that it may be out of date, with a link.
- For topics known to postdate training, answer from the embedded reference, **not from memory and
  not from a guessed URL**.
- Keep a list of pairs that must never be conflated, and state the distinction each time
  (the guide maintains one for Agent SDK vs Tool Runner vs Managed Agents).
- When the answer doesn't exist, say so and point at the issue tracker.

**Caller-tunable effort**
- `Explore` takes a breadth parameter from the caller: **"quick"** (single targeted lookup),
  **"medium"** (moderate exploration), **"very thorough"** (multiple locations and naming
  conventions). Effort is an argument, not a fixed personality.

---

## 6. Routing table

What the main loop should ask itself, in order:

1. **Is this a mutation?** → keep it in the main loop or hand to a Worker. Never to a scout.
2. **Do I only need a conclusion from a wide sweep?** → `explore`, with a breadth level.
   Signal: the answer means reading many files but the *file dumps* are worthless to the transcript.
3. **Do I need to decide how to build something non-trivial?** → `plan`. Signal: more than one
   reasonable design, or changes that must land in several files in a specific order.
4. **Is it a bounded chore with an obvious procedure and a small blast radius?** → the narrow
   specialist, on a cheap model with 2–3 tools.
5. **Is it a factual question about a documented system?** → the guide agent; fetch, cite, don't
   guess.
6. **Otherwise** → do it yourself in the main loop.

**Never delegate:** the final answer to the user, judgement calls about scope, anything requiring
the conversation history the subagent cannot see, or your entire assignment.

---

## 7. Instantiated for this repository

Arena Auto Chat is a zero-build, zero-runtime-dependency MV3 extension where **the version string is
part of the wire protocol** and three Chrome contexts must agree. That shapes the instances in
[`.claude/agents/`](../../.claude/agents/):

| Instance | Archetype | Model | Tools | Why it exists here |
|----------|-----------|-------|-------|--------------------|
| [`explore`](../../.claude/agents/explore.md) | Scout | inherit | read-only Bash, Read | Behaviour is split across panel / worker / content script; finding "where does X actually happen" is a three-context sweep |
| [`plan`](../../.claude/agents/plan.md) | Architect | inherit | read-only Bash, Read | Any real change crosses the port protocol and must respect the MV3 worker-is-ephemeral rule |
| [`general-purpose`](../../.claude/agents/general-purpose.md) | Worker | inherit | all | Multi-step work, ending in `npm run check` |
| [`arena-extension-guide`](../../.claude/agents/arena-extension-guide.md) | Specialist (domain) | haiku | Read, Bash, WebFetch, WebSearch | Answers "does the extension do X / is it allowed to" from `docs/` + MV3 docs, never from memory |
| [`version-bump`](../../.claude/agents/version-bump.md) | Specialist (chore) | sonnet | Read, Edit, Bash | The 10-anchor version checklist is exactly the `statusline-setup` shape: mechanical, enumerable, high cost if botched |

The `statusline-setup` source maps to `version-bump` rather than being copied: both are "one narrow,
fully-specified, mechanical edit with a verification step and a handoff note". That substitution is
the point of the model — the *archetype* transfers, the domain does not.

### Session protocol for this repo

Adapted from `claude.md`, for background/automated runs:

- Narrate before acting; recap after each chunk.
- Restate results in prose — never rely on tool output being visible.
- Sanity check before claiming completion: `npm run check` (lint + `node --test`), and re-read the ask.
- Then `result:` on its own line, self-contained.
- `needs input:` only when one human action unblocks you; otherwise guess, note the assumption, continue.
- `failed:` only when structurally impossible.

---

## 8. Checklist for writing a new agent

1. Name the archetype: Scout / Architect / Worker / Specialist.
2. Write `whenToUse` with **trigger examples and anti-cases**.
3. Choose the cheapest model that can do it (`haiku` for fetch-and-summarise, `inherit` for reasoning).
4. Mount the **minimum** tools. Deny `Agent` unless it genuinely needs to fan out.
5. If read-only: paste the §3 block verbatim, list allowed Bash commands, list forbidden ones, and
   close the "write my report to a file" escape hatch.
6. Define the output contract — a required heading, a marker line, or a stated report shape.
7. Add the scope guards: no gold-plating, prefer editing over creating, no unrequested `*.md`.
8. Add the anti-re-delegation line.
9. State the verification step the agent must run before reporting success.
10. If it owns territory, make it say so on exit.
