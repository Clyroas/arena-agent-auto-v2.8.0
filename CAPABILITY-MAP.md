# Capability Map: Full Skill Delivery in Arena Auto Chat

Status: **approved module map, module specifications, and implementation plan.**

Intent confirmed by the user: the extension user explicitly selects and reviews a skill, and the Arena agent receives its full `SKILL.md` with the task. Source scope is the existing engineering pack, appropriately licensed Anthropic public example skills, and permitted original alternatives for restricted document skills. No automatic selection, system-prompt installation, referenced files, scripts, or assets.

| Module ID | Responsibility | Depends on |
|---|---|---|
| `skill-catalog` | Package approved `SKILL.md` texts with provenance and license metadata; exclude restricted material and unavailable references/scripts. | — |
| `skill-selection` | Find, read and explicitly choose a skill without sending or silently changing a task. | `skill-catalog` |
| `skill-inline-delivery` | Deliver the complete selected skill and task together when the message fits; preserve privacy and existing send safeguards. | `skill-catalog`, `skill-selection` |
| `skill-attachment-overflow` | If it does not fit, offer a confirmed `.md` attachment; verify Arena/file limits and fail closed if unavailable. | `skill-inline-delivery` |

Build order: `skill-catalog` → `skill-selection` → `skill-inline-delivery` → `skill-attachment-overflow`.

The module specs are `SPEC-skill-catalog.md`, `SPEC-skill-selection.md`, `SPEC-skill-inline-delivery.md`, and `SPEC-skill-attachment-overflow.md`. The existing `tasks/plan.md` and `tasks/todo.md` concern other work and are **not** this initiative's plan.

## Shared non-goals and invariants

- The supplied Claude system-prompt page is background context, **not** an executable skill pack or a license to redistribute its contents. Never import that document verbatim.
- The feature deliberately revises two existing repository rules **only for this feature**: shipping approved skill text and, with user consent, generating a skill `.md` attachment. Existing privacy, Arena-only networking, no build step/runtime dependencies, single-send and fail-closed rules remain.
- No claim that Arena has Claude-specific paths, tools, APIs or dependencies. Sending a skill does not grant the agent any tool.
- Only primary `SKILL.md` text is delivered. Linked references, scripts, assets and lifecycle commands remain separate/out of scope. Existing Task prompts keep working unless the approved specs later say otherwise.
- A rejected, cancelled or unsupported delivery must send nothing and must not truncate, retry, silently split, or substitute a summary for the full skill.

## Evidence to validate while specifying

- Existing 25 engineering skills are vendored under `.agents/skills/` at the MIT-pinned revision recorded in `.agents/SOURCE.md`. The extension currently packages only generated short presets; `.agents/` itself is excluded.
- The public `anthropics/skills` repository at `33375500bcea98d610eb30ce10ac4e59b89c390d` has 14 per-skill Apache-2.0 examples, four source-available but restrictively licensed document skills (`docx`, `pdf`, `pptx`, `xlsx`), and `doc-coauthoring` without a verified license. Do not include the last five without a new explicit authorization/source review.
- Composer limit is 30,000 characters; a public example `claude-api/SKILL.md` alone is about 86 KB. `.md` is an accepted attachment type, but the existing path caps the total at four files and only currently stages user-supplied files. Arena page acceptance and agent readability require runtime verification; neither can be inferred from an accepted MIME type.

## Approval gates

1. Review and approve each module's draft specification and unresolved questions.
2. Only then plan verifiable vertical slices (do not overwrite unrelated task plans without approval).
3. Implement and verify against the approved specs; no code changes were made during discovery/spec drafting.
