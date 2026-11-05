import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_SECOND,
  formatTimecode,
  frameDurationTicks,
  frameToTicks,
  parseTimecode,
  quantizeToFrame,
  quantizeToSample,
  samplesToTicks,
  ticksToFrame,
  ticksToSamples,
} from '../src/core/time';

const FPS_30 = { num: 30, den: 1 };
const FPS_2997 = { num: 30000, den: 1001 };
const FPS_60 = { num: 60, den: 1 };

describe('integer timebase', () => {
  it('has exact frame boundaries for the frame rates it claims', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      expect(TICKS_PER_SECOND % fps).toBe(0);
      expect(Number.isInteger(frameDurationTicks({ num: fps, den: 1 }))).toBe(true);
    }
  });

  it('maps frames to ticks and back without drift over an hour', () => {
    const oneHourFrames = 30 * 3600;
    const ticks = frameToTicks(oneHourFrames, FPS_30);
    expect(ticks).toBe(3600 * TICKS_PER_SECOND);
    expect(ticksToFrame(ticks, FPS_30)).toBe(oneHourFrames);
  });

  it('handles 29.97 drop-frame arithmetic as rational, not float', () => {
    const frame = 29;
    const ticks = frameToTicks(frame, FPS_2997);
    expect(ticks).toBe(Math.round((frame * 1001 * TICKS_PER_SECOND) / 30000));
    expect(ticksToFrame(ticks, FPS_2997)).toBe(frame);
  });

  it('quantizes to frame boundaries exactly', () => {
    const midFrame = frameToTicks(10, FPS_60) + 5000;
    expect(quantizeToFrame(midFrame, FPS_60, 'floor')).toBe(frameToTicks(10, FPS_60));
    expect(quantizeToFrame(midFrame, FPS_60, 'ceil')).toBe(frameToTicks(11, FPS_60));
  });

  it('round-trips audio samples at 44.1 and 48 kHz', () => {
    for (const rate of [44_100, 48_000]) {
      const ticks = quantizeToSample(samplesToTicks(12_345, rate) + 137, rate);
      expect(ticksToSamples(ticks, rate)).toBe(Math.round((ticks * rate) / TICKS_PER_SECOND));
      expect(ticks % 1).toBe(0);
    }
  });

  it('formats and parses timecode round-trip', () => {
    const ticks = frameToTicks(3600 * 30 + 12 * 30 + 7, FPS_30);
    const text = formatTimecode(ticks, FPS_30);
    expect(text).toBe('01:00:12:07');
    expect(parseTimecode(text, FPS_30)).toBe(ticks);
  });

  it('rejects malformed timecode instead of guessing', () => {
    expect(parseTimecode('nonsense', FPS_30)).toBeNull();
    expect(parseTimecode('00:99:00:00', FPS_30)).toBeNull();
  });
});
