# Agent skills

Production-grade engineering skills for AI coding agents, vendored from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT). Pin and refresh notes: [SOURCE.md](SOURCE.md).

```
.agents/
  skills/        25 SKILL.md workflows (plus a few skill-local references/scripts)
  references/    shared checklists the skills link to
  commands/      lifecycle entry points (spec, plan, build, test, review, ship, …)
  LICENSE        MIT (Addy Osmani)
```

Agents that speak the [Agent Skills](https://agentskills.io/specification) spec discover these under `.agents/skills/`. Agents that only read `AGENTS.md` are told to open the matching `SKILL.md` — there is no separate skill tool in Arena Agent Mode.

These files never enter the unpacked extension. They exist so coding agents working on this repository follow the same engineering lifecycle.
