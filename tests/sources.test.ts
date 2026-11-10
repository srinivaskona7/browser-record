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

  it('uses sequential canvasesAtTimestamps single-pass decoding and frame reuse when prepareTimelineSchedule is called', async () => {
    const { MediaAssetResolver } = await import('../src/render/sources');
    const project = projectWithClip();
    const resolver = new MediaAssetResolver(
      project,
      {
        getFile: async () => new File([new Uint8Array([1, 2, 3])], 'screen.webm', { type: 'video/webm' }),
      },
      { maxCanvasDimension: 1600 },
    );

    const yieldedTimestamps: number[] = [];
    const getCanvasCalls: number[] = [];
    const fakeCanvas = { width: 1600, height: 900 } as unknown as HTMLCanvasElement;
    // Inject a mock decoder entry so we can verify sequential iterator consumption vs random getCanvas seeks
    (resolver as unknown as { decoders: Map<string, Promise<unknown>> }).decoders.set(
      'asset_ok',
      Promise.resolve({
        input: { dispose: () => undefined },
        videoTrack: {},
        sink: {
          canvasesAtTimestamps: async function* (timestamps: number[]) {
            for (const ts of timestamps) {
              yieldedTimestamps.push(ts);
              yield { canvas: fakeCanvas, timestamp: ts, duration: 1 / 30 };
            }
          },
          getCanvas: async (ts: number) => {
            getCanvasCalls.push(ts);
            return { canvas: fakeCanvas, timestamp: ts, duration: 1 / 30 };
          },
        },
        canvas: fakeCanvas,
        ctx: {},
        width: 1600,
        height: 900,
      }),
    );

    const frame0 = 0;
    const frame1 = Math.round(TICKS_PER_SECOND / 30);
    // Include a repeated timestamp (frame1 twice) to verify consecutive-frame caching
    await resolver.prepareTimelineSchedule([frame0, frame1, frame1]);

    const res0 = await resolver.resolve('asset_ok', frame0);
    const res1a = await resolver.resolve('asset_ok', frame1);
    const res1b = await resolver.resolve('asset_ok', frame1);

    expect(res0?.width).toBe(1600);
    expect(res1a).toBe(res1b);
    expect(yieldedTimestamps).toHaveLength(2);
    expect(getCanvasCalls).toHaveLength(0);
    await resolver.close();
  });
});
