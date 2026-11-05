import { describe, expect, it } from 'vitest';
import {
  clamp,
  computePlacement,
  ease,
  fitInside,
  oppositeCorner,
  presenterBubble,
  safeArea,
  sideBySideRegions,
} from '../src/render/layout';
import type { PresenterProps, Transform } from '../src/project/types';

const CANVAS = { width: 3840, height: 2160 };

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotationDeg: 0,
    opacity: 1,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    radius: 0,
    shadow: 0,
    borderWidth: 0,
    borderColor: '#000',
    ...overrides,
  };
}

function presenter(overrides: Partial<PresenterProps> = {}): PresenterProps {
  return {
    layout: 'bubble',
    corner: 'bottom-right',
    size: 0.25,
    margin: 0.04,
    shape: 'circle',
    mirror: false,
    chromaKey: false,
    shadow: 0,
    border: 0,
    borderColor: '#ffffff',
    ...overrides,
  };
}

describe('clip placement', () => {
  it('letterboxes a 16:9 source into a 16:9 canvas edge to edge', () => {
    const placement = computePlacement({ canvas: CANVAS, source: { width: 1920, height: 1080 }, transform: transform() });
    expect(placement.x).toBe(0);
    expect(placement.y).toBe(0);
    expect(placement.width).toBe(3840);
    expect(placement.height).toBe(2160);
  });

  it('pillarboxes a 4:3 source instead of distorting it', () => {
    const placement = computePlacement({ canvas: CANVAS, source: { width: 1024, height: 768 }, transform: transform() });
    expect(placement.height).toBe(2160);
    expect(placement.width).toBe(2880);
    expect(placement.x).toBe(480);
    expect(placement.y).toBe(0);
  });

  it('cover crops overflow outside the canvas while keeping aspect', () => {
    const placement = computePlacement({
      canvas: CANVAS,
      source: { width: 1920, height: 1080 },
      transform: transform({ fit: 'cover' }),
    });
    expect(placement.width / placement.height).toBeCloseTo(16 / 9);
  });

  it('applies zoom around the frame centre and pan in canvas fractions', () => {
    const zoomed = computePlacement({
      canvas: CANVAS,
      source: { width: 1920, height: 1080 },
      transform: transform(),
      zoom: 2,
    });
    expect(zoomed.width).toBe(7680);
    expect(zoomed.x).toBe(-1920);
    expect(zoomed.y).toBe(1080 - 2160);

    const panned = computePlacement({
      canvas: CANVAS,
      source: { width: 1920, height: 1080 },
      transform: transform(),
      panX: 0.1,
    });
    expect(panned.x).toBeCloseTo(1920 + 384 - 1920, 5);
  });

  it('crops before fitting, so a half-width crop still fills the canvas', () => {
    const placement = computePlacement({
      canvas: CANVAS,
      source: { width: 1920, height: 1080 },
      transform: transform({ crop: { x: 0, y: 0, width: 0.5, height: 1 } }),
    });
    expect(placement.height).toBe(2160);
    expect(placement.width).toBe(1920);
  });

  it('converts rotation to radians and keeps opacity', () => {
    const placement = computePlacement({
      canvas: CANVAS,
      source: { width: 1920, height: 1080 },
      transform: transform({ rotationDeg: 90, opacity: 0.5 }),
    });
    expect(placement.rotation).toBeCloseTo(Math.PI / 2);
    expect(placement.opacity).toBe(0.5);
  });
});

describe('presenter geometry', () => {
  it('keeps the bubble inside the canvas for every corner', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const bubble = presenterBubble({ canvas: CANVAS, presenter: presenter({ corner }) });
      expect(bubble.x).toBeGreaterThanOrEqual(0);
      expect(bubble.y).toBeGreaterThanOrEqual(0);
      expect(bubble.x + bubble.width).toBeLessThanOrEqual(CANVAS.width);
      expect(bubble.y + bubble.height).toBeLessThanOrEqual(CANVAS.height);
    }
  });

  it('sizes the bubble from canvas height and clamps absurd values', () => {
    const normal = presenterBubble({ canvas: CANVAS, presenter: presenter({ size: 0.25 }) });
    expect(normal.width).toBe(540);
    expect(normal.radius).toBe(270);
    const huge = presenterBubble({ canvas: CANVAS, presenter: presenter({ size: 4 }) });
    expect(huge.width).toBe(2160);
    const tiny = presenterBubble({ canvas: CANVAS, presenter: presenter({ size: 0 }) });
    expect(tiny.width).toBeCloseTo(172.8, 5);
  });

  it('gives a square shape no corner radius', () => {
    expect(presenterBubble({ canvas: CANVAS, presenter: presenter({ shape: 'square' }) }).radius).toBe(0);
    expect(presenterBubble({ canvas: CANVAS, presenter: presenter({ shape: 'rounded' }) }).radius).toBeGreaterThan(0);
  });

  it('makes a portrait card 3:4 and keeps it inside the canvas', () => {
    const bubble = presenterBubble({ canvas: CANVAS, presenter: presenter({ shape: 'portrait', corner: 'bottom-right' }) });
    expect(bubble.width / bubble.height).toBeCloseTo(0.75, 5);
    expect(bubble.width).toBeLessThan(bubble.height);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(CANVAS.width);
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(CANVAS.height);
    expect(bubble.radius).toBeGreaterThan(0);
  });

  it('splits the frame into non-overlapping screen and camera regions', () => {
    const { screen, camera } = sideBySideRegions(CANVAS);
    expect(screen.x + screen.width).toBeLessThanOrEqual(camera.x);
    expect(camera.x + camera.width).toBeLessThanOrEqual(CANVAS.width);
    expect(screen.height).toBe(camera.height);
  });
});

describe('framing helpers', () => {
  it('fits a 9:16 clip inside a 16:9 safe area without overflow', () => {
    const bounds = safeArea(CANVAS, 0.05);
    const fitted = fitInside(bounds, 9 / 16);
    expect(fitted.height).toBeCloseTo(bounds.height);
    expect(fitted.width).toBeCloseTo(bounds.height * (9 / 16));
    expect(fitted.y).toBeGreaterThanOrEqual(bounds.y);
  });

  it('safe area shrinks by the margin on every side', () => {
    expect(safeArea(CANVAS, 0.1)).toEqual({ x: 384, y: 216, width: 3072, height: 1728 });
  });

  it('opposite corners are distinct', () => {
    expect(oppositeCorner('top-left')).toBe('bottom-right');
    expect(oppositeCorner('bottom-right')).toBe('top-left');
  });

  it('clamps and eases monotonically', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(ease(0, 'ease-in-out')).toBe(0);
    expect(ease(1, 'ease-in-out')).toBe(1);
    expect(ease(0.5, 'ease-in')).toBeLessThan(0.5);
    expect(ease(0.5, 'ease-out')).toBeGreaterThan(0.5);
  });
});
