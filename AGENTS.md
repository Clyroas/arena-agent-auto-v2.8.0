# AGENTS.md

Guidance for AI coding agents working in this repository (Arena Agent Mode, Claude Code, Cursor, Codex, and others).

This is **Arena Auto Chat**, a Manifest V3 Chrome extension that drives [arena.ai](https://arena.ai) from a side panel. There is no build step and no runtime dependencies. Chat never leaves Arena's own page. Fail closed: never guess, never retry a click, never resend.

## Skills pack

The [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) pack is vendored at [`.agents/`](.agents/README.md) (plugin 0.6.10).

There is no `skill` tool here. When a skill applies, **read** `.agents/skills/<name>/SKILL.md` and follow it. Shared checklists live in `.agents/references/`. Lifecycle entry points (the `/spec` `/plan` `/build` `/test` `/review` `/ship` family) are Markdown in `.agents/commands/`.

Start with [`.agents/skills/using-agent-skills/SKILL.md`](.agents/skills/using-agent-skills/SKILL.md) if you are choosing which workflow applies.

| Phase | Skill | Path |
|-------|--------|------|
| Discover | using-agent-skills | `.agents/skills/using-agent-skills/SKILL.md` |
| Define | interview-me, idea-refine, spec-driven-development, constraint-driven-development | `.agents/skills/<name>/SKILL.md` |
| Plan | planning-and-task-breakdown | `.agents/skills/planning-and-task-breakdown/SKILL.md` |
| Build | incremental-implementation, test-driven-development, frontend-ui-engineering, api-and-interface-design, context-engineering, source-driven-development, doubt-driven-development | `.agents/skills/<name>/SKILL.md` |
| Verify | debugging-and-error-recovery, browser-testing-with-devtools | `.agents/skills/<name>/SKILL.md` |
| Review | code-review-and-quality, code-simplification, security-and-hardening, performance-optimization | `.agents/skills/<name>/SKILL.md` |
| Ship | git-workflow-and-versioning, ci-cd-and-automation, deprecation-and-migration, documentation-and-adrs, observability-and-instrumentation, shipping-and-launch | `.agents/skills/<name>/SKILL.md` |

Do not load every skill into context. Open only the one (or two) that match the current task.

## This repository overrides the pack

Where the pack and this repo disagree, **this list wins**.

1. **Stay on the Arena session branch.** Do not create, switch, or push to any other branch. Atomic commits and descriptive messages from `git-workflow-and-versioning` still apply on that branch.
2. **Fail closed on the live page.** Never guess a selector, never retry a click, never resend a prompt, never invent a fallback DOM path. Coded, visible errors beat silent degradation. See [STABILITY-REVIEW.md](STABILITY-REVIEW.md) and [docs/architecture.md](docs/architecture.md).
3. **No build step, no runtime dependencies.** Do not add a bundler, compile step, or production `package.json` dependency. Dev-only Node tooling (`eslint`, `jsdom`, Playwright) stays in `devDependencies`.
4. **Do not ship skills in the extension.** Runtime files are the allow-list in `extension-files.json`. `.agents/`, `AGENTS.md`, tests, and `dev/` stay out of `npm run package:extension`.
5. **Privacy is appearance-only storage.** Chat content, prompts, replies, file bytes, screenshots, and account data are never persisted. Do not add telemetry, analytics, or new host permissions without an explicit product decision.
6. **Version is a wire protocol.** If you change the adapter contract, bump every version anchor in lockstep (`manifest.json` is source of truth; `test/version-sync.test.mjs` checks the rest) and reload both the extension and Arena tabs.

## Checks

```bash
npm run check          # eslint + Node/jsdom regressions
npm test               # node --test "test/**/*.test.mjs"
npm run test:browser   # opt-in Chromium fixtures; no live Arena network
npm run package:extension
```

Node ≥ 20. Details: [docs/development.md](docs/development.md).
