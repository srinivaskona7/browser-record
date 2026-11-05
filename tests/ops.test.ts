import { describe, expect, it } from 'vitest';
import { createClip, createProject, frameCount } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { TICKS_PER_SECOND, type Tick } from '../src/core/time';
import type { Project } from '../src/project/types';

const seconds = (value: number): Tick => value * TICKS_PER_SECOND;

function withAsset(base: Project): Project {
  return {
    ...base,
    assets: [
      {
        id: 'asset_one',
        kind: 'video',
        name: 'screen.webm',
        path: 'media/originals/screen.webm',
        durationTicks: seconds(30),
        origin: 'recorded',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

function projectWithClips(): { project: Project; trackId: string; clipId: string } {
  const base = withAsset(createProject({ name: 'Ops fixture', width: 1920, height: 1080, id: 'proj_test', now: '2026-01-01T00:00:00.000Z' }));
  const track = base.tracks[0]!;
  const placed = ops.addAssetClip(base, track.id, 'asset_one', 0, { mode: 'overwrite' });
  const project = ops.trimEnd(placed.project, placed.clipId, seconds(10));
  return { project, trackId: track.id, clipId: placed.clipId };
}

function clips(project: Project, trackId: string) {
  return project.tracks.find((track) => track.id === trackId)!.clips;
}

describe('timeline edits', () => {
  it('splits a clip into two contiguous halves with independent media offsets', () => {
    const { project, trackId } = projectWithClips();
    const split = ops.splitAt(project, seconds(4), { splitLinked: true });
    const parts = clips(split, trackId);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.startTicks).toBe(0);
    expect(parts[0]!.durationTicks).toBe(seconds(4));
    expect(parts[1]!.startTicks).toBe(seconds(4));
    expect(parts[1]!.inTicks).toBe(seconds(4));
    expect(parts[1]!.durationTicks).toBe(seconds(6));
  });

  it('splits linked clips together and keeps the link', () => {
    const { project } = projectWithClips();
    const videoTrack = project.tracks[0]!;
    const audioTrack = project.tracks[2]!;
    const withAudio: Project = {
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === audioTrack.id
          ? {
              ...track,
              clips: [createClip({ id: 'audio_one', startTicks: 0, durationTicks: seconds(10), assetId: 'asset_one', linkId: 'link_a' })],
            }
          : track.id === videoTrack.id
            ? { ...track, clips: track.clips.map((clip) => ({ ...clip, linkId: 'link_a' })) }
            : track,
      ),
    };
    const split = ops.splitAt(withAudio, seconds(3), { splitLinked: true });
    const videoParts = clips(split, videoTrack.id);
    const audioParts = clips(split, audioTrack.id);
    expect(videoParts).toHaveLength(2);
    expect(audioParts).toHaveLength(2);
    // Each half is its own link group. Reusing one id for both halves made a
    // ripple delete of the second half remove the first half as well.
    expect(videoParts[0]!.linkId).toBe('link_a');
    expect(audioParts[0]!.linkId).toBe('link_a');
    expect(videoParts[1]!.linkId).toBe(audioParts[1]!.linkId);
    expect(videoParts[1]!.linkId).not.toBe('link_a');
  });

  it('ripple delete of one half of a split keeps the other half', () => {
    const { project } = projectWithClips();
    const videoTrack = project.tracks[0]!;
    const audioTrack = project.tracks[2]!;
    const withAudio: Project = {
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === audioTrack.id
          ? {
              ...track,
              clips: [createClip({ id: 'audio_one', startTicks: 0, durationTicks: seconds(10), assetId: 'asset_one', linkId: 'link_a' })],
            }
          : track.id === videoTrack.id
            ? { ...track, clips: track.clips.map((clip) => ({ ...clip, linkId: 'link_a' })) }
            : track,
      ),
    };
    const split = ops.splitAt(withAudio, seconds(3), { splitLinked: true });
    const right = clips(split, videoTrack.id)[1]!;
    const after = ops.deleteClips(split, [right.id], 'ripple');
    expect(clips(after, videoTrack.id)).toHaveLength(1);
    expect(clips(after, audioTrack.id)).toHaveLength(1);
    expect(clips(after, videoTrack.id)[0]!.startTicks).toBe(0);
  });

  it('ripple delete removes the range and closes the gap on every track', () => {
    const { project, trackId } = projectWithClips();
    const ripple = ops.rippleDeleteRange(project, seconds(2), seconds(5));
    const parts = clips(ripple, trackId);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.startTicks).toBe(0);
    expect(parts[0]!.durationTicks).toBe(seconds(2));
    expect(parts[1]!.startTicks).toBe(seconds(2));
    expect(parts[1]!.durationTicks).toBe(seconds(5));
    expect(ripple.durationTicks).toBe(seconds(7));
  });

  it('overwrite placement trims the earlier clip instead of stacking', () => {
    const { project, trackId, clipId } = projectWithClips();
    const incoming = createClip({ id: 'clip_two', startTicks: seconds(3), durationTicks: seconds(4), assetId: 'asset_two' });
    const placed = ops.placeClip(project, trackId, incoming, 'overwrite');
    const parts = clips(placed, trackId);
    expect(parts).toHaveLength(3);
    const [left, middle, right] = parts;
    expect(left!.id).toBe(clipId);
    expect(left!.durationTicks).toBe(seconds(3));
    expect(middle!.id).toBe('clip_two');
    expect(middle!.startTicks).toBe(seconds(3));
    expect(right!.startTicks).toBe(seconds(7));
    expect(right!.durationTicks).toBe(seconds(3));
  });

  it('insert placement pushes later clips right by the inserted duration', () => {
    const { project, trackId } = projectWithClips();
    const incoming = createClip({ id: 'clip_two', startTicks: 0, durationTicks: seconds(3), assetId: 'asset_two' });
    const placed = ops.placeClip(project, trackId, incoming, 'insert');
    const parts = clips(placed, trackId);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.id).toBe('clip_two');
    expect(parts[1]!.startTicks).toBe(seconds(3));
  });

  it('locks are respected by destructive edits', () => {
    const { project, trackId } = projectWithClips();
    const locked: Project = {
      ...project,
      tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, locked: true } : track)),
    };
    expect(clips(ops.splitAt(locked, seconds(4)), trackId)).toHaveLength(1);
    expect(clips(ops.rippleDeleteRange(locked, 0, seconds(5)), trackId)).toHaveLength(1);
  });

  it('frame count is derived from the exact integer duration', () => {
    const { project } = projectWithClips();
    expect(ops.withDuration(project).durationTicks).toBe(seconds(10));
    expect(frameCount(project)).toBe(300);
  });
});

describe('relinking', () => {
  it('repairs a missing asset without touching clips or in-points', () => {
    const { project, trackId, clipId } = projectWithClips();
    const missing: Project = {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, missing: true })),
    };
    const clipsBefore = project.tracks.find((track) => track.id === trackId)!.clips;
    const relinked = ops.relinkAssetInProject(missing, 'asset_one', {
      path: 'media/originals/relinked-screen.webm',
      durationSeconds: 42.5,
      width: 2560,
      height: 1440,
      mimeType: 'video/webm',
    });
    const asset = relinked.assets[0]!;
    expect(asset.missing).toBe(false);
    expect(asset.path).toBe('media/originals/relinked-screen.webm');
    expect(asset.durationTicks).toBe(seconds(42.5));
    expect(asset.width).toBe(2560);
    expect(asset.mimeType).toBe('video/webm');
    const after = relinked.tracks.find((track) => track.id === trackId)!.clips;
    expect(after).toEqual(clipsBefore);
    expect(after.find((clip) => clip.id === clipId)).toBeTruthy();
  });

  it('leaves other assets untouched', () => {
    const { project } = projectWithClips();
    const two: Project = {
      ...project,
      assets: [
        ...project.assets,
        {
          id: 'asset_two',
          kind: 'audio',
          name: 'mic.webm',
          path: 'media/originals/mic.webm',
          durationTicks: seconds(30),
          origin: 'recorded',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const relinked = ops.relinkAssetInProject(two, 'asset_one', { path: 'x.webm', durationSeconds: 5 });
    expect(relinked.assets[1]).toEqual(two.assets[1]);
  });
});
