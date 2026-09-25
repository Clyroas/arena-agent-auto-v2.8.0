# Source reference — `Plan`

Upstream: [`Anthropic/claude-code/agents/Plan.md`](https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code/agents/Plan.md)
· archetype: **Architect** · read 2026-09-25

## Frontmatter

```yaml
name: Plan
whenToUse: >-
  Software architect agent for designing implementation plans. Use this when you need to plan
  the implementation strategy for a task. Returns step-by-step plans, identifies critical files,
  and considers architectural trade-offs.
disallowedTools: [Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck,
                  ExitPlanMode, Edit, Write, NotebookEdit]
model: inherit
```

Same denylist as `Explore` — including `ExitPlanMode`, so the planner cannot promote itself out of
planning. Note it does **not** set `omitClaudeMd`: an architect *does* want project conventions.

## Prompt structure

1. **Identity** — "a software architect and planning specialist … Your role is to explore the
   codebase and design implementation plans."
2. **The read-only block**, worded for a "READ-ONLY planning task".
3. **Input contract** — "You will be provided with a set of requirements and optionally a
   **perspective** on how to approach the design process." The perspective is a caller-supplied
   lens (e.g. "minimise blast radius", "optimise for testability"); several `Plan` agents can be run
   in parallel with different perspectives on the same requirements.

### Process (verbatim headings)

1. **Understand Requirements** — focus on the requirements given; apply the assigned perspective throughout.
2. **Explore Thoroughly**
   - Read any files provided in the initial prompt
   - Find existing patterns and conventions using `find`, `grep`, `Read`
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths
   - Read-only Bash allowlist / denylist (identical to `Explore`)
3. **Design Solution** — approach per the perspective; consider trade-offs and architectural
   decisions; follow existing patterns where appropriate.
4. **Detail the Plan** — step-by-step strategy; dependencies and sequencing; anticipated challenges.

### Required output

```markdown
### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- `path/to/file1.ts`
- `path/to/file2.ts`
- `path/to/file3.ts`
```

Then a closing reminder in caps: *"REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT
write, edit, or modify any files. You do NOT have access to file editing tools."*

## What to copy

- **The bounded output artifact.** "3–5 files" is a forcing function: it makes the planner commit to
  a blast radius instead of hedging, and gives the implementing agent an immediate read list.
- **"Identify similar features as reference."** The cheapest way to get a plan that matches house
  style is to make the planner find the precedent first.
- **The pluggable perspective**, enabling parallel competing plans.
- **Repeating the constraint at the end.** Long prompts decay in the middle; the final line is
  prime real estate.
- Keeping project memory (unlike the scout) — architecture decisions depend on local conventions.
