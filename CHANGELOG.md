# Changelog

## 2.8.2 — 2026-09-25

Correctness and recovery work from the improvement review. Reload the extension **and Arena tabs** after updating; older adapters are rejected rather than mixing staging protocols.

### Fixed

- Distinct files with equal metadata retain their original bytes and order.
- MIME aliases, per-input file restrictions, wildcards and the exact 8 MiB boundary are handled correctly.
- File overflow and all-invalid selections display actionable feedback.
- Repeated policy injection is idempotent; synchronous Chrome attachment errors cannot race client initialization.
- Completed/cancelled/interrupted turns release original file references; transport payloads are not retained in turn history.
- Main-world staging uses the native file input setter, consumes its marker once and rejects expired requests.
- Staging and history waits are bounded; cancellation/timeout prevents late Send continuation.
- Connection handshake timing starts after attachment. A dialog wait has a deadline and accessible cancel/open-tab actions.
- Screenshot completion cannot attach into a cleared/changed draft. Capture cancellation closes its popup best-effort.
- Screenshot slices are document-bound and checked for navigation/viewport changes; final redirect URLs are reported.
- Screenshot stitching releases each bitmap promptly and enforces memory/pixel budgets.
- Tab discardability is restored to its prior value, including asynchronous release/reacquire races.

### Added / improved

- Same-conversation reconnect preserves local history and draft; verified accepted messages are re-watched read-only.
- Silent-port warning pauses new sends without resending or imposing a generation deadline.
- Requested-model mismatch requires explicit confirmation before Send.
- Settings keyboard focus boundary and opener restoration.
- Expanded Node/jsdom regression coverage, synthetic Chromium extension tests and a CI browser job.
- `npm run package:extension` creates an allow-listed unpacked extension under `dist/`.

### Validation / remaining work

Node checks and packaging pass. Chromium execution was blocked in the implementation sandbox by browser download/system-library availability, but all four Chromium fixture tests subsequently passed in GitHub Actions after correcting a test-harness import context. Authorized live Arena smoke testing remains required. See [implementation status](docs/IMPLEMENTATION-STATUS.md) for precise coverage and the remaining roadmap. No fivefold performance improvement is claimed.
