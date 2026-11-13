/**
 * Tab containment shared by the ≤860px app drawer and `Dialog`.
 *
 * Two traps here leaked before: Chrome keeps layout boxes (and an `offsetParent`) for the
 * content of a CLOSED `<details>`, so a hidden menu button became the trap's "last" item and
 * Tab walked out of the dialog; and a handler bound to the dialog element never saw keys once
 * focus had dropped to `<body>` (a Save button that disables itself). Callers listen on the
 * document and pass every Tab through `trapTab`.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isRendered(element: HTMLElement): boolean {
  if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true });
  // No layout (jsdom): a closed <details> still hides everything but its summary.
  return !element.closest('details:not([open]) > :not(summary)');
}

/** Elements Tab can reach inside `root`, in document order. */
export function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.closest('[inert]') && isRendered(element),
  );
}

/**
 * Keeps Tab and Shift+Tab inside `root`. Focus that is outside it (on `<body>`, or behind the
 * modal) is pulled back in. Returns true when it moved focus.
 */
export function trapTab(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const items = tabbableWithin(root);
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    root.focus();
    return true;
  }
  if (!(active instanceof Node) || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  // The browser's own Tab order is fine unless no tabbable item lies ahead of focus (in the
  // Tab direction) inside root; this also covers focus on root or on a non-tabbable child.
  const ahead = event.shiftKey
    ? items.some((item) => active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING)
    : items.some((item) => active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (ahead) return false;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
  return true;
}
