import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/core/time';
import {
  applyAdjustmentOverRange,
  buildExportRangeSpec,
  canRippleDeleteRange,
  classifySelection,
  contextMenuCommandsForSelection,
  deleteRange,
  inspectorSectionsForSelection,
  rippleDeleteRange,
  speedRange,
  splitRangeEdges,
  toolbarCommandsForSelection,
} from '../src/editor/actions';
import {
  createCaptionSelection,
  createClipsSelection,
  createRangeSelection,
  formatSelectionScopeChip,
  selectAllClips,
} from '../src/editor/selection';
import { createClip, createProject, createTrack } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { useEditor } from '../src/project/store';

function makeEditorProject() {
  let project = createProject({ name: 'E1 Selection & Command Spec' });
  const videoTrack = project.tracks.find((t) => t.kind === 'video')!;
  const audioTrack = project.tracks.find((t) => t.kind === 'audio')!;

  const vidClip = createClip({
    kind: 'media',
    assetId: 'asset_v1',
    startTicks: 0,
    durationTicks: 4 * TICKS_PER_SECOND,
    linkId: 'link_av_1',
    label: 'Intro Video',
  });
  const audClip = createClip({
    kind: 'media',
    assetId: 'asset_a1',
    startTicks: 0,
    durationTicks: 4 * TICKS_PER_SECOND,
    linkId: 'link_av_1',
    label: 'Intro Audio',
  });
  const secondVid = createClip({
    kind: 'media',
    assetId: 'asset_v2',
    startTicks: 4 * TICKS_PER_SECOND,
    durationTicks: 6 * TICKS_PER_SECOND,
    label: 'Main Demo',
    keyframes: [
      {
        target: 'zoom',
        keyframes: [{ id: 'kf_1', atTicks: 2 * TICKS_PER_SECOND, value: 1.4, easing: 'ease-out' }],
      },
    ],
  });

  project = ops.placeClip(project, videoTrack.id, vidClip, 'overwrite');
  project = ops.placeClip(project, videoTrack.id, secondVid, 'overwrite');
  project = ops.placeClip(project, audioTrack.id, audClip, 'overwrite');

  const overlayTrack = createTrack('video', 'Overlays');
  project = ops.addTrack(project, overlayTrack);
  const titleRes = ops.addTitleClip(project, overlayTrack.id, TICKS_PER_SECOND, 'WEEKEND VIBES');
  project = titleRes.project;

  const adjRes = ops.addAdjustmentLayer(project, 0, 3 * TICKS_PER_SECOND, 'rec709_standard');
  project = adjRes.project;

  project = {
    ...project,
    markers: [
      { id: 'm_inside', atTicks: 5 * TICKS_PER_SECOND, label: 'Inside Range', color: '#38bdf8' },
      { id: 'm_after', atTicks: 9 * TICKS_PER_SECOND, label: 'After Range', color: '#38bdf8' },
    ],
    captions: [
      {
        id: 'cue_1',
        startTicks: TICKS_PER_SECOND,
        endTicks: 3 * TICKS_PER_SECOND,
        text: 'hello sunday morning',
      },
      {
        id: 'cue_2',
        startTicks: 5 * TICKS_PER_SECOND,
        endTicks: 7 * TICKS_PER_SECOND,
        text: 'inside range cue',
      },
      {
        id: 'cue_3',
        startTicks: 8 * TICKS_PER_SECOND,
        endTicks: 9 * TICKS_PER_SECOND,
        text: 'after range cue',
      },
    ],
  };

  return {
    project,
    videoTrackId: videoTrack.id,
    audioTrackId: audioTrack.id,
    vidClipId: vidClip.id,
    secondVidId: secondVid.id,
    audClipId: audClip.id,
    titleClipId: titleRes.clipId,
    adjClipId: adjRes.clipId,
  };
}

describe('Phase E1: Unified Selection Store, Scope Chip, Command Registry & Range Semantics', () => {
  it('replaces selection kinds cleanly, steps back with Esc, and formats identical scope chips', () => {
    const { project, audioTrackId, vidClipId, audClipId, titleClipId } = makeEditorProject();
    useEditor.getState().loadProject(project);

    // 1. Video clip with linked audio partner
    useEditor.getState().selectClips([vidClipId]);
    expect(formatSelectionScopeChip(useEditor.getState().selection, project)).toBe(
      'Clip · Video · 0:04.00 · + linked audio',
    );

    // 2. Multi-clip across 2 tracks
    useEditor.getState().selectClips([vidClipId, audClipId]);
    expect(formatSelectionScopeChip(useEditor.getState().selection, project)).toBe('2 clips · 2 tracks');

    // 3. Canvas layer selection
    useEditor.getState().setSelection(createClipsSelection([titleClipId], 'canvas'));
    expect(formatSelectionScopeChip(useEditor.getState().selection, project)).toBe(
      "Layer · Text 'WEEKEND VIBES'",
    );

    // 4. Caption word selection -> Esc steps back to Caption cue -> Esc steps back to none
    useEditor.getState().selectCaption('cue_1', 1);
    expect(formatSelectionScopeChip(useEditor.getState().selection, project)).toBe(
      "Caption · Cue 1 · word 'sunday'",
    );
    useEditor.getState().stepBackSelection();
    expect(useEditor.getState().selection).toEqual({ kind: 'caption', cueId: 'cue_1' });
    expect(formatSelectionScopeChip(useEditor.getState().selection, project)).toBe('Caption · Cue 1');
    useEditor.getState().stepBackSelection();
    expect(useEditor.getState().selection).toEqual({ kind: 'none' });

    // 5. Range selection with 1 locked track reported in scope chip
    const withLocked = ops.setTrackFlag(project, audioTrackId, { locked: true });
    const rangeSel = createRangeSelection(4 * TICKS_PER_SECOND, 7.5 * TICKS_PER_SECOND, 'unlocked');
    expect(formatSelectionScopeChip(rangeSel, withLocked)).toContain('(1 locked skipped)');

    // 6. Select all clips on unlocked tracks
    const allSel = selectAllClips(withLocked);
    expect(allSel.kind).toBe('clips');
    if (allSel.kind === 'clips') {
      expect(allSel.ids).not.toContain(audClipId);
    }
  });

  it('satisfies all 7 rows of the Selection -> Toolbar, Context Menu, and Inspector Matrix', () => {
    const { project, vidClipId, secondVidId, audClipId, titleClipId, adjClipId } = makeEditorProject();

    // Row 1: Video clip
    const vidSel = createClipsSelection([vidClipId]);
    expect(classifySelection(vidSel, project)).toBe('video-clip');
    expect(toolbarCommandsForSelection(vidSel, project).map((c) => c.label)).toEqual([
      'Split',
      'Speed',
      'Volume',
      'Filter',
      'Delete',
    ]);
    expect(inspectorSectionsForSelection(vidSel, project)).toContain('Transform & Crop');

    // Row 2: Text clip
    const textSel = createClipsSelection([titleClipId]);
    expect(classifySelection(textSel, project)).toBe('text-clip');
    expect(toolbarCommandsForSelection(textSel, project).map((c) => c.label)).toEqual([
      'Edit',
      'Style',
      'Animate',
      'Duplicate',
      'Delete',
    ]);
    expect(inspectorSectionsForSelection(textSel, project)).toContain('Font');

    // Row 3: Audio clip
    const audSel = createClipsSelection([audClipId]);
    expect(classifySelection(audSel, project)).toBe('audio-clip');
    expect(toolbarCommandsForSelection(audSel, project).map((c) => c.label)).toEqual([
      'Split',
      'Volume',
      'Fade',
      'Enhance',
      'Delete',
    ]);
    expect(inspectorSectionsForSelection(audSel, project)).toContain('Volume & Fades');

    // Row 4: Adjust layer
    const adjSel = createClipsSelection([adjClipId]);
    expect(classifySelection(adjSel, project)).toBe('adjust-layer');
    expect(toolbarCommandsForSelection(adjSel, project).map((c) => c.label)).toEqual([
      'Adjust',
      'Filter',
      'Effect',
      'Duration',
      'Delete',
    ]);

    // Row 5: Multi-clip
    const multiSel = createClipsSelection([vidClipId, secondVidId]);
    expect(classifySelection(multiSel, project)).toBe('multi-clip');
    expect(toolbarCommandsForSelection(multiSel, project).map((c) => c.label)).toEqual([
      'Group',
      'Align',
      'Speed',
      'Volume',
      'Delete',
    ]);

    // Row 6: Time range
    const rangeSel = createRangeSelection(4 * TICKS_PER_SECOND, 8 * TICKS_PER_SECOND);
    expect(classifySelection(rangeSel, project)).toBe('time-range');
    expect(toolbarCommandsForSelection(rangeSel, project).map((c) => c.label)).toEqual([
      'Split edges',
      'Delete',
      'Ripple delete',
      'Speed',
      'Effect',
    ]);
    expect(contextMenuCommandsForSelection(rangeSel, project).length).toBeGreaterThanOrEqual(5);

    // Row 7: Caption
    const capSel = createCaptionSelection('cue_1');
    expect(classifySelection(capSel, project)).toBe('caption');
    expect(toolbarCommandsForSelection(capSel, project).map((c) => c.label)).toEqual([
      'Edit',
      'Split cue',
      'Merge',
      'Style',
      'Delete',
    ]);
  });

  it('enforces Range Semantics: locked-track skip, ripple-delete block, speed retiming, adjustment over range, and non-mutating export range', () => {
    const { project, audioTrackId } = makeEditorProject();
    const range = { start: 4 * TICKS_PER_SECOND, end: 8 * TICKS_PER_SECOND, tracks: 'unlocked' as const };

    // 1. Split edges splits secondVid (4s..10s) at 8s
    const splitProj = splitRangeEdges(project, range);
    expect(splitProj.tracks[0]!.clips.length).toBe(3);

    // 2. Delete range leaves a gap (later clip remains at 8s) and removes marker inside range
    const deleted = deleteRange(project, range);
    expect(deleted.tracks[0]!.clips.some((c) => c.startTicks === 8 * TICKS_PER_SECOND)).toBe(true);
    expect(deleted.markers.some((m) => m.id === 'm_inside')).toBe(false);
    expect(deleted.markers.find((m) => m.id === 'm_after')?.atTicks).toBe(9 * TICKS_PER_SECOND);

    // 3. Ripple delete is BLOCKED when a locked track has content after range.start
    const withLateAudio = ops.placeClip(
      project,
      audioTrackId,
      createClip({ kind: 'media', assetId: 'asset_a1', startTicks: 5 * TICKS_PER_SECOND, durationTicks: 3 * TICKS_PER_SECOND }),
      'overwrite',
    );
    const lockedProject = ops.setTrackFlag(withLateAudio, audioTrackId, { locked: true });
    expect(canRippleDeleteRange(lockedProject, range).ok).toBe(false);
    expect(rippleDeleteRange(lockedProject, range)).toBe(lockedProject);

    // 4. Ripple delete when unlocked shifts later clips, markers, and captions left by 4s
    const rippled = rippleDeleteRange(project, range);
    expect(rippled.tracks[0]!.clips.some((c) => c.startTicks === 4 * TICKS_PER_SECOND && c.durationTicks === 2 * TICKS_PER_SECOND)).toBe(true);
    expect(rippled.markers.find((m) => m.id === 'm_after')?.atTicks).toBe(5 * TICKS_PER_SECOND);
    expect(rippled.captions.find((c) => c.text === 'after range cue')?.startTicks).toBe(4 * TICKS_PER_SECOND);

    // 5. Speed range 2x halves inner duration (4s -> 2s), shifts later marker left by 2s, and scales keyframes
    const sped = speedRange(project, range, 2, true);
    expect(sped.markers.find((m) => m.id === 'm_after')?.atTicks).toBe(7 * TICKS_PER_SECOND);
    expect(sped.markers.find((m) => m.id === 'm_inside')?.atTicks).toBe(4.5 * TICKS_PER_SECOND);

    // 6. Apply adjustment layer over range creates an adjustment clip spanning [4s, 8s)
    const withRangeAdj = applyAdjustmentOverRange(project, range, { effect: 'video_handheld' });
    const adjTrack = withRangeAdj.tracks.find((t) => t.name === 'Adjustment Layer')!;
    expect(adjTrack.clips.some((c) => c.startTicks === 4 * TICKS_PER_SECOND && c.durationTicks === 4 * TICKS_PER_SECOND)).toBe(true);

    // 7. Export range locks in/out points without modifying Project JSON
    const beforeJson = JSON.stringify(project);
    const exportSpec = buildExportRangeSpec(project, range);
    expect(exportSpec.inTicks).toBe(4 * TICKS_PER_SECOND);
    expect(exportSpec.outTicks).toBe(8 * TICKS_PER_SECOND);
    expect(exportSpec.durationTicks).toBe(4 * TICKS_PER_SECOND);
    expect(JSON.stringify(exportSpec.projectUnchanged)).toBe(beforeJson);
  });

  it('maintains a 200-step undo history and executes commands in one undo step', () => {
    const { project, titleClipId } = makeEditorProject();
    useEditor.getState().loadProject(project);
    useEditor.getState().selectClips([titleClipId]);

    for (let i = 1; i <= 205; i += 1) {
      useEditor.getState().runCommand('edit-text', `Step ${i}`);
    }
    expect(useEditor.getState().history.length).toBe(200);
    useEditor.getState().undo();
    expect(ops.findClipById(useEditor.getState().project!, titleClipId)?.text?.text).toBe('Step 204');
  });
});
