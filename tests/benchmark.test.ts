import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEncodeBenchmark } from '../src/capabilities/benchmark';
import { VIDEO_CODECS } from '../src/capabilities/codecs';

/** Minimal WebCodecs stand-ins that exercise the real control flow. */
class FakeVideoFrame {
  constructor(
    readonly source: unknown,
    readonly init: { timestamp: number; duration: number },
  ) {}
  close(): void {}
}

class FakeEncodedVideoChunk {
  constructor(readonly init: { type: 'key' | 'delta'; timestamp: number; duration: number; data: Uint8Array }) {}
}

type OutputChunk = {
  byteLength: number;
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  copyTo: (target: Uint8Array) => void;
};

class FakeVideoEncoder {
  static configs: VideoEncoderConfig[] = [];
  static failOnEncode = false;
  encodeQueueSize = 0;
  private readonly output: (chunk: OutputChunk, metadata: { decoderConfig?: VideoDecoderConfig }) => void;
  private readonly onError: (error: Error) => void;

  constructor(init: {
    output: (chunk: OutputChunk, metadata: { decoderConfig?: VideoDecoderConfig }) => void;
    error: (error: Error) => void;
  }) {
    this.output = init.output;
    this.onError = init.error;
  }

  static async isConfigSupported(config: VideoEncoderConfig) {
    FakeVideoEncoder.configs.push(config);
    return { supported: true, config };
  }

  configure(): void {}

  encode(_frame: FakeVideoFrame, options?: { keyFrame?: boolean }): void {
    if (FakeVideoEncoder.failOnEncode) {
      this.onError(new Error('GPU process lost'));
      return;
    }
    const data = new Uint8Array([1, 2, 3, 4]);
    this.output(
      {
        byteLength: data.byteLength,
        type: options?.keyFrame ? 'key' : 'delta',
        timestamp: _frame.init.timestamp,
        duration: _frame.init.duration,
        copyTo: (target) => target.set(data),
      },
      {
        // This is the metadata the old benchmark threw away. H.264 decoding
        // depends on it.
        decoderConfig: {
          codec: 'avc1.4d0032',
          codedWidth: 320,
          codedHeight: 180,
          description: new Uint8Array([0x01, 0x64, 0x00, 0x1f]).buffer,
        },
      },
    );
  }

  async flush(): Promise<void> {}
  close(): void {}
}

class FakeVideoDecoder {
  static lastConfig: VideoDecoderConfig | null = null;
  static configured = 0;
  private readonly output: (frame: { close: () => void }) => void;
  private readonly onError: (error: Error) => void;

  constructor(init: {
    output: (frame: { close: () => void }) => void;
    error: (error: Error) => void;
  }) {
    this.output = init.output;
    this.onError = init.error;
  }

  static async isConfigSupported(config: VideoDecoderConfig) {
    return { supported: true, config };
  }

  configure(config: VideoDecoderConfig): void {
    FakeVideoDecoder.lastConfig = config;
    FakeVideoDecoder.configured += 1;
  }

  decode(chunk: FakeEncodedVideoChunk): void {
    if (!(chunk instanceof FakeEncodedVideoChunk)) this.onError(new Error('wrong chunk type'));
    this.output({ close: () => undefined });
  }

  async flush(): Promise<void> {}
  close(): void {}
}

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return {
      fillStyle: '',
      font: '',
      fillRect: () => undefined,
      fillText: () => undefined,
      createLinearGradient: () => ({ addColorStop: () => undefined }),
    };
  }
}

const codec = VIDEO_CODECS[0]!;

function installFakes(): void {
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
  vi.stubGlobal('VideoDecoder', FakeVideoDecoder);
  vi.stubGlobal('EncodedVideoChunk', FakeEncodedVideoChunk);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  FakeVideoEncoder.configs = [];
  FakeVideoEncoder.failOnEncode = false;
  FakeVideoDecoder.lastConfig = null;
  FakeVideoDecoder.configured = 0;
}

describe('encode/decode benchmark', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes every encoded chunk using the encoder’s decoder configuration', async () => {
    installFakes();
    const result = await runEncodeBenchmark({
      width: 320,
      height: 180,
      fps: 30,
      frames: 45,
      codec,
      bitrate: 2_000_000,
    });

    expect(result.ok).toBe(true);
    expect(result.encodedFrames).toBe(45);
    // The old implementation decoded only the first chunk, and without the
    // avcC description, so this was 0.
    expect(result.decodedFrames).toBe(45);
    expect(result.decoderRoundTrip).toBe(true);
    expect(result.keyFrames).toBe(2);
    expect(result.bytesOut).toBe(180);
    expect(result.decodeError).toBeUndefined();

    const description = FakeVideoDecoder.lastConfig?.description;
    expect(description).toBeInstanceOf(ArrayBuffer);
    expect((description as ArrayBuffer).byteLength).toBe(4);
    expect(FakeVideoDecoder.lastConfig?.codec).toBe('avc1.4d0032');
  });

  it('reports an encoder error instead of throwing from the callback', async () => {
    installFakes();
    FakeVideoEncoder.failOnEncode = true;
    const result = await runEncodeBenchmark({
      width: 320,
      height: 180,
      fps: 30,
      frames: 10,
      codec,
      bitrate: 2_000_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/GPU process lost/);
    expect(result.decoderRoundTrip).toBe(false);
  });

  it('states when WebCodecs is unavailable', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('VideoFrame', undefined);
    const result = await runEncodeBenchmark({
      width: 320,
      height: 180,
      fps: 30,
      frames: 10,
      codec,
      bitrate: 2_000_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/WebCodecs is not available/);
  });
});
