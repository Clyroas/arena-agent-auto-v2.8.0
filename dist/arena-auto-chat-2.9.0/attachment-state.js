// Panel-only attachment ownership. Metadata is not an identity: never re-find a File by name/size.
import './attachment-policy.js';
const A = globalThis.ArenaAgentAttachments;

export function selectAttachments(files, remaining = A.ATTACHMENT_POLICY.maxFiles) {
  const originals = Array.from(files || []);
  const { accepted, rejected } = A.validateAttachments(originals, remaining);
  return {
    accepted: accepted.map(({ sourceIndex, ...meta }) => ({ ...meta, file: originals[sourceIndex] })),
    rejected
  };
}

// JS cannot guarantee memory erasure. Drop references; never retain transport bytes in turn history.
export function releaseTurnAttachments(turn) {
  if (!turn) return;
  if (turn.payload) for (const item of turn.payload) item.data = '';
  turn.payload = null;
  turn.files = null;
}

// Only call when no Send click was attempted. Staging may already have touched Arena's composer;
// restoring a local draft is not permission to retry it automatically.
export function restoreTurnAttachments(turn) {
  const files = (turn?.files || []).map((file, index) => ({ ...turn.attachments[index], file }));
  releaseTurnAttachments(turn);
  return files;
}
