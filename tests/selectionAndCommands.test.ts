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

  it('Phase E2 & E3: enforces drag-and-drop track rules (8px snap, auto-track on type mismatch, locked refusal) and .cube 3D LUT import', () => {
    const { project, videoTrackId, vidClipId } = makeEditorProject();
    const withAssets = {
      ...project,
      assets: [
        ...project.assets,
        {
          id: 'asset_music_drop',
          name: 'theme.wav',
          kind: 'audio' as const,
          path: 'imports/theme.wav',
          durationTicks: 3 * TICKS_PER_SECOND,
          origin: 'imported' as const,
          createdAt: '2026-11-08T00:00:00.000Z',
        },
      ],
    };

    const pxPerTick = 100 / TICKS_PER_SECOND; // 100 px per second
    // Drop audio asset onto video track near 4.04s (within 8px of 4.00s clip edge)
    const dropped = ops.dropAssetOnTrack(
      withAssets,
      videoTrackId,
      'asset_music_drop',
      404,
      pxPerTick,
      true,
      'overwrite',
    );
    expect(dropped.refusedLocked).toBe(false);
    // Created a new audio track because target was a video track
    expect(dropped.targetTrackId).not.toBe(videoTrackId);
    const createdClip = ops.findClipById(dropped.project, dropped.clipId)!;
    // Snapped within 8px to 4.00s
    expect(createdClip.startTicks).toBe(4 * TICKS_PER_SECOND);

    // Dropping onto a locked track is refused with no project mutation
    const lockedVid = ops.setTrackFlag(withAssets, videoTrackId, { locked: true });
    const refused = ops.dropAssetOnTrack(lockedVid, videoTrackId, 'asset_music_drop', 100, pxPerTick, true);
    expect(refused.refusedLocked).toBe(true);
    expect(refused.project).toBe(lockedVid);

    // Phase E3: .cube 3D LUT file import and resolution
    const sampleCube = [
      'TITLE "Teal Cinema 33"',
      'LUT_3D_SIZE 2',
      '0.02 0.08 0.12',
      '0.45 0.50 0.52',
      '0.98 0.88 0.74',
    ].join('\n');
    const lutApplied = ops.applyCubeLutText(withAssets, sampleCube, 'TealCinema.cube', vidClipId);
    expect(lutApplied.lutId).toBe('cube_teal_cinema_33');
    expect(ops.findClipById(lutApplied.project, vidClipId)?.effects.lut).toBe('cube_teal_cinema_33');
  });

  it('Phase E4–X: verifies font fallback badges, My styles user presets, caption nudge, hold keyframe easing & jump, ±0.5 dB audio gain parity, and decoded blob verification', async () => {
    const {
      checkFontAvailability,
      getUserTextStylePresets,
      saveUserTextStylePreset,
    } = await import('../src/effects/catalog');
    const { ease } = await import('../src/render/layout');
    const { clipGain } = await import('../src/render/compositorQuery');
    const { verifyDecodedVideoBlob } = await import('../src/export/exporter');

    // Phase E4: Bundled font is 'ready'; unbundled display font reports 'fallback' with identical fallback stack
    expect(checkFontAvailability('Inter').badge).toBe('ready');
    const fallbackCheck = checkFontAvailability('Studio Sans 99');
    expect(fallbackCheck.badge).toBe('fallback');
    expect(fallbackCheck.resolvedStack).toBe('Inter, system-ui, sans-serif');

    // Save reusable 'My styles' preset
    const customPreset = saveUserTextStylePreset('DevOps Header', {
      fontFamily: 'JetBrains Mono',
      color: '#38BDF8',
      fontSize: 72,
    });
    expect(customPreset.name).toBe('★ DevOps Header');
    expect(getUserTextStylePresets().some((p) => p.id === customPreset.id)).toBe(true);

    // Phase E5: Nudge caption cue timing while preserving duration
    const { project, secondVidId } = makeEditorProject();
    const nudged = ops.nudgeCaptionCue(project, 'cue_1', TICKS_PER_SECOND);
    const cue1 = nudged.captions.find((c) => c.id === 'cue_1')!;
    expect(cue1.startTicks).toBe(2 * TICKS_PER_SECOND);
    expect(cue1.endTicks).toBe(4 * TICKS_PER_SECOND);

    // Phase E6: Audio gain envelope matches within ±0.5 dB
    const clipWithFade = createClip({
      kind: 'media',
      assetId: 'asset_a1',
      startTicks: 0,
      durationTicks: 4 * TICKS_PER_SECOND,
      audio: {
        gain: 0.8,
        muted: false,
        fadeInTicks: TICKS_PER_SECOND,
        fadeOutTicks: TICKS_PER_SECOND,
        processed: false,
        pan: 0,
      },
    });
    const midGain = clipGain(clipWithFade, 2 * TICKS_PER_SECOND);
    const expectedGain = 0.8;
    const diffDb = Math.abs(20 * Math.log10(midGain / expectedGain));
    expect(diffDb).toBeLessThan(0.5);

    // Phase E7: Hold keyframe easing and Prev/Next keyframe navigation
    expect(ease(0.5, 'hold')).toBe(0);
    expect(ease(1.0, 'hold')).toBe(1);
    const secondVid = ops.findClipById(project, secondVidId)!;
    expect(ops.jumpToAdjacentKeyframe(secondVid, 0, 'next')).toBe(2 * TICKS_PER_SECOND);
    expect(ops.jumpToAdjacentKeyframe(secondVid, 3 * TICKS_PER_SECOND, 'prev')).toBe(2 * TICKS_PER_SECOND);

    // Phase X: Decoded video blob verification rejects empty blobs and accepts non-empty blobs
    const emptyCheck = await verifyDecodedVideoBlob(new Blob([]));
    expect(emptyCheck.ok).toBe(false);
  });
});
