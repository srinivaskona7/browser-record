import { TICKS_PER_SECOND, type Tick } from '../core/time';
import type { Clip, Project } from '../project/types';
import { clipGain } from '../render/compositorQuery';
import { buildProcessingChain, type ProcessingChainOptions } from './chain';

export interface AudioResolver {
  /** Decode an asset into an AudioBuffer managed by the given context. */
  getBuffer(assetId: string): Promise<AudioBuffer | null>;
}

export interface MixdownOptions {
  sampleRate: number;
  startTicks: Tick;
  durationTicks: Tick;
  /** Render the processing chain on narration clips. */
  chain?: ProcessingChainOptions;
  /** Music clips flagged duckUnderVoice get reduced while narration plays. */
  ducking?: boolean;
  channels?: number;
  /** OfflineAudioContext constructor is injectable for tests. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

export interface MixdownResult {
  buffer: AudioBuffer;
  /** Longest source mismatch encountered, in samples. */
  maxDriftSamples: number;
  warnings: string[];
}

/**
 * Mix every audio clip into one buffer with the project's fades, gains,
 * keyframes, processing chain and ducking applied. Export and preview both
 * call this, which is what keeps exported audio identical to what was heard.
 */
export async function mixdownProject(
  project: Project,
  resolver: AudioResolver,
  options: MixdownOptions,
): Promise<MixdownResult> {
  const channels = options.channels ?? 2;
  const frames = Math.max(1, Math.ceil((options.durationTicks / TICKS_PER_SECOND) * options.sampleRate));
  const createContext =
    options.createContext ??
    ((ch: number, length: number, rate: number) => new OfflineAudioContext(ch, length, rate));
  const ctx = createContext(channels, frames, options.sampleRate);
  const master = ctx.createGain();
  master.gain.value = 1;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.knee.value = 0;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  const warnings: string[] = [];
  let maxDriftSamples = 0;
  const rangeStart = options.startTicks;
  const rangeEnd = options.startTicks + options.durationTicks;
  const narrationSpans = collectNarrationSpans(project);
  const ducking = options.ducking ?? true;

  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      const clipStart = Math.max(clip.startTicks, rangeStart);
      const clipEnd = Math.min(clip.startTicks + clip.durationTicks, rangeEnd);
      if (clipEnd <= clipStart || !clip.assetId) continue;
      const buffer = await resolver.getBuffer(clip.assetId);
      if (!buffer) {
        warnings.push(`Missing audio media for clip ${clip.label ?? clip.id}.`);
        continue;
      }
      if (Math.abs(buffer.sampleRate - options.sampleRate) > 1) {
        const drift = Math.round((buffer.sampleRate - options.sampleRate) * ((clipEnd - clipStart) / TICKS_PER_SECOND));
        maxDriftSamples = Math.max(maxDriftSamples, Math.abs(drift));
      }
      const source = ctx.createBufferSource();
      source.buffer = clip.reverse ? reverseAudioBuffer(ctx, buffer) : buffer;
      const speed = clip.speed || 1;
      source.playbackRate.value = speed;

      const gainNode = ctx.createGain();
      const startSeconds = (clipStart - rangeStart) / TICKS_PER_SECOND;
      const sourceOffsetSeconds =
        (clip.inTicks + Math.round((clipStart - clip.startTicks) * speed)) / TICKS_PER_SECOND;
      const playDurationSeconds = (clipEnd - clipStart) / TICKS_PER_SECOND;
      const startAt = Math.max(0, startSeconds);

      const chain = clip.audio.processed ? buildProcessingChain(ctx, options.chain) : null;
      source.connect(gainNode);
      let tail: AudioNode = gainNode;
      if (clip.audio.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, clip.audio.pan));
        gainNode.connect(panner);
        tail = panner;
      }
      if (chain) {
        tail.connect(chain.input);
        chain.output.connect(master);
      } else {
        tail.connect(master);
      }

      // Base gain plus fades, expressed as an automation curve.
      const base = clip.audio.gain * track.volume;
      const points = buildGainAutomation(clip, clipStart, clipEnd, base, ducking, narrationSpans);
      gainNode.gain.cancelScheduledValues(0);
      for (const point of points) {
        const time = Math.max(0, point.at / TICKS_PER_SECOND);
        if (point.curve === 'set') gainNode.gain.setValueAtTime(point.value, time);
        else gainNode.gain.linearRampToValueAtTime(point.value, time);
      }

      try {
        source.start(startAt, sourceOffsetSeconds, playDurationSeconds);
      } catch (error) {
        warnings.push(`Clip ${clip.label ?? clip.id} could not be scheduled: ${(error as Error).message}`);
      }
    }
  }

  const buffer = await ctx.startRendering();
  return { buffer, maxDriftSamples, warnings };
}

interface GainPoint {
  at: Tick;
  value: number;
  curve: 'set' | 'ramp';
}

function buildGainAutomation(
  clip: Clip,
  clipStart: Tick,
  clipEnd: Tick,
  base: number,
  ducking: boolean,
  narrationSpans: Array<[Tick, Tick]>,
): GainPoint[] {
  const points: GainPoint[] = [];
  const localStart = clipStart - clip.startTicks;
  const hasVolumeCurve = clip.keyframes?.some((k) => k.target === 'volume' && k.keyframes.length > 0) ?? false;
  if (hasVolumeCurve) {
    const step = Math.round(TICKS_PER_SECOND / 4);
    for (let t = clipStart; t <= clipEnd; t += step) {
      points.push({ at: t, value: clipGain(clip, t) * (base / Math.max(clip.audio.gain, 1e-6)), curve: 'set' });
    }
    points.push({ at: clipEnd, value: clipGain(clip, clipEnd) * (base / Math.max(clip.audio.gain, 1e-6)), curve: 'set' });
    return points;
  }
  const localEnd = clipEnd - clip.startTicks;
  const fadeInEnd = Math.min(localEnd, localStart + clip.audio.fadeInTicks);
  if (clip.audio.fadeInTicks > 0) {
    points.push({ at: clipStart, value: 0, curve: 'set' });
    points.push({ at: clip.startTicks + fadeInEnd, value: base, curve: 'ramp' });
  } else {
    points.push({ at: clipStart, value: base, curve: 'set' });
  }

  const fadeOutStart = Math.max(localStart, localEnd - clip.audio.fadeOutTicks);
  if (clip.audio.fadeOutTicks > 0) {
    points.push({ at: clip.startTicks + fadeOutStart, value: base, curve: 'ramp' });
    points.push({ at: clipEnd, value: 0, curve: 'ramp' });
  }

  if (ducking && clip.audio.duckUnderVoice) {
    for (const [spanStart, spanEnd] of narrationSpans) {
      if (spanEnd <= clipStart || spanStart >= clipEnd) continue;
      const at = Math.max(spanStart, clipStart, 0);
      const until = Math.min(spanEnd, clipEnd);
      const ducked = base * 0.3;
      points.push({ at: Math.max(0, at - 120_000), value: base, curve: 'set' });
      points.push({ at, value: ducked, curve: 'ramp' });
      points.push({ at: until, value: ducked, curve: 'set' });
      points.push({ at: until + 240_000, value: base, curve: 'ramp' });
    }
  }
  points.sort((a, b) => a.at - b.at);
  return points;
}

/** Spans where narration is audible, used for ducking and silence checks. */
export function collectNarrationSpans(project: Project): Array<[Tick, Tick]> {
  const spans: Array<[Tick, Tick]> = [];
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    if (!/narration|voice|voiceover|mic/i.test(track.name)) continue;
    for (const clip of track.clips) {
      if (clip.audio.muted) continue;
      spans.push([clip.startTicks, clip.startTicks + clip.durationTicks]);
    }
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

/** Peak envelope for waveform display, downsampled to n buckets. */
export function waveformPeaks(buffer: AudioBuffer, buckets: number): number[] {
  const data = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(data.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i += 1) {
    let peak = 0;
    const start = i * size;
    const end = Math.min(data.length, start + size);
    for (let j = start; j < end; j += 1) {
      const abs = Math.abs(data[j]!);
      if (abs > peak) peak = abs;
    }
    peaks.push(peak);
  }
  return peaks;
}

/** Silence detection used by the transcript panel. */
export interface SilenceRange {
  startTicks: Tick;
  endTicks: Tick;
  durationTicks: Tick;
}

export function detectSilences(
  buffer: AudioBuffer,
  options: { thresholdDb: number; minDurationTicks: Tick; paddingTicks: Tick },
): SilenceRange[] {
  const threshold = Math.pow(10, options.thresholdDb / 20);
  const data = buffer.getChannelData(0);
  const windowSamples = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const ranges: SilenceRange[] = [];
  let silentStart: number | null = null;
  for (let i = 0; i < data.length; i += windowSamples) {
    let peak = 0;
    const end = Math.min(data.length, i + windowSamples);
    for (let j = i; j < end; j += 1) {
      const abs = Math.abs(data[j]!);
      if (abs > peak) peak = abs;
    }
    const silent = peak < threshold;
    if (silent && silentStart === null) silentStart = i;
    if (!silent && silentStart !== null) {
      pushSilence(ranges, silentStart, i, buffer, options);
      silentStart = null;
    }
  }
  if (silentStart !== null) pushSilence(ranges, silentStart, data.length, buffer, options);
  return ranges;
}

function pushSilence(
  ranges: SilenceRange[],
  startSample: number,
  endSample: number,
  buffer: AudioBuffer,
  options: { minDurationTicks: Tick; paddingTicks: Tick },
): void {
  const startTicks = Math.round((startSample / buffer.sampleRate) * TICKS_PER_SECOND) + options.paddingTicks;
  const endTicks = Math.round((endSample / buffer.sampleRate) * TICKS_PER_SECOND) - options.paddingTicks;
  if (endTicks - startTicks >= options.minDurationTicks) {
    ranges.push({ startTicks, endTicks, durationTicks: endTicks - startTicks });
  }
}

function reverseAudioBuffer(ctx: OfflineAudioContext, buffer: AudioBuffer): AudioBuffer {
  if (typeof ctx.createBuffer !== 'function') return buffer;
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i += 1) {
      dst[i] = src[n - 1 - i]!;
    }
  }
  return out;
}

