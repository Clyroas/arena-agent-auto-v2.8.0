// Copy buttons (v2.8.0): reply text (as Markdown) and code blocks. Write-only, on the user's click —
// the extension never reads the clipboard, and nothing is ever pasted into Arena this way.
export async function copyText(text, button) {
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  // Keep the author's tooltip, so a failure message does not outlive the failure.
  if (button.dataset.title === undefined) button.dataset.title = button.title;
  clearTimeout(button.copyTimer);
  try {
    await navigator.clipboard.writeText(String(text));
    button.textContent = 'Copied'; button.dataset.state = 'ok';
  } catch {
    button.textContent = 'Copy failed'; button.dataset.state = 'error';
    button.title = 'Chrome did not allow the copy. Select the text and press Ctrl+C (⌘C on Mac).';
  }
  button.copyTimer = setTimeout(() => { button.textContent = label; delete button.dataset.state; button.title = button.dataset.title; }, 1600);
}
