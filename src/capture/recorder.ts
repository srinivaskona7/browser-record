import { newId } from '../core/ids';
import { secondsToTicks, TICKS_PER_SECOND, type Tick } from '../core/time';
import type { Asset, AssetSegment, Marker } from '../project/types';
import type { DirectoryHandleLike, RecordingAssetRecord, RecordingManifest } from '../workspace/types';
import { SegmentWriter, readTakeManifest, resolveFile, writeTakeManifest } from '../workspace/workspace';
import { WORKSPACE_LAYOUT } from '../workspace/types';

/**
 * Where a project's files actually live. Take media must sit in the same
 * folder as project.json, or the manifest, playback and discard each look in
 * a different place.
 */
function projectBase(projectFolder: string): string {
  return `${WORKSPACE_LAYOUT.projects}/${projectFolder}`;
}

export interface CaptureAssetSpec {
  key: 'screen' | 'camera' | 'microphone' | 'system-audio';
  kind: RecordingAssetRecord['kind'];
  name: string;
  stream: MediaStream;
  mimeType: string;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
}

export interface CaptureSessionOptions {
  root: DirectoryHandleLike;
  projectFolder: string;
  projectId: string;
  assets: CaptureAssetSpec[];
  segmentSeconds: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  onStats?: (stats: CaptureStats) => void;
  onWarning?: (message: string) => void;
  onFatal?: (error: Error) => void;
  /** Fired when the browser's own "Stop sharing" ends the screen track. */
  onSourceEnded?: (key: CaptureAssetSpec['key']) => void;
  now?: () => number;
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
}

export interface AssetStats {
  key: CaptureAssetSpec['key'];
  state: 'recording' | 'paused' | 'stopped' | 'error';
  bytes: number;
  chunks: number;
  writeLatencyMs: number;
  committedBytes: number;
  lastCommitAt: number;
}

export interface CaptureStats {
  elapsedMs: number;
  pausedMs: number;
  bytes: number;
  writeLatencyMs: number;
  assets: AssetStats[];
  markers: Marker[];
  /** Bytes that could be lost if the tab died right now (since last commit). */
  uncommittedBytes: number;
  errors: string[];
}

export interface TakeResult {
  takeId: string;
  manifest: RecordingManifest;
  assets: Asset[];
  markers: Marker[];
  durationTicks: Tick;
  warnings: string[];
}

interface AssetRuntime {
  spec: CaptureAssetSpec;
  record: RecordingAssetRecord;
  recorder: MediaRecorder;
  writer: SegmentWriter;
  chunks: number;
  bytes: number;
  committedBytes: number;
  writeLatencyTotal: number;
  writeCount: number;
  writeChain: Promise<void>;
  startedAt: number;
  state: AssetStats['state'];
  segmentIndex: number;
  lastCommitAt: number;
  error?: string;
}

const EXTENSION_BY_MIME: Array<[RegExp, string]> = [
  [/video\/mp4/, 'mp4'],
  [/video\/webm/, 'webm'],
  [/audio\/webm/, 'webm'],
  [/audio\/mp4/, 'm4a'],
  [/audio\/wav/, 'wav'],
];

export function extensionForMime(mime: string): string {
  for (const [pattern, extension] of EXTENSION_BY_MIME) if (pattern.test(mime)) return extension;
  return 'webm';
}

/**
 * Segmented capture to disk.
 *
 * Every recorder writes into one file per asset. The file is flushed (close())
 * every `segmentSeconds`, and only after close() resolves is the byte range
 * considered durable and recorded in the manifest. A crash therefore loses at
 * most the time since the last commit — never the whole take.
 */
export class CaptureSession {
  readonly takeId: string;
  readonly manifest: RecordingManifest;
  private runtimes: AssetRuntime[] = [];
  private segmentTimer: ReturnType<typeof setInterval> | null = null;
  private pauseStartedAt: number | null = null;
  private pausedTotalMs = 0;
  private startedAt: number;
  private stopped = false;
  private finalizePromise: Promise<TakeResult> | null = null;
  private manifestChain: Promise<void> = Promise.resolve();
  private readonly warnings: string[] = [];
  private readonly errors: string[] = [];
  private markers: Marker[] = [];
  private readonly options: CaptureSessionOptions;
  private readonly now: () => number;

  private constructor(options: CaptureSessionOptions, manifest: RecordingManifest, runtimes: AssetRuntime[]) {
    this.options = options;
    this.manifest = manifest;
    this.runtimes = runtimes;
    this.takeId = manifest.takeId;
    this.now = options.now ?? (() => performance.now());
    this.startedAt = this.now();
  }

  static async start(options: CaptureSessionOptions): Promise<CaptureSession> {
    const takeId = newId('take');
    const startedAt = new Date().toISOString();
    const manifest: RecordingManifest = {
      version: 1,
      takeId,
      projectId: options.projectId,
      startedAt,
      status: 'recording',
      segmentSeconds: options.segmentSeconds,
      assets: [],
    };
    await writeTakeManifest(options.root, options.projectFolder, manifest);

    const runtimes: AssetRuntime[] = [];
    const session = new CaptureSession(options, manifest, runtimes);

    for (const spec of options.assets) {
      const extension = extensionForMime(spec.mimeType);
      const relativePath = `${WORKSPACE_LAYOUT.recordings}/${takeId}/${spec.key}.${extension}`;
      const record: RecordingAssetRecord = {
        id: newId('asset'),
        kind: spec.kind,
        name: spec.name,
        path: relativePath,
        mimeType: spec.mimeType,
        committedBytes: 0,
        segments: [],
        offsetMs: Math.round(session.now() - session.startedAt),
        ...(spec.width ? { width: spec.width } : {}),
        ...(spec.height ? { height: spec.height } : {}),
        ...(spec.sampleRate ? { sampleRate: spec.sampleRate } : {}),
        ...(spec.channels ? { channels: spec.channels } : {}),
      };
      const handle = await resolveFile(options.root, `${projectBase(options.projectFolder)}/${relativePath}`, true);
      const runtime: AssetRuntime = {
        spec,
        record,
        chunks: 0,
        bytes: 0,
        committedBytes: 0,
        writeLatencyTotal: 0,
        writeCount: 0,
        writeChain: Promise.resolve(),
        startedAt: session.now(),
        state: 'recording',
        segmentIndex: 0,
        lastCommitAt: session.now(),
        // Placeholder; the recorder is created below so the writer callback can
        // reference the runtime.
        recorder: null as unknown as MediaRecorder,
        writer: null as unknown as SegmentWriter,
      };
      runtime.writer = new SegmentWriter(
        handle,
        async (committedBytes) => {
          runtime.committedBytes = committedBytes;
          const segment: AssetSegment = {
            path: record.path,
            bytes: committedBytes,
            startTicks: secondsToTicks((runtime.startedAt - session.startedAt) / 1000),
            durationTicks: 0,
          };
          void segment;
          record.committedBytes = committedBytes;
          record.segments.push({
            index: runtime.segmentIndex,
            path: record.path,
            bytes: committedBytes,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            finalized: true,
          });
          runtime.segmentIndex += 1;
          runtime.lastCommitAt = session.now();
          await session.persistManifest();
        },
        (error) => {
          runtime.error = error.message;
          session.errors.push(`${spec.key}: ${error.message}`);
          options.onFatal?.(error);
        },
      );

      const recorderFactory = options.createRecorder ?? ((stream, recorderOptions) => new MediaRecorder(stream, recorderOptions));
      const recorderOptions: MediaRecorderOptions = {
        mimeType: spec.mimeType,
        ...(spec.kind === 'microphone' || spec.kind === 'system-audio'
          ? { audioBitsPerSecond: options.audioBitsPerSecond ?? 160_000 }
          : { videoBitsPerSecond: options.videoBitsPerSecond ?? 16_000_000 }),
      };
      let recorder: MediaRecorder;
      try {
        recorder = recorderFactory(spec.stream, recorderOptions);
      } catch (error) {
        throw new Error(`Could not start recording ${spec.name}: ${(error as Error).message}`, { cause: error });
      }
      runtime.recorder = recorder;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data || event.data.size === 0) return;
        runtime.chunks += 1;
        runtime.bytes += event.data.size;
        const started = session.now();
        runtime.writeChain = runtime.writeChain
          .then(async () => {
            const bytes = new Uint8Array(await event.data.arrayBuffer());
            await runtime.writer.append(bytes);
            runtime.writeLatencyTotal += session.now() - started;
            runtime.writeCount += 1;
          })
          .catch((error: Error) => {
            runtime.state = 'error';
            runtime.error = error.message;
            session.errors.push(`${spec.key}: ${error.message}`);
            options.onFatal?.(error);
          });
      };
      recorder.onerror = (event: Event) => {
        const message = (event as unknown as { error?: DOMException }).error?.message ?? 'Recorder error';
        runtime.state = 'error';
        runtime.error = message;
        session.errors.push(`${spec.key}: ${message}`);
      };
      recorder.onstop = () => {
        if (runtime.state !== 'error') runtime.state = 'stopped';
      };
      recorder.start(1000);
      manifest.assets.push(record);
      runtimes.push(runtime);
    }

    await session.persistManifest();
    session.segmentTimer = setInterval(() => {
      void session.commitSegments();
    }, Math.max(2000, options.segmentSeconds * 1000));
    for (const runtime of runtimes) {
      const track = runtime.spec.stream.getTracks()[0];
      if (!track) continue;
      track.addEventListener('ended', () => {
        session.warn(`${runtime.spec.name} stopped (device disconnected or sharing ended).`);
        options.onSourceEnded?.(runtime.spec.key);
      });
    }
    return session;
  }

  private async persistManifest(): Promise<void> {
    const snapshot: RecordingManifest = {
      ...this.manifest,
      assets: this.manifest.assets.map((asset) => ({ ...asset, segments: [...asset.segments] })),
    };
    this.manifestChain = this.manifestChain
      .then(() => writeTakeManifest(this.options.root, this.options.projectFolder, snapshot))
      .catch((error: Error) => {
        this.errors.push(`Manifest write failed: ${error.message}`);
      });
    await this.manifestChain;
  }

  private warn(message: string): void {
    if (this.warnings.includes(message)) return;
    this.warnings.push(message);
    this.options.onWarning?.(message);
  }

  private async commitSegments(): Promise<void> {
    if (this.stopped || this.pauseStartedAt !== null) return;
    for (const runtime of this.runtimes) {
      if (runtime.recorder.state !== 'recording') continue;
      try {
        await runtime.writeChain;
        await runtime.writer.commit();
      } catch (error) {
        runtime.state = 'error';
        runtime.error = (error as Error).message;
        this.errors.push(`${runtime.spec.key}: ${(error as Error).message}`);
      }
    }
    this.emitStats();
  }

  pause(): void {
    if (this.stopped || this.pauseStartedAt !== null) return;
    this.pauseStartedAt = this.now();
    for (const runtime of this.runtimes) {
      if (runtime.recorder.state === 'recording') {
        runtime.recorder.pause();
        runtime.state = 'paused';
      }
    }
    this.emitStats();
  }

  resume(): void {
    if (this.stopped || this.pauseStartedAt === null) return;
    this.pausedTotalMs += this.now() - this.pauseStartedAt;
    this.pauseStartedAt = null;
    for (const runtime of this.runtimes) {
      if (runtime.recorder.state === 'paused') {
        runtime.recorder.resume();
        runtime.state = 'recording';
      }
    }
    this.emitStats();
  }

  addMarker(label: string): Marker {
    const marker: Marker = {
      id: newId('marker'),
      atTicks: this.elapsedTicks(),
      label,
      color: '#ffd166',
    };
    this.markers.push(marker);
    this.emitStats();
    return marker;
  }

  elapsedMs(): number {
    const paused = this.pausedTotalMs + (this.pauseStartedAt ? this.now() - this.pauseStartedAt : 0);
    return Math.max(0, this.now() - this.startedAt - paused);
  }

  elapsedTicks(): Tick {
    return Math.round((this.elapsedMs() / 1000) * TICKS_PER_SECOND);
  }

  emitStats(): void {
    this.options.onStats?.(this.stats());
  }

  stats(): CaptureStats {
    const assets = this.runtimes.map<AssetStats>((runtime) => ({
      key: runtime.spec.key,
      state: runtime.state,
      bytes: runtime.bytes,
      chunks: runtime.chunks,
      writeLatencyMs: runtime.writeCount > 0 ? runtime.writeLatencyTotal / runtime.writeCount : 0,
      committedBytes: runtime.committedBytes,
      lastCommitAt: runtime.lastCommitAt,
    }));
    const bytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    const committed = assets.reduce((sum, asset) => sum + asset.committedBytes, 0);
    const latencySum = assets.reduce((sum, asset) => sum + asset.writeLatencyMs, 0);
    return {
      elapsedMs: this.elapsedMs(),
      pausedMs: this.pausedTotalMs,
      bytes,
      writeLatencyMs: assets.length > 0 ? latencySum / assets.length : 0,
      assets,
      markers: [...this.markers],
      uncommittedBytes: Math.max(0, bytes - committed),
      errors: [...this.errors],
    };
  }

  /** Stop, flush every writer, and mark the manifest finalized. */
  async stop(): Promise<TakeResult> {
    if (this.finalizePromise) return this.finalizePromise;
    this.finalizePromise = this.finalizeTake();
    return this.finalizePromise;
  }

  private async finalizeTake(): Promise<TakeResult> {
    if (this.segmentTimer) clearInterval(this.segmentTimer);
    this.segmentTimer = null;
    if (this.pauseStartedAt !== null) this.pausedTotalMs += this.now() - this.pauseStartedAt;
    this.pauseStartedAt = null;
    const recorders = this.runtimes.map((runtime) => stopRecorder(runtime.recorder));
    await Promise.all(recorders);
    for (const runtime of this.runtimes) {
      try {
        await runtime.writeChain;
        await runtime.writer.close();
      } catch (error) {
        runtime.state = 'error';
        this.errors.push(`${runtime.spec.key}: ${(error as Error).message}`);
      }
    }
    this.stopped = true;
    this.manifest.status = 'finalized';
    this.manifest.endedAt = new Date().toISOString();
    this.manifest.notes = this.errors.length > 0 ? `Errors: ${this.errors.join('; ')}` : undefined;
    await this.persistManifest();
    const durationTicks = secondsToTicks(this.elapsedMs() / 1000);
    return {
      takeId: this.takeId,
      manifest: this.manifest,
      assets: buildAssetsFromManifest(this.manifest),
      markers: this.markers,
      durationTicks,
      warnings: [...this.warnings, ...this.errors],
    };
  }

  /** Stop and delete the take folder. Original media is never touched by stop(). */
  async discard(): Promise<void> {
    if (this.segmentTimer) clearInterval(this.segmentTimer);
    this.segmentTimer = null;
    await Promise.all(this.runtimes.map((runtime) => stopRecorder(runtime.recorder)));
    for (const runtime of this.runtimes) {
      // A final dataavailable can still be queued when stop() resolves. Let it
      // land before aborting, or the append surfaces after the folder is gone
      // and shows a bogus "Capture failed" card after a successful discard.
      try {
        await runtime.writeChain;
      } catch {
        /* the append error was already recorded when it happened */
      }
      try {
        await runtime.writer.abort();
      } catch (error) {
        this.errors.push(`${runtime.spec.key}: ${(error as Error).message}`);
      }
    }
    this.manifest.status = 'aborted';
    this.manifest.endedAt = new Date().toISOString();
    try {
      await writeTakeManifest(this.options.root, this.options.projectFolder, this.manifest);
    } catch {
      /* best effort */
    }
    this.stopped = true;
  }
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') {
      resolve();
      return;
    }
    const done = () => resolve();
    recorder.addEventListener('stop', done, { once: true });
    try {
      recorder.stop();
    } catch {
      resolve();
    }
  });
}

/** Rebuild project assets from a take manifest (also used by crash recovery). */
export function buildAssetsFromManifest(manifest: RecordingManifest): Asset[] {
  const manifestDurationMs = manifestDuration(manifest);
  return manifest.assets.map((record) => {
    const durationTicks = record.committedBytes > 0 ? Math.max(1, millisecondsToTicks(manifestDurationMs)) : 0;
    return {
      id: record.id,
      kind: record.kind === 'microphone' || record.kind === 'system-audio' ? 'audio' : 'video',
      name: record.name,
      path: record.path,
      durationTicks,
      origin: 'recorded',
      mimeType: record.mimeType,
      ...(record.width ? { width: record.width } : {}),
      ...(record.height ? { height: record.height } : {}),
      ...(record.sampleRate ? { sampleRate: record.sampleRate } : {}),
      ...(record.channels ? { channels: record.channels } : {}),
      segments: record.segments.map((segment) => ({
        path: segment.path,
        bytes: segment.bytes,
        startTicks: 0,
        durationTicks: 0,
      })),
      createdAt: manifest.startedAt,
    };
  });
}

/**
 * Duration of a take. For an interrupted take there is no endedAt, so the last
 * committed segment bounds what is known to be durable.
 */
export function manifestDuration(manifest: RecordingManifest): number {
  const start = Date.parse(manifest.startedAt);
  if (!Number.isFinite(start)) return 0;
  if (manifest.endedAt) {
    const end = Date.parse(manifest.endedAt);
    if (Number.isFinite(end)) return Math.max(0, end - start);
  }
  let lastCommit = 0;
  for (const record of manifest.assets) {
    for (const segment of record.segments) {
      const at = Date.parse(segment.endedAt ?? segment.startedAt);
      if (Number.isFinite(at)) lastCommit = Math.max(lastCommit, at - start);
    }
  }
  return lastCommit;
}

export function millisecondsToTicks(ms: number): number {
  return Math.round((ms / 1000) * TICKS_PER_SECOND);
}

export interface RecoveryReport {
  takeId: string;
  manifest: RecordingManifest;
  assets: Asset[];
  /** Bytes the manifest says are durable. */
  committedBytes: number;
  /** Bytes present on disk beyond the last commit, which may be unplayable. */
  uncommittedBytes: number;
  /** Worst-case data loss window in seconds (the segment interval). */
  lossWindowSeconds: number;
  warnings: string[];
}

/**
 * Recover interrupted takes. Only committed byte ranges are claimed as
 * recoverable; anything written after the last close() is reported as a
 * loss window rather than promised as intact.
 */
export async function recoverInterruptedTake(
  root: DirectoryHandleLike,
  projectFolder: string,
  takeId: string,
): Promise<RecoveryReport | null> {
  const manifest = await readTakeManifest(root, projectFolder, takeId);
  if (!manifest) return null;
  const warnings: string[] = [];
  let uncommitted = 0;
  for (const record of manifest.assets) {
    try {
      const file = await (await resolveFile(root, `${projectBase(projectFolder)}/${record.path}`)).getFile();
      const extra = Math.max(0, file.size - record.committedBytes);
      uncommitted += extra;
      if (extra > 0) {
        warnings.push(
          `${record.name}: ${extra} bytes were written after the last commit and may not decode. The committed prefix is intact.`,
        );
      }
      if (record.committedBytes === 0) {
        warnings.push(`${record.name} has no committed data and cannot be recovered.`);
      }
    } catch {
      warnings.push(`${record.name} is missing from disk.`);
    }
  }
  if (manifest.status === 'recording') {
    manifest.status = 'recovered';
    try {
      await writeTakeManifest(root, projectFolder, manifest);
    } catch {
      warnings.push('Could not mark the take as recovered; the manifest is read-only or the disk is full.');
    }
  }
  return {
    takeId,
    manifest,
    assets: buildAssetsFromManifest(manifest),
    committedBytes: manifest.assets.reduce((sum, record) => sum + record.committedBytes, 0),
    uncommittedBytes: uncommitted,
    lossWindowSeconds: manifest.segmentSeconds,
    warnings,
  };
}
