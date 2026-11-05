import type { CodecCandidate } from './codecs';

export interface BenchmarkOptions {
  width: number;
  height: number;
  fps: number;
  /** Number of frames to synthesize. 30–60 is enough to expose slow encoders. */
  frames: number;
  codec: CodecCandidate;
  bitrate: number;
  hardwareAcceleration?: HardwareAcceleration;
}

export interface BenchmarkResult {
  ok: boolean;
  reason?: string;
  encodedFrames: number;
  decodedFrames: number;
  elapsedMs: number;
  /** Frames per second the device actually sustained for this synthetic clip. */
  sustainedFps: number;
  avgEncodeMs: number;
  bytesOut: number;
  /** Approximate encoded bitrate for the sample. */
  measuredBitrate: number;
  decoderRoundTrip: boolean;
  /** Why the round trip failed, when it did. */
  decodeError?: string;
  keyFrames: number;
  /** Non-fatal observations (configuration fallbacks, timestamp anomalies). */
  notes: string[];
}

interface CollectedChunk {
  data: Uint8Array<ArrayBuffer>;
  type: EncodedVideoChunkType;
  timestamp: number;
  duration: number;
}

/**
 * Encode and decode a short synthetic clip.
 *
 * Configuration support alone never proves the device can sustain real-time 4K,
 * and a decode probe that only feeds the first chunk proves very little either.
 * This performs a full encode → flush → decode → flush round trip over every
 * encoded chunk and reports both directions separately.
 *
 * Measurement covers drawing + encoding, matching what the exporter actually
 * does per frame. The decoder runs afterwards and is not counted as capture
 * throughput.
 */
export async function runEncodeBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const empty: BenchmarkResult = {
    ok: false,
    encodedFrames: 0,
    decodedFrames: 0,
    elapsedMs: 0,
    sustainedFps: 0,
    avgEncodeMs: 0,
    bytesOut: 0,
    measuredBitrate: 0,
    decoderRoundTrip: false,
    keyFrames: 0,
    notes: [],
  };
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return { ...empty, reason: 'WebCodecs is not available in this browser.' };
  }
  const canvas = createTestCanvas(options.width, options.height);
  if (!canvas) return { ...empty, reason: 'Could not create a 2D test canvas.' };
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) return { ...empty, reason: 'Could not acquire a 2D context for the test pattern.' };

  const notes: string[] = [];
  const chunks: CollectedChunk[] = [];
  let decoderConfig: VideoDecoderConfig | null = null;
  let keyFrames = 0;
  let encodeError: Error | null = null;

  const config: VideoEncoderConfig = {
    codec: options.codec.codec,
    width: options.width,
    height: options.height,
    framerate: options.fps,
    bitrate: options.bitrate,
    latencyMode: 'quality',
    ...(options.hardwareAcceleration ? { hardwareAcceleration: options.hardwareAcceleration } : {}),
  };

  try {
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) {
      return { ...empty, notes, reason: 'The browser rejected this encoder configuration.' };
    }
  } catch (error) {
    return { ...empty, notes, reason: `Encoder support could not be checked: ${(error as Error).message}` };
  }

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        data,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? 0,
      });
      if (chunk.type === 'key') keyFrames += 1;
      // H.264 decoders need the avcC description the encoder emits with the
      // first chunk. Dropping this metadata was why the round trip decoded
      // zero frames: the decoder expected Annex B and silently produced nothing.
      const hint = metadata?.decoderConfig;
      if (hint && !decoderConfig) {
        decoderConfig = {
          ...hint,
          ...(hint.description
            ? { description: copyBufferSource(hint.description) }
            : {}),
        } as VideoDecoderConfig;
      }
    },
    // Throwing inside this callback escapes the promise chain and looks like a
    // successful encode. Record the error and let the loop stop cleanly.
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });

  const start = performance.now();
  let encodedFrames = 0;
  try {
    encoder.configure(config);
    for (let i = 0; i < options.frames; i += 1) {
      if (encodeError) break;
      drawTestPattern(ctx, canvas.width, canvas.height, i);
      const timestamp = Math.round((i * 1_000_000) / options.fps);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: Math.round(1_000_000 / options.fps),
      });
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(options.fps)) === 0 });
      frame.close();
      // Bounded queue: an unbounded encode() loop measures submission speed,
      // not the encoder, and can exhaust GPU memory on a 4K surface.
      if (encoder.encodeQueueSize > 4) await waitForQueue(encoder, 4);
      encodedFrames += 1;
    }
    if (!encodeError) await encoder.flush();
  } catch (error) {
    encodeError = error instanceof Error ? error : new Error(String(error));
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
  }
  const elapsedMs = performance.now() - start;

  if (encodeError) {
    return {
      ...empty,
      notes,
      encodedFrames,
      elapsedMs,
      sustainedFps: elapsedMs > 0 ? (encodedFrames * 1000) / elapsedMs : 0,
      avgEncodeMs: encodedFrames > 0 ? elapsedMs / encodedFrames : 0,
      reason: `Encoding failed after ${encodedFrames} frame(s): ${encodeError.message}`,
    };
  }
  if (chunks.length === 0) {
    return { ...empty, notes, encodedFrames, elapsedMs, reason: 'The encoder produced no data.' };
  }

  const bytesOut = chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
  const durationSeconds = options.frames / options.fps;
  const result: BenchmarkResult = {
    ok: encodedFrames > 0,
    encodedFrames,
    decodedFrames: 0,
    elapsedMs,
    sustainedFps: elapsedMs > 0 ? (encodedFrames * 1000) / elapsedMs : 0,
    avgEncodeMs: encodedFrames > 0 ? elapsedMs / encodedFrames : 0,
    bytesOut,
    measuredBitrate: durationSeconds > 0 ? (bytesOut * 8) / durationSeconds : 0,
    decoderRoundTrip: false,
    keyFrames,
    notes,
  };

  if (chunks[0]?.type !== 'key') {
    notes.push('The first encoded chunk was not a keyframe; decoders cannot start mid-GOP.');
  }
  const unsorted = chunks.some((chunk, index) => index > 0 && chunk.timestamp < chunks[index - 1]!.timestamp);
  if (unsorted) notes.push('Encoded timestamps were not monotonic; the exporter would remux with wrong ordering.');
  const zeroDuration = chunks.filter((chunk) => chunk.duration <= 0).length;
  if (zeroDuration > 0) notes.push(`${zeroDuration} chunk(s) reported no duration; frame timing relies on the track rate instead.`);

  if (typeof VideoDecoder === 'undefined') {
    result.decodeError = 'This browser has no VideoDecoder, so the round trip could not be tested.';
    return result;
  }

  const decoded = await decodeAllChunks(chunks, decoderConfig, {
    codec: options.codec.codec,
    width: options.width,
    height: options.height,
    notes,
  });
  result.decodedFrames = decoded.decodedFrames;
  result.decoderRoundTrip = decoded.decodedFrames > 0;
  if (decoded.error) result.decodeError = decoded.error;
  if (decoded.decodedFrames > 0 && decoded.decodedFrames < chunks.length) {
    notes.push(
      `Decoded ${decoded.decodedFrames} of ${chunks.length} chunks. Partial decoding points at the stream or the decoder configuration, not automatically at the hardware.`,
    );
  }
  return result;
}

function copyBufferSource(source: AllowSharedBufferSource): ArrayBuffer {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  return view.slice().buffer;
}

async function waitForQueue(encoder: VideoEncoder, target: number): Promise<void> {
  const deadline = performance.now() + 5000;
  while (encoder.encodeQueueSize > target && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

interface DecodeOutcome {
  decodedFrames: number;
  error?: string;
}

/**
 * Decode every collected chunk with the encoder's own decoder configuration.
 * Output callbacks are asynchronous, so the count is read only after flush().
 */
async function decodeAllChunks(
  chunks: CollectedChunk[],
  encoderConfig: VideoDecoderConfig | null,
  options: { codec: string; width: number; height: number; notes: string[] },
): Promise<DecodeOutcome> {
  let decodedFrames = 0;
  let decodeError: string | null = null;
  const decoder = new VideoDecoder({
    output: (frame) => {
      decodedFrames += 1;
      frame.close();
    },
    error: (error) => {
      decodeError = error.message || 'Decoder error';
    },
  });

  const base: VideoDecoderConfig = encoderConfig ?? {
    codec: options.codec,
    codedWidth: options.width,
    codedHeight: options.height,
  };
  const config: VideoDecoderConfig = {
    ...base,
    ...(base.codedWidth ? {} : { codedWidth: options.width }),
    ...(base.codedHeight ? {} : { codedHeight: options.height }),
  };

  try {
    decoder.configure(config);
  } catch (error) {
    // Some encoders emit a description this decoder will not accept alongside a
    // codec string. Retry once without it before declaring a failure.
    if (config.description) {
      options.notes.push('Decoder rejected the encoder’s description; retried without it.');
      try {
        decoder.configure({ ...config, description: undefined });
      } catch (retryError) {
        decoder.close();
        return { decodedFrames: 0, error: `Decoder could not be configured: ${(retryError as Error).message}` };
      }
    } else {
      decoder.close();
      return { decodedFrames: 0, error: `Decoder could not be configured: ${(error as Error).message}` };
    }
  }

  try {
    for (const chunk of chunks) {
      if (decodeError) break;
      decoder.decode(
        new EncodedVideoChunk({
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          data: chunk.data,
        }),
      );
    }
    if (!decodeError) await decoder.flush();
  } catch (error) {
    decodeError = (error as Error).message;
  } finally {
    try {
      decoder.close();
    } catch {
      /* already closed */
    }
  }

  return {
    decodedFrames,
    ...(decodeError ? { error: `Decoding failed: ${decodeError}` } : {}),
  };
}

function createTestCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // fall through
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** Terminal-like content: small text, high-contrast edges and gradients. */
export function drawTestPattern(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
): void {
  const t = index / 30;
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0b3d4a');
  gradient.addColorStop(1, '#402b4d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width * 0.5, height * 0.22);
  ctx.fillStyle = '#d7e2ea';
  ctx.font = `${Math.round(height / 46)}px ui-monospace, "SF Mono", Menlo, monospace`;
  const lines = [
    '$ kubectl get pods -n kyma-system',
    'NAME                          READY   STATUS    RESTARTS   AGE',
    'api-gateway-6b8f7c9d4f-2xj9p  1/1     Running   0          4d2h',
    'eventing-controller-7f6       1/1     Running   0          4d2h',
    '$ kubectl logs -f --tail=50 api-gateway',
  ];
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillStyle = i === 0 ? '#7ee787' : '#d7e2ea';
    ctx.fillText(lines[i]!, width * 0.04, height * 0.3 + i * (height / 26));
  }
  const x = width * 0.1 + ((index * 7) % Math.max(1, Math.floor(width * 0.7)));
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(x, height * 0.72, width * 0.12, height * 0.03);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`frame ${index} t=${t.toFixed(2)}`, width * 0.04, height * 0.92);
}
