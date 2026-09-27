# Full Skill Delivery — Task Checklist

Status: **approved task list; execute one task at a time**. Companion to [skill-delivery-plan.md](skill-delivery-plan.md). Do not use the unrelated `tasks/todo.md`. Implementation is approved one task at a time; unchecked tasks remain pending.

## `skill-catalog`

### T1 — Record permitted source/licensing contract ✅
- [x] Pin the Anthropic commit and list only the 14 per-skill Apache-2.0 examples (no `docx`, `pdf`, `pptx`, `xlsx`, or unverified `doc-coauthoring`); retain license/notice provenance.
- [x] Add a failing source-audit test for missing/unlicensed IDs and accidental inclusion of restricted material.
- Dependencies: none. Candidate files: `skill-sources/manifest.json`, `skill-sources/LICENSE-ANTHROPIC.txt`, `test/skill-catalog-source.test.mjs` (3).
- Verify: `node --test test/skill-catalog-source.test.mjs`; `npm run check`.

### T2 — Pin the complete permitted Anthropic primary texts
- [ ] Add exactly the 14 unmodified `SKILL.md` bodies at the audited commit as development-only source data; no scripts/references/assets.
- [ ] Tests verify exact byte/source parity, unique names/IDs and license coverage; packaging does not ship source data directly.
- Dependencies: T1. Candidate files: `skill-sources/anthropic-skills.json`, `test/skill-catalog-source.test.mjs` (2).
- Verify: `node --test test/skill-catalog-source.test.mjs` (offline recorded checksums); manually compare the pinned source to upstream during import, without CI network dependence.

### T3 — Author four original document-format alternatives
- [ ] Create **independently authored** `.md` skills for docx, pdf, pptx and xlsx, with clear scope, safe tool detection and output verification; do not borrow restricted prose.
- [ ] Add a source audit that checks IDs/frontmatter/provenance and absence of claimed Claude-only tools.
- Dependencies: T1 (parallel-safe with T2). Candidate files: `skill-sources/original/{docx,pdf,pptx,xlsx}/SKILL.md` (4), `test/skill-catalog-source.test.mjs` (1).
- Verify: `node --test test/skill-catalog-source.test.mjs`; manual originality/quality review against approved spec.

### T4 — Generate a static full-text catalog
- [ ] A deterministic dev-only script produces a checked-in static ES module from the 25 existing skills, 14 pinned permitted sources, and four originals, with stable source-qualified IDs, full text, notices and compatibility metadata.
- [ ] Drift test fails if the source changes without regeneration; a skill exceeding 30,000 characters remains intact.
- Dependencies: T2, T3. Candidate files: `scripts/build-full-skill-catalog.mjs`, `full-skill-catalog.js`, `test/full-skill-catalog.test.mjs` (3).
- Verify: `node --test test/full-skill-catalog.test.mjs`; run the generator twice and compare output; `npm run check`.

### T5 — Include only approved catalog output in release
- [ ] Add the generated module and needed license notice(s) to `extension-files.json`, update `AGENTS.md` to document the narrowly approved shipping exception, and keep raw sources/references/scripts out.
- [ ] Packaging/source tests reject blocked IDs and fail on missing notices or dependencies; existing short presets remain unchanged.
- Dependencies: T4. Candidate files: `extension-files.json`, `AGENTS.md`, `test/package.test.mjs`, `test/agent-skills.test.mjs`, `full-skill-catalog.js` (5; touch the last only if notice metadata needs adjustment).
- Verify: `npm run check`; `npm run package:extension`; inspect allow-listed output.

### Checkpoint C1 — Catalog/package audit
- [ ] 25 + 14 + 4 full primary texts are present with audited attribution; no restricted/unverified Anthropic texts or absent resources ship.
- [ ] `npm run check` and `npm run package:extension` pass; human reviews catalog before UI work.

## `skill-selection`

### T6 — Browse and search the full catalog
- [ ] An explicitly opened picker lists catalog entries with source, license, and search, including a usable empty state; existing Task prompts picker is unaffected.
- [ ] Opening or searching never sends, stages a file, stores chat text or changes the task draft.
- Dependencies: T5. Candidate files: `panel.html`, `floating.html`, `panel.js`, `panel.css`, `test/panel-skills.test.mjs` (5).
- Verify: `node --test test/panel-skills.test.mjs`; `npm run check`; manual narrow-width UI check.

### T7 — Read and select exactly one skill
- [ ] Viewer shows unmodified full text, including long examples, with source/compatibility warning and accessible focus/close behavior.
- [ ] User can choose/change/remove one active skill; no send on selection; chosen ID clears only after a verified accepted Send.
- Dependencies: T6. Candidate files: `panel.html`, `floating.html`, `panel.js`, `panel.css`, `test/panel-skills.test.mjs` (5).
- Verify: `node --test test/panel-skills.test.mjs`; `npm run check`; manual keyboard review.

### Checkpoint C2 — No-send UI review
- [ ] Panel/floating parity and search/preview/accessibility tests pass; no task text, storage or port events change on selection.
- [ ] Human reviews the visible consent/compatibility messaging before Send integration.

## `skill-inline-delivery`

### T8 — Compose one exact bounded message
- [ ] Pure function keeps full `SKILL.md` and task untruncated, with attributed warning; reports overflow rather than substituting a summary.
- [ ] Tests cover exact/over limit, empty/stale input and no-skill compatibility; no runtime I/O.
- Dependencies: T4 (can be developed before T7, integrated after it). Candidate files: `skill-delivery.js`, `test/skill-inline-delivery.test.mjs` (2).
- Verify: `node --test test/skill-inline-delivery.test.mjs`; `npm run check`.

### T9 — Connect composition to user-initiated Send
- [ ] With one selected skill, show a concise Send summary; hand exact composed text to existing send path once when it fits; ordinary no-skill sends unchanged.
- [ ] Cancellation, stale draft/selection, disconnect and pre-click failure preserve recoverable intent; never silently retry or persist content.
- Dependencies: T7, T8. Candidate files: `panel.js`, `panel.html`, `floating.html`, `test/panel-skills.test.mjs` (4).
- Verify: `node --test test/panel-skills.test.mjs test/skill-inline-delivery.test.mjs`; `npm run check`.

### Checkpoint C3 — Inline full-text delivery
- [ ] Under-limit message reaches synthetic Arena tab exactly once with task and full text; over-limit path sends nothing yet.
- [ ] No-skill/preset behavior and reconnection regressions pass; human reviews before fallback work.

## `skill-attachment-overflow`

### T10 — Build a transient approved Markdown attachment
- [ ] Pure helper checks overflow, exact full skill bytes, unique safe filename, file size/remaining slots and supported `.md` MIME; generates no persistent data.
- [ ] Tests cover 4-file cap, oversize, invalid skill, and preservation of user File identities.
- Dependencies: T8. Candidate files: `skill-delivery.js`, `test/skill-attachment-overflow.test.mjs` (2).
- Verify: `node --test test/skill-attachment-overflow.test.mjs`; `npm run check`.

### T11 — Confirm and stage only on overflow Send
- [ ] On each overflow Send, confirm skill name/file/slot, and only then generate/stage `.md` with the task; cancel does nothing.
- [ ] Unsupported/no file input, rejected `.md`, full slots or changed tab/draft fail with visible error before Send; no user file eviction or task-only send.
- Dependencies: T9, T10. Candidate files: `panel.js`, `panel.html`, `floating.html`, `panel.css`, `test/panel-skills.test.mjs` (5).
- Verify: `node --test test/panel-skills.test.mjs test/skill-attachment-overflow.test.mjs`; `npm run check`.

### T12 — Guard attachment recovery and ambiguous outcomes
- [ ] Tests cover pre-click restore, existing user-picked files, page drift, connection loss, and staged-but-unknown outcome without duplicate Send or automatic retry.
- [ ] If adapter behavior must change, stop for review and synchronized version update instead of guessing page selectors or widening validation.
- Dependencies: T11. Candidate files: `panel.js`, `attachment-state.js` (only if needed), `test/panel-skills.test.mjs`, `test/attachment-state.test.mjs` (up to 4).
- Verify: `npm run check`; focused attachment and panel tests.

### Checkpoint C4 — Fail-closed overflow path
- [ ] No file capacity/format/error path sends the task alone, evicts files, silently truncates, or retries after ambiguity.
- [ ] Human reviews overflow consent and all coded recovery notices before browser verification.

### T13 — Prove synthetic and live behavior
- [ ] Synthetic browser fixture demonstrates full `.md` staging and one task Send, plus unsupported/rejected input sending nothing.
- [ ] Manual live Arena Agent check demonstrates agent can access the attachment text; record evidence or mark fallback unverified and **not ship-ready**.
- Dependencies: T12. Candidate files: `test/browser/extension.spec.mjs`, `test/browser/fixtures/agent.html`, `docs/IMPLEMENTATION-STATUS.md` (3).
- Verify: `npm run test:browser`; documented live check on an authorized account; `npm run check`.

## Cross-cutting

### T14 — Document, audit and hand off
- [ ] Update user/dev/architecture docs for full skill selection, unmodified text and compatibility warnings, license provenance, consented overflow, privacy and current runtime limits.
- [ ] Verify release allow-list, panel/floating parity, version anchors if changed, full checks, and open live-site caveats; request human ship review.
- Dependencies: T5, T7, T9, T13. Candidate files: `README.md`, `docs/architecture.md`, `docs/development.md`, `docs/IMPLEMENTATION-STATUS.md` (4).
- Verify: `npm run check`; `npm run package:extension`; `npm run test:browser` if available; manual reviewer sign-off.

### Checkpoint C5 — Complete only after review
- [ ] All four approved specs' acceptance criteria and the standing Definition of Done are met.
- [ ] License/source review and live attachment readability are documented; if not verifiable, clearly label blocked scope instead of declaring completion.
- [ ] Human approves shipping; nothing is deployed or pushed automatically.
