/**
 * Area capture geometry.
 *
 * A selection is stored as fractions (0..1) of the shared screen. The on-page selector is a
 * frame with the screen's aspect ratio, so the same four numbers place the box on the page and
 * crop the captured stream, whatever the pixel size of either one. (The selector used to store
 * page pixels and crop by `window.innerWidth`, so the region recorded was not the one drawn.)
 */

export type AreaAspect = 'free' | '16:9' | '4:3' | '1:1' | '9:16';

export interface AreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export const AREA_ASPECTS: ReadonlyArray<{ id: AreaAspect; label: string }> = [
  { id: 'free', label: 'Free' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '1:1', label: '1:1' },
  { id: '9:16', label: '9:16' },
];

/** A centred box over most of the screen, so Confirm works before the first drag. */
export const DEFAULT_AREA: AreaRect = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 };

/** Smallest selection edge in selector pixels; keeps the corner handles apart. */
export const AREA_MIN_PX = 40;

/** Smallest selection edge for keyboard resizing, as a fraction of the screen height. */
const KEYBOARD_MIN = 0.04;

export function aspectRatioOf(aspect: AreaAspect): number | null {
  switch (aspect) {
    case '16:9':
      return 16 / 9;
    case '4:3':
      return 4 / 3;
    case '1:1':
      return 1;
    case '9:16':
      return 9 / 16;
    default:
      return null;
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function toAreaPixels(rect: AreaRect, bounds: Size): AreaRect {
  return {
    x: rect.x * bounds.width,
    y: rect.y * bounds.height,
    width: rect.width * bounds.width,
    height: rect.height * bounds.height,
  };
}

export function toAreaFractions(px: AreaRect, bounds: Size): AreaRect {
  if (bounds.width <= 0 || bounds.height <= 0) return DEFAULT_AREA;
  return {
    x: px.x / bounds.width,
    y: px.y / bounds.height,
    width: px.width / bounds.width,
    height: px.height / bounds.height,
  };
}

/** Shift a rect so it lies inside `bounds`; it only shrinks when it is larger than them. */
function contain(px: AreaRect, bounds: Size): AreaRect {
  const width = Math.min(px.width, bounds.width);
  const height = Math.min(px.height, bounds.height);
  return {
    x: clamp(px.x, 0, bounds.width - width),
    y: clamp(px.y, 0, bounds.height - height),
    width,
    height,
  };
}

/** Clamp a stored selection into the screen (a corrupt or legacy value can sit outside it). */
export function clampArea(rect: AreaRect): AreaRect {
  const unit = { width: 1, height: 1 };
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  return contain(
    {
      x: finite(rect.x, DEFAULT_AREA.x),
      y: finite(rect.y, DEFAULT_AREA.y),
      width: Math.max(0.01, finite(rect.width, DEFAULT_AREA.width)),
      height: Math.max(0.01, finite(rect.height, DEFAULT_AREA.height)),
    },
    unit,
  );
}

/** Move by a pointer delta, staying inside the selector. */
export function moveAreaPx(start: AreaRect, dx: number, dy: number, bounds: Size): AreaRect {
  return contain({ ...start, x: start.x + dx, y: start.y + dy }, bounds);
}

/**
 * The rect spanned by a fixed `anchor` corner and the pointer: at least `minPx` on each side,
 * at the locked ratio when there is one (the axis the pointer pulled further wins), shrunk to
 * the room on the pointer's side of the anchor, then shifted inside the selector.
 */
export function resizeAreaPx(anchor: Point, pointer: Point, bounds: Size, aspect: AreaAspect, minPx = AREA_MIN_PX): AreaRect {
  const ratio = aspectRatioOf(aspect);
  const dirX = pointer.x >= anchor.x ? 1 : -1;
  const dirY = pointer.y >= anchor.y ? 1 : -1;
  const roomX = dirX > 0 ? bounds.width - anchor.x : anchor.x;
  const roomY = dirY > 0 ? bounds.height - anchor.y : anchor.y;
  let width = Math.abs(pointer.x - anchor.x);
  let height = Math.abs(pointer.y - anchor.y);
  if (ratio) {
    if (width >= height * ratio) height = width / ratio;
    else width = height * ratio;
    const scale = Math.min(1, width > 0 ? roomX / width : 1, height > 0 ? roomY / height : 1);
    width *= scale;
    height *= scale;
    // The shorter edge sets the minimum, so a locked box keeps its ratio when it is tiny.
    const minWidth = ratio >= 1 ? minPx * ratio : minPx;
    if (width < minWidth) {
      width = minWidth;
      height = width / ratio;
    }
  } else {
    width = Math.max(minPx, Math.min(width, roomX));
    height = Math.max(minPx, Math.min(height, roomY));
  }
  return contain(
    {
      x: dirX > 0 ? anchor.x : anchor.x - width,
      y: dirY > 0 ? anchor.y : anchor.y - height,
      width,
      height,
    },
    bounds,
  );
}

/** Re-shape a selection to a locked ratio around its centre, keeping roughly its area. */
export function snapAreaToAspect(rect: AreaRect, aspect: AreaAspect, screenAspect: number): AreaRect {
  const ratio = aspectRatioOf(aspect);
  if (!ratio || !(screenAspect > 0)) return rect;
  // Screen units: width measured in screen heights, so on-screen pixel ratios hold.
  const bounds = { width: screenAspect, height: 1 };
  const px = toAreaPixels(rect, bounds);
  const area = px.width * px.height;
  let width = Math.sqrt(area * ratio);
  let height = width / ratio;
  const scale = Math.min(1, bounds.width / width, bounds.height / height);
  width *= scale;
  height *= scale;
  const centreX = px.x + px.width / 2;
  const centreY = px.y + px.height / 2;
  return toAreaFractions(contain({ x: centreX - width / 2, y: centreY - height / 2, width, height }, bounds), bounds);
}

/**
 * Keyboard editing: Arrow keys move the selection by `step` of the screen; with `resize` the
 * right/bottom edge moves instead (both edges at a locked ratio). Null for any other key.
 */
export function nudgeArea(
  rect: AreaRect,
  key: string,
  resize: boolean,
  aspect: AreaAspect,
  screenAspect: number,
  step = 0.01,
): AreaRect | null {
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  if (dx === 0 && dy === 0) return null;
  const sa = screenAspect > 0 ? screenAspect : 16 / 9;
  const bounds = { width: sa, height: 1 };
  const px = toAreaPixels(rect, bounds);
  if (!resize) return toAreaFractions(moveAreaPx(px, dx * sa, dy, bounds), bounds);
  const ratio = aspectRatioOf(aspect);
  let width: number;
  let height: number;
  if (ratio) {
    // Right/Down grow and Left/Up shrink, by one step of the screen height.
    height = Math.max(KEYBOARD_MIN, px.height + dx + dy);
    width = height * ratio;
    const scale = Math.min(1, (bounds.width - px.x) / width, (bounds.height - px.y) / height);
    width *= scale;
    height *= scale;
  } else {
    width = clamp(px.width + dx * sa, KEYBOARD_MIN, bounds.width - px.x);
    height = clamp(px.height + dy, KEYBOARD_MIN, bounds.height - px.y);
  }
  return toAreaFractions(contain({ x: px.x, y: px.y, width, height }, bounds), bounds);
}

export interface AreaCropPlan {
  /** Source rect in stream pixels. Even-aligned: 4:2:0 video frames reject odd offsets. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Where to crop a stream of `source` size for a selection; the output is `sw × sh`. */
export function planAreaCrop(rect: AreaRect, source: Size): AreaCropPlan {
  const even = (value: number) => Math.max(0, Math.floor(value / 2) * 2);
  const area = clampArea(rect);
  const sx = even(area.x * source.width);
  const sy = even(area.y * source.height);
  const sw = Math.max(2, Math.min(even(source.width - sx), even(area.width * source.width)));
  const sh = Math.max(2, Math.min(even(source.height - sy), even(area.height * source.height)));
  return { sx, sy, sw, sh };
}

/**
 * The size the browser delivers for the entire screen under `max` width/height constraints
 * (it scales down to fit both, keeping the screen's shape).
 */
export function expectedScreenSize(screen: Size, max: Size): Size {
  if (!(screen.width > 0) || !(screen.height > 0)) return max;
  const scale = Math.min(1, max.width / screen.width, max.height / screen.height);
  return { width: Math.round(screen.width * scale), height: Math.round(screen.height * scale) };
}
