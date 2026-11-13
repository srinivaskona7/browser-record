import { describe, expect, it } from 'vitest';
import {
  AREA_MIN_PX,
  DEFAULT_AREA,
  clampArea,
  expectedScreenSize,
  moveAreaPx,
  nudgeArea,
  planAreaCrop,
  resizeAreaPx,
  snapAreaToAspect,
  toAreaFractions,
  toAreaPixels,
} from '../src/capture/areaSelection';

const bounds = { width: 800, height: 500 };

describe('area selection geometry', () => {
  it('round-trips between selector pixels and screen fractions', () => {
    const px = toAreaPixels(DEFAULT_AREA, bounds);
    expect(toAreaFractions(px, bounds)).toEqual(DEFAULT_AREA);
  });

  it('crops the stream by fraction of the stream, not of the page', () => {
    // The old crop divided page pixels by window.innerWidth; a box drawn over the left half
    // of the frame must take the left half of a 2560×1600 capture.
    expect(planAreaCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }, { width: 2560, height: 1600 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 1280,
      sh: 800,
    });
  });

  it('keeps crop offsets and sizes even and inside the source', () => {
    const plan = planAreaCrop({ x: 0.3333, y: 0.7777, width: 0.9, height: 0.9 }, { width: 1511, height: 983 });
    for (const value of Object.values(plan)) expect(value % 2).toBe(0);
    expect(plan.sx + plan.sw).toBeLessThanOrEqual(1511);
    expect(plan.sy + plan.sh).toBeLessThanOrEqual(983);
  });

  it('moves inside the selector', () => {
    const start = { x: 700, y: 400, width: 200, height: 100 };
    expect(moveAreaPx(start, 500, 500, bounds)).toEqual({ x: 600, y: 400, width: 200, height: 100 });
    expect(moveAreaPx(start, -2000, -2000, bounds)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('resizes from the anchor towards the pointer in every direction', () => {
    expect(resizeAreaPx({ x: 100, y: 100 }, { x: 300, y: 250 }, bounds, 'free')).toEqual({ x: 100, y: 100, width: 200, height: 150 });
    expect(resizeAreaPx({ x: 300, y: 250 }, { x: 100, y: 100 }, bounds, 'free')).toEqual({ x: 100, y: 100, width: 200, height: 150 });
  });

  it('never resizes below the minimum or past the selector edge', () => {
    const tiny = resizeAreaPx({ x: 100, y: 100 }, { x: 101, y: 101 }, bounds, 'free');
    expect(tiny.width).toBe(AREA_MIN_PX);
    expect(tiny.height).toBe(AREA_MIN_PX);
    const huge = resizeAreaPx({ x: 100, y: 100 }, { x: 5000, y: 5000 }, bounds, 'free');
    expect(huge).toEqual({ x: 100, y: 100, width: 700, height: 400 });
  });

  it('holds a locked ratio while resizing, including against the edge', () => {
    const r = resizeAreaPx({ x: 0, y: 0 }, { x: 320, y: 10 }, bounds, '16:9');
    expect(r.width / r.height).toBeCloseTo(16 / 9);
    expect(r.width).toBeCloseTo(320);
    const edge = resizeAreaPx({ x: 0, y: 0 }, { x: 5000, y: 5000 }, bounds, '1:1');
    expect(edge).toEqual({ x: 0, y: 0, width: 500, height: 500 });
  });

  it('snaps to a preset around the centre in screen pixels', () => {
    const screenAspect = 16 / 10;
    const snapped = snapAreaToAspect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, '9:16', screenAspect);
    // Ratio in on-screen pixels: (width × screenAspect) / height.
    expect((snapped.width * screenAspect) / snapped.height).toBeCloseTo(9 / 16);
    expect(snapped.x + snapped.width / 2).toBeCloseTo(0.5);
    expect(snapped.y + snapped.height / 2).toBeCloseTo(0.5);
    expect(snapped.y).toBeGreaterThanOrEqual(0);
    expect(snapped.y + snapped.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(snapAreaToAspect(DEFAULT_AREA, 'free', screenAspect)).toEqual(DEFAULT_AREA);
  });

  it('moves and resizes from the keyboard, ignoring other keys', () => {
    const start = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    const moved = nudgeArea(start, 'ArrowRight', false, 'free', 16 / 9);
    expect(moved?.x).toBeCloseTo(0.21);
    expect(moved?.width).toBeCloseTo(0.5);
    const grown = nudgeArea(start, 'ArrowDown', true, 'free', 16 / 9);
    expect(grown?.height).toBeCloseTo(0.51);
    expect(grown?.y).toBeCloseTo(0.2);
    const shrunkLocked = nudgeArea({ x: 0, y: 0, width: 0.5, height: 0.5 }, 'ArrowLeft', true, '1:1', 1);
    expect(shrunkLocked?.width).toBeCloseTo(0.49);
    expect(shrunkLocked?.height).toBeCloseTo(0.49);
    expect(nudgeArea(start, 'Enter', false, 'free', 16 / 9)).toBeNull();
  });

  it('clamps corrupt selections back into the screen', () => {
    const clamped = clampArea({ x: -1, y: 2, width: 0.5, height: Number.NaN });
    expect(clamped.x).toBe(0);
    expect(clamped.width).toBe(0.5);
    expect(clamped.height).toBe(0.7);
    expect(clamped.y).toBeCloseTo(0.3);
  });

  it('predicts the stream size under a resolution cap, keeping the screen shape', () => {
    expect(expectedScreenSize({ width: 3024, height: 1964 }, { width: 1920, height: 1080 })).toEqual({ width: 1663, height: 1080 });
    expect(expectedScreenSize({ width: 1280, height: 720 }, { width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 });
  });
});
