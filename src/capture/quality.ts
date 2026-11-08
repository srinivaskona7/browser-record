/**
 * Capture quality targets.
 *
 * A quality target is a *request*, never a promise: the browser may hand back a
 * smaller track. The session stores the canvas that was actually chosen, so the
 * recording panel starts from the project instead of assuming 4K on every run.
 */

export type CaptureResolution = '1080' | '1440' | '4k';

export interface CaptureDimensions {
  width: number;
  height: number;
}

export const RESOLUTION_DIMENSIONS: Record<CaptureResolution, CaptureDimensions> = {
  '1080': { width: 1920, height: 1080 },
  '1440': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

/** Pick the capture target that matches the project canvas, rounding up to 1080p. */
export function resolutionForCanvas(canvas: { width: number; height: number }): CaptureResolution {
  const longEdge = Math.max(canvas.width, canvas.height);
  if (longEdge >= 3840) return '4k';
  if (longEdge >= 2560) return '1440';
  return '1080';
}

export function captureDimensions(resolution: CaptureResolution): CaptureDimensions {
  return RESOLUTION_DIMENSIONS[resolution];
}

/**
 * Bitrate that keeps terminal text sharp in a compact file size without asking a
 * 1080p capture to pretend it is 4K. ~4 Mbps at 1080p30 and ~14 Mbps at 4K30 VBR.
 */
export function recordingBitrate(width: number, height: number, fps: number): number {
  const pixels = Math.max(1, width * height);
  const pixelsPerSecond = pixels * Math.max(1, fps);
  const bitsPerPixel = 0.06;
  const floor = 2_800_000;
  const ceiling = 24_000_000;
  return Math.round(Math.min(ceiling, Math.max(floor, pixelsPerSecond * bitsPerPixel)));
}

/** Conservative first-run target when no project or measurement exists. */
export function firstRunQuality(): { resolution: CaptureResolution; fps: 30; dimensions: CaptureDimensions } {
  return { resolution: '1080', fps: 30, dimensions: RESOLUTION_DIMENSIONS['1080'] };
}

/**
 * Frame rate the project asked for, clamped to what the recording UI offers.
 */
export function frameRateForCanvas(canvas: { fps: { num: number; den: number } }): 30 | 60 {
  return canvas.fps.num / canvas.fps.den >= 50 ? 60 : 30;
}
