import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { Asset } from '../project/types';
import { secondsToTicks } from '../core/time';
import { newId } from '../core/ids';

/**
 * A still image has no intrinsic duration. Give it a usable length when it is
 * placed on the timeline, otherwise the clip is zero ticks long, preview and
 * export never select it, and "add image" looks broken.
 */
export const DEFAULT_IMAGE_DURATION_SECONDS = 5;

export interface MediaInfo {
  kind: 'video' | 'audio' | 'image';
  durationSeconds: number;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  /** Best guess at the source frame rate when the container reports one. */
  frameRate?: number;
  mimeType: string;
}

/**
 * Read real media metadata. Duration comes from the container, not from a
 * hard-coded guess, and a still image is reported as an image rather than a
 * zero-length video.
 */
export async function probeMediaFile(file: File): Promise<MediaInfo> {
  if (file.type.startsWith('image/')) {
    const bitmap = await createImageBitmap(file).catch(() => null);
    const info: MediaInfo = { kind: 'image', durationSeconds: 0, mimeType: file.type };
    if (bitmap) {
      info.width = bitmap.width;
      info.height = bitmap.height;
      bitmap.close();
    }
    return info;
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    if (videoTrack) {
      const width = await videoTrack.getDisplayWidth();
      const height = await videoTrack.getDisplayHeight();
      const audio = audioTrack
        ? { sampleRate: await audioTrack.getSampleRate(), channels: await audioTrack.getNumberOfChannels() }
        : {};
      const frameRate = await videoTrack
        .computeFrameRateMetrics({ targetPacketCount: 64 })
        .then((metrics) => metrics.bestGuessFrameRate)
        .catch(() => undefined);
      return {
        kind: 'video',
        durationSeconds: duration,
        width,
        height,
        ...(frameRate && Number.isFinite(frameRate) && frameRate > 0 ? { frameRate } : {}),
        ...audio,
        mimeType: file.type || (await input.getMimeType()),
      };
    }
    if (audioTrack) {
      return {
        kind: 'audio',
        durationSeconds: duration,
        sampleRate: await audioTrack.getSampleRate(),
        channels: await audioTrack.getNumberOfChannels(),
        mimeType: file.type || (await input.getMimeType()),
      };
    }
    throw new Error('File contains no video or audio track this browser can read.');
  } finally {
    input.dispose?.();
  }
}

/** Build a project asset record for a file that has been written to the workspace. */
export function assetFromFile(params: {
  file: File;
  info: MediaInfo;
  path: string;
  origin: Asset['origin'];
  name?: string;
}): Asset {
  const { file, info, path, origin } = params;
  return {
    id: newId('asset'),
    kind: info.kind,
    name: params.name ?? file.name,
    path,
    durationTicks: secondsToTicks(
      info.kind === 'image' ? DEFAULT_IMAGE_DURATION_SECONDS : info.durationSeconds,
    ),
    ...(info.width ? { width: info.width } : {}),
    ...(info.height ? { height: info.height } : {}),
    ...(info.sampleRate ? { sampleRate: info.sampleRate } : {}),
    ...(info.channels ? { channels: info.channels } : {}),
    origin,
    ...(info.mimeType ? { mimeType: info.mimeType } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function sanitizeFileName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'media'
  );
}

export function uniquePath(existing: readonly string[], path: string): string {
  if (!existing.includes(path)) return path;
  const dot = path.lastIndexOf('.');
  const base = dot === -1 ? path : path.slice(0, dot);
  const extension = dot === -1 ? '' : path.slice(dot);
  let index = 2;
  while (existing.includes(`${base}-${index}${extension}`)) index += 1;
  return `${base}-${index}${extension}`;
}
