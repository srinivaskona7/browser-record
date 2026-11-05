import { describe, expect, it } from 'vitest';
import {
  findAndReplace,
  formatSrtTime,
  mergeAdjacentCues,
  normalizePunctuation,
  parseSrt,
  parseSubtitles,
  parseTimestampToTicks,
  rebalanceCues,
  retimeCues,
  scaleCues,
  serializeSrt,
  serializeVtt,
} from '../src/captions/subtitles';
import { TICKS_PER_SECOND } from '../src/core/time';
import type { CaptionCue } from '../src/project/types';

const cue = (id: string, start: number, end: number, text: string): CaptionCue => ({
  id,
  startTicks: Math.round(start * TICKS_PER_SECOND),
  endTicks: Math.round(end * TICKS_PER_SECOND),
  text,
});

const SRT = `1
00:00:01,000 --> 00:00:04,500
kubectl get pods

2
00:00:05,000 --> 00:00:08,000
Then describe the pod

3
not a timestamp
ignored block
`;

describe('subtitle parsing', () => {
  it('parses SRT blocks and reports the malformed one', () => {
    const result = parseSrt(SRT);
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.startTicks).toBe(TICKS_PER_SECOND);
    expect(result.value[0]!.endTicks).toBe(Math.round(4.5 * TICKS_PER_SECOND));
    expect(result.value[0]!.text).toBe('kubectl get pods');
    expect(result.issues).toHaveLength(1);
  });

  it('parses WebVTT timestamps with and without hours', () => {
    expect(parseTimestampToTicks('00:02:03.500')).toBe(Math.round(123.5 * TICKS_PER_SECOND));
    expect(parseTimestampToTicks('02:03.500')).toBe(Math.round(123.5 * TICKS_PER_SECOND));
    expect(parseTimestampToTicks('bad')).toBeNull();
  });

  it('auto-detects the format', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
    expect(parseSubtitles(vtt).value).toHaveLength(1);
  });

  it('serializes SRT with exact millisecond rounding', () => {
    expect(formatSrtTime(Math.round(3661.999 * TICKS_PER_SECOND))).toBe('01:01:01,999');
    const text = serializeSrt([cue('a', 1, 2.5, 'Hello')]);
    expect(text).toContain('00:00:01,000 --> 00:00:02,500');
    expect(text.trim().endsWith('Hello')).toBe(true);
  });

  it('serializes VTT only with real word timings', () => {
    const plain = serializeVtt([cue('a', 0, 1, 'Hello')], { wordTimings: true });
    expect(plain).not.toContain('<00:');
    const timed = serializeVtt(
      [
        {
          ...cue('b', 0, 1, 'Hello'),
          words: [{ startTicks: 0, endTicks: TICKS_PER_SECOND / 2, text: 'Hello' }],
        },
      ],
      { wordTimings: true },
    );
    expect(timed).toContain('<00:00:00.000>');
  });
});

describe('subtitle edits', () => {
  it('retimes every cue and its words by a delta', () => {
    const cues = [{ ...cue('a', 2, 4, 'x'), words: [{ startTicks: 2 * TICKS_PER_SECOND, endTicks: 3 * TICKS_PER_SECOND, text: 'x' }] }];
    const moved = retimeCues(cues, TICKS_PER_SECOND);
    expect(moved[0]!.startTicks).toBe(3 * TICKS_PER_SECOND);
    expect(moved[0]!.words![0]!.startTicks).toBe(3 * TICKS_PER_SECOND);
  });

  it('scales cues around an origin', () => {
    const scaled = scaleCues([cue('a', 10, 20, 'x')], 0.5, 10 * TICKS_PER_SECOND);
    expect(scaled[0]!.startTicks).toBe(10 * TICKS_PER_SECOND);
    expect(scaled[0]!.endTicks).toBe(15 * TICKS_PER_SECOND);
  });

  it('rebalances long lines below the character limit', () => {
    const long = cue('a', 0, 5, 'This is a deliberately long caption line that must be split into readable pieces for the viewer');
    const balanced = rebalanceCues([long], 32);
    expect(balanced.length).toBeGreaterThan(1);
    for (const part of balanced) {
      expect(part.text.length).toBeLessThanOrEqual(32);
      expect(part.endTicks).toBeGreaterThan(part.startTicks);
    }
  });

  it('merges adjacent cues without swallowing real gaps', () => {
    const merged = mergeAdjacentCues([cue('a', 0, 2, 'one'), cue('b', 2.1, 4, 'two'), cue('c', 6, 8, 'three')]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.text).toBe('one two');
  });

  it('find and replace reports the count and preserves other text', () => {
    const result = findAndReplace([cue('a', 0, 1, 'kubernetes is kubectl'), cue('b', 2, 3, 'Kubernetes')], 'kubernetes', 'K8s');
    expect(result.count).toBe(2);
    expect(result.cues[0]!.text).toContain('K8s');
  });

  it('normalises punctuation without inventing words', () => {
    const fixed = normalizePunctuation([cue('a', 0, 1, 'hello , world .')]);
    expect(fixed[0]!.text).toBe('Hello, world.');
  });
});
