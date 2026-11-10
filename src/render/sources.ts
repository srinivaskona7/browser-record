import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny';
import { secondsToTicks, type Tick } from '../core/time';
import type { Asset, Project } from '../project/types';
import { activeClipAt, sourceTicks } from './compositorQuery';
import type { DrawableSource } from './compose';

export interface AssetFileProvider {
  getFile(asset: Asset): Promise<File>;
}

interface ScheduledStream {
  timestamps: number[];
  iterator: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number } | null, void, unknown>;
  cursor: number;
  currentTimestamp: number | null;
  currentDrawable: DrawableSource | null;
}

interface DecoderEntry {
  input: Input;
  videoTrack: InputVideoTrack;
  sink: CanvasSink;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  lastTimestamp?: number;
  lastDrawable?: DrawableSource;
  stream?: ScheduledStream;
}

/**
 * Deterministic frame extraction for export. Frames are decoded from the
 * original media at exact timestamps instead of being re-recorded from a live
 * preview, so export timing does not depend on playback speed.
 *
 * When `prepareTimelineSchedule` is called before the export loop, each video
 * track uses MediaBunny's sequential `canvasesAtTimestamps()` pipeline so every
 * compressed packet is decoded at most once (4×–8× faster than per-frame random
 * `getCanvas(timestamp)` GOP re-seeking) and returns the pooled canvas directly
 * without an extra 2D `drawImage` copy.
 */
export class MediaAssetResolver {
  private decoders = new Map<string, Promise<DecoderEntry | null>>();
  /** Decoded images are cached: a per-frame ImageBitmap is never closed. */
  private images = new Map<string, Promise<DrawableSource | null>>();
  /** Why an asset could not be resolved, so exports can name the cause. */
  private failures = new Map<string, string>();
  private readonly maxCanvasDimension: number;

  constructor(
    private readonly project: Project,
    private readonly files: AssetFileProvider,
    options: { maxCanvasDimension?: number } = {},
  ) {
    this.maxCanvasDimension = options.maxCanvasDimension ?? 4096;
  }

  /**
   * Pre-schedules monotonically non-decreasing frame timestamps for each video
   * asset across the export timeline so `CanvasSink.canvasesAtTimestamps` decodes
   * forward in a single pass without re-seeking from keyframes on every frame.
   */
  async prepareTimelineSchedule(frameTicksList: readonly Tick[]): Promise<void> {
    const perAsset = new Map<string, number[]>();
    for (const ticks of frameTicksList) {
      const reqs = activeSourceRequests(this.project, ticks);
      const seenInFrame = new Set<string>();
      for (const req of reqs) {
        if (seenInFrame.has(req.assetId)) continue;
        seenInFrame.add(req.assetId);
        const asset = this.project.assets.find((a) => a.id === req.assetId);
        if (!asset || asset.kind === 'image') continue;
        const ts = Math.max(0, req.atTicks / 720_000);
        let list = perAsset.get(req.assetId);
        if (!list) {
          list = [];
          perAsset.set(req.assetId, list);
        }
        list.push(ts);
      }
    }

    await Promise.all(
      [...perAsset.entries()].map(async ([assetId, timestamps]) => {
        if (timestamps.length < 2) return;
        // Verify timestamps are monotonically non-decreasing (standard forward play / hold frame)
        for (let i = 1; i < timestamps.length; i += 1) {
          if (timestamps[i]! < timestamps[i - 1]! - 1e-6) return;
        }
        const asset = this.project.assets.find((a) => a.id === assetId);
        if (!asset || asset.kind === 'image') return;
        const decoder = await this.decoder(asset);
        if (!decoder || typeof decoder.sink.canvasesAtTimestamps !== 'function') return;
        // Deduplicate consecutive identical timestamps (e.g. hold frames or 30fps source in 60fps export)
        const deduped: number[] = [];
        for (const ts of timestamps) {
          if (deduped.length === 0 || Math.abs(ts - deduped[deduped.length - 1]!) > 1e-6) {
            deduped.push(ts);
          }
        }
        const iterator = decoder.sink.canvasesAtTimestamps(deduped, { verifyKeyPackets: false });
        decoder.stream = {
          timestamps: deduped,
          iterator,
          cursor: 0,
          currentTimestamp: null,
          currentDrawable: null,
        };
      }),
    );
  }

  async resolve(assetId: string, atTicks: Tick): Promise<DrawableSource | null> {
    const asset = this.project.assets.find((a) => a.id === assetId);
    if (!asset) {
      this.failures.set(assetId, 'the asset is not in this project');
      return null;
    }
    if (asset.kind === 'image') {
      return this.loadImage(asset);
    }
    const decoder = await this.decoder(asset);
    if (!decoder) return null;
    const timestamp = Math.max(0, atTicks / 720_000);

    // Fast path 1: reuse identical consecutive frame (hold frame / frame rate step)
    if (
      decoder.lastTimestamp !== undefined &&
      decoder.lastDrawable &&
      Math.abs(decoder.lastTimestamp - timestamp) <= 1e-6
    ) {
      return decoder.lastDrawable;
    }

    // Fast path 2: sequential streaming iterator (decodes each packet at most once, zero-copy)
    const stream = decoder.stream;
    if (stream && stream.cursor < stream.timestamps.length) {
      const expectedTs = stream.timestamps[stream.cursor]!;
      if (Math.abs(expectedTs - timestamp) <= 1e-4) {
        stream.cursor += 1;
        const next = await stream.iterator.next();
        if (!next.done && next.value) {
          const drawable: DrawableSource = {
            image: next.value.canvas as unknown as CanvasImageSource,
            width: decoder.width,
            height: decoder.height,
          };
          decoder.lastTimestamp = timestamp;
          decoder.lastDrawable = drawable;
          return drawable;
        }
      } else {
        // Fallback to random access if timeline order diverged
        void stream.iterator.return?.();
        decoder.stream = undefined;
      }
    }

    const wrapped = await decoder.sink.getCanvas(timestamp, { verifyKeyPackets: false });
    if (!wrapped) {
      this.failures.set(assetId, `no decodable frame at ${timestamp.toFixed(3)}s`);
      return null;
    }
    const drawable: DrawableSource = {
      image: wrapped.canvas as unknown as CanvasImageSource,
      width: decoder.width,
      height: decoder.height,
    };
    decoder.lastTimestamp = timestamp;
    decoder.lastDrawable = drawable;
    return drawable;
  }

  /** Last reason this asset failed to resolve, or null if it resolved. */
  failureFor(assetId: string): string | null {
    return this.failures.get(assetId) ?? null;
  }

  /** Called when a resolve throws, so the export can name the real cause. */
  recordFailure(assetId: string, message: string): void {
    this.failures.set(assetId, message || 'the source could not be read');
  }

  private loadImage(asset: Asset): Promise<DrawableSource | null> {
    const cached = this.images.get(asset.id);
    if (cached) return cached;
    const created = (async (): Promise<DrawableSource | null> => {
      try {
        const file = await this.files.getFile(asset);
        const bitmap = await createImageBitmap(file);
        return { image: bitmap, width: bitmap.width, height: bitmap.height };
      } catch (error) {
        this.failures.set(asset.id, (error as Error).message || 'the image could not be decoded');
        return null;
      }
    })();
    this.images.set(asset.id, created);
    return created;
  }

  private decoder(asset: Asset): Promise<DecoderEntry | null> {
    const existing = this.decoders.get(asset.id);
    if (existing) return existing;
    const created = this.createDecoder(asset).catch((error) => {
      this.failures.set(asset.id, (error as Error).message || 'the decoder could not be created');
      console.warn(`Cannot decode ${asset.name}:`, error);
      return null;
    });
    this.decoders.set(asset.id, created);
    return created;
  }

  private async createDecoder(asset: Asset): Promise<DecoderEntry | null> {
    const file = await this.files.getFile(asset);
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      this.failures.set(asset.id, 'the file has no video track this browser can read');
      return null;
    }
    const displayWidth = (await videoTrack.getDisplayWidth().catch(() => asset.width ?? 1920)) || asset.width || 1920;
    const displayHeight = (await videoTrack.getDisplayHeight().catch(() => asset.height ?? 1080)) || asset.height || 1080;
    const scale = Math.min(1, this.maxCanvasDimension / Math.max(displayWidth, displayHeight));
    const width = Math.max(2, Math.round(displayWidth * scale));
    const height = Math.max(2, Math.round(displayHeight * scale));
    const canvas = createScratchCanvas(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) {
      this.failures.set(asset.id, 'no 2D canvas context is available for decoding');
      return null;
    }
    // width/height above already keep the source aspect ratio, so 'fill' is
    // exact. mediabunny throws when both are given without a fit mode, which
    // made every exported clip decode to nothing.
    const sink = new CanvasSink(videoTrack, { width, height, fit: 'fill', poolSize: 4 });
    return { input, videoTrack, sink, canvas, ctx, width, height };
  }

  async close(): Promise<void> {
    for (const entry of this.decoders.values()) {
      const decoder = await entry.catch(() => null);
      if (decoder?.stream) {
        await decoder.stream.iterator.return?.().catch(() => undefined);
      }
      decoder?.input.dispose?.();
    }
    this.decoders.clear();
    for (const entry of this.images.values()) {
      const drawable = await entry.catch(() => null);
      const bitmap = drawable?.image as ImageBitmap | undefined;
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
    this.images.clear();
  }
}

function createScratchCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export interface ActiveSourceRequest {
  assetId: string;
  atTicks: Tick;
}

/** Every video clip active at a timeline position, with the source time to read. */
export function activeSourceRequests(project: Project, ticks: Tick): ActiveSourceRequest[] {
  const requests: ActiveSourceRequest[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = activeClipAt(track, ticks);
    if (!clip?.assetId) continue;
    requests.push({ assetId: clip.assetId, atTicks: sourceTicks(clip, ticks) });
  }
  return requests;
}

export interface PreparedFrame {
  sources: Map<string, DrawableSource>;
  /** Asset ids that a clip needed but could not be decoded for this frame. */
  missing: string[];
}

/**
 * Resolve all sources needed for one frame before drawing. Rendering itself
 * stays synchronous, which is what lets preview and export share it.
 *
 * Unresolvable assets are reported in `missing` rather than dropped, so an
 * export can never finish "successfully" with silently blank clips.
 */
export async function prepareFrameSources(
  project: Project,
  ticks: Tick,
  resolver: {
    resolve(assetId: string, atTicks: Tick): Promise<DrawableSource | null>;
    recordFailure?(assetId: string, message: string): void;
  },
): Promise<PreparedFrame> {
  const requests = activeSourceRequests(project, ticks);
  const unique = new Map<string, Tick>();
  for (const request of requests) {
    if (!unique.has(request.assetId)) unique.set(request.assetId, request.atTicks);
  }
  const map = new Map<string, DrawableSource>();
  const missing: string[] = [];
  await Promise.all(
    [...unique.entries()].map(async ([assetId, atTicks]) => {
      try {
        const drawable = await resolver.resolve(assetId, atTicks);
        if (drawable) map.set(assetId, drawable);
        else missing.push(assetId);
      } catch (error) {
        resolver.recordFailure?.(assetId, (error as Error).message);
        missing.push(assetId);
      }
    }),
  );
  return { sources: map, missing };
}

export function ticksFromSeconds(seconds: number): Tick {
  return secondsToTicks(seconds);
}
