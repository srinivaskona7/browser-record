import { formatTimecode, TICKS_PER_SECOND, type Tick } from '../core/time';
import type { Clip, Project, Track } from '../project/types';
import * as ops from '../project/ops';

export type SelectionOrigin = 'timeline' | 'canvas';

export type EditorSelection =
  | { kind: 'none' }
  | { kind: 'clips'; ids: string[]; primary: string; origin: SelectionOrigin }
  | { kind: 'range'; start: Tick; end: Tick; tracks: 'unlocked' | string[] }
  | { kind: 'caption'; cueId: string; wordIndex?: number };

export const NONE_SELECTION: EditorSelection = { kind: 'none' };

export function createClipsSelection(
  ids: readonly string[],
  origin: SelectionOrigin = 'timeline',
  primary?: string,
): EditorSelection {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return NONE_SELECTION;
  const primaryId = primary && unique.includes(primary) ? primary : unique[0]!;
  return {
    kind: 'clips',
    ids: unique,
    primary: primaryId,
    origin,
  };
}

export function createRangeSelection(
  start: Tick,
  end: Tick,
  tracks: 'unlocked' | string[] = 'unlocked',
): EditorSelection {
  const s = Math.max(0, Math.min(start, end));
  const e = Math.max(start, end);
  if (e <= s) return NONE_SELECTION;
  return {
    kind: 'range',
    start: s,
    end: e,
    tracks: Array.isArray(tracks) ? Array.from(new Set(tracks)) : 'unlocked',
  };
}

export function createCaptionSelection(cueId: string, wordIndex?: number): EditorSelection {
  if (!cueId) return NONE_SELECTION;
  return wordIndex !== undefined ? { kind: 'caption', cueId, wordIndex } : { kind: 'caption', cueId };
}

/**
 * Esc clears one level:
 * - caption word -> caption cue -> none
 * - canvas/timeline clip(s) -> none
 * - range -> none
 */
export function stepBackSelection(selection: EditorSelection): EditorSelection {
  if (selection.kind === 'caption' && selection.wordIndex !== undefined) {
    return { kind: 'caption', cueId: selection.cueId };
  }
  return NONE_SELECTION;
}

/** Select all clips on unlocked tracks (⌘/Ctrl + A). */
export function selectAllClips(project: Project): EditorSelection {
  const ids: string[] = [];
  for (const track of project.tracks) {
    if (track.locked || track.hidden) continue;
    for (const clip of track.clips) {
      ids.push(clip.id);
    }
  }
  return createClipsSelection(ids, 'timeline');
}

function formatShortTime(ticks: Tick, project: Project): string {
  const fps = project.canvas?.fps ?? { num: 30, den: 1 };
  return formatTimecode(ticks, fps);
}

/**
 * Produces the identical Scope Chip text displayed at the top of the Inspector,
 * on the Floating Toolbar, and as the Context Menu header.
 */
export function formatSelectionScopeChip(selection: EditorSelection, project: Project): string {
  if (selection.kind === 'none') {
    return 'No selection';
  }

  if (selection.kind === 'caption') {
    const cueIndex = project.captions.findIndex((c) => c.id === selection.cueId);
    const cue = cueIndex >= 0 ? project.captions[cueIndex] : undefined;
    const cueLabel = cueIndex >= 0 ? `Cue ${cueIndex + 1}` : `Cue`;
    if (selection.wordIndex !== undefined && cue) {
      const words = cue.text.trim().split(/\s+/);
      const word = words[selection.wordIndex] ?? '';
      return `Caption · ${cueLabel} · word '${word}'`;
    }
    return `Caption · ${cueLabel}`;
  }

  if (selection.kind === 'range') {
    const startStr = formatShortTime(selection.start, project);
    const endStr = formatShortTime(selection.end, project);
    const lockedCount = project.tracks.filter((t) => t.locked).length;
    if (selection.tracks === 'unlocked') {
      const lockedSuffix = lockedCount > 0 ? ` (${lockedCount} locked skipped)` : '';
      return `Range · ${startStr}–${endStr} · All tracks${lockedSuffix}`;
    }
    return `Range · ${startStr}–${endStr} · ${selection.tracks.length} track${selection.tracks.length === 1 ? '' : 's'}`;
  }

  // selection.kind === 'clips'
  const clips: Array<{ clip: Clip; trackId: string; trackKind: Track['kind'] }> = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (selection.ids.includes(clip.id)) {
        clips.push({ clip, trackId: track.id, trackKind: track.kind });
      }
    }
  }
  if (clips.length === 0) return 'No selection';

  if (clips.length > 1) {
    const uniqueTracks = new Set(clips.map((c) => c.trackId));
    return `${clips.length} clips · ${uniqueTracks.size} track${uniqueTracks.size === 1 ? '' : 's'}`;
  }

  const { clip, trackKind } = clips[0]!;
  if (selection.origin === 'canvas') {
    if (clip.kind === 'title' && clip.text) {
      const snippet = clip.text.text.slice(0, 20);
      return `Layer · Text '${snippet}'`;
    }
    return `Layer · ${clip.label ?? clip.kind}`;
  }

  const durSec = (clip.durationTicks / TICKS_PER_SECOND).toFixed(2);
  const linked = ops.linkedClipIds(project, clip);
  const hasLinkedAudio =
    linked.length > 1 &&
    project.tracks.some(
      (t) => t.kind === 'audio' && t.clips.some((c) => c.id !== clip.id && linked.includes(c.id)),
    );
  const kindLabel =
    clip.kind === 'title'
      ? 'Text'
      : clip.kind === 'adjustment'
        ? 'Adjust layer'
        : trackKind === 'audio'
          ? 'Audio'
          : 'Video';
  return `Clip · ${kindLabel} · 0:${durSec.padStart(5, '0')}${hasLinkedAudio ? ' · + linked audio' : ''}`;
}
