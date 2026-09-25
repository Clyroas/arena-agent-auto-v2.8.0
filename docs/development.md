# Development

Practical guide: running the checks, what each test suite covers, how to bump the version, and the
conventions changes are held to. The extension itself has no build step — dev tooling is Node-based
and dev-only.

## Setup

- Node ≥ 20 (CI uses 22), npm.
- `npm install` installs ESLint and jsdom for the dev tooling. The extension never imports them.

| Script | Does |
|--------|------|
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`) |
| `npm test` | `node --test "test/**/*.test.mjs"` — Node/jsdom tests |
| `npm run check` | Both, in that order — what CI runs |

## Tests

The suites cover the pure helpers plus the paths that used to be untestable:

| Suite | Covers |
|-------|--------|
| `core.test.mjs` | URL helpers (`isArena`/`isDirect`/`isDirectChat`, `directModelUrl`), `withTimeout`, `tabLabel`, `samePage`, `capabilitySummary` |
| `capabilities.test.mjs` | The real `agent-dom.js` `capabilities()` snapshot under jsdom, fed into `capabilitySummary`: a healthy layout, a lost composer (drift), and a missing upload input (degraded, not blocking) |
| `attachment-policy.test.mjs` | The pure file rules: count/size/MIME limits, extension↔MIME matching, edge cases |
| `agent-client.test.mjs` | The panel client against a faked `chrome`: hang/timeout paths, teardown, the bounded worker calls |
| `content-script.test.mjs` | The content script loaded into jsdom: connection handover (`portAlive` takeover), scan coalescing (40 mutations → 2 scans) |
| `conversation-view.test.mjs` | Transcript rendering against the real `panel.html` markup contract — which element each state toggle lives on (also what the motion layer keys off) |
| `live-view.test.mjs` | The moving parts of a turn: preview text, tool rows, question cards, response pairs |
| `live-status.test.mjs` | "Last change N ago" status derivation |
| `question-history.test.mjs` | Answered clarification rows stay history (not a second reply): remembered IDs, hidden remnants, answered-vs-unanswered completion, resume handover |
| `rich-view.test.mjs` | Markdown/code rendering |
| `screenshot.test.mjs` | Capture pipeline maths: slicing, caps, stitching decisions |
| `preferences.test.mjs` | Whitelist-normalization of theme/text-size/accent prefs |
| `stylesheet.test.mjs` | The CSS "linter": custom-property typos, animations pointing at missing keyframes, unbalanced braces, motion only on `transform`/`opacity`/colour, and the reduced-motion escape hatch |
| `version-sync.test.mjs` | Every version anchor matches the manifest; the manifest references only files that exist; permissions and CSP are exactly as intended |

### The version-bump checklist

The version string is part of the wire protocol — a bump that misses an anchor disables the
extension at runtime (`VERSION_MISMATCH` / `SCRIPT_REGISTRATION_FAILED`). `manifest.json` is the
source of truth; keep every anchor in step and `npm test` will verify them:

1. `manifest.json` — `version`, `action.default_title` ("Arena Auto Chat · x.y.z")
2. `package.json` — `version` (must not drift from the manifest)
3. `agent-client.js` — `ADAPTER_VERSION`
4. `attachment.js` — `ADAPTER_VERSION`
5. `agent-dom.js` — `globalThis.ArenaAgentDOM = { version: ... }`
6. `agent-content.js` — `const VERSION` and `adapterVersion:`
7. `panel.js` — the "content script v⟨x.y.z⟩ verified" message
8. `panel.html` — `<title>` and `<strong id="version">`
9. `floating.html` — `<title>` and `<strong id="version">`
10. `dev/preview.js` — the fake port's `adapterVersion`, so the preview still matches

## Dev motion preview

`dev/preview.html` + `dev/preview.js` render the **real** panel against a fake Arena tab: they load
`panel.html`, `panel.css` and `panel.js`, answer Chrome API calls with a fake service worker and a
fake port, and drive scripted scenarios (plain reply, formatted reply, tool steps, clarification
card, response pair, rate limit, staged file, imported history). No network, no stored chat
content, no Arena tab touched, and nothing in `manifest.json` references `dev/`:

```bash
python3 -m http.server 8080     # or any static server
# open http://localhost:8080/  → meta-refresh forwards to /dev/preview.html
```

Use the bar at the top of the preview to replay any single scenario.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run lint` and `npm test` on pushes to `main`, on
every pull request, and on demand. Lint catches the mistakes that break the panel at runtime
(unknown identifiers, dead code, promise executors that return values).

## Conventions

- **No build step, no runtime dependencies.** Files the manifest loads are plain files with plain
  names (enforced by `version-sync.test.mjs`). Dev-only code lives in `dev/` and `package.json`.
- **ES modules** for extension pages and the worker; the content script is a classic script, which
  is why shared code like `attachment-policy.js` is dual-format (ESM + `window` global).
- **ESLint globals are per world** — browser, worker, content script and Node files each get their
  own globals in `eslint.config.mjs`; keep new files in the right group.
- **Fail-closed by default.** Prefer a coded, visible error over a guess; bound every request with
  a timeout and a recovery message; never retry a click or resend; one dialog at a time; exact
  matches over fallbacks. If a relaxation is tempting, write down the evidence first (see the
  open findings in [STABILITY-REVIEW.md](../STABILITY-REVIEW.md)).
- **Motion is CSS-only** and restricted to `transform`/`opacity`/colour with short durations and the
  shared spring easing; `test/stylesheet.test.mjs` enforces this and the reduced-motion escape
  hatch. See the motion table in [STABILITY-REVIEW.md](../STABILITY-REVIEW.md).
- **Storage is appearance-only.** Anything that smells like chat content, credentials, or telemetry
  does not get persisted — see the table in [architecture.md](architecture.md).

## Browser regressions and release artifacts (2.8.2)

```bash
npx playwright install --with-deps chromium
npm run test:browser
npm run package:extension
```

`test/browser/extension.spec.mjs` loads the real unpacked extension in a persistent Chromium context. All ordinary web requests are intercepted; `test/browser/fixtures/agent.html` is synthetic, not a private conversation or a claim about current Arena markup. The browser job runs separately from Node tests in CI. The implementation sandbox could discover these tests but could not launch Chromium; see [implementation status](IMPLEMENTATION-STATUS.md).

`extension-files.json` is the reviewed release allow-list. Update it for new runtime modules/assets. Node tests verify packaged import/style/markup dependencies and panel/floating control parity. `npm run package:extension` writes `dist/arena-auto-chat-<version>/`, which can be loaded unpacked or zipped for distribution. Never include `node_modules`, tests, traces, `.git`, or development previews in the artifact.

The version checklist also includes `attachment-policy.js`'s registration `VERSION`; changing its implementation without a version bump can leave an old registration in an already-open tab.
