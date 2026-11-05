import { describe, expect, it } from 'vitest';
import { createClip, createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { parseProject, serializeProject } from '../src/project/serialize';
import { TICKS_PER_SECOND } from '../src/core/time';
import type { Project } from '../src/project/types';

function fixture(): Project {
  return createProject({ name: 'Annotations', width: 1920, height: 1080, id: 'proj_ann', now: '2026-01-01T00:00:00.000Z' });
}

describe('arrow and title presets', () => {
  it('adds an arrow clip with geometry on a video track', () => {
    const base = fixture();
    const trackId = base.tracks.find((t) => t.kind === 'video')!.id;
    const { project, clipId } = ops.addArrowClip(base, trackId, 0);
    const clip = project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === clipId)!;
    expect(clip.kind).toBe('arrow');
    expect(clip.arrow?.from).toEqual({ x: 0.2, y: 0.8 });
    expect(clip.arrow?.to).toEqual({ x: 0.45, y: 0.55 });
  });

  it('round-trips an arrow clip through the serializer', () => {
    const base = fixture();
    const trackId = base.tracks.find((t) => t.kind === 'video')!.id;
    const { project } = ops.addArrowClip(base, trackId, 0);
    const restored = parseProject(JSON.parse(serializeProject(project)));
    const clip = restored.tracks.find((t) => t.id === trackId)!.clips[0]!;
    expect(clip.arrow?.color).toBe('#ffd166');
  });

  it('rejects an arrow clip that has no arrow properties', () => {
    const base = fixture();
    const trackId = base.tracks.find((t) => t.kind === 'video')!.id;
    const bad = createClip({ kind: 'arrow', startTicks: 0, durationTicks: TICKS_PER_SECOND });
    const project = { ...base, tracks: base.tracks.map((t) => (t.id === trackId ? { ...t, clips: [bad] } : t)) };
    expect(() => parseProject(JSON.parse(serializeProject(project)))).toThrow(/no arrow properties/);
  });

  it('gives the lower-third and callout presets their own placement and style', () => {
    const base = fixture();
    const trackId = base.tracks.find((t) => t.kind === 'video')!.id;
    const lower = ops.addTitleClip(base, trackId, 0, 'Name', 'lower-third').project;
    const callout = ops.addTitleClip(base, trackId, 0, 'Key', 'callout').project;
    const lowerClip = lower.tracks.find((t) => t.id === trackId)!.clips[0]!;
    const calloutClip = callout.tracks.find((t) => t.id === trackId)!.clips[0]!;
    expect(lowerClip.transform.y).toBeGreaterThan(0.8);
    expect(calloutClip.text?.background).toBe('#ffd166');
    expect(calloutClip.transform.y).toBeLessThan(0.3);
  });
});
