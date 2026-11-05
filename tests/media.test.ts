import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_DURATION_SECONDS, assetFromFile } from '../src/media/probe';
import { TICKS_PER_SECOND } from '../src/core/time';

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('asset records', () => {
  it('gives a still image a usable timeline duration instead of zero ticks', () => {
    const asset = assetFromFile({
      file: file('cover.png', 'image/png'),
      info: { kind: 'image', durationSeconds: 0, width: 1280, height: 720, mimeType: 'image/png' },
      path: 'media/originals/cover.png',
      origin: 'imported',
    });
    expect(asset.durationTicks).toBe(DEFAULT_IMAGE_DURATION_SECONDS * TICKS_PER_SECOND);
    expect(asset.width).toBe(1280);
    expect(asset.kind).toBe('image');
  });

  it('keeps the real duration of a video', () => {
    const asset = assetFromFile({
      file: file('lesson.webm', 'video/webm'),
      info: { kind: 'video', durationSeconds: 12.5, width: 1920, height: 1080, mimeType: 'video/webm' },
      path: 'media/originals/lesson.webm',
      origin: 'recorded',
    });
    expect(asset.durationTicks).toBe(12.5 * TICKS_PER_SECOND);
  });
});
