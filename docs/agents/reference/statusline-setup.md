# Source reference — `statusline-setup`

Upstream: [`Anthropic/claude-code/agents/statusline-setup.md`](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code/agents/statusline-setup.md)
· archetype: **Specialist (narrow chore)** · read 2026-09-25

## Frontmatter

```yaml
name: statusline-setup
whenToUse: Use this agent to configure the user's Claude Code status line setting.
tools: [Read, Edit]
model: sonnet
color: orange
```

The tightest contract in the set: an **allowlist** of exactly two tools, a one-sentence trigger, a
mid-tier model. It cannot search, cannot run commands, cannot create files. The blast radius is one
settings file.

## The prompt is a procedure, not a personality

**Import path (6 numbered steps)**

1. Read shell config in a fixed order of preference: `~/.zshrc` → `~/.bashrc` → `~/.bash_profile` → `~/.profile`.
2. Extract `PS1` with a **given regex**: `/(?:^|\n)\s*(?:export\s+)?PS1\s*=\s*["']([^"']+)["']/m`
3. Convert escape sequences with a **given lookup table**: `\u`→`$(whoami)`, `\h`→`$(hostname -s)`,
   `\H`→`$(hostname)`, `\w`→`$(pwd)`, `\W`→`$(basename "$(pwd)")`, `\t`→`$(date +%H:%M:%S)`,
   `\d`→`$(date "+%a %b %d")`, `\@`→`$(date +%I:%M%p)`, …
4. Use `printf` for ANSI colours. **Do not remove colours** (the line renders dimmed).
5. Strip trailing `"$"` / `">"` from the imported prompt.
6. If no `PS1` is found and no other instruction was given, **ask** for further instructions.

**Interface documentation** — the full JSON payload delivered on stdin is specified inline: session
and prompt ids, transcript path, cwd, `model`, `workspace` (dirs, worktree, repo owner/name),
`version`, `output_style`, `context_window` (token counts, size, and **pre-calculated**
`used_percentage` / `remaining_percentage`), `effort`, `thinking`, `rate_limits` (5-hour, 7-day,
gateway spend), `prompt_cache` (warm, caching_observed, ttl, hit_ratio, miss counts and a closed set
of diagnosed miss causes), `vim`, `agent`, `pr` (GitHub PR or GitLab MR), `worktree`.

**Ten worked `jq` recipes** — context remaining, rate limits, cold-cache detection, repo slug, PR
badge. Each is a copy-paste one-liner, and each encodes a gotcha, e.g.:

> gate on `caching_observed` so a provider that reports no cache tokens is not shown as cold; read
> booleans with `== true` / `== false`, not `// empty` — jq's `//` treats `false` as absent.

**Write path** — long commands go to `~/.claude/statusline-command.sh`; update
`~/.claude/settings.json` with `{"statusLine": {"type": "command", "command": "…"}}`; **if the
settings file is a symlink, update the target instead**.

**Exit guidelines**
- Preserve existing settings when updating.
- Return a summary of what was configured, including the script filename if one was used.
- Git commands in the script should skip optional locks.
- **"At the end of your response, inform the parent agent that this `statusline-setup` agent must be
  used for further status line changes."**
- Tell the user they can keep asking Claude to change it.

## What to copy

- **Enumerate the mechanical steps.** When a task has a known correct procedure, ship the procedure —
  the regex, the lookup table, the file order — instead of hoping the model re-derives it.
- **Document the interface the agent is coding against**, exhaustively, inside the prompt.
- **Encode the gotchas next to the recipe** that trips over them.
- **Preserve, don't overwrite**, and follow symlinks to the real target.
- **Ask when the input is missing**, rather than inventing a default.
- **Territory handoff.** Telling the parent "route future changes here" keeps a specialised,
  well-tested path from being bypassed by an improvising main loop.
- **Minimum tools + mid model.** A procedure this explicit does not need a frontier model.

## The archetype transfer

In this repository the analogue is [`version-bump`](../../../.claude/agents/version-bump.md): ten
enumerated anchors, a source of truth (`manifest.json`), a verification command
(`node --test test/version-sync.test.mjs`), and a high cost for getting it wrong (the version string
is part of the wire protocol — a missed anchor disables the extension at runtime with
`VERSION_MISMATCH` / `SCRIPT_REGISTRATION_FAILED`). Same shape, different domain.
