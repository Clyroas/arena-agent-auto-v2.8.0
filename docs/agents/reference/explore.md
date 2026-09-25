# Source reference — `Explore`

Upstream: [`Anthropic/claude-code/agents/Explore.md`](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code/agents/Explore.md)
· archetype: **Scout** · read 2026-09-25

## Frontmatter

```yaml
name: Explore
whenToUse: >-
  Fast read-only search agent for locating code. Use it to find files by pattern
  (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"),
  or answer "where is X defined / which files reference Y." Do NOT use it for code review,
  design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads
  excerpts rather than whole files and will miss content past its read window.
  When calling, specify search breadth: "quick" for a single targeted lookup, "medium" for
  moderate exploration, or "very thorough" to search across multiple locations and naming
  conventions.
whenToUseLean: >-
  Read-only search agent for broad fan-out searches — when answering means sweeping many
  files, directories, or naming conventions and you only need the conclusion, not the file
  dumps. It reads excerpts rather than whole files, so it locates code; it doesn't review
  or audit it. Specify search breadth: "medium" … "very thorough" …
disallowedTools: [Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck,
                  ExitPlanMode, Edit, Write, NotebookEdit]
model: inherit
omitClaudeMd: true
```

Two routing descriptions ship in the same file: `whenToUse` for classic-prompt models,
`whenToUseLean` for lean-prompt models. `model: inherit` is overridden to opus when the main-loop
model sits above opus.

## Environment-dependent body

The upstream note records that the body is **generated per environment**. The captured version is
the native macOS/Linux rendering: the agent receives **no Glob/Grep tools** (its toolset is Bash,
Read, WebFetch, WebSearch, plus orchestration tools), so the guidance points at `find`/`grep` via
Bash. npm/Windows builds render "Use Glob / Use Grep" instead, and Windows swaps the read-only
command list for PowerShell equivalents.

→ Prompt text and mounted tools are one artifact. Never describe a tool the agent doesn't have.

## Prompt, in full structure

1. **Identity** — "a file search specialist … You excel at thoroughly navigating and exploring codebases."
2. **The read-only block** — see [the model, §3](../README.md#3-the-read-only-contract-verbatim-pattern).
3. **Role fence** — "Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have
   access to file editing tools - attempting to edit files will fail."
4. **Strengths** — glob patterns, regex content search, reading and analysing contents.
5. **Guidelines** — `find` for file patterns, `grep` for contents, `Read` when the path is known,
   Bash for read-only ops only (`ls`, `git status`, `git log`, `git diff`, `find`, `grep`, `cat`,
   `head`, `tail`), never `mkdir`/`touch`/`rm`/`cp`/`mv`/`git add`/`git commit`/`npm install`/
   `pip install`; adapt to the caller's thoroughness level; **report as a regular message, never a file**.
6. **Speed clause** — "You are meant to be a fast agent that returns output as quickly as possible":
   be smart about how you search, and **spawn multiple parallel tool calls wherever possible**.

## What to copy

- Anti-cases in the routing description. This is the single highest-value line in the file.
- `omitClaudeMd: true` — a scout doesn't need project memory; it needs a small, fast context.
- Denying `Agent` so scouts can't spawn scouts.
- Explicit parallelism instruction.
- Caller-supplied breadth ("quick" / "medium" / "very thorough").
- Closing the "write my findings to a file" escape hatch.

## Known limits

Excerpt-level reading. It answers *where*, not *whether it's correct*. Route review, audits and
cross-file consistency work to an Architect or Worker with whole-file reads.
