import { describe, expect, it } from 'vitest';
import { dedupeSegments, planChunks, toMono } from '../src/captions/chunking';
import { applyGlossary, findFillers, removeWordAt, suggestGlossaryFixes } from '../src/captions/glossary';
import { defaultGlossary } from '../src/project/factory';
import type { TimedSegment } from '../src/captions/chunking';

describe('transcription chunk planning', () => {
  it('covers the whole audio with bounded overlapping windows', () => {
    const plan = planChunks(60, 25, 2);
    expect(plan[0]).toEqual({ startSeconds: 0, endSeconds: 25, lengthSeconds: 25 });
    expect(plan.at(-1)!.endSeconds).toBe(60);
    for (const chunk of plan) expect(chunk.lengthSeconds).toBeLessThanOrEqual(25);
  });

  it('returns no chunks for empty audio instead of an invalid window', () => {
    expect(planChunks(0)).toEqual([]);
  });

  it('drops overlapping duplicates and folds repeated tails', () => {
    const segments: TimedSegment[] = [
      { start: 20, end: 24, text: 'the pod is running', chunkStart: 0 },
      { start: 20.2, end: 24, text: 'The pod is running.', chunkStart: 18 },
      { start: 23, end: 26, text: 'it is healthy', chunkStart: 18 },
      { start: 25, end: 27, text: 'healthy', chunkStart: 18 },
    ];
    const deduped = dedupeSegments(segments);
    expect(deduped).toHaveLength(2);
    expect(deduped[1]!.end).toBe(27);
  });

  it('downmixes stereo to a mono float buffer', () => {
    const mono = toMono([new Float32Array([1, 0]), new Float32Array([0, 1])], 2);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
  });
});

describe('DevOps glossary', () => {
  const glossary = defaultGlossary();

  it('fixes canonical spellings case-insensitively', () => {
    const result = applyGlossary('run kubernetes and kubectl on systemd', glossary);
    expect(result.text).toContain('Kubernetes');
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it('suggests without applying', () => {
    const suggestions = suggestGlossaryFixes('we use kuberneties daily', glossary);
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('finds filler words and removes exactly the chosen occurrence', () => {
    const cueText = 'so um we run the pod';
    const fillers = findFillers([{ id: 'c', text: cueText }]);
    expect(fillers.length).toBeGreaterThan(0);
    expect(removeWordAt(cueText, fillers[0]!.index, fillers[0]!.word.length)).not.toContain(fillers[0]!.word);
  });
});
