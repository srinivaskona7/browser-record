import { describe, expect, it } from 'vitest';
import { prepareFrameSources } from '../src/render/sources';
import { createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { TICKS_PER_SECOND } from '../src/core/time';
import type { Project } from '../src/project/types';

function projectWithClip(): Project {
  const base = createProject({ name: 'Sources', width: 1920, height: 1080, id: 'proj_src' });
  const withAsset: Project = {
    ...base,
    assets: [
      {
        id: 'asset_ok',
        kind: 'video',
        name: 'screen.webm',
        path: 'media/originals/screen.webm',
        durationTicks: 30 * TICKS_PER_SECOND,
        origin: 'recorded',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  const track = withAsset.tracks.find((item) => item.kind === 'video')!;
  const placed = ops.addAssetClip(withAsset, track.id, 'asset_ok', 0, { mode: 'overwrite' });
  return ops.trimEnd(placed.project, placed.clipId, TICKS_PER_SECOND);
}

describe('prepareFrameSources', () => {
  it('returns resolved sources and an empty missing list', async () => {
    const project = projectWithClip();
    const prepared = await prepareFrameSources(project, 0, {
      resolve: async (assetId) => ({ image: null as unknown as CanvasImageSource, width: 1920, height: 1080, assetId }),
    });
    expect([...prepared.sources.keys()]).toEqual(['asset_ok']);
    expect(prepared.missing).toEqual([]);
  });

  it('names assets a clip needed but could not decode', async () => {
    const project = projectWithClip();
    const prepared = await prepareFrameSources(project, 0, { resolve: async () => null });
    expect(prepared.sources.size).toBe(0);
    expect(prepared.missing).toEqual(['asset_ok']);
  });

  it('treats a throwing resolver as missing instead of aborting the frame', async () => {
    const project = projectWithClip();
    const prepared = await prepareFrameSources(project, 0, {
      resolve: async () => {
        throw new Error('decoder exploded');
      },
    });
    expect(prepared.missing).toEqual(['asset_ok']);
  });
});
