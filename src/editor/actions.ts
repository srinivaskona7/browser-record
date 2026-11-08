import { newId } from '../core/ids';
import { TICKS_PER_SECOND, type Tick } from '../core/time';
import { createClip, createTrack, defaultEffects, projectDuration } from '../project/factory';
import * as ops from '../project/ops';
import type { CaptionCue, KeyframeTrack, Marker, Project, Track } from '../project/types';
import type { EditorSelection } from './selection';

export type SelectionCategory =
  | 'none'
  | 'video-clip'
  | 'text-clip'
  | 'audio-clip'
  | 'adjust-layer'
  | 'multi-clip'
  | 'time-range'
  | 'caption';

export function classifySelection(selection: EditorSelection, project: Project): SelectionCategory {
  if (selection.kind === 'none') return 'none';
  if (selection.kind === 'range') return 'time-range';
  if (selection.kind === 'caption') return 'caption';
  if (selection.ids.length > 1) return 'multi-clip';
  const primaryId = selection.primary;
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === primaryId);
    if (!clip) continue;
    if (clip.kind === 'title') return 'text-clip';
    if (clip.kind === 'adjustment') return 'adjust-layer';
    if (track.kind === 'audio') return 'audio-clip';
    return 'video-clip';
  }
  return 'none';
}

export function inspectorSectionsForSelection(selection: EditorSelection, project: Project): string[] {
  const category = classifySelection(selection, project);
  switch (category) {
    case 'video-clip':
      return [
        'Transform & Crop',
        'Speed',
        'Audio',
        'Filters',
        'Adjust',
        'Animations',
        'Keyframes',
        'Opacity & Blend',
        'Clip actions',
      ];
    case 'text-clip':
      return [
        'Text',
        'Font',
        'Style',
        'Presets',
        'Animations',
        'Transform',
        'Keyframes',
        'Timing',
      ];
    case 'audio-clip':
      return ['Volume & Fades', 'Speed', 'Enhance', 'Ducking', 'Keyframes'];
    case 'adjust-layer':
      return ['Adjust', 'Filters', 'Effects', 'Opacity', 'Timing'];
    case 'multi-clip':
      return ['Shared properties ("Mixed")'];
    case 'time-range':
      return ['Range info', 'Speed', 'Volume', 'Apply filter/adjust/effect', 'Freeze frame', 'Export range'];
    case 'caption':
      return ['Cue text & timing', 'Word highlight', 'Style', 'Animation'];
    default:
      return [];
  }
}

// ============================================================================
// Range Semantics (Phase E1)
// ============================================================================

function isTrackInRangeScope(track: Track, scope: 'unlocked' | string[]): boolean {
  if (track.locked) return false;
  if (scope === 'unlocked') return true;
  return scope.includes(track.id);
}

/** Split every clip on in-scope unlocked tracks that crosses `start` or `end`. */
export function splitRangeEdges(
  project: Project,
  range: { start: Tick; end: Tick; tracks: 'unlocked' | string[] },
): Project {
  const inScopeClipIds = (p: Project, tick: Tick): string[] => {
    const ids: string[] = [];
    for (const track of p.tracks) {
      if (!isTrackInRangeScope(track, range.tracks)) continue;
      for (const clip of track.clips) {
        if (tick > clip.startTicks && tick < clip.startTicks + clip.durationTicks) {
          ids.push(clip.id);
        }
      }
    }
    return ids;
  };
  let working = project;
  const startClips = inScopeClipIds(working, range.start);
  if (startClips.length > 0) {
    working = ops.splitAt(working, range.start, { clipIds: startClips, splitLinked: false });
  }
  const endClips = inScopeClipIds(working, range.end);
  if (endClips.length > 0) {
    working = ops.splitAt(working, range.end, { clipIds: endClips, splitLinked: false });
  }
  return working;
}

/** Delete inner pieces inside `[range.start, range.end)` on in-scope unlocked tracks, leaving a gap. */
export function deleteRange(
  project: Project,
  range: { start: Tick; end: Tick; tracks: 'unlocked' | string[] },
): Project {
  const split = splitRangeEdges(project, range);
  const tracks = split.tracks.map((track) => {
    if (!isTrackInRangeScope(track, range.tracks)) return track;
    return {
      ...track,
      clips: track.clips.filter(
        (clip) => !(clip.startTicks >= range.start && clip.startTicks + clip.durationTicks <= range.end),
      ),
    };
  });
  const markers = split.markers.filter((m) => m.atTicks < range.start || m.atTicks >= range.end);
  const captions = removeOrSplitCaptionsInRange(split.captions, range.start, range.end, 0);
  const next = { ...split, tracks, markers, captions };
  return { ...next, durationTicks: projectDuration(next.tracks) };
}

/** Check whether a ripple delete is blocked because a locked track has content after the range start. */
export function canRippleDeleteRange(
  project: Project,
  range: { start: Tick; end: Tick; tracks: 'unlocked' | string[] },
): { ok: boolean; reason?: string } {
  if (range.end <= range.start) return { ok: false, reason: 'Range is empty' };
  for (const track of project.tracks) {
    if (!track.locked) continue;
    const hasContentAfter = track.clips.some((clip) => clip.startTicks + clip.durationTicks > range.start);
    if (hasContentAfter) {
      return {
        ok: false,
        reason: `Blocked: locked track "${track.name}" has content after the range`,
      };
    }
  }
  return { ok: true };
}

/**
 * Ripple delete `[range.start, range.end)`:
 * - Blocked if any locked track has content after `range.start`.
 * - Removes inner pieces on in-scope unlocked tracks and shifts later clips, markers, and captions left by `delta`.
 * - Out-of-scope clips that CROSS the range stay unchanged; out-of-scope unlocked clips that START after the range shift left.
 */
export function rippleDeleteRange(
  project: Project,
  range: { start: Tick; end: Tick; tracks: 'unlocked' | string[] },
): Project {
  const check = canRippleDeleteRange(project, range);
  if (!check.ok) return project;
  const delta = range.end - range.start;
  const split = splitRangeEdges(project, range);

  const tracks = split.tracks.map((track) => {
    if (track.locked) return track;
    const inScope = isTrackInRangeScope(track, range.tracks);
    return {
      ...track,
      clips: track.clips
        .filter(
          (clip) =>
            !inScope || !(clip.startTicks >= range.start && clip.startTicks + clip.durationTicks <= range.end),
        )
        .map((clip) => {
          // Out-of-scope clips that CROSS the range stay unchanged; clips starting >= range.end shift left
          if (clip.startTicks >= range.end) {
            return { ...clip, startTicks: Math.max(0, clip.startTicks - delta) };
          }
          return clip;
        }),
    };
  });

  const markers: Marker[] = split.markers
    .filter((m) => m.atTicks < range.start || m.atTicks >= range.end)
    .map((m) => (m.atTicks >= range.end ? { ...m, atTicks: m.atTicks - delta } : m));

  const captions = removeOrSplitCaptionsInRange(split.captions, range.start, range.end, -delta);
  const next = { ...split, tracks, markers, captions };
  return { ...next, durationTicks: projectDuration(next.tracks) };
}

function removeOrSplitCaptionsInRange(
  captions: CaptionCue[],
  start: Tick,
  end: Tick,
  shiftAfterTicks: Tick,
): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of captions) {
    if (cue.endTicks <= start) {
      out.push(cue);
      continue;
    }
    if (cue.startTicks >= end) {
      out.push({
        ...cue,
        startTicks: Math.max(0, cue.startTicks + shiftAfterTicks),
        endTicks: Math.max(1, cue.endTicks + shiftAfterTicks),
      });
      continue;
    }
    // Cue overlaps [start, end)
    if (cue.startTicks < start) {
      out.push({ ...cue, id: newId('cue'), endTicks: start });
    }
    if (cue.endTicks > end) {
      out.push({
        ...cue,
        id: newId('cue'),
        startTicks: Math.max(0, end + shiftAfterTicks),
        endTicks: Math.max(1, cue.endTicks + shiftAfterTicks),
      });
    }
  }
  return out;
}

function scaleKeyframes(keyframes: KeyframeTrack[], factor: number): KeyframeTrack[] {
  return keyframes.map((track) => ({
    ...track,
    keyframes: track.keyframes.map((kf) => ({
      ...kf,
      atTicks: Math.round(kf.atTicks * factor),
    })),
  }));
}

/**
 * Speed-scale `[range.start, range.end)` by `speedMultiplier` (`d -> d / s`, pitch preserved).
 * When `ripple` is true (default), shifts subsequent clips, markers, and captions by `d / s - d`.
 */
export function speedRange(
  project: Project,
  range: { start: Tick; end: Tick; tracks: 'unlocked' | string[] },
  speedMultiplier: number,
  ripple = true,
): Project {
  const s = Math.max(0.1, Math.min(10, speedMultiplier));
  const d = range.end - range.start;
  if (d <= 0) return project;
  const newDuration = Math.max(1, Math.round(d / s));
  const delta = newDuration - d;

  // If ripple is off and slow-down (delta > 0) would overlap a later clip on an in-scope track, block
  const split = splitRangeEdges(project, range);
  if (!ripple && delta > 0) {
    for (const track of split.tracks) {
      if (!isTrackInRangeScope(track, range.tracks)) continue;
      const hasLaterNeighbour = track.clips.some((c) => c.startTicks >= range.end && c.startTicks < range.start + newDuration);
      if (hasLaterNeighbour) return project;
    }
  }

  const factor = 1 / s;
  const tracks = split.tracks.map((track) => {
    if (track.locked) return track;
    const inScope = isTrackInRangeScope(track, range.tracks);
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (inScope && clip.startTicks >= range.start && clip.startTicks + clip.durationTicks <= range.end) {
          const offsetFromStart = clip.startTicks - range.start;
          return {
            ...clip,
            startTicks: range.start + Math.round(offsetFromStart * factor),
            durationTicks: Math.max(1, Math.round(clip.durationTicks * factor)),
            speed: Number(((clip.speed || 1) * s).toFixed(3)),
            audio: { ...clip.audio, preservePitch: true },
            keyframes: scaleKeyframes(clip.keyframes, factor),
          };
        }
        if (ripple && clip.startTicks >= range.end) {
          return { ...clip, startTicks: Math.max(0, clip.startTicks + delta) };
        }
        return clip;
      }),
    };
  });

  const markers = split.markers.map((m) => {
    if (m.atTicks >= range.start && m.atTicks < range.end) {
      return { ...m, atTicks: range.start + Math.round((m.atTicks - range.start) * factor) };
    }
    if (ripple && m.atTicks >= range.end) {
      return { ...m, atTicks: Math.max(0, m.atTicks + delta) };
    }
    return m;
  });

  const captions = split.captions.map((cue) => {
    if (cue.startTicks >= range.start && cue.endTicks <= range.end) {
      return {
        ...cue,
        startTicks: range.start + Math.round((cue.startTicks - range.start) * factor),
        endTicks: range.start + Math.max(1, Math.round((cue.endTicks - range.start) * factor)),
      };
    }
    if (ripple && cue.startTicks >= range.end) {
      return {
        ...cue,
        startTicks: Math.max(0, cue.startTicks + delta),
        endTicks: Math.max(1, cue.endTicks + delta),
      };
    }
    return cue;
  });

  const next = { ...split, tracks, markers, captions };
  return { ...next, durationTicks: projectDuration(next.tracks) };
}

/** Place an Adjustment Layer spanning exactly `[range.start, range.end)` without shifting later content. */
export function applyAdjustmentOverRange(
  project: Project,
  range: { start: Tick; end: Tick },
  options: { filter?: string; lut?: string; effect?: string } = {},
): Project {
  const duration = Math.max(1, range.end - range.start);
  let adjTrack = project.tracks.find((t) => t.kind === 'video' && !t.locked && t.name === 'Adjustment Layer');
  let working = project;
  if (!adjTrack) {
    adjTrack = createTrack('video', 'Adjustment Layer');
    working = ops.addTrack(working, adjTrack);
  }
  const clip = createClip({
    kind: 'adjustment',
    startTicks: range.start,
    durationTicks: duration,
    label: 'Range Adjustment',
    effects: {
      ...defaultEffects(),
      colorFilter: options.filter ?? 'normal',
      lut: options.lut ?? 'rec709_standard',
      videoEffect: options.effect ?? 'none',
    },
  });
  working = ops.placeClip(working, adjTrack.id, clip, 'overwrite');
  return { ...working, durationTicks: projectDuration(working.tracks) };
}

/** Export range specification — locks in/out points for export without mutating Project JSON. */
export function buildExportRangeSpec(
  project: Project,
  range: { start: Tick; end: Tick },
): { inTicks: Tick; outTicks: Tick; durationTicks: Tick; projectUnchanged: Project } {
  const inTicks = Math.max(0, Math.min(range.start, range.end));
  const outTicks = Math.max(inTicks + 1, Math.max(range.start, range.end));
  return {
    inTicks,
    outTicks,
    durationTicks: outTicks - inTicks,
    projectUnchanged: project,
  };
}

// ============================================================================
// Unified Command Registry (Inspector + Floating Toolbar + Context Menu)
// ============================================================================

export interface CommandEligibility {
  ok: boolean;
  reason?: string;
}

export interface EditorCommandSpec {
  id: string;
  label: string;
  shortcut?: string;
  categories: SelectionCategory[];
  isEligible: (selection: EditorSelection, project: Project, playheadTicks?: Tick) => CommandEligibility;
  run: (selection: EditorSelection, project: Project, playheadTicks?: Tick, arg?: unknown) => Project;
}

function hasUnlockedSelectedClips(selection: EditorSelection, project: Project): CommandEligibility {
  if (selection.kind !== 'clips' || selection.ids.length === 0) {
    return { ok: false, reason: 'Select a clip first' };
  }
  for (const track of project.tracks) {
    if (track.locked && track.clips.some((c) => selection.ids.includes(c.id))) {
      return { ok: false, reason: `Track "${track.name}" is locked` };
    }
  }
  return { ok: true };
}

export const EDITOR_COMMAND_REGISTRY: readonly EditorCommandSpec[] = [
  // Video & Audio Clip Commands
  {
    id: 'split',
    label: 'Split',
    shortcut: 'S',
    categories: ['video-clip', 'audio-clip'],
    isEligible: (sel, proj, tick = 0) => {
      const base = hasUnlockedSelectedClips(sel, proj);
      if (!base.ok || sel.kind !== 'clips') return base;
      const clip = ops.findClipById(proj, sel.primary);
      if (!clip || tick <= clip.startTicks || tick >= clip.startTicks + clip.durationTicks) {
        return { ok: false, reason: 'Move playhead inside the selected clip to split' };
      }
      return { ok: true };
    },
    run: (sel, proj, tick = 0) =>
      sel.kind === 'clips' ? ops.splitAt(proj, tick, { clipIds: sel.ids, splitLinked: true }) : proj,
  },
  {
    id: 'speed',
    label: 'Speed',
    categories: ['video-clip', 'audio-clip', 'multi-clip', 'time-range'],
    isEligible: (sel, proj) => {
      if (sel.kind === 'range') return { ok: sel.end > sel.start };
      return hasUnlockedSelectedClips(sel, proj);
    },
    run: (sel, proj, _tick, speedArg) => {
      const rate = typeof speedArg === 'number' ? speedArg : 1.5;
      if (sel.kind === 'range') return speedRange(proj, sel, rate, true);
      if (sel.kind === 'clips') {
        let next = proj;
        for (const id of sel.ids) {
          next = ops.updateClip(next, id, { speed: rate });
        }
        return next;
      }
      return proj;
    },
  },
  {
    id: 'volume',
    label: 'Volume',
    categories: ['video-clip', 'audio-clip', 'multi-clip'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, gainArg) => {
      if (sel.kind !== 'clips') return proj;
      const gain = typeof gainArg === 'number' ? gainArg : 1;
      let next = proj;
      for (const id of sel.ids) {
        next = ops.updateClipDeep(next, id, { audio: { gain, muted: gain <= 0 } });
      }
      return next;
    },
  },
  {
    id: 'filter',
    label: 'Filter',
    categories: ['video-clip', 'adjust-layer'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, filterArg) =>
      sel.kind === 'clips'
        ? ops.applyFilter(proj, sel.primary, typeof filterArg === 'string' ? filterArg : 'Warm Glow')
        : proj,
  },
  {
    id: 'edit-text',
    label: 'Edit',
    shortcut: 'Enter',
    categories: ['text-clip', 'caption'],
    isEligible: (sel, proj) =>
      sel.kind === 'caption' ? { ok: true } : hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, textArg) => {
      if (sel.kind === 'clips' && typeof textArg === 'string') {
        return ops.updateClipDeep(proj, sel.primary, { text: { text: textArg } });
      }
      return proj;
    },
  },
  {
    id: 'style',
    label: 'Style',
    categories: ['text-clip', 'caption'],
    isEligible: (sel, proj) =>
      sel.kind === 'caption' ? { ok: true } : hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, presetArg) => {
      if (sel.kind === 'caption') {
        return ops.setCaptionStyle(proj, typeof presetArg === 'string' ? presetArg : 'hormozi-pop');
      }
      if (sel.kind === 'clips') {
        return ops.applyTextPreset(proj, sel.primary, typeof presetArg === 'string' ? presetArg : 'viral_hormozi_gold');
      }
      return proj;
    },
  },
  {
    id: 'animate',
    label: 'Animate',
    categories: ['text-clip'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, animArg) =>
      sel.kind === 'clips'
        ? ops.setTextAnimation(proj, sel.primary, typeof animArg === 'string' ? animArg : 'Kinetic Pop')
        : proj,
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    shortcut: '⌘D',
    categories: ['text-clip', 'video-clip', 'audio-clip', 'adjust-layer'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj) => {
      if (sel.kind !== 'clips') return proj;
      const clip = ops.findClipById(proj, sel.primary);
      return ops.duplicateClips(proj, sel.ids, clip?.durationTicks ?? TICKS_PER_SECOND);
    },
  },
  {
    id: 'fade',
    label: 'Fade',
    categories: ['audio-clip'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj) =>
      sel.kind === 'clips'
        ? ops.updateClipDeep(proj, sel.primary, {
            audio: { fadeInTicks: Math.round(0.5 * TICKS_PER_SECOND), fadeOutTicks: Math.round(0.5 * TICKS_PER_SECOND) },
          })
        : proj,
  },
  {
    id: 'enhance',
    label: 'Enhance',
    categories: ['audio-clip'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj) =>
      sel.kind === 'clips' ? ops.applyVoicePreset(proj, 'podcast-warm', sel.primary) : proj,
  },
  {
    id: 'adjust',
    label: 'Adjust',
    categories: ['adjust-layer'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, lutArg) =>
      sel.kind === 'clips'
        ? ops.applyLUT(proj, sel.primary, typeof lutArg === 'string' ? lutArg : 'hollywood_blockbuster')
        : proj,
  },
  {
    id: 'effect',
    label: 'Effect',
    categories: ['adjust-layer', 'time-range'],
    isEligible: (sel, proj) =>
      sel.kind === 'range' ? { ok: sel.end > sel.start } : hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, fxArg) => {
      const fx = typeof fxArg === 'string' ? fxArg : 'video_handheld';
      if (sel.kind === 'range') return applyAdjustmentOverRange(proj, sel, { effect: fx });
      if (sel.kind === 'clips') return ops.applyEffect(proj, sel.primary, fx);
      return proj;
    },
  },
  {
    id: 'duration',
    label: 'Duration',
    categories: ['adjust-layer'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj, _tick, secArg) => {
      if (sel.kind !== 'clips') return proj;
      const clip = ops.findClipById(proj, sel.primary);
      if (!clip) return proj;
      const sec = typeof secArg === 'number' ? secArg : 3;
      return ops.trimEnd(proj, clip.id, clip.startTicks + Math.round(sec * TICKS_PER_SECOND));
    },
  },
  {
    id: 'group',
    label: 'Group',
    shortcut: '⌘G',
    categories: ['multi-clip'],
    isEligible: (sel, proj) => {
      if (sel.kind !== 'clips' || sel.ids.length < 2) {
        return { ok: false, reason: 'Select at least 2 clips to group' };
      }
      return hasUnlockedSelectedClips(sel, proj);
    },
    run: (sel, proj) => (sel.kind === 'clips' ? ops.groupClips(proj, sel.ids) : proj),
  },
  {
    id: 'align',
    label: 'Align',
    categories: ['multi-clip'],
    isEligible: (sel, proj) => hasUnlockedSelectedClips(sel, proj),
    run: (sel, proj) => {
      if (sel.kind !== 'clips') return proj;
      let next = proj;
      for (const id of sel.ids) next = ops.alignClip(next, id, 'center');
      return next;
    },
  },
  // Time Range Commands
  {
    id: 'split-edges',
    label: 'Split edges',
    categories: ['time-range'],
    isEligible: (sel) =>
      sel.kind === 'range' && sel.end > sel.start ? { ok: true } : { ok: false, reason: 'Select a valid time range' },
    run: (sel, proj) => (sel.kind === 'range' ? splitRangeEdges(proj, sel) : proj),
  },
  {
    id: 'delete',
    label: 'Delete',
    shortcut: '⌫',
    categories: ['video-clip', 'text-clip', 'audio-clip', 'adjust-layer', 'multi-clip', 'time-range', 'caption'],
    isEligible: (sel, proj) => {
      if (sel.kind === 'range') return { ok: sel.end > sel.start };
      if (sel.kind === 'caption') return { ok: proj.captions.some((c) => c.id === sel.cueId) };
      return hasUnlockedSelectedClips(sel, proj);
    },
    run: (sel, proj) => {
      if (sel.kind === 'range') return deleteRange(proj, sel);
      if (sel.kind === 'caption') {
        return { ...proj, captions: proj.captions.filter((c) => c.id !== sel.cueId) };
      }
      if (sel.kind === 'clips') return ops.deleteClips(proj, sel.ids, 'lift');
      return proj;
    },
  },
  {
    id: 'ripple-delete',
    label: 'Ripple delete',
    shortcut: '⇧⌫',
    categories: ['time-range'],
    isEligible: (sel, proj) => {
      if (sel.kind !== 'range') return { ok: false, reason: 'Select a time range first' };
      return canRippleDeleteRange(proj, sel);
    },
    run: (sel, proj) => (sel.kind === 'range' ? rippleDeleteRange(proj, sel) : proj),
  },
  // Caption Commands
  {
    id: 'split-cue',
    label: 'Split cue',
    categories: ['caption'],
    isEligible: (sel, proj) => {
      if (sel.kind !== 'caption') return { ok: false, reason: 'Select a caption cue' };
      const cue = proj.captions.find((c) => c.id === sel.cueId);
      if (!cue || cue.endTicks - cue.startTicks < 200) {
        return { ok: false, reason: 'Caption cue is too short to split' };
      }
      return { ok: true };
    },
    run: (sel, proj) => {
      if (sel.kind !== 'caption') return proj;
      const idx = proj.captions.findIndex((c) => c.id === sel.cueId);
      if (idx < 0) return proj;
      const cue = proj.captions[idx]!;
      const mid = Math.round((cue.startTicks + cue.endTicks) / 2);
      const words = cue.text.trim().split(/\s+/);
      const half = Math.max(1, Math.floor(words.length / 2));
      const left: CaptionCue = { ...cue, endTicks: mid, text: words.slice(0, half).join(' ') || cue.text };
      const right: CaptionCue = {
        ...cue,
        id: newId('cue'),
        startTicks: mid,
        text: words.slice(half).join(' ') || cue.text,
      };
      const nextCues = [...proj.captions];
      nextCues.splice(idx, 1, left, right);
      return { ...proj, captions: nextCues };
    },
  },
  {
    id: 'merge-cue',
    label: 'Merge',
    categories: ['caption'],
    isEligible: (sel, proj) => {
      if (sel.kind !== 'caption') return { ok: false, reason: 'Select a caption cue' };
      const idx = proj.captions.findIndex((c) => c.id === sel.cueId);
      if (idx < 0 || idx >= proj.captions.length - 1) {
        return { ok: false, reason: 'No following caption cue to merge with' };
      }
      return { ok: true };
    },
    run: (sel, proj) => {
      if (sel.kind !== 'caption') return proj;
      const idx = proj.captions.findIndex((c) => c.id === sel.cueId);
      if (idx < 0 || idx >= proj.captions.length - 1) return proj;
      const curr = proj.captions[idx]!;
      const next = proj.captions[idx + 1]!;
      const merged: CaptionCue = {
        ...curr,
        endTicks: next.endTicks,
        text: `${curr.text.trim()} ${next.text.trim()}`.trim(),
      };
      const nextCues = [...proj.captions];
      nextCues.splice(idx, 2, merged);
      return { ...proj, captions: nextCues };
    },
  },
];

/**
 * Returns the ≤ 5 primary toolbar commands for the active selection category,
 * matching the Phase E1 Selection → Options matrix.
 */
export function toolbarCommandsForSelection(
  selection: EditorSelection,
  project: Project,
): EditorCommandSpec[] {
  const category = classifySelection(selection, project);
  const orderByCategory: Record<SelectionCategory, string[]> = {
    none: [],
    'video-clip': ['split', 'speed', 'volume', 'filter', 'delete'],
    'text-clip': ['edit-text', 'style', 'animate', 'duplicate', 'delete'],
    'audio-clip': ['split', 'volume', 'fade', 'enhance', 'delete'],
    'adjust-layer': ['adjust', 'filter', 'effect', 'duration', 'delete'],
    'multi-clip': ['group', 'align', 'speed', 'volume', 'delete'],
    'time-range': ['split-edges', 'delete', 'ripple-delete', 'speed', 'effect'],
    caption: ['edit-text', 'split-cue', 'merge-cue', 'style', 'delete'],
  };
  const ids = orderByCategory[category] ?? [];
  return ids
    .map((id) => EDITOR_COMMAND_REGISTRY.find((cmd) => cmd.id === id))
    .filter((cmd): cmd is EditorCommandSpec => Boolean(cmd))
    .slice(0, 5);
}

/** Returns all commands applicable to the active selection for the Context Menu. */
export function contextMenuCommandsForSelection(
  selection: EditorSelection,
  project: Project,
): EditorCommandSpec[] {
  const category = classifySelection(selection, project);
  return EDITOR_COMMAND_REGISTRY.filter((cmd) => cmd.categories.includes(category));
}
