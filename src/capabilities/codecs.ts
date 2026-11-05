export interface CodecCandidate {
  /** WebCodecs or MediaRecorder codec string. */
  codec: string;
  /** Container MIME for MediaRecorder paths. */
  mime: string;
  label: string;
  family: 'h264' | 'vp9' | 'av1' | 'hevc' | 'vp8' | 'opus' | 'aac' | 'pcm';
  video: boolean;
}

export const VIDEO_CODECS: CodecCandidate[] = [
  { codec: 'avc1.640033', mime: 'video/mp4;codecs=avc1.640033', label: 'H.264 High 5.1', family: 'h264', video: true },
  { codec: 'avc1.4d0032', mime: 'video/mp4;codecs=avc1.4d0032', label: 'H.264 Main 5.0', family: 'h264', video: true },
  { codec: 'vp09.00.10.08', mime: 'video/webm;codecs=vp09.00.10.08', label: 'VP9', family: 'vp9', video: true },
  { codec: 'vp8', mime: 'video/webm;codecs=vp8', label: 'VP8', family: 'vp8', video: true },
  { codec: 'av01.0.08M.08', mime: 'video/mp4;codecs=av01.0.08M.08', label: 'AV1', family: 'av1', video: true },
  { codec: 'hvc1.1.6.L123.B0', mime: 'video/mp4;codecs=hvc1.1.6.L123.B0', label: 'HEVC (H.265)', family: 'hevc', video: true },
];

export const AUDIO_CODECS: CodecCandidate[] = [
  { codec: 'opus', mime: 'audio/webm;codecs=opus', label: 'Opus', family: 'opus', video: false },
  { codec: 'mp4a.40.2', mime: 'audio/mp4;codecs=mp4a.40.2', label: 'AAC-LC', family: 'aac', video: false },
  { codec: 'pcm-s16', mime: 'audio/wav', label: 'PCM 16-bit', family: 'pcm', video: false },
];

export interface CodecSupport {
  codec: CodecCandidate;
  encoderSupported: boolean;
  decoderSupported: boolean;
  /** Why it is unsupported, when the browser tells us. */
  reason?: string;
}

export async function probeVideoEncoder(codec: CodecCandidate, width: number, height: number, fps: number, bitrate: number): Promise<CodecSupport> {
  const support: CodecSupport = { codec, encoderSupported: false, decoderSupported: false };
  if (typeof VideoEncoder === 'undefined') {
    return { ...support, reason: 'WebCodecs VideoEncoder is unavailable.' };
  }
  try {
    const config: VideoEncoderConfig = {
      codec: codec.codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: 'quality',
    };
    const result = await VideoEncoder.isConfigSupported(config);
    support.encoderSupported = Boolean(result.supported);
    if (!result.supported) support.reason = 'Browser reports the configuration is not supported.';
  } catch (error) {
    support.reason = (error as Error).message;
  }
  if (typeof VideoDecoder !== 'undefined') {
    try {
      const result = await VideoDecoder.isConfigSupported({ codec: codec.codec, codedWidth: width, codedHeight: height });
      support.decoderSupported = Boolean(result.supported);
    } catch {
      support.decoderSupported = false;
    }
  }
  return support;
}

export async function probeAudioEncoder(codec: CodecCandidate, sampleRate: number, channels: number, bitrate: number): Promise<CodecSupport> {
  const support: CodecSupport = { codec, encoderSupported: false, decoderSupported: false };
  if (typeof AudioEncoder === 'undefined') return { ...support, reason: 'WebCodecs AudioEncoder is unavailable.' };
  try {
    const result = await AudioEncoder.isConfigSupported({ codec: codec.codec, sampleRate, numberOfChannels: channels, bitrate });
    support.encoderSupported = Boolean(result.supported);
    if (!result.supported) support.reason = 'Browser reports the audio configuration is not supported.';
  } catch (error) {
    support.reason = (error as Error).message;
  }
  if (typeof AudioDecoder !== 'undefined') {
    try {
      const result = await AudioDecoder.isConfigSupported({ codec: codec.codec, sampleRate, numberOfChannels: channels });
      support.decoderSupported = Boolean(result.supported);
    } catch {
      support.decoderSupported = false;
    }
  }
  return support;
}

/** MediaRecorder container/codec support — the segmented capture path. */
export function probeRecorderMimeTypes(): Array<{ mime: string; supported: boolean }> {
  if (typeof MediaRecorder === 'undefined') return [];
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.640033,mp4a.40.2',
    'video/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  return candidates.map((mime) => ({ mime, supported: MediaRecorder.isTypeSupported(mime) }));
}

export function chooseRecorderMime(kind: 'video' | 'audio', includeAudio: boolean): string {
  const candidates =
    kind === 'video'
      ? includeAudio
        ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? '';
}

/** Choose the best export codec for a container, based on measured support. */
export function pickExportCodec(
  supports: CodecSupport[],
  preference: Array<CodecCandidate['family']>,
): CodecCandidate | null {
  for (const family of preference) {
    const match = supports.find((s) => s.codec.family === family && s.encoderSupported);
    if (match) return match.codec;
  }
  return supports.find((s) => s.encoderSupported)?.codec ?? null;
}

/**
 * mediabunny names codecs by family while WebCodecs wants the full string
 * ('avc1.640033', 'mp4a.40.2'). Passing the WebCodecs string straight to
 * `CanvasSource` throws "Invalid video codec" before a single frame is encoded.
 */
export function mediaBunnyVideoCodec(codec: CodecCandidate): 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8' {
  switch (codec.family) {
    case 'av1':
      return 'av1';
    case 'vp9':
      return 'vp9';
    case 'vp8':
      return 'vp8';
    case 'hevc':
      return 'hevc';
    default:
      return 'avc';
  }
}

export function mediaBunnyAudioCodec(codec: CodecCandidate): 'aac' | 'opus' | 'pcm-s16' {
  switch (codec.family) {
    case 'opus':
      return 'opus';
    case 'pcm':
      return 'pcm-s16';
    default:
      return 'aac';
  }
}
