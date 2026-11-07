import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EditorToolLibrary, ClipQuickActions } from '../src/ui/EditorTools';
import { createProject, createClip } from '../src/project/factory';
import { useEditor } from '../src/project/store';
import { TICKS_PER_SECOND } from '../src/core/time';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useEditor.getState().loadProject(createProject({ name: 'Creator test' }));
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); useEditor.getState().closeProject(); });

it('adds styled text on a separate overlay track, selects it, and supports undo', async () => {
  const project = useEditor.getState().project!;
  const source = createClip({ kind: 'media', assetId: 'source', startTicks: 0, durationTicks: 10 * TICKS_PER_SECOND });
  project.tracks[0]!.clips = [source];
  await act(() => root.render(<EditorToolLibrary tool="text" project={project} clip={null} />));
  const preset = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Keynote Minimal'))!;
  await act(() => preset.click());
  const state = useEditor.getState();
  expect(state.project!.tracks[0]!.clips).toEqual([source]);
  const title = state.project!.tracks.find((t) => t.name === 'Overlays')!.clips[0]!;
  expect(title.text?.stylePreset).toBe('apple_keynote_clean');
  expect(state.selectedClipIds).toEqual([title.id]);
  await act(() => state.undo());
  expect(useEditor.getState().project!.tracks.some((t) => t.name === 'Overlays')).toBe(false);
});

it('disables applying video effects with no selected clip', async () => {
  await act(() => root.render(<EditorToolLibrary tool="effects" project={useEditor.getState().project!} clip={null} />));
  expect(host.querySelector('.hint-card')?.textContent).toContain('Select a video clip');
  expect([...host.querySelectorAll<HTMLButtonElement>('.catalog-tile')].every((b) => b.disabled)).toBe(true);
});

it('splits the selected clip and its linked audio without splitting an unrelated layer', async () => {
  const project = useEditor.getState().project!;
  const video = createClip({ kind: 'media', assetId: 'video', linkId: 'take', startTicks: 0, durationTicks: 10 * TICKS_PER_SECOND });
  const audio = createClip({ kind: 'media', assetId: 'audio', linkId: 'take', startTicks: 0, durationTicks: 10 * TICKS_PER_SECOND });
  const other = createClip({ kind: 'title', startTicks: 0, durationTicks: 10 * TICKS_PER_SECOND });
  project.tracks[0]!.clips = [video];
  project.tracks[1]!.clips = [other];
  project.tracks[2]!.clips = [audio];
  project.durationTicks = 10 * TICKS_PER_SECOND;
  useEditor.getState().selectClips([video.id]);
  useEditor.getState().setPlayhead(4 * TICKS_PER_SECOND);
  await act(() => root.render(<ClipQuickActions project={project} />));
  await act(() => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Split'))!.click());
  const result = useEditor.getState().project!;
  expect(result.tracks[0]!.clips).toHaveLength(2);
  expect(result.tracks[2]!.clips).toHaveLength(2);
  expect(result.tracks[1]!.clips).toEqual([other]);
});

it('supports reverse playback, horizontal/vertical flip, alignment, extract audio, group/ungroup, copy/paste, beat markers, and presenter visibility', async () => {
  const ops = await import('../src/project/ops');
  const { sourceTicks } = await import('../src/render/compositorQuery');
  const { detectFloatingCameraSupport } = await import('../src/capture/floatingCamera');

  let project = useEditor.getState().project!;
  const video = createClip({
    kind: 'media',
    assetId: 'video_1',
    startTicks: 0,
    durationTicks: 6 * TICKS_PER_SECOND,
    inTicks: 0,
  });
  const second = createClip({
    kind: 'media',
    assetId: 'video_2',
    startTicks: 6 * TICKS_PER_SECOND,
    durationTicks: 4 * TICKS_PER_SECOND,
  });
  project.tracks[0]!.clips = [video, second];
  project.durationTicks = 10 * TICKS_PER_SECOND;

  // Flip H / V & Alignment
  project = ops.toggleClipFlip(project, video.id, 'x');
  project = ops.toggleClipFlip(project, video.id, 'y');
  expect(ops.findClipById(project, video.id)?.transform.flipX).toBe(true);
  expect(ops.findClipById(project, video.id)?.transform.flipY).toBe(true);
  project = ops.alignClip(project, video.id, 'left');
  expect(ops.findClipById(project, video.id)?.transform.x).toBe(0.25);

  // Reverse playback inverts sourceTicks frame lookup
  project = ops.toggleClipReverse(project, video.id);
  const reversedClip = ops.findClipById(project, video.id)!;
  expect(reversedClip.reverse).toBe(true);
  expect(sourceTicks(reversedClip, TICKS_PER_SECOND)).toBe(5 * TICKS_PER_SECOND);

  // Extract audio mutes source video clip and creates synchronized Extracted Audio clip
  const extracted = ops.extractAudio(project, video.id);
  project = extracted.project;
  expect(extracted.audioClipId).not.toBeNull();
  expect(ops.findClipById(project, video.id)?.audio.muted).toBe(true);
  const extractedClip = ops.findClipById(project, extracted.audioClipId!)!;
  expect(extractedClip.assetId).toBe('video_1');
  expect(extractedClip.reverse).toBe(true);

  // Group and Ungroup
  project = ops.groupClips(project, [video.id, second.id]);
  const sharedLink = ops.findClipById(project, video.id)?.linkId;
  expect(sharedLink).toBeTruthy();
  expect(ops.findClipById(project, second.id)?.linkId).toBe(sharedLink);
  project = ops.ungroupClips(project, [video.id]);
  expect(ops.findClipById(project, video.id)?.linkId).toBeUndefined();
  expect(ops.findClipById(project, second.id)?.linkId).toBeUndefined();

  // Copy and Paste at playhead
  const pasted = ops.pasteClipsAtPlayhead(project, [second], 10 * TICKS_PER_SECOND);
  expect(pasted.newClipIds).toHaveLength(1);
  expect(ops.findClipById(pasted.project, pasted.newClipIds[0]!)?.startTicks).toBe(10 * TICKS_PER_SECOND);

  // Beat markers
  const withBeats = ops.addBeatMarkers(pasted.project, 120, 8);
  expect(withBeats.markers.filter((m) => m.label.startsWith('Beat '))).toHaveLength(8);

  // Floating camera capability detection honest fallback in jsdom
  const support = detectFloatingCameraSupport();
  expect(support.mode).toBe('unsupported');
  expect(support.supported).toBe(false);
});

