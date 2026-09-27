# Spec: skill-catalog

Status: **approved requirements and plan — implementation gated by task checkpoints**. Indexed by [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: none.

## Objective

Make complete, reviewable `SKILL.md` texts available **locally** to the extension without copying restricted materials or claiming unavailable tools. Consumers are `skill-selection` and the two delivery modules. Success means a user can retrieve the exact primary skill text from a packaged catalog without network access, and every entry has an auditable source/license.

Scope requested: the 25 existing Addy Osmani engineering skills (MIT, pinned in `.agents/SOURCE.md`), all redistributable Anthropic example skills, and independently written/permissively licensed equivalents for `docx`, `pdf`, `pptx`, `xlsx`. The current inspection of `anthropics/skills` revision `33375500bcea98d610eb30ce10ac4e59b89c390d` found 14 per-skill Apache-2.0 examples; four document skills are restrictive and `doc-coauthoring` lacks a verified redistribution license. The last five are **excluded**, not copied or rewritten from their text. Verify licenses again before packaging; if uncertain, omit and ask.

## Tech Stack

Plain static ES modules/Markdown in an MV3 Chrome extension, with dev-only Node scripts for reproducible generation/auditing. No new runtime dependencies, network permissions, remote code, or runtime fetching. The existing `skill-presets.js` remains the separate short-prompt library.

## Commands

- Regenerate current preset library (existing): `npm run build:presets`
- Run project checks: `npm run check`
- Run focused tests (to create during implementation): `node --test test/skill-catalog.test.mjs`
- Verify release allow-list: `npm run package:extension`

## Project Structure

- `.agents/skills/<name>/SKILL.md`, `.agents/SOURCE.md`, `.agents/LICENSE`: existing pinned engineering source; don't change upstream text for this feature.
- A separately pinned, license-audited source area for permitted external `SKILL.md` files and a clear original source area for the four alternatives (exact filenames to be set in the approved plan). Their notices and provenance must accompany shipped text.
- A generated static runtime catalog/module on `extension-files.json` (or individually allow-listed Markdown assets), with metadata including stable ID, name, source, license and complete primary text. No `AGENTS.md`, tests, unpublished reference folders, or restricted content in the release artifact.
- `test/skill-catalog.test.mjs`: generation parity, license/manifest completeness, exclusion and packaging checks. `README.md`, `AGENTS.md`, and architecture/development docs updated when the previous no-shipping rule is revised.

## Code Style

Expose immutable metadata, plain text, and deterministic IDs; render external text using `textContent`, never `innerHTML`:

```js
const entry = { id: 'addy:using-agent-skills', source: 'addyosmani/agent-skills', license: 'MIT', text: skillText };
preview.textContent = entry.text;
```

Stable IDs distinguish duplicate skill names across sources. Display names are not identity; no executable code in catalog data.

## Testing Strategy

Node tests verify every selected source's manifest entry and full text, reproducible pinning, required license/attribution, non-inclusion of the five blocked upstream examples, and that only allow-listed artifacts ship. Test a deliberately over-limit skill such as `claude-api` without truncation. Lint and package checks must pass. A manual extension check confirms the catalog loads offline in both panel and floating window.

## Boundaries

- **Always:** Audit the exact source revision and each skill's terms before import; preserve primary text, attribution and notices; surface missing references/tools as availability limits, not a promise they exist; use static/offline packaging.
- **Ask first:** Adding a skill from a different source or without clear redistribution rights; changing the agreed source scope; replacing/revising existing preset behavior; introducing dependencies or new permissions.
- **Never:** Package the linked leaked system prompt, restrictive Anthropic document skill texts, unlicensed text, upstream scripts/assets/references as though they were the primary skill, or unreviewed network-fetched instructions.

## Success Criteria

1. All 25 existing engineering skills and every license-verified eligible Anthropic public example are discoverable as **complete** `SKILL.md` texts; four original/permitted document-format alternatives are clearly labelled as alternatives, not Anthropic originals.
2. Release artifacts carry their license/attribution and no blocked material, scripts or references. The package and the catalog are tested against an explicit reviewed manifest; source refreshes cannot silently drift.
3. No runtime network fetch, storage of task/chat content, permission addition, bundler or runtime dependency is introduced.
4. Each entry is uniquely identified by source plus skill ID; source/tool compatibility is visible to the user without modifying the underlying primary text.

## Decisions Confirmed During Spec Review

- Preserve the **complete primary text unmodified**, including frontmatter and tool/path instructions. Put compatibility warnings outside it. Do not claim unavailable tools are present.
- Author four **original, Arena-appropriate** document-format alternatives in this initiative; do not derive their text from restrictive Anthropic skills. Label them as original alternatives and review their quality before packaging.
- “All eligible” means every source whose redistribution terms can be verified for the pinned revision (currently the 14 per-skill Apache-2.0 examples); exclude `doc-coauthoring` unless a separate applicable license is established and the scope is re-approved.
