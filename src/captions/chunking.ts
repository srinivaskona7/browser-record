export interface ChunkPlan {
  startSeconds: number;
  endSeconds: number;
  lengthSeconds: number;
}

/**
 * Overlapping chunk plan. Whisper degrades on long single passes; bounded
 * windows with overlap keep timings stable and let progress be reported.
 */
export function planChunks(totalSeconds: number, chunkSeconds = 25, overlapSeconds = 2): ChunkPlan[] {
  if (totalSeconds <= 0) return [];
  const step = Math.max(1, chunkSeconds - overlapSeconds);
  const plan: ChunkPlan[] = [];
  for (let start = 0; start < totalSeconds; start += step) {
    const end = Math.min(totalSeconds, start + chunkSeconds);
    plan.push({ startSeconds: start, endSeconds: end, lengthSeconds: end - start });
    if (end >= totalSeconds) break;
  }
  return plan;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TimedSegment extends TranscriptionSegment {
  chunkStart: number;
}

/** Copy a chunk out of a mono float buffer, with bounds clamped. */
export function sliceAudio(samples: Float32Array, sampleRate: number, plan: ChunkPlan): Float32Array {
  const start = Math.max(0, Math.floor(plan.startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.ceil(plan.endSeconds * sampleRate));
  return samples.subarray(start, end);
}

/**
 * Merge overlapping chunk output. Duplicate text in the overlapping time
 * window is dropped, and a partially repeated tail is folded into the segment
 * it continues.
 */
export function dedupeSegments(segments: TimedSegment[], toleranceSeconds = 1.5): TimedSegment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TimedSegment[] = [];
  for (const segment of sorted) {
    const duplicate = out.find(
      (existing) =>
        Math.abs(existing.start - segment.start) <= toleranceSeconds &&
        normalize(existing.text) === normalize(segment.text),
    );
    if (duplicate) {
      if (segment.end > duplicate.end) duplicate.end = segment.end;
      continue;
    }
    const repeatedTail = out.find(
      (existing) =>
        segment.start < existing.end &&
        normalize(existing.text).endsWith(normalize(segment.text)) &&
        normalize(segment.text).length > 0,
    );
    if (repeatedTail) {
      repeatedTail.end = Math.max(repeatedTail.end, segment.end);
      continue;
    }
    out.push({ ...segment });
  }
  return out.sort((a, b) => a.start - b.start);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Mono float samples from an AudioBuffer-like object (pure helper for tests). */
export function toMono(channels: Float32Array[], length: number): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) out[i] = (out[i] ?? 0) + (channel[i] ?? 0) / channels.length;
  }
  return out;
}
