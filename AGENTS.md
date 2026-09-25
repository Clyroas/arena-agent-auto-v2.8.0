# AGENTS.md

Conventions for AI agents working in this repository. The full reference model — archetypes,
frontmatter schema, tool policy, output contracts, routing — lives in
[`docs/agents/README.md`](docs/agents/README.md); the runnable agent definitions live in
[`.claude/agents/`](.claude/agents/).

## The delegates

| Agent | Use it for | Writes? |
|-------|-----------|---------|
| [`explore`](.claude/agents/explore.md) | "Where is X / which files reference Y" across the three Chrome contexts. Pass a breadth: quick / medium / very thorough. | no |
| [`plan`](.claude/agents/plan.md) | Designing a change that crosses contexts, touches the port protocol, or has more than one reasonable shape. Returns a sequenced plan + 3–5 critical files. | no |
| [`general-purpose`](.claude/agents/general-purpose.md) | Multi-step research and implementation. | yes |
| [`arena-extension-guide`](.claude/agents/arena-extension-guide.md) | "Does the extension do X / is it allowed to" — answered from `docs/` + Chrome MV3 docs, with citations. | no |
| [`version-bump`](.claude/agents/version-bump.md) | Moving the version string across all ten anchors. Always route version changes here. | scoped |

Don't delegate: the final answer to the user, scope judgement, or your whole assignment.

## Project rules every agent must respect

1. **No build step, no runtime dependencies.** Plain ES modules. ESLint and jsdom are dev-only and
   must never be imported by extension code.
2. **The MV3 service worker is ephemeral.** Nothing long-lived may depend on `worker.js`; the chat
   path is the direct `chrome.tabs.connect` port. Worker traffic is one-shot and bounded.
3. **DOM access only from the isolated world**, except the single `stage-main.js` main-world
   injection per explicit staged-file Send.
4. **The version string is part of the wire protocol** — see `version-bump` above and the checklist
   in [`docs/development.md`](docs/development.md).
5. **Fail closed.** No silent guessing at the page, no manual fallback, no resend.
6. **Persistence stays tiny** — theme, text size, accent, last 5 Direct model names. Nothing else.
7. **Permissions and CSP** are asserted by `test/version-sync.test.mjs`; changing them is a reviewed
   decision.
8. Prefer editing an existing file to creating a new one. Don't create `*.md` or `README` files that
   nobody asked for.
9. Update the matching suite in `test/`, and `dev/preview.js` when the fake port's behaviour drifts.

## Before you claim you're done

Run `npm run check` (ESLint + `node --test "test/**/*.test.mjs"`) and say what it reported. For
background/automated runs, follow the reporting protocol in
[`docs/agents/README.md` §7](docs/agents/README.md#session-protocol-for-this-repo): narrate, restate
results in prose, sanity-check, then `result:` / `needs input:` / `failed:` on its own line.
