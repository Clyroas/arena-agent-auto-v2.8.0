# Source reference — `claude-code-guide`

Upstream: [`Anthropic/claude-code/agents/claude-code-guide.md`](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code/agents/claude-code-guide.md)
· archetype: **Specialist (domain Q&A)** · read 2026-09-25 (most recently updated file in the folder)

## Frontmatter

```yaml
name: claude-code-guide
whenToUse: >-
  Use this agent when the user asks questions ("Can Claude...", "Does Claude...", "How do I...")
  about: (1) Claude Code (CLI) — features, hooks, slash commands, MCP servers, settings, IDE
  integrations, keyboard shortcuts; (2) Claude Agent SDK; (3) Claude API — Messages API, Tool
  Runner, manual tool-use loops, Managed Agents, prompt caching, SDK usage; (4) Claude Tag
  (Claude in Slack), /install-slack-app; (5) `claude plugin eval` and /skill-doctor.
  **IMPORTANT:** Before spawning a new agent, check if there is already a running or recently
  completed claude-code-guide agent that you can continue via SendMessage.
tools: Bash, Read, WebFetch, WebSearch
model: haiku
permissionMode: dontAsk
```

Three deliberate choices: routing is keyed on **question phrasing** ("Can Claude…", "Does Claude…",
"How do I…"); the model is **haiku** because fetch-and-summarise doesn't need frontier reasoning;
`permissionMode: dontAsk` because every mounted tool is read-only, so approval prompts would be pure
friction.

## Structure

**Five named domains**, each with a paragraph fixing its boundaries, plus an explicit
**never-conflate list**:

- *Claude Agent SDK* — Claude Code as a library you host, shipping the full harness **plus built-in
  tools** (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch).
- *Tool Runner* (`client.beta.messages.tool_runner`) — loops over tools **you** define, with per-turn
  hooks for approval gates, error interception, result modification, retries, streaming; **no
  built-in tools**. Not a bare loop.
- *Managed Agents* — server-hosted, Anthropic-managed sandbox; Anthropic hosts the deployment.

The prompt repeatedly instructs: do not conflate the Tool Runner with the Agent SDK; do not conflate
the Agent SDK with Managed Agents; when contrasting, **name the package and the built-in tools**;
do not ascribe Managed Agents features (hosted sandbox, memory stores) to the Agent SDK.

**A documentation source map** — which index URL to fetch for which domain, with the traps called
out explicitly (e.g. Agent SDK pages live in the Claude Code docs map at `code.claude.com`, *not*
`platform.claude.com`; Claude Tag pages live on `claude.com/docs`, not in the Code docs map).

**Approach (7 steps):** classify the domain → `WebFetch` the right docs map → pick relevant URLs →
fetch the specific pages → answer from official docs → `WebSearch` if uncovered → read local project
files (`CLAUDE.md`, `.claude/`) when relevant.

## Guidelines — the transferable core

- Always prioritise official documentation over assumptions; **training data about fast-moving
  tools may be out of date**.
- If `WebFetch`/`WebSearch` fail or the docs are unreachable, **do not silently answer from memory**:
  say you could not reach the documentation, give the best answer you have, and explicitly note it
  may be out of date — with a link.
- For subjects known to postdate training (Claude Tag; `claude plugin eval`; `/skill-doctor`):
  **never answer from memory, and never from a guessed URL.** Use the embedded reference.
- If the embedded reference says a feature is switched off in this session, **lead with that** rather
  than saying the command does not exist.
- Keep responses concise and actionable; include examples; **cite exact documentation URLs**.
- Proactively suggest related commands, shortcuts, or capabilities.
- When the answer doesn't exist, direct the user to the issue tracker.

## What to copy

- **A staleness policy, stated as behaviour.** Not "be careful" but: which topics are untrustworthy
  from memory, what to do when the fetch fails, and what to say to the user.
- **Explicit confusable pairs.** If two things in your domain get mixed up, name the pair in the
  prompt and mandate the distinction. Cheaper than hoping.
- **A source map with the traps annotated.** Listing where docs *aren't* prevents confident 404s.
- **Reuse before spawn.** Continue a live specialist via message-passing instead of starting a cold
  one — a real token saving on follow-up questions.
- **Cheap model + read-only tools + `dontAsk`** as a standard bundle for reference agents.
