/**
 * Integer timebase.
 *
 * All timeline positions are integers in a single project-wide tick base.
 * 720_000 ticks/second is the least common multiple of the two rates we care
 * about: 90_000 (the MPEG video timebase, exact for 24/25/30/50/60 fps) and
 * 48_000 (the audio sample rate). Every frame boundary and every audio sample
 * therefore lands exactly on an integer tick — no floating-point drift.
 */
export const TICKS_PER_SECOND = 720_000;

/** Integer tick count. Never a float. */
export type Tick = number;

/** Frame rate as an exact rational, e.g. 30000/1001 for 29.97. */
export interface FrameRate {
  readonly num: number;
  readonly den: number;
}

export const FPS_24 = { num: 24, den: 1 } as const;
export const FPS_25 = { num: 25, den: 1 } as const;
export const FPS_30 = { num: 30, den: 1 } as const;
export const FPS_50 = { num: 50, den: 1 } as const;
export const FPS_60 = { num: 60, den: 1 } as const;
export const FPS_29_97 = { num: 30000, den: 1001 } as const;

export function fpsToNumber(fps: FrameRate): number {
  return fps.num / fps.den;
}

export function secondsToTicks(seconds: number): Tick {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: Tick): number {
  return ticks / TICKS_PER_SECOND;
}

/** Duration of one frame in ticks, rounded to the nearest integer tick. */
export function frameDurationTicks(fps: FrameRate): Tick {
  return Math.round((TICKS_PER_SECOND * fps.den) / fps.num);
}

/** Ticks at the start of a given frame index. */
export function frameToTicks(frame: number, fps: FrameRate): Tick {
  return Math.round((frame * TICKS_PER_SECOND * fps.den) / fps.num);
}

/**
 * Frame index containing the given tick. Uses exact integer arithmetic so a
 * tick sitting exactly on a frame boundary maps to that frame, and long
 * timelines never drift.
 */
export function ticksToFrame(ticks: Tick, fps: FrameRate): number {
  return Math.floor((ticks * fps.num) / (TICKS_PER_SECOND * fps.den));
}

/** Quantize a tick value to the nearest frame boundary. */
export function quantizeToFrame(ticks: Tick, fps: FrameRate, mode: 'floor' | 'round' | 'ceil' = 'round'): Tick {
  const exactNum = ticks * fps.num;
  const frameDen = TICKS_PER_SECOND * fps.den;
  let frame: number;
  if (mode === 'floor') frame = Math.floor(exactNum / frameDen);
  else if (mode === 'ceil') frame = Math.ceil(exactNum / frameDen);
  else frame = Math.round(exactNum / frameDen);
  return Math.round((frame * frameDen) / fps.num);
}

/** Snap a tick to the nearest audio sample boundary for a sample rate. */
export function quantizeToSample(ticks: Tick, sampleRate: number): Tick {
  return samplesToTicks(ticksToSamples(ticks, sampleRate), sampleRate);
}

export function samplesToTicks(samples: number, sampleRate: number): Tick {
  return Math.round((samples * TICKS_PER_SECOND) / sampleRate);
}

export function ticksToSamples(ticks: Tick, sampleRate: number): number {
  return Math.round((ticks * sampleRate) / TICKS_PER_SECOND);
}

export function clampTicks(value: Tick, min: Tick, max: Tick): Tick {
  return Math.min(Math.max(value, min), max);
}

/** Format a tick count as HH:MM:SS:FF (frame-accurate timecode). */
export function formatTimecode(ticks: Tick, fps: FrameRate): string {
  const clamped = Math.max(0, ticks);
  const totalSeconds = Math.floor(clamped / TICKS_PER_SECOND);
  const frame = ticksToFrame(clamped - totalSeconds * TICKS_PER_SECOND, fps);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frame)}`;
}

/** Format a tick count as HH:MM:SS.mmm — the form subtitles and humans use. */
export function formatClock(ticks: Tick): string {
  const ms = Math.max(0, Math.round((ticks * 1000) / TICKS_PER_SECOND));
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const milli = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(milli).padStart(3, '0')}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse "HH:MM:SS:FF", "HH:MM:SS.mmm" or "MM:SS.mmm" into ticks.
 * Returns null for anything that is not a well-formed timecode.
 */
export function parseTimecode(text: string, fps: FrameRate): Tick | null {
  const trimmed = text.trim();
  const frameMatch = /^(\d+):([0-5]\d):([0-5]\d):(\d{1,3})$/.exec(trimmed);
  if (frameMatch) {
    const [, h, m, s, f] = frameMatch;
    const frames = Number(f);
    if (frames >= Math.ceil(fpsToNumber(fps))) return null;
    return (
      Number(h) * 3600 * TICKS_PER_SECOND +
      Number(m) * 60 * TICKS_PER_SECOND +
      Number(s) * TICKS_PER_SECOND +
      frameToTicks(frames, fps)
    );
  }
  const clockMatch = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)(?:[.,](\d{1,3}))?$/.exec(trimmed);
  if (clockMatch) {
    const [, h, m, s, frac = '0'] = clockMatch;
    const millis = Number(frac.padEnd(3, '0'));
    return (
      (Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)) * TICKS_PER_SECOND +
      Math.round((millis * TICKS_PER_SECOND) / 1000)
    );
  }
  return null;
}

/** Sum of clip durations, used for project length. */
export function maxTick(values: readonly Tick[]): Tick {
  return values.reduce((acc, v) => (v > acc ? v : acc), 0);
}
