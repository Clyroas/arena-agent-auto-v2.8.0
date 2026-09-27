# Vendored from addyosmani/agent-skills

| Field | Value |
|-------|-------|
| Upstream | https://github.com/addyosmani/agent-skills |
| Plugin version | 0.6.10 |
| Git commit | `bcab6a1b8503100e8618c3b4e32cc78de43de769` (2026-09-22) |
| License | MIT — see [LICENSE](LICENSE) |
| Copyright | © 2025 Addy Osmani |

This directory is a whole-pack vendor of the 25 skills, shared checklists, and lifecycle commands. It is **not** part of the Chrome extension: `extension-files.json` does not include it, and `npm run package:extension` will not ship it.

Relative links inside `skills/<name>/` (`../../references/…`) resolve to the checklists in this folder's `references/`, matching the upstream `skills/` + `references/` layout.

To refresh from upstream:

```bash
git clone --depth 1 https://github.com/addyosmani/agent-skills.git /tmp/agent-skills
rsync -a --delete /tmp/agent-skills/skills/ .agents/skills/
rsync -a --delete /tmp/agent-skills/references/ .agents/references/
rsync -a --delete /tmp/agent-skills/.claude/commands/ .agents/commands/
cp /tmp/agent-skills/LICENSE .agents/LICENSE
# Re-apply the one layout fix in commands/ship.md (orchestration-patterns path).
# Then update the commit hash in this file.
```
