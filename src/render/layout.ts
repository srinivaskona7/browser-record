import type { PresenterBubbleEffect, PresenterProps, Transform } from '../project/types';

export const PRESENTER_BUBBLE_SHAPES: ReadonlyArray<{
  id: PresenterProps['shape'];
  label: string;
  shortLabel: string;
}> = [
  { id: 'circle', label: 'Circle', shortLabel: 'Circle' },
  { id: 'square', label: 'Square', shortLabel: 'Square' },
  { id: 'rounded', label: 'Rounded rectangle', shortLabel: 'Rounded' },
  { id: 'portrait', label: 'Portrait card (3:4)', shortLabel: 'Portrait' },
  { id: 'pill', label: 'Pill (stadium)', shortLabel: 'Pill' },
  { id: 'hexagon', label: 'Hexagon', shortLabel: 'Hex' },
];

export const PRESENTER_BUBBLE_EFFECTS: ReadonlyArray<{
  id: PresenterBubbleEffect;
  label: string;
  shortLabel: string;
}> = [
  { id: 'none', label: 'Natural (none)', shortLabel: 'None' },
  { id: 'warm-glow', label: 'Warm studio glow', shortLabel: 'Warm' },
  { id: 'cinema-teal', label: 'Cinema teal', shortLabel: 'Teal' },
  { id: 'bw-contrast', label: 'Noir B&W contrast', shortLabel: 'B&W' },
  { id: 'soft-focus', label: 'Soft studio focus', shortLabel: 'Soft' },
  { id: 'neon-ring', label: 'Neon cyber ring', shortLabel: 'Neon' },
];

export function presenterEffectFilter(effect?: PresenterBubbleEffect): string {
  switch (effect) {
    case 'warm-glow':
      return 'saturate(1.18) contrast(1.06) sepia(0.14) brightness(1.04)';
    case 'cinema-teal':
      return 'contrast(1.12) saturate(1.14) hue-rotate(-8deg)';
    case 'bw-contrast':
      return 'grayscale(1) contrast(1.22) brightness(1.03)';
    case 'soft-focus':
      return 'saturate(1.06) brightness(1.05) contrast(0.96)';
    case 'neon-ring':
      return 'contrast(1.14) saturate(1.26)';
    default:
      return 'none';
  }
}

export function cornerFromNormalizedCenter(x: number, y: number): PresenterProps['corner'] {
  if (x < 0.5 && y < 0.5) return 'top-left';
  if (x >= 0.5 && y < 0.5) return 'top-right';
  if (x < 0.5 && y >= 0.5) return 'bottom-left';
  return 'bottom-right';
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Source crop rectangle in source pixels, clamped to the source size. */
export function cropRect(transform: Transform, source: Size): Rect {
  const crop = transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const x = clamp(crop.x, 0, 1) * source.width;
  const y = clamp(crop.y, 0, 1) * source.height;
  const width = clamp(crop.width, 0.001, 1 - clamp(crop.x, 0, 1)) * source.width;
  const height = clamp(crop.height, 0.001, 1 - clamp(crop.y, 0, 1)) * source.height;
  return { x, y, width, height };
}

export interface Placement extends Rect {
  /** Radians. */
  rotation: number;
  opacity: number;
}

/**
 * Destination placement for a clip's media on a canvas, honoring fit mode,
 * scale, position, zoom/pan and crop. Pure math so it is unit-testable and
 * shared verbatim by preview and export.
 */
export function computePlacement(params: {
  canvas: Size;
  source: Size;
  transform: Transform;
  zoom?: number;
  panX?: number;
  panY?: number;
}): Placement {
  const { canvas, source, transform } = params;
  const zoom = params.zoom ?? 1;
  const panX = params.panX ?? 0;
  const panY = params.panY ?? 0;
  const crop = cropRect(transform, source);
  const effectiveSource = { width: crop.width, height: crop.height };
  const fit = transform.fit;
  const scale = transform.scale * zoom;

  let width: number;
  let height: number;
  if (fit === 'contain') {
    const ratio = Math.min(canvas.width / effectiveSource.width, canvas.height / effectiveSource.height);
    width = effectiveSource.width * ratio;
    height = effectiveSource.height * ratio;
  } else if (fit === 'cover') {
    const ratio = Math.max(canvas.width / effectiveSource.width, canvas.height / effectiveSource.height);
    width = effectiveSource.width * ratio;
    height = effectiveSource.height * ratio;
  } else {
    width = canvas.width;
    height = canvas.height;
  }

  width *= scale;
  height *= scale;

  const centerX = canvas.width * transform.x + panX * canvas.width;
  const centerY = canvas.height * transform.y + panY * canvas.height;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation: (transform.rotationDeg * Math.PI) / 180,
    opacity: transform.opacity,
  };
}

/** Presenter bubble geometry for a camera overlay. */
export function presenterBubble(params: { canvas: Size; presenter: PresenterProps }): Rect & { radius: number } {
  const { canvas, presenter } = params;
  const height = canvas.height * clamp(presenter.size, 0.08, 1);
  // 'portrait' is a 3:4 rounded card; 'pill' is a 4:3 stadium pill; every other shape is 1:1.
  const width =
    presenter.shape === 'portrait'
      ? height * 0.75
      : presenter.shape === 'pill'
        ? height * 1.35
        : height;
  const marginX = canvas.width * presenter.margin;
  const marginY = canvas.height * presenter.margin;
  let x = canvas.width - width - marginX;
  let y = canvas.height - height - marginY;
  if (
    typeof presenter.x === 'number' &&
    Number.isFinite(presenter.x) &&
    typeof presenter.y === 'number' &&
    Number.isFinite(presenter.y)
  ) {
    x = clamp(presenter.x * canvas.width - width / 2, 0, Math.max(0, canvas.width - width));
    y = clamp(presenter.y * canvas.height - height / 2, 0, Math.max(0, canvas.height - height));
  } else if (presenter.corner === 'top-left') {
    x = marginX;
    y = marginY;
  } else if (presenter.corner === 'top-right') {
    y = marginY;
  } else if (presenter.corner === 'bottom-left') {
    x = marginX;
  }
  const radius =
    presenter.shape === 'circle' || presenter.shape === 'pill'
      ? height / 2
      : presenter.shape === 'square' || presenter.shape === 'hexagon'
        ? 0
        : presenter.shape === 'portrait'
          ? Math.max(10, width * 0.18)
          : Math.max(8, height * 0.12);
  return { x, y, width, height, radius };
}

/** Side-by-side presenter layout: screen plate plus a camera column. */
export function sideBySideRegions(canvas: Size, cameraFraction = 0.28): { screen: Rect; camera: Rect } {
  const gap = canvas.width * 0.01;
  const cameraWidth = canvas.width * cameraFraction;
  const screenWidth = canvas.width - cameraWidth - gap * 2;
  const pad = canvas.height * 0.02;
  return {
    screen: { x: gap, y: pad, width: screenWidth, height: canvas.height - pad * 2 },
    camera: { x: screenWidth + gap * 2, y: pad, width: cameraWidth - gap, height: canvas.height - pad * 2 },
  };
}

/** Letterboxed rect: the largest k*aspect box that fits inside bounds, centered. */
export function fitInside(bounds: Rect, aspect: number): Rect {
  const width = Math.min(bounds.width, bounds.height * aspect);
  const height = width / aspect;
  return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height };
}

/** Safe-area guides (action-safe) as a rect. */
export function safeArea(canvas: Size, margin: number): Rect {
  return {
    x: canvas.width * margin,
    y: canvas.height * margin,
    width: canvas.width * (1 - margin * 2),
    height: canvas.height * (1 - margin * 2),
  };
}

/** Pick the corner with the most visual headroom, used when auto-placing bubbles. */
export function oppositeCorner(corner: PresenterProps['corner']): PresenterProps['corner'] {
  const map: Record<PresenterProps['corner'], PresenterProps['corner']> = {
    'top-left': 'bottom-right',
    'top-right': 'bottom-left',
    'bottom-left': 'top-right',
    'bottom-right': 'top-left',
  };
  return map[corner];
}

/** Easing for keyframe interpolation. */
export function ease(
  value: number,
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold',
): number {
  const t = clamp(value, 0, 1);
  switch (easing) {
    case 'hold':
      return t < 1 ? 0 : 1;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:
      return t;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * YouTube 20-second end-screen layout zones (Subscribe badge + two 16:9 video
 * recommendation cards) scaled to the canvas size.
 */
export function endScreenZone(canvas: Size): {
  subscribe: Rect;
  leftVideo: Rect;
  rightVideo: Rect;
  windowSeconds: number;
} {
  const cardW = canvas.width * 0.34;
  const cardH = Math.min(canvas.height * 0.36, cardW * (9 / 16));
  const cardY = canvas.height * 0.44;
  const gap = canvas.width * 0.06;
  const leftX = (canvas.width - cardW * 2 - gap) / 2;
  const rightX = leftX + cardW + gap;
  const subSize = Math.min(canvas.width, canvas.height) * 0.14;
  return {
    subscribe: {
      x: (canvas.width - subSize) / 2,
      y: canvas.height * 0.18,
      width: subSize,
      height: subSize,
    },
    leftVideo: { x: leftX, y: cardY, width: cardW, height: cardH },
    rightVideo: { x: rightX, y: cardY, width: cardW, height: cardH },
    windowSeconds: 20,
  };
}

/** Side-by-side Before / After split regions with a central divider. */
export function beforeAfterRegions(canvas: Size): { left: Rect; right: Rect; dividerX: number } {
  const pad = canvas.width * 0.02;
  const gap = canvas.width * 0.02;
  const halfW = (canvas.width - pad * 2 - gap) / 2;
  const height = canvas.height * 0.78;
  const y = (canvas.height - height) / 2 + canvas.height * 0.04;
  return {
    left: { x: pad, y, width: halfW, height },
    right: { x: pad + halfW + gap, y, width: halfW, height },
    dividerX: canvas.width / 2,
  };
}

/**
 * Quantize clip progress into discrete reveal steps (1..steps) for architecture
 * diagram step-by-step reveals.
 */
export function diagramRevealProgress(
  localTicks: number,
  durationTicks: number,
  steps: number,
): { fraction: number; currentStep: number; totalSteps: number } {
  const totalSteps = Math.max(1, Math.round(steps));
  if (totalSteps <= 1 || durationTicks <= 0) {
    return { fraction: 1, currentStep: 1, totalSteps: 1 };
  }
  const progress = clamp(localTicks / durationTicks, 0, 0.999999);
  const currentStep = Math.min(totalSteps, Math.floor(progress * totalSteps) + 1);
  return {
    fraction: currentStep / totalSteps,
    currentStep,
    totalSteps,
  };
}
