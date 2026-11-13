/**
 * Magnetic pull for the handful of primary calls to action marked `data-magnetic`.
 *
 * Only `--mx` / `--my` custom properties are written; CSS turns them into a
 * `translate3d`, so the effect never triggers layout and stays on the compositor.
 * One delegated, rAF-throttled listener serves every marked element. Off for touch,
 * pen and coarse pointers, and whenever the user asks for reduced motion.
 */

/** Fraction of the pointer's distance from the centre the element follows. */
const STRENGTH = 0.2;
/** Never drift further than this, so the label stays under the pointer. */
const MAX_OFFSET_PX = 5;

export function magneticOffset(pointer: number, center: number): number {
  const raw = (pointer - center) * STRENGTH;
  return Math.max(-MAX_OFFSET_PX, Math.min(MAX_OFFSET_PX, raw));
}

export function installMagnetic(root: Document = document): () => void {
  if (typeof window.matchMedia !== 'function' || typeof requestAnimationFrame !== 'function') return () => {};
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active: HTMLElement | null = null;
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;

  const release = () => {
    if (active) {
      active.style.removeProperty('--mx');
      active.style.removeProperty('--my');
    }
    active = null;
    pointer = null;
  };

  const flush = () => {
    frame = 0;
    if (!active || !pointer) return;
    const rect = active.getBoundingClientRect();
    active.style.setProperty('--mx', `${magneticOffset(pointer.x, rect.left + rect.width / 2).toFixed(2)}px`);
    active.style.setProperty('--my', `${magneticOffset(pointer.y, rect.top + rect.height / 2).toFixed(2)}px`);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) {
      if (active) release();
      return;
    }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-magnetic]') : null;
    if (active && active !== target) release();
    if (!target || target.matches(':disabled')) return;
    active = target;
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };

  const onOut = (event: PointerEvent) => {
    if (!event.relatedTarget) release();
  };

  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerout', onOut, { passive: true });
  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerout', onOut);
    if (frame) cancelAnimationFrame(frame);
    release();
  };
}
