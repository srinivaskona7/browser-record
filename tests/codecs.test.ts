import { describe, expect, it } from 'vitest';
import { mediaBunnyAudioCodec, mediaBunnyVideoCodec, AUDIO_CODECS, VIDEO_CODECS, type CodecCandidate } from '../src/capabilities/codecs';

const byFamily = (list: CodecCandidate[], family: CodecCandidate['family']) => list.find((codec) => codec.family === family)!;

describe('mediabunny codec names', () => {
  it('maps WebCodecs video strings to mediabunny families', () => {
    // mediabunny rejects 'avc1.640033' with "Invalid video codec"; this is the
    // export failure that produced no file at all.
    expect(mediaBunnyVideoCodec(byFamily(VIDEO_CODECS, 'h264'))).toBe('avc');
    expect(mediaBunnyVideoCodec(byFamily(VIDEO_CODECS, 'vp9'))).toBe('vp9');
    expect(mediaBunnyVideoCodec(byFamily(VIDEO_CODECS, 'vp8'))).toBe('vp8');
    expect(mediaBunnyVideoCodec(byFamily(VIDEO_CODECS, 'av1'))).toBe('av1');
    expect(mediaBunnyVideoCodec(byFamily(VIDEO_CODECS, 'hevc'))).toBe('hevc');
  });

  it('maps AAC-LC to the audio family mediabunny accepts', () => {
    expect(mediaBunnyAudioCodec(byFamily(AUDIO_CODECS, 'aac'))).toBe('aac');
    expect(mediaBunnyAudioCodec(byFamily(AUDIO_CODECS, 'opus'))).toBe('opus');
    expect(mediaBunnyAudioCodec(byFamily(AUDIO_CODECS, 'pcm'))).toBe('pcm-s16');
  });
});
