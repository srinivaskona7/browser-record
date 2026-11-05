import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { TICKS_PER_SECOND, frameToTicks, type Tick } from '../core/time';
import type { Project } from '../project/types';
import {
  probeAudioEncoder,
  probeVideoEncoder,
  mediaBunnyAudioCodec,
  mediaBunnyVideoCodec,
  AUDIO_CODECS,
  VIDEO_CODECS,
  type CodecCandidate,
  type CodecSupport,
} from '../capabilities/codecs';
import { mixdownProject, type AudioResolver, type MixdownResult } from '../audio/mixdown';
import { renderFrame } from '../render/compose';
import { MediaAssetResolver, prepareFrameSources } from '../render/sources';
import { frameCount } from '../project/factory';
import { formatBytes, planBitrate, type ExportPreset } from './presets';
import type { DirectoryHandleLike, FileHandleLike, WritableLike } from '../workspace/types';
import { resolveFile } from '../workspace/workspace';

export interface ExportProgress {
  phase: 'prepare' | 'audio' | 'video' | 'finalize' | 'done';
  frame: number;
  totalFrames: number;
  progress: number;
  fps: number;
  bytesWritten: number;
  etaSeconds: number;
  detail?: string;
}

export interface ExportResult {
  path?: string;
  buffer?: ArrayBuffer;
  width: number;
  height: number;
  durationSeconds: number;
  videoCodec: string;
  audioCodec: string | null;
  container: 'mp4' | 'webm';
  bytes: number;
  frames: number;
  warnings: string[];
  /** Whether the audio track exists in the output. */
  hasAudio: boolean;
}

export interface ExportRequest {
  project: Project;
  preset: ExportPreset;
  /** Overrides when the user picked a custom target size or bitrate. */
  videoBitrate?: number;
  audioBitrate?: number;
  width?: number;
  height?: number;
  /** Where the file goes. Omit to get an ArrayBuffer back for a download. */
  destination?: { root: DirectoryHandleLike; path: string };
  getAssetFile: (assetPath: string) => Promise<File>;
  audioResolver?: AudioResolver;
  createAudioContext?: () => AudioContext;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  includeCaptions?: boolean;
  /** Mixdown loudness target in dBFS peak; applied as a master trim. */
  normalizePeakDb?: number;
}

export class ExportCancelled extends Error {
  constructor(readonly partialFileMayRemain = false) {
    super(partialFileMayRemain ? 'Export cancelled; a partial file may remain' : 'Export cancelled');
    this.name = 'ExportCancelled';
  }
}

/**
 * Render the whole timeline offline and mux it to a file. Every frame is drawn
 * from original media at a deterministic timestamp, so the result does not
 * depend on preview playback speed or on how fast the editor runs.
 */
export async function exportProject(request: ExportRequest): Promise<ExportResult> {
  const { project, preset } = request;
  const width = request.width ?? preset.width;
  const height = request.height ?? preset.height;
  const fps = project.canvas.fps;
  const fpsNumber = fps.num / fps.den;
  const totalFrames = frameCount(project);
  const durationSeconds = project.durationTicks / TICKS_PER_SECOND;
  const warnings: string[] = [];
  const assertNotCancelled = () => {
    if (request.signal?.aborted) throw new ExportCancelled();
  };

  if (totalFrames <= 0) throw new Error('The timeline is empty — add a clip before exporting.');
  if (width > project.canvas.width || height > project.canvas.height) {
    warnings.push(
      `Exporting at ${width}×${height} from a ${project.canvas.width}×${project.canvas.height} composition upscales; detail cannot exceed the composition size.`,
    );
  }
  const targetAspect = width / height;
  const sourceAspect = project.canvas.width / project.canvas.height;
  const aspectMismatch = Math.abs(targetAspect - sourceAspect) > 0.01;
  if (aspectMismatch) {
    warnings.push(
      `Export frame is ${width}×${height} (${targetAspect.toFixed(2)}:1) but the composition is ${project.canvas.width}×${project.canvas.height} (${sourceAspect.toFixed(2)}:1). Frames are letterboxed, not stretched; a Custom preset at the composition size avoids the bars.`,
    );
  }

  // Uniform scale with centring: non-uniform scaling distorted vertical or
  // square projects exported through a 16:9 preset.
  const frameScale = Math.min(width / project.canvas.width, height / project.canvas.height);
  const frameOffsetX = (width - project.canvas.width * frameScale) / 2;
  const frameOffsetY = (height - project.canvas.height * frameScale) / 2;

  // Codec selection is measured, not assumed.
  const videoSupport: CodecSupport[] = [];
  for (const codec of VIDEO_CODECS) {
    if (!preset.codecPreference.includes(codec.family as never)) continue;
    videoSupport.push(await probeVideoEncoder(codec, width, height, fpsNumber, request.videoBitrate ?? preset.videoBitrate));
  }
  let chosenVideo = videoSupport.find((support) => support.encoderSupported);
  if (!chosenVideo) {
    // WebM is the fallback container when H.264 is unavailable but VP9/VP8 is.
    const webm = await probeVideoEncoder(VIDEO_CODECS.find((c) => c.family === 'vp9')!, width, height, fpsNumber, preset.videoBitrate);
    if (webm.encoderSupported) chosenVideo = webm;
  }
  if (!chosenVideo) {
    const reasons = videoSupport.map((s) => `${s.codec.label}: ${s.reason ?? 'unsupported'}`).join('; ');
    throw new Error(`No usable video encoder at ${width}×${height}. ${reasons}`);
  }
  // Container and codec must agree. A VP9 stream inside an announced MP4 file
  // is the kind of silent substitution that produced unplayable exports, so the
  // container follows the measured codec and the change is stated up front.
  const container = containerForCodec(chosenVideo.codec.family, preset.container);
  if (container !== preset.container) {
    warnings.push(
      `${chosenVideo.codec.label} is the supported encoder here, so this export is ${container.toUpperCase()} (${chosenVideo.codec.label}) instead of ${preset.container.toUpperCase()}.`,
    );
  }
  const videoBitrate = request.videoBitrate ?? preset.videoBitrate;
  const audioBitrate = request.audioBitrate ?? preset.audioBitrate;

  let audioCodec = await pickAudioCodec(container, audioBitrate, project.settings.sampleRate);
  if (!audioCodec) {
    warnings.push('No supported audio encoder for this container; the export will be silent.');
  }

  const budget = planBitrate({
    durationSeconds,
    width,
    height,
    fps: fpsNumber,
    audioBitrate: audioCodec ? audioBitrate : 0,
    videoBitrate,
  });
  warnings.push(...budget.warnings);

  // Output plumbing.
  const chunksToFile: Uint8Array[] = [];
  let written = 0;
  let fileHandle: FileHandleLike | null = null;
  let fileWritable: WritableLike | null = null;
  let target: BufferTarget | StreamTarget;

  if (request.destination) {
    fileHandle = await resolveFile(request.destination.root, request.destination.path, true);
    const writable = await fileHandle.createWritable();
    fileWritable = writable;
    target = new StreamTarget(
      new WritableStream<{ type: 'write'; data: Uint8Array<ArrayBuffer>; position: number }>({
        write: async (chunk) => {
          await writable.write({ type: 'write', position: chunk.position, data: chunk.data });
          written += chunk.data.byteLength;
        },
      }),
      { chunked: false },
    );
  } else {
    target = new BufferTarget({
      onFinalize: (buffer) => {
        chunksToFile.push(new Uint8Array(buffer));
      },
    });
  }

  const format = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
  const output = new Output({ format, target });
  const canvas = createExportCanvas(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Could not create the export canvas.');

  const videoSource = new CanvasSource(canvas, {
    codec: mediaBunnyVideoCodec(chosenVideo.codec) as VideoCodec,
    quality: new Quality({ bitrate: videoBitrate, bitrateMode: 'variable' }),
  });
  output.addVideoTrack(videoSource, { frameRate: fpsNumber });

  let audioBuffer: AudioBuffer | null = null;
  let audioSource: AudioBufferSource | null = null;
  if (audioCodec) {
    request.onProgress?.({
      phase: 'audio',
      frame: 0,
      totalFrames,
      progress: 0.02,
      fps: 0,
      bytesWritten: 0,
      etaSeconds: 0,
      detail: 'Mixing audio from originals',
    });
    assertNotCancelled();
    try {
      const resolver = request.audioResolver ?? createAudioResolver(request, project);
      const mixdown: MixdownResult = await mixdownProject(project, resolver, {
        sampleRate: project.settings.sampleRate,
        startTicks: 0,
        durationTicks: project.durationTicks,
        ducking: true,
        channels: 2,
      });
      warnings.push(...mixdown.warnings);
      audioBuffer = mixdown.buffer;
      if (audioBuffer && request.normalizePeakDb !== undefined) {
        applyPeakTrim(audioBuffer, request.normalizePeakDb);
      }
    } catch (error) {
      // A decode failure in one source must not throw the whole lesson away.
      // Say the export is silent rather than producing sound that is not there.
      warnings.push(
        `Audio could not be mixed (${(error as Error).message}); this export will be silent even though an audio track was requested.`,
      );
      audioBuffer = null;
    }
    if (audioBuffer) {
      audioSource = new AudioBufferSource({
        codec: mediaBunnyAudioCodec(audioCodec) as AudioCodec,
        quality: new Quality({ bitrate: audioBitrate }),
      });
      output.addAudioTrack(audioSource, {});
    } else {
      audioCodec = null;
    }
  }
  await output.start();
  if (audioSource && audioBuffer) await audioSource.add(audioBuffer);

  const mediaResolver = new MediaAssetResolver(project, {
    getFile: async (asset) => request.getAssetFile(asset.path),
  });
  const started = performance.now();
  let framesDone = 0;
  let lastReport = 0;
  // assetId -> { frames, reason }, so a decoder failure becomes a named warning
  // instead of a blank clip that still reports success.
  const unresolved = new Map<string, { frames: number; reason: string | null }>();

  try {
    for (let frame = 0; frame < totalFrames; frame += 1) {
      assertNotCancelled();
      const ticks = frameToTicks(frame, fps);
      const prepared = await prepareFrameSources(project, ticks, mediaResolver);
      for (const assetId of prepared.missing) {
        const entry = unresolved.get(assetId) ?? {
          frames: 0,
          reason: mediaResolver.failureFor(assetId),
        };
        entry.frames += 1;
        if (!entry.reason) entry.reason = mediaResolver.failureFor(assetId);
        unresolved.set(assetId, entry);
      }
      const sources = prepared.sources;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = project.canvas.background;
      ctx.fillRect(0, 0, width, height);
      ctx.translate(frameOffsetX, frameOffsetY);
      ctx.scale(frameScale, frameScale);
      renderFrame(ctx, project, {
        timeTicks: ticks,
        lookup: (assetId) => sources.get(assetId) ?? null,
        captionsEnabled: request.includeCaptions !== false,
      });
      ctx.restore();
      await videoSource.add(frame / fpsNumber, 1 / fpsNumber);
      framesDone += 1;
      const now = performance.now();
      if (now - lastReport > 250 || frame === totalFrames - 1) {
        lastReport = now;
        const elapsed = (now - started) / 1000;
        const rate = elapsed > 0 ? framesDone / elapsed : 0;
        const remaining = rate > 0 ? (totalFrames - framesDone) / rate : 0;
        request.onProgress?.({
          phase: 'video',
          frame: framesDone,
          totalFrames,
          progress: 0.05 + (framesDone / totalFrames) * 0.9,
          fps: rate,
          bytesWritten: written,
          etaSeconds: remaining,
        });
      }
    }
    assertNotCancelled();
    if (framesDone !== totalFrames) {
      throw new Error(`Only ${framesDone} of ${totalFrames} frames were rendered.`);
    }
    request.onProgress?.({
      phase: 'finalize',
      frame: framesDone,
      totalFrames,
      progress: 0.96,
      fps: (framesDone * 1000) / Math.max(1, performance.now() - started),
      bytesWritten: written,
      etaSeconds: 0,
    });
    await output.finalize();
    // Closing the destination belongs to the same failure domain as finalize:
    // a disk-full close must not escape past the cleanup below.
    if (fileWritable) await fileWritable.close();
  } catch (error) {
    try {
      await output.cancel();
    } catch {
      /* already finalized or cancelled */
    }
    try {
      await fileWritable?.abort?.();
    } catch {
      /* ignore */
    }
    let leftoverPath: string | null = null;
    if (request.destination && fileHandle) {
      const removed = await deleteQuietly(request.destination.root, request.destination.path);
      if (!removed) leftoverPath = request.destination.path;
    }
    try {
      await mediaResolver.close();
    } catch {
      // Cleanup must never replace the real error.
    }
    if (error instanceof ExportCancelled) throw new ExportCancelled(leftoverPath !== null);
    const leftover = leftoverPath ? ` A partial file may remain at ${leftoverPath}.` : '';
    throw new Error(`Export failed: ${(error as Error).message}.${leftover}`, { cause: error });
  }

  await mediaResolver.close();
  const buffer = target instanceof BufferTarget ? (target.buffer ?? concatChunks(chunksToFile)) : undefined;
  const bytes = buffer ? buffer.byteLength : written;
  request.onProgress?.({
    phase: 'done',
    frame: totalFrames,
    totalFrames,
    progress: 1,
    fps: (framesDone * 1000) / Math.max(1, performance.now() - started),
    bytesWritten: bytes,
    etaSeconds: 0,
  });

  // Never let an unreadable asset read as a clean export.
  for (const [assetId, failure] of unresolved) {
    const asset = project.assets.find((a) => a.id === assetId);
    const name = asset?.name ?? assetId;
    const reason = failure.reason ? ` (${failure.reason})` : '';
    warnings.push(
      `${name} could not be decoded for ${failure.frames} frame(s)${reason}. Those clips are blank in this export.`,
    );
  }

  return {
    path: request.destination?.path,
    buffer: buffer ?? undefined,
    width,
    height,
    durationSeconds,
    videoCodec: chosenVideo.codec.label,
    audioCodec: audioCodec?.label ?? null,
    container,
    bytes,
    frames: totalFrames,
    warnings,
    hasAudio: Boolean(audioCodec && audioBuffer),
  };
}

function containerForCodec(family: CodecCandidate['family'], preferred: 'mp4' | 'webm'): 'mp4' | 'webm' {
  if (family === 'vp8' || family === 'vp9') return 'webm';
  if (family === 'h264' || family === 'hevc') return 'mp4';
  // AV1 is legal in both; keep the user's container when possible.
  return preferred;
}

async function pickAudioCodec(container: 'mp4' | 'webm', bitrate: number, sampleRate: number) {
  // WebM carries Opus; muxing AAC into WebM produces a file many players reject.
  const families = container === 'mp4' ? ['aac', 'opus'] : ['opus'];
  for (const family of families) {
    const codec = AUDIO_CODECS.find((c) => c.family === family);
    if (!codec) continue;
    const support = await probeAudioEncoder(codec, sampleRate, 2, bitrate);
    if (support.encoderSupported) return codec;
  }
  return null;
}

function applyPeakTrim(buffer: AudioBuffer, targetPeakDb: number): void {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
  }
  if (peak <= 0) return;
  const target = Math.pow(10, targetPeakDb / 20);
  const gain = target / peak;
  if (gain >= 1) return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = data[i]! * gain;
  }
}

function createExportCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function concatChunks(chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** Returns false when the partial file is still on disk, so callers can say so. */
async function deleteQuietly(root: DirectoryHandleLike, path: string): Promise<boolean> {
  try {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) return false;
    let dir = root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    await dir.removeEntry(name);
    return true;
  } catch {
    // A partially written file the user can delete is better than a crash here,
    // but the caller must be told it is still there.
    return false;
  }
}

/** Decode original audio assets for the offline mixdown. */
export function createAudioResolver(request: ExportRequest, project: Project): AudioResolver {
  const contextFactory = request.createAudioContext ?? (() => new AudioContext({ sampleRate: project.settings.sampleRate }));
  let context: AudioContext | null = null;
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  return {
    getBuffer: async (assetId: string) => {
      const existing = cache.get(assetId);
      if (existing) return existing;
      const promise = (async () => {
        const asset = project.assets.find((a) => a.id === assetId);
        if (!asset) return null;
        try {
          context ??= contextFactory();
          const file = await request.getAssetFile(asset.path);
          const bytes = await file.arrayBuffer();
          return await context.decodeAudioData(bytes);
        } catch (error) {
          console.warn(`Could not decode audio for ${asset?.name ?? assetId}`, error);
          return null;
        }
      })();
      cache.set(assetId, promise);
      return promise;
    },
  };
}

export function describeExport(result: ExportResult): string {
  const lines = [
    `${result.width}×${result.height} · ${result.videoCodec}${result.audioCodec ? ` + ${result.audioCodec}` : ' · no audio'}`,
    `${result.durationSeconds.toFixed(1)}s · ${result.frames} frames · ${formatBytes(result.bytes)}`,
  ];
  return lines.join('\n');
}

export function estimateForDuration(project: Project, preset: ExportPreset, durationTicks: Tick) {
  return planBitrate({
    durationSeconds: durationTicks / TICKS_PER_SECOND,
    width: preset.width,
    height: preset.height,
    fps: project.canvas.fps.num / project.canvas.fps.den,
    audioBitrate: preset.audioBitrate,
    videoBitrate: preset.videoBitrate,
  });
}
