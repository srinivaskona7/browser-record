/**
 * Places every `details.rec-more-menu` popover where it is actually visible.
 *
 * The popover used to open upward unconditionally — right for the floating take dock at
 * the bottom edge, wrong everywhere else: the app "Menu", Projects "More" and Edit
 * "Project" menus opened above the viewport or under the top bar, and the Edit menu ran
 * off the left edge. Placement is now measured when a menu opens: below the trigger unless
 * only the space above fits, aligned to whichever trigger edge keeps it inside the clip
 * box (viewport ∩ every clipping ancestor up to the first fixed one).
 */

const GAP = 8;

export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Placement {
  placement: 'top' | 'bottom';
  align: 'start' | 'end';
}

/** Pure geometry so the decision is unit-testable without layout. */
export function choosePlacement(trigger: Box, size: { width: number; height: number }, clip: Box): Placement {
  const below = clip.bottom - trigger.bottom - GAP;
  const above = trigger.top - clip.top - GAP;
  const placement = below >= size.height || below >= above ? 'bottom' : 'top';
  // Right-aligned (popover grows leftward) is the default; flip when that would cross the
  // left clip edge and starting at the trigger's left edge fits better.
  const endFits = trigger.right - size.width >= clip.left + GAP;
  const startFits = trigger.left + size.width <= clip.right - GAP;
  const align = endFits || !startFits ? 'end' : 'start';
  return { placement, align };
}

/** Viewport intersected with every clipping ancestor, stopping at a fixed-position box. */
export function clipBox(element: Element): Box {
  const box: Box = { top: 0, left: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight };
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const rect = node.getBoundingClientRect();
      box.top = Math.max(box.top, rect.top);
      box.left = Math.max(box.left, rect.left);
      box.right = Math.min(box.right, rect.right);
      box.bottom = Math.min(box.bottom, rect.bottom);
    }
    if (style.position === 'fixed') break;
  }
  return box;
}

export function placePopover(details: HTMLDetailsElement): void {
  const summary = details.querySelector(':scope > summary');
  const popover = details.querySelector(':scope > .rec-more-popover');
  if (!(summary instanceof HTMLElement) || !(popover instanceof HTMLElement)) return;
  const { placement, align } = choosePlacement(
    summary.getBoundingClientRect(),
    { width: popover.offsetWidth, height: popover.offsetHeight },
    clipBox(details),
  );
  details.dataset.placement = placement;
  details.dataset.align = align;
}

/**
 * One capture-phase listener covers every menu, including ones mounted later. `toggle`
 * does not bubble, but capture listeners on the document still see it.
 */
export function installPopoverPlacement(root: Document = document): () => void {
  const onToggle = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLDetailsElement && target.open && target.classList.contains('rec-more-menu')) {
      placePopover(target);
    }
  };
  root.addEventListener('toggle', onToggle, true);
  return () => root.removeEventListener('toggle', onToggle, true);
}
