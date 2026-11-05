import { TICKS_PER_SECOND, type Tick } from '../core/time';
import { newId } from '../core/ids';
import { assetById, createClip, createTrack, defaultEffects, defaultTransform, projectDuration } from './factory';
import type { BrandKit, CaptionCue, CaptionPreset, CaptionStyle, Clip, Project, StickerKind, TextProps, Track } from './types';
import { sourceTicks } from '../render/compositorQuery';

export type EditMode = 'insert' | 'overwrite';

const cloneTrack = (track: Track): Track => ({ ...track, clips: track.clips.map((c) => ({ ...c })) });

function mapTracks(project: Project, fn: (track: Track) => Track | null): Project {
  const tracks: Track[] = [];
  for (const track of project.tracks) {
    const next = fn(track);
    if (next) tracks.push(next);
  }
  return withDuration({ ...project, tracks });
}

export function withDuration(project: Project): Project {
  return { ...project, durationTicks: projectDuration(project.tracks) };
}

export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startTicks - b.startTicks || a.id.localeCompare(b.id));
}

export function clipEnd(clip: Clip): Tick {
  return clip.startTicks + clip.durationTicks;
}

/** Ids of clips that must move together with the given clip. */
export function linkedClipIds(project: Project, clip: Clip): string[] {
  if (!clip.linkId) return [clip.id];
  const ids: string[] = [];
  for (const track of project.tracks) {
    for (const other of track.clips) {
      if (other.linkId === clip.linkId) ids.push(other.id);
    }
  }
  return ids;
}

export function findClipById(project: Project, clipId: string): Clip | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/** End of the last clip on any track, so a new take or import appends. */
export function nextFreeStart(project: Project): Tick {
  return project.tracks.reduce(
    (max, track) => track.clips.reduce((end, clip) => Math.max(end, clip.startTicks + clip.durationTicks), max),
    0,
  );
}

function prepareClipForSplit(clip: Clip, tick: Tick): [Clip, Clip] | null {
  const leftDuration = tick - clip.startTicks;
  if (leftDuration <= 0 || tick >= clipEnd(clip)) return null;
  const rightDuration = clip.durationTicks - leftDuration;
  const speed = clip.speed || 1;
  const left: Clip = { ...clip, durationTicks: leftDuration };
  const right: Clip = {
    ...clip,
    id: newId('clip'),
    startTicks: tick,
    inTicks: clip.inTicks + Math.round(leftDuration * speed),
    durationTicks: rightDuration,
    transitionIn: { type: 'none', durationTicks: 0 },
  };
  return [left, right];
}

/**
 * Split every unlocked clip that crosses `tick`. Clips sharing a linkId split at
 * the same tick so audio stays in sync with video.
 */
export function splitAt(project: Project, tick: Tick, options: { clipIds?: string[]; splitLinked?: boolean } = {}): Project {
  const targets = new Set<string>(options.clipIds ?? []);
  const splitLinked = options.splitLinked ?? true;
  const seed = [...targets].map((id) => findClipById(project, id)).filter((c): c is Clip => Boolean(c));
  if (splitLinked) {
    for (const clip of seed) {
      if (clip.linkId) {
        for (const other of project.tracks.flatMap((t) => t.clips)) {
          if (other.linkId === clip.linkId) targets.add(other.id);
        }
      }
    }
  }
  const rightLinkIds = new Map<string, string>();
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    const next = cloneTrack(track);
    const clips: Clip[] = [];
    for (const clip of next.clips) {
      const applicable = targets.size === 0 || targets.has(clip.id);
      if (!applicable) {
        clips.push(clip);
        continue;
      }
      const parts = prepareClipForSplit(clip, tick);
      if (!parts) {
        clips.push(clip);
        continue;
      }
      const [left, right] = parts;
      left.linkId = clip.linkId ?? newId('link');
      if (clip.linkId) {
        // The right-hand halves get their own link group. Sharing the original
        // linkId would couple the halves, so deleting or trimming one half
        // would drag the other half of the recording with it.
        let rightLink = rightLinkIds.get(clip.linkId);
        if (!rightLink) {
          rightLink = newId('link');
          rightLinkIds.set(clip.linkId, rightLink);
        }
        right.linkId = rightLink;
      } else {
        right.linkId = left.linkId;
      }
      clips.push(left, right);
    }
    next.clips = sortClips(clips);
    return next;
  });
}

/** Split at the playhead on all tracks that have a clip under it. */
export function splitAllAt(project: Project, tick: Tick): Project {
  return splitAt(project, tick, { splitLinked: true });
}

export function trimStart(project: Project, clipId: string, newStart: Tick): Project {
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) return track;
    const end = clipEnd(clip);
    const speed = clip.speed || 1;
    const minStart = clip.startTicks - Math.floor(clip.inTicks / speed);
    const clamped = Math.min(Math.max(newStart, minStart), end - 1);
    const next = cloneTrack(track);
    const target = next.clips.find((c) => c.id === clipId)!;
    target.startTicks = clamped;
    target.inTicks = Math.max(0, clip.inTicks + Math.round((clamped - clip.startTicks) * speed));
    target.durationTicks = end - clamped;
    next.clips = sortClips(next.clips);
    return next;
  });
}

export function trimEnd(project: Project, clipId: string, newEnd: Tick): Project {
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) return track;
    const asset = assetById(project, clip.assetId);
    const sourceLimit = asset
      ? Math.round((asset.durationTicks - clip.inTicks) / (clip.speed || 1))
      : Number.POSITIVE_INFINITY;
    const maxDuration = Math.max(1, Math.min(sourceLimit, Number.MAX_SAFE_INTEGER));
    const next = cloneTrack(track);
    const target = next.clips.find((c) => c.id === clipId)!;
    target.durationTicks = Math.max(1, Math.min(newEnd - clip.startTicks, maxDuration));
    return next;
  });
}

export function moveClip(project: Project, clipId: string, deltaTicks: Tick, options: { moveLinked?: boolean } = {}): Project {
  const clip = findClipById(project, clipId);
  if (!clip) return project;
  const moveLinked = options.moveLinked ?? true;
  const ids = new Set(moveLinked ? linkedClipIds(project, clip) : [clipId]);
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    if (!track.clips.some((c) => ids.has(c.id))) return track;
    const next = cloneTrack(track);
    for (const c of next.clips) {
      if (!ids.has(c.id)) continue;
      c.startTicks = Math.max(0, c.startTicks + deltaTicks);
    }
    next.clips = sortClips(next.clips);
    return next;
  });
}

/**
 * Remove a time range from the project. Every clip crossing the range is split
 * at both edges, the middle is removed, and later clips slide left — on video,
 * audio and captions alike, which is what keeps linked cuts in sync.
 */
export function rippleDeleteRange(
  project: Project,
  start: Tick,
  end: Tick,
  options: { trackIds?: string[]; includeCaptions?: boolean } = {},
): Project {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (to <= from) return project;
  const removed = to - from;
  const trackFilter = options.trackIds ? new Set(options.trackIds) : null;

  let next = splitAt(project, from, { splitLinked: true });
  next = splitAt(next, to, { splitLinked: true });

  const tracks = next.tracks.map((track) => {
    if (track.locked) return track;
    if (trackFilter && !trackFilter.has(track.id)) {
      return { ...track, clips: track.clips.map((c) => (c.startTicks >= to ? { ...c, startTicks: c.startTicks - removed } : c)) };
    }
    const kept: Clip[] = [];
    for (const clip of track.clips) {
      const clippedStart = clip.startTicks;
      const clippedEnd = clipEnd(clip);
      if (clippedEnd <= from) {
        kept.push(clip);
      } else if (clippedStart >= to) {
        kept.push({ ...clip, startTicks: clip.startTicks - removed });
      }
      // Clips fully inside [from,to) are dropped.
    }
    return { ...track, clips: sortClips(kept) };
  });

  let captions = next.captions;
  if (options.includeCaptions !== false) {
    captions = shiftCaptions(removeCaptionRange(next.captions, from, to), to, -removed);
  }
  return withDuration({ ...next, tracks, captions });
}

export function removeCaptionRange(captions: CaptionCue[], from: Tick, to: Tick): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of captions) {
    if (cue.endTicks <= from || cue.startTicks >= to) {
      out.push(cue);
      continue;
    }
    // A cue partially overlapping the cut keeps the surviving portion.
    if (cue.startTicks < from) out.push({ ...cue, endTicks: from, words: cue.words?.filter((w) => w.endTicks <= from) });
    if (cue.endTicks > to)
      out.push({
        ...cue,
        id: newId('cue'),
        startTicks: to,
        words: cue.words?.filter((w) => w.startTicks >= to),
      });
  }
  return out.sort((a, b) => a.startTicks - b.startTicks);
}

export function shiftCaptions(captions: CaptionCue[], pivot: Tick, delta: Tick): CaptionCue[] {
  return captions.map((cue) =>
    cue.startTicks >= pivot
      ? {
          ...cue,
          startTicks: cue.startTicks + delta,
          endTicks: cue.endTicks + delta,
          words: cue.words?.map((w) => ({ ...w, startTicks: w.startTicks + delta, endTicks: w.endTicks + delta })),
        }
      : cue,
  );
}

/**
 * Overlap resolution. Overwrite mode trims earlier clips where the incoming
 * clip lands; insert mode pushes everything at/after the insert point right.
 */
export function placeClip(project: Project, trackId: string, clip: Clip, mode: EditMode): Project {
  return mapTracks(project, (track) => {
    if (track.id !== trackId) return track;
    const next = cloneTrack(track);
    let clips = next.clips.filter((c) => c.id !== clip.id);
    if (mode === 'insert') {
      clips = clips.map((c) => (c.startTicks >= clip.startTicks ? { ...c, startTicks: c.startTicks + clip.durationTicks } : c));
    } else {
      const incomingEnd = clipEnd(clip);
      clips = clips.flatMap((c) => {
        if (clipEnd(c) <= clip.startTicks || c.startTicks >= incomingEnd) return [c];
        const leftDuration = clip.startTicks - c.startTicks;
        const rightStart = incomingEnd;
        const rightDuration = clipEnd(c) - rightStart;
        const parts: Clip[] = [];
        if (leftDuration > 0) parts.push({ ...c, durationTicks: leftDuration });
        if (rightDuration > 0)
          parts.push({
            ...c,
            id: newId('clip'),
            startTicks: rightStart,
            inTicks: c.inTicks + Math.round((rightStart - c.startTicks) * (c.speed || 1)),
            durationTicks: rightDuration,
          });
        return parts;
      });
    }
    clips.push(clip);
    next.clips = sortClips(clips);
    return next;
  });
}

export function deleteClips(project: Project, clipIds: readonly string[], mode: 'lift' | 'ripple' = 'lift'): Project {
  const ids = new Set<string>();
  for (const id of clipIds) {
    const clip = findClipById(project, id);
    if (clip) for (const linked of linkedClipIds(project, clip)) ids.add(linked);
  }
  if (mode === 'lift') {
    return mapTracks(project, (track) => {
      if (track.locked) return track;
      if (!track.clips.some((c) => ids.has(c.id))) return track;
      return { ...track, clips: track.clips.filter((c) => !ids.has(c.id)) };
    });
  }
  // Ripple: remove the union of deleted clip spans.
  let next = project;
  const spans: Array<[Tick, Tick]> = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (ids.has(clip.id)) spans.push([clip.startTicks, clipEnd(clip)]);
    }
  }
  for (const [start, end] of mergeRanges(spans).sort((a, b) => b[0] - a[0])) {
    next = rippleDeleteRange(next, start, end);
  }
  return next;
}

export function mergeRanges(ranges: Array<[Tick, Tick]>): Array<[Tick, Tick]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[Tick, Tick]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

export function groupClips(project: Project, clipIds: readonly string[]): Project {
  if (clipIds.length < 2) return project;
  const linkId = newId('link');
  const ids = new Set(clipIds);
  return mapTracks(project, (track) => {
    if (!track.clips.some((c) => ids.has(c.id))) return track;
    return { ...track, clips: track.clips.map((c) => (ids.has(c.id) ? { ...c, linkId } : c)) };
  });
}

export function ungroupClips(project: Project, clipIds: readonly string[]): Project {
  const ids = new Set(clipIds);
  const linkIds = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) if (ids.has(clip.id) && clip.linkId) linkIds.add(clip.linkId);
  }
  if (linkIds.size === 0) return project;
  return mapTracks(project, (track) => {
    if (!track.clips.some((c) => c.linkId && linkIds.has(c.linkId))) return track;
    return {
      ...track,
      clips: track.clips.map((c) => {
        if (!c.linkId || !linkIds.has(c.linkId)) return c;
        const { linkId: _drop, ...rest } = c;
        return rest;
      }),
    };
  });
}

export function duplicateClips(project: Project, clipIds: readonly string[], offsetTicks: Tick): Project {
  const selected = new Set(clipIds);
  const groupMap = new Map<string, string>();
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    const originals = track.clips.filter((c) => selected.has(c.id));
    if (originals.length === 0) return track;
    const copies = originals.map((clip) => {
      let linkId = clip.linkId;
      if (linkId) {
        if (!groupMap.has(linkId)) groupMap.set(linkId, newId('link'));
        linkId = groupMap.get(linkId);
      }
      const copy: Clip = {
        ...structuredClone(clip),
        id: newId('clip'),
        startTicks: clip.startTicks + offsetTicks,
      };
      if (linkId) copy.linkId = linkId;
      else delete copy.linkId;
      return copy;
    });
    return { ...track, clips: sortClips([...track.clips, ...copies]) };
  });
}

export function muteClip(project: Project, clipId: string): Project {
  return mapTracks(project, (track) => {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx === -1) return track;
    const clips = [...track.clips];
    const current = clips[idx]!;
    clips[idx] = { ...current, audio: { ...current.audio, muted: !current.audio.muted } };
    return { ...track, clips };
  });
}

export function setTrackFlag(project: Project, trackId: string, patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked' | 'volume' | 'name'>>): Project {
  return mapTracks(project, (track) => (track.id === trackId ? { ...track, ...patch } : track));
}

export function addTrack(project: Project, track: Track): Project {
  return withDuration({ ...project, tracks: [...project.tracks, track] });
}

export function removeTrack(project: Project, trackId: string): Project {
  return withDuration({ ...project, tracks: project.tracks.filter((t) => t.id !== trackId) });
}

export function addAssetClip(
  project: Project,
  trackId: string,
  assetId: string,
  startTicks: Tick,
  options: { mode?: EditMode; durationTicks?: Tick } = {},
): { project: Project; clipId: string } {
  const asset = assetById(project, assetId);
  if (!asset) return { project, clipId: '' };
  const clip = createClip({
    assetId,
    kind: 'media',
    startTicks,
    durationTicks: options.durationTicks ?? asset.durationTicks,
    label: asset.name,
  });
  const withAsset =
    asset.kind === 'audio'
      ? { ...clip, audio: { ...clip.audio, processed: false } }
      : asset.kind === 'video'
        ? clip
        : clip;
  return { project: placeClip(project, trackId, withAsset, options.mode ?? 'overwrite'), clipId: withAsset.id };
}

export type TitlePreset =
  | 'title'
  | 'lower-third'
  | 'callout'
  | 'header'
  | 'footer'
  | 'code'
  | 'section'
  | 'hook'
  | 'terminal'
  | 'thumbnail'
  | 'metric'
  | 'cli';

const TITLE_PRESETS: Record<TitlePreset, { durationSeconds: number; patch: Partial<TextProps>; y: number }> = {
  title: { durationSeconds: 3.5, patch: { fontSize: 96, align: 'center', backgroundOpacity: 0.35 }, y: 0.5 },
  'lower-third': { durationSeconds: 4, patch: { fontSize: 56, align: 'left', backgroundOpacity: 0.6 }, y: 0.85 },
  callout: { durationSeconds: 3, patch: { fontSize: 64, color: '#111111', background: '#ffd166', backgroundOpacity: 1, align: 'center' }, y: 0.2 },
  header: { durationSeconds: 3.5, patch: { fontSize: 40, align: 'left', backgroundOpacity: 0.5, maxWidth: 0.9 }, y: 0.06 },
  code: { durationSeconds: 5, patch: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontWeight: 500, fontSize: 40, color: '#7ee787', background: '#0d1117', backgroundOpacity: 0.92, align: 'left', maxWidth: 0.7, lineHeight: 1.35 }, y: 0.5 },
  cli: { durationSeconds: 5, patch: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontWeight: 500, fontSize: 40, color: '#e6edf3', background: '#0b0f17', backgroundOpacity: 0.94, align: 'left', maxWidth: 0.78, lineHeight: 1.4, cliMode: true }, y: 0.5 },
  hook: { durationSeconds: 2.5, patch: { fontSize: 120, align: 'center', backgroundOpacity: 0.5, maxWidth: 0.85, fontWeight: 800 }, y: 0.35 },
  terminal: { durationSeconds: 5, patch: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontWeight: 500, fontSize: 44, color: '#7ee787', background: '#0d1117', backgroundOpacity: 0.92, align: 'left', maxWidth: 0.7, typewriter: true }, y: 0.5 },
  thumbnail: { durationSeconds: 3, patch: { fontSize: 150, fontWeight: 900, color: '#ffd166', align: 'center', backgroundOpacity: 0.7, maxWidth: 0.9 }, y: 0.5 },
  metric: { durationSeconds: 2.5, patch: { fontSize: 180, fontWeight: 800, color: '#7ee787', align: 'center', backgroundOpacity: 0, maxWidth: 0.9 }, y: 0.5 },
  section: { durationSeconds: 3, patch: { fontSize: 120, align: 'center', color: '#ffffff', background: '#1f6feb', backgroundOpacity: 0.9, maxWidth: 0.7 }, y: 0.5 },
  footer: { durationSeconds: 3.5, patch: { fontSize: 34, align: 'center', backgroundOpacity: 0.6, maxWidth: 0.95 }, y: 0.94 },
};

export function addTitleClip(
  project: Project,
  trackId: string,
  atTicks: Tick,
  text: string,
  preset: TitlePreset = 'title',
  durationTicks?: Tick,
): { project: Project; clipId: string } {
  const spec = TITLE_PRESETS[preset];
  const clip = createClip({
    kind: 'title',
    startTicks: atTicks,
    durationTicks: durationTicks ?? Math.round(spec.durationSeconds * 720_000),
    label: text.slice(0, 40),
    transform: { ...defaultTransform(), y: spec.y },
    text: {
      text,
      fontFamily: 'Inter',
      fontWeight: 600,
      fontSize: 96,
      color: '#ffffff',
      background: '#000000',
      backgroundOpacity: 0.35,
      align: 'center',
      maxWidth: 0.8,
      letterSpacing: 0,
      lineHeight: 1.2,
      ...spec.patch,
    },
  });
  return { project: placeClip(project, trackId, clip, 'overwrite'), clipId: clip.id };
}

/** A default arrow pointing from the lower left toward the centre of the frame. */
export function addArrowClip(project: Project, trackId: string, atTicks: Tick): { project: Project; clipId: string } {
  const clip = createClip({
    kind: 'arrow',
    startTicks: atTicks,
    durationTicks: Math.round(3 * 720_000),
    label: 'Arrow',
    arrow: { from: { x: 0.2, y: 0.8 }, to: { x: 0.45, y: 0.55 }, color: '#ffd166', width: 0.012 },
  });
  return { project: placeClip(project, trackId, clip, 'overwrite'), clipId: clip.id };
}

/** Immutable clip patch helper used by the inspector. */
export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const clips = [...track.clips];
    clips[index] = { ...clips[index]!, ...patch };
    return { ...track, clips };
  });
}

export function updateClipDeep(
  project: Project,
  clipId: string,
  patch: {
    transform?: Partial<Clip['transform']>;
    effects?: Partial<Clip['effects']>;
    audio?: Partial<Clip['audio']>;
    text?: Partial<NonNullable<Clip['text']>>;
    keystroke?: Partial<NonNullable<Clip['keystroke']>>;
    endScreen?: Partial<NonNullable<Clip['endScreen']>>;
    presenter?: Partial<NonNullable<Clip['presenter']>>;
    transitionIn?: Partial<Clip['transitionIn']>;
    transitionOut?: Partial<Clip['transitionOut']>;
  },
): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const current = track.clips[index]!;
    const next: Clip = {
      ...current,
      ...(patch.transform ? { transform: { ...current.transform, ...patch.transform } } : {}),
      ...(patch.effects ? { effects: { ...current.effects, ...patch.effects } } : {}),
      ...(patch.audio ? { audio: { ...current.audio, ...patch.audio } } : {}),
      ...(patch.text && current.text ? { text: { ...current.text, ...patch.text } } : {}),
      ...(patch.keystroke && current.keystroke ? { keystroke: { ...current.keystroke, ...patch.keystroke } } : {}),
      ...(patch.endScreen && current.endScreen ? { endScreen: { ...current.endScreen, ...patch.endScreen } } : {}),
      ...(patch.presenter
        ? { presenter: { ...(current.presenter ?? { layout: 'bubble' }), ...patch.presenter } as Clip['presenter'] }
        : {}),
      ...(patch.transitionIn ? { transitionIn: { ...current.transitionIn, ...patch.transitionIn } } : {}),
      ...(patch.transitionOut ? { transitionOut: { ...current.transitionOut, ...patch.transitionOut } } : {}),
    };
    const clips = [...track.clips];
    clips[index] = next;
    return { ...track, clips };
  });
}

/** Add or replace a keyframe at a clip-local time. */
export function upsertKeyframe(
  project: Project,
  clipId: string,
  target: import('./types').KeyframeTarget,
  atLocalTicks: Tick,
  value: number,
  easing: import('./types').Easing = 'ease-in-out',
): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const clip = track.clips[index]!;
    const groups = clip.keyframes.map((group) => ({ ...group, keyframes: [...group.keyframes] }));
    let group = groups.find((candidate) => candidate.target === target);
    if (!group) {
      group = { target, keyframes: [] };
      groups.push(group);
    }
    const existingIndex = group.keyframes.findIndex((frame) => Math.abs(frame.atTicks - atLocalTicks) < 1000);
    const keyframe = {
      id: existingIndex >= 0 ? group.keyframes[existingIndex]!.id : newId('kf'),
      atTicks: atLocalTicks,
      value,
      easing,
    };
    if (existingIndex >= 0) group.keyframes[existingIndex] = keyframe;
    else group.keyframes.push(keyframe);
    group.keyframes.sort((a, b) => a.atTicks - b.atTicks);
    const clips = [...track.clips];
    clips[index] = { ...clip, keyframes: groups };
    return { ...track, clips };
  });
}

export function clearKeyframes(project: Project, clipId: string, target?: import('./types').KeyframeTarget): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const clip = track.clips[index]!;
    const keyframes = target ? clip.keyframes.filter((group) => group.target !== target) : [];
    const clips = [...track.clips];
    clips[index] = { ...clip, keyframes };
    return { ...track, clips };
  });
}

export function addMask(project: Project, clipId: string, mask: Clip['masks'][number]): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const clip = track.clips[index]!;
    const clips = [...track.clips];
    clips[index] = { ...clip, masks: [...clip.masks, mask] };
    return { ...track, clips };
  });
}

export function updateMask(project: Project, clipId: string, maskIndex: number, patch: Partial<Clip['masks'][number]>): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const clip = track.clips[index]!;
    if (!clip.masks[maskIndex]) return track;
    const masks = clip.masks.map((mask, i) => (i === maskIndex ? { ...mask, ...patch } : mask));
    const clips = [...track.clips];
    clips[index] = { ...clip, masks };
    return { ...track, clips };
  });
}

export function removeMask(project: Project, clipId: string, maskIndex: number): Project {
  return mapTracks(project, (track) => {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index === -1) return track;
    const clip = track.clips[index]!;
    const clips = [...track.clips];
    clips[index] = { ...clip, masks: clip.masks.filter((_, i) => i !== maskIndex) };
    return { ...track, clips };
  });
}

/**
 * Extract a time range into a standalone project copy. Used for quality-preview
 * samples so the encoder runs the real composition path over a short span.
 */
export function cloneProjectWithRange(project: Project, startTicks: Tick, durationTicks: Tick): Project {
  const endTicks = startTicks + durationTicks;
  const tracks = project.tracks.map((track) => {
    const clips: Clip[] = [];
    for (const clip of track.clips) {
      const from = Math.max(clip.startTicks, startTicks);
      const to = Math.min(clipEnd(clip), endTicks);
      if (to <= from) continue;
      clips.push({
        ...clip,
        id: newId('clip'),
        startTicks: from - startTicks,
        durationTicks: to - from,
        inTicks: clip.inTicks + (from - clip.startTicks) * clip.speed,
      });
    }
    return { ...track, clips: sortClips(clips) };
  });
  const captions = project.captions
    .filter((cue) => cue.endTicks > startTicks && cue.startTicks < endTicks)
    .map((cue) => ({
      ...cue,
      startTicks: Math.max(0, cue.startTicks - startTicks),
      endTicks: Math.min(durationTicks, cue.endTicks - startTicks),
    }));
  return withDuration({
    ...project,
    id: newId('project'),
    name: `${project.name} (sample)`,
    tracks,
    captions,
    markers: [],
  });
}

export interface RelinkInfo {
  path: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  mimeType?: string;
}

/**
 * Point a missing asset at a newly chosen file. Clip references, in/out points
 * and the edit itself are untouched: relinking only repairs the link.
 */
export function relinkAssetInProject(project: Project, assetId: string, info: RelinkInfo): Project {
  return {
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === assetId
        ? {
            ...asset,
            path: info.path,
            missing: false,
            durationTicks: Math.round(info.durationSeconds * TICKS_PER_SECOND),
            ...(info.width ? { width: info.width } : {}),
            ...(info.height ? { height: info.height } : {}),
            ...(info.mimeType ? { mimeType: info.mimeType } : {}),
          }
        : asset,
    ),
  };
}

/** Header (name) and footer (role, email, LinkedIn) bars spanning the whole timeline. */
export function addBrandBars(project: Project, brand: BrandKit): { project: Project; clipIds: string[] } {
  const span = Math.max(project.durationTicks, TICKS_PER_SECOND);
  // Header and footer each get their own track: both start at zero, so on one
  // track the second would overwrite the first.
  const ensureTrack = (p: Project, name: string): { project: Project; trackId: string } => {
    const existing = p.tracks.find((t) => t.kind === 'video' && t.name === name);
    if (existing) return { project: p, trackId: existing.id };
    const track = createTrack('video', name);
    return { project: addTrack(p, track), trackId: track.id };
  };
  const headerTrack = ensureTrack(project, 'Header');
  const header = addTitleClip(headerTrack.project, headerTrack.trackId, 0, `${brand.name} · ${brand.role}`, 'header', span);
  const footerTrack = ensureTrack(header.project, 'Footer');
  const footer = addContactClip(footerTrack.project, footerTrack.trackId, 0, brand, span);
  return { project: footer.project, clipIds: [header.clipId, footer.clipId] };
}

/**
 * One-step opener: header and footer from the brand kit across the timeline,
 * plus a hook line on the Overlays track at the start.
 */
export function addIntroTemplate(project: Project, brand: BrandKit, hookText: string): { project: Project; clipIds: string[] } {
  const bars = addBrandBars(project, brand);
  // Own track: a hook at tick 0 on Overlays would overwrite any overlay already there.
  const existing = bars.project.tracks.find((t) => t.kind === 'video' && t.name === 'Intro' && !t.locked);
  const track = existing ?? createTrack('video', 'Intro');
  const withTrack = existing ? bars.project : addTrack(bars.project, track);
  const hook = addTitleClip(withTrack, track.id, 0, hookText, 'hook');
  return { project: hook.project, clipIds: [...bars.clipIds, hook.clipId] };
}

/**
 * Holds the source frame under the playhead for `durationTicks`. The clip is cut
 * at the playhead and a frozen, silent copy is inserted, pushing later clips right.
 */
export function holdFrame(
  project: Project,
  trackId: string,
  clipId: string,
  atTicks: Tick,
  durationTicks: Tick,
): { project: Project; clipId: string } {
  const track = project.tracks.find((t) => t.id === trackId);
  const source = track?.clips.find((c) => c.id === clipId);
  if (!source || source.kind !== 'media' || !source.assetId) return { project, clipId: '' };
  if (atTicks <= source.startTicks || atTicks >= source.startTicks + source.durationTicks) return { project, clipId: '' };
  if (durationTicks <= 0) return { project, clipId: '' };
  const frozenSource = sourceTicks(source, atTicks);
  const hold = createClip({
    kind: 'media',
    assetId: source.assetId,
    startTicks: atTicks,
    durationTicks,
    inTicks: frozenSource,
    freezeAt: frozenSource,
    label: `Hold ${source.label ?? ''}`.trim(),
    transform: { ...source.transform },
    effects: source.effects,
    audio: { ...source.audio, muted: true },
  });
  const cut = splitAt(project, atTicks, { clipIds: [clipId], splitLinked: true });
  return { project: placeClip(cut, trackId, hold, 'insert'), clipId: hold.id };
}

/** A call-to-action sticker (Subscribe, Like, Bell) at the given frame position. */
export function addStickerClip(
  project: Project,
  trackId: string,
  atTicks: Tick,
  kind: StickerKind,
): { project: Project; clipId: string } {
  const label = kind === 'subscribe' ? 'Subscribe' : kind === 'like' ? 'Like' : 'Turn on notifications';
  const clip = createClip({
    kind: 'sticker',
    startTicks: atTicks,
    durationTicks: Math.round(5 * TICKS_PER_SECOND),
    label,
    transform: { ...defaultTransform(), x: 0.8, y: 0.82 },
    sticker: { kind, color: kind === 'like' ? '#1f6feb' : '#ff0033', textColor: '#ffffff' },
  });
  return { project: placeClip(project, trackId, clip, 'overwrite'), clipId: clip.id };
}

const DEFAULT_ACCENT = '#1f6feb';

/** Name, role, email and LinkedIn in one styled bar with icons. */
export function addContactClip(
  project: Project,
  trackId: string,
  atTicks: Tick,
  brand: BrandKit,
  durationTicks?: Tick,
): { project: Project; clipId: string } {
  const clip = createClip({
    kind: 'contact',
    startTicks: atTicks,
    durationTicks: durationTicks ?? Math.round(5 * TICKS_PER_SECOND),
    label: `${brand.name} contact`,
    transform: { ...defaultTransform(), x: 0.5, y: 0.92 },
    contact: {
      name: brand.name,
      role: brand.role,
      email: brand.email,
      linkedin: brand.linkedin,
      style: brand.style ?? 'glass',
      accent: brand.accent ?? DEFAULT_ACCENT,
    },
  });
  return { project: placeClip(project, trackId, clip, 'overwrite'), clipId: clip.id };
}

export function findClip(project: Project, clipId: string): Clip | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

/** A blur box over the upper-left area, where terminals usually show tokens and hosts. Position it in the Inspector. */
export function addBlurBox(project: Project, clipId: string): Project {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'media') return project;
  return updateClip(project, clipId, {
    masks: [...clip.masks, { x: 0.04, y: 0.08, width: 0.36, height: 0.08, mode: 'blur', strength: 24 }],
  });
}

/** Zooms the clip in quickly and back out: 1.0 → 1.2 → 1.0 over about 1.2 s. */
/**
 * Jump cut: removes each silent range (timeline ticks) from the project, last
 * range first so earlier ranges keep their positions. Linked audio and video
 * are cut together by rippleDeleteRange.
 */
export function cutSilences(project: Project, ranges: readonly { startTicks: Tick; endTicks: Tick }[]): Project {
  return [...ranges]
    .sort((a, b) => b.startTicks - a.startTicks)
    .reduce((p, range) => rippleDeleteRange(p, range.startTicks, range.endTicks), project);
}

/**
 * Zoom highlight: eases the clip to `scale` at `atTicks` and back over
 * `durationTicks`. Refuses when the clip already has zoom keyframes, like punch-in.
 */
export function addZoomHighlight(
  project: Project,
  clipId: string,
  atTicks: Tick,
  durationTicks: Tick,
  scale = 1.3,
): Project {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'media') return project;
  if (clip.keyframes.some((track) => track.target === 'zoom')) return project;
  const local = Math.max(0, atTicks - clip.startTicks);
  const end = Math.min(clip.durationTicks, local + durationTicks);
  const rampTicks = Math.min(Math.round(0.25 * TICKS_PER_SECOND), Math.floor((end - local) / 2));
  if (end <= local || rampTicks <= 0) return project;
  return updateClip(project, clipId, {
    keyframes: [
      ...clip.keyframes,
      {
        target: 'zoom',
        keyframes: [
          { id: newId('kf'), atTicks: local, value: 1, easing: 'ease-out' },
          { id: newId('kf'), atTicks: local + rampTicks, value: scale, easing: 'ease-in-out' },
          { id: newId('kf'), atTicks: end - rampTicks, value: scale, easing: 'ease-in-out' },
          { id: newId('kf'), atTicks: end, value: 1, easing: 'ease-in-out' },
        ],
      },
    ],
  });
}

/** Why addPunchIn would do nothing, or null when it can apply. */
export function punchInBlockReason(project: Project, clipId: string): string | null {
  const clip = findClip(project, clipId);
  if (!clip) return 'Select a clip first.';
  if (clip.kind !== 'media') return 'Punch-in works on media clips only.';
  if (clip.keyframes.some((track) => track.target === 'zoom')) return 'This clip already has zoom keyframes. Clear them to add a punch-in.';
  return null;
}

/** Why addBlurBox would do nothing, or null when it can apply. */
export function blurBoxBlockReason(project: Project, clipId: string | null): string | null {
  if (!clipId) return 'Select a clip first.';
  const clip = findClip(project, clipId);
  if (!clip) return 'Select a clip first.';
  if (clip.kind !== 'media') return 'Blur box works on media clips only.';
  return null;
}

/** Why fullCameraSpan would leave a camera clip unchanged, or null when it can apply. */
export function fullCameraBlockReason(project: Project, startTicks: Tick, endTicks: Tick): string | null {
  if (endTicks <= startTicks) return 'The hold length must be greater than zero.';
  const locked = project.tracks.some(
    (track) => track.locked && track.clips.some((c) => c.presenter && c.startTicks < endTicks && c.startTicks + c.durationTicks > startTicks),
  );
  if (locked) return 'The camera track is locked. Unlock it to switch to full frame.';
  const hasCamera = project.tracks.some(
    (track) => !track.locked && track.clips.some((c) => c.presenter && c.startTicks < endTicks && c.startTicks + c.durationTicks > startTicks),
  );
  if (!hasCamera) return 'No camera clip overlaps this span.';
  return null;
}

export function addPunchIn(project: Project, clipId: string): Project {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'media') return project;
  const rampTicks = Math.round(0.3 * TICKS_PER_SECOND);
  const holdTicks = Math.round(1.2 * TICKS_PER_SECOND);
  // Refuse rather than overwrite a hand-made zoom ramp: the user can undo or clear it first.
  if (clip.keyframes.some((track) => track.target === 'zoom')) return project;
  return updateClip(project, clipId, {
    keyframes: [
      ...clip.keyframes,
      {
        target: 'zoom',
        keyframes: [
          { id: newId('kf'), atTicks: 0, value: 1, easing: 'ease-out' },
          { id: newId('kf'), atTicks: rampTicks, value: 1.2, easing: 'ease-in-out' },
          { id: newId('kf'), atTicks: Math.min(holdTicks, clip.durationTicks), value: 1, easing: 'ease-in-out' },
        ],
      },
    ],
  });
}

/**
 * Switches the presenter (camera) to full frame for [startTicks, endTicks), cutting
 * the camera clips at both ends so only that span changes. The pattern-interrupt move.
 */
export function fullCameraSpan(project: Project, startTicks: Tick, endTicks: Tick): Project {
  if (endTicks <= startTicks) return project;
  let working = splitAt(project, startTicks);
  working = splitAt(working, endTicks);
  return {
    ...working,
    tracks: working.tracks.map((track) => ({
      ...track,
      // Locked tracks are not split by splitAt, so a clip crossing the span edges keeps its layout.
      clips: track.clips.map((clip) =>
        clip.presenter && !track.locked && clip.startTicks >= startTicks && clip.startTicks + clip.durationTicks <= endTicks
          ? { ...clip, presenter: { ...clip.presenter, layout: 'full' as const } }
          : clip,
      ),
    })),
  };
}

/** Why addZoomHighlight would do nothing, or null when it can apply. */
export function zoomHighlightBlockReason(project: Project, clipId: string | null): string | null {
  if (!clipId) return 'Select a clip first.';
  const clip = findClip(project, clipId);
  if (!clip) return 'Select a clip first.';
  if (clip.kind !== 'media') return 'Zoom highlight works on media clips only.';
  if (clip.keyframes.some((track) => track.target === 'zoom')) {
    return 'This clip already has zoom keyframes. Clear them to add a zoom highlight.';
  }
  return null;
}

/** Parse comma/space/range 1-based line numbers, e.g. "1, 3-4" -> [1, 3, 4]. */
export function parseHighlightLines(input: string): number[] {
  const out = new Set<number>();
  for (const part of input.split(/[,\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      const from = Math.max(1, Math.min(a, b));
      const to = Math.min(200, Math.max(a, b));
      for (let line = from; line <= to; line += 1) out.add(line);
      continue;
    }
    const num = Number(trimmed);
    if (Number.isInteger(num) && num >= 1 && num <= 200) out.add(num);
  }
  return [...out].sort((a, b) => a - b);
}

export function formatHighlightLines(lines?: readonly number[]): string {
  if (!lines || lines.length === 0) return '';
  return lines.join(', ');
}

export function setCodeHighlightLines(project: Project, clipId: string, lines: readonly number[]): Project {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'title' || !clip.text) return project;
  const cleaned = [...new Set(lines.filter((n) => Number.isInteger(n) && n >= 1))].sort((a, b) => a - b);
  return updateClipDeep(project, clipId, { text: { highlightLines: cleaned } });
}

function ensureOverlayVideoTrack(project: Project, name: string): { project: Project; trackId: string } {
  const existing = project.tracks.find((t) => t.kind === 'video' && t.name === name && !t.locked);
  if (existing) return { project, trackId: existing.id };
  const track = createTrack('video', name);
  return { project: addTrack(project, track), trackId: track.id };
}

/**
 * 9:16 vertical reframe preset (1080×1920): places the screen recording in the
 * upper frame, presenter camera in a lower portrait card, and keeps footer/contact
 * bars pinned near the bottom edge so they do not cover the speaker.
 */
export function reframe9x16(project: Project): Project {
  return {
    ...project,
    canvas: { ...project.canvas, width: 1080, height: 1920 },
    tracks: project.tracks.map((track) => {
      if (track.kind !== 'video' || track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.presenter) {
            return {
              ...clip,
              presenter: {
                ...clip.presenter,
                layout: 'bubble' as const,
                shape: 'portrait' as const,
                corner: 'bottom-right' as const,
                size: 0.3,
                margin: 0.04,
              },
            };
          }
          if (clip.kind === 'contact') {
            return { ...clip, transform: { ...clip.transform, x: 0.5, y: 0.95 } };
          }
          if (clip.kind === 'media' && track.name === 'Screen') {
            return {
              ...clip,
              transform: { ...clip.transform, x: 0.5, y: 0.34, scale: 1, fit: 'contain' },
            };
          }
          return clip;
        }),
      };
    }),
  };
}

/**
 * Vertical 9:16 reframe that follows the presenter/action horizontally across
 * the screen clip using panX keyframes derived from presenter corners or markers.
 */
export function reframeFollowPresenter(project: Project): Project {
  const base = reframe9x16(project);
  // Collect horizontal target anchors across the timeline from camera clips or markers.
  const cameraClips = base.tracks
    .flatMap((t) => (t.kind === 'video' ? t.clips : []))
    .filter((c) => Boolean(c.presenter))
    .sort((a, b) => a.startTicks - b.startTicks);

  return {
    ...base,
    tracks: base.tracks.map((track) => {
      if (track.kind !== 'video' || track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.kind !== 'media' || clip.presenter) return clip;
          const keyframes: Array<{ id: string; atTicks: Tick; value: number; easing: 'ease-in-out' }> = [];
          if (cameraClips.length > 0) {
            for (const cam of cameraClips) {
              if (cam.startTicks + cam.durationTicks <= clip.startTicks || cam.startTicks >= clip.startTicks + clip.durationTicks) {
                continue;
              }
              const localAt = Math.max(0, cam.startTicks - clip.startTicks);
              const pan =
                cam.presenter?.corner === 'top-left' || cam.presenter?.corner === 'bottom-left'
                  ? 0.14
                  : -0.14;
              keyframes.push({ id: newId('kf'), atTicks: localAt, value: pan, easing: 'ease-in-out' });
            }
          }
          if (keyframes.length < 2) {
            const mid = Math.round(clip.durationTicks / 2);
            keyframes.splice(
              0,
              keyframes.length,
              { id: newId('kf'), atTicks: 0, value: -0.14, easing: 'ease-in-out' },
              { id: newId('kf'), atTicks: mid, value: 0.14, easing: 'ease-in-out' },
              { id: newId('kf'), atTicks: clip.durationTicks, value: 0, easing: 'ease-in-out' },
            );
          }
          const others = clip.keyframes.filter((k) => k.target !== 'panX');
          return {
            ...clip,
            transform: { ...clip.transform, x: 0.5, y: 0.36, scale: 1.15, fit: 'cover' },
            keyframes: [...others, { target: 'panX' as const, keyframes }],
          };
        }),
      };
    }),
  };
}

export function brollPipBlockReason(project: Project, assetId: string | null): string | null {
  if (!assetId) return 'Select an image or video upload first.';
  const asset = assetById(project, assetId);
  if (!asset) return 'Select an image or video upload first.';
  if (asset.kind === 'audio') return 'B-roll picture-in-picture requires a video or image asset.';
  return null;
}

/**
 * Places a video or image asset as a picture-in-picture card in the upper-right
 * corner on a dedicated 'B-Roll' overlay track without overwriting the screen track.
 */
export function addBrollPip(
  project: Project,
  assetId: string,
  atTicks: Tick,
  durationTicks?: Tick,
): { project: Project; clipId: string } {
  const asset = assetById(project, assetId);
  if (!asset || asset.kind === 'audio') return { project, clipId: '' };
  const ensured = ensureOverlayVideoTrack(project, 'B-Roll');
  const duration =
    durationTicks ??
    (asset.kind === 'image' ? Math.round(4 * TICKS_PER_SECOND) : Math.min(asset.durationTicks, Math.round(6 * TICKS_PER_SECOND)));
  const clip = createClip({
    kind: 'media',
    assetId,
    startTicks: atTicks,
    durationTicks: Math.max(TICKS_PER_SECOND, duration),
    label: `B-Roll: ${asset.name}`,
    transform: {
      ...defaultTransform(),
      x: 0.74,
      y: 0.26,
      scale: 0.42,
      fit: 'contain',
      radius: 16,
      shadow: 24,
      borderWidth: 3,
      borderColor: '#ffffff',
    },
    audio: { ...createClip({ startTicks: 0, durationTicks: TICKS_PER_SECOND }).audio, muted: true },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/**
 * Adds candidate blur masks from secret scanning onto a media clip.
 * Experimental heuristic only — never a guarantee that all secrets are hidden.
 */
export function autoBlurSecretsOnClip(
  project: Project,
  clipId: string,
  regions: readonly { x: number; y: number; width: number; height: number }[],
): Project {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'media') return project;
  const targets =
    regions.length > 0
      ? regions
      : [{ x: 0.04, y: 0.12, width: 0.44, height: 0.08 }];
  const masks = [
    ...clip.masks,
    ...targets.map((r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      mode: 'blur' as const,
      strength: 24,
    })),
  ];
  return updateClip(project, clipId, { masks });
}

/** Apply a named caption style preset, including DevOps terminal and short-form presets. */
export function applyCaptionPreset(style: CaptionStyle, preset: CaptionPreset): CaptionStyle {
  const base: CaptionStyle = { ...style, preset, wordHighlight: false, uppercase: false };
  switch (preset) {
    case 'documentary':
      return { ...base, backgroundOpacity: 0, outlineWidth: 0, fontSize: 46, maxLineChars: 46, color: '#ffffff' };
    case 'lower-third':
      return { ...base, backgroundOpacity: 0.8, outlineWidth: 0, align: 'left', marginX: 0.06, fontSize: 42, positionY: 0.78 };
    case 'outlined':
      return { ...base, backgroundOpacity: 0, outlineWidth: 6, outlineColor: '#000000', fontSize: 56 };
    case 'box':
      return { ...base, backgroundOpacity: 0.72, outlineWidth: 0, fontSize: 50 };
    case 'word-highlight':
      return { ...base, backgroundOpacity: 0.45, outlineWidth: 3, wordHighlight: true, fontSize: 54 };
    case 'devops-terminal':
      return {
        ...base,
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 44,
        color: '#7ee787',
        background: '#0d1117',
        backgroundOpacity: 0.9,
        outlineWidth: 0,
        align: 'left',
        marginX: 0.06,
      };
    case 'hormozi-pop':
      return {
        ...base,
        fontSize: 68,
        color: '#ffd166',
        backgroundOpacity: 0,
        outlineColor: '#000000',
        outlineWidth: 8,
        uppercase: true,
        wordHighlight: true,
        wordHighlightColor: '#06d6a0',
        maxLineChars: 24,
      };
    case 'minimal-pill':
      return {
        ...base,
        fontSize: 42,
        color: '#f0f6fc',
        background: '#161b22',
        backgroundOpacity: 0.85,
        outlineWidth: 0,
        maxLineChars: 38,
      };
    default:
      return { ...base, backgroundOpacity: 0.62, outlineWidth: 4, fontSize: 54, align: 'center', marginX: 0.08 };
  }
}

/**
 * Speed-ramps silent or idle timeline ranges instead of cutting them out:
 * splits across unlocked tracks at each range boundary, multiplies clip speed
 * inside the range by `speedMultiplier` (default 2.5×), shortens the range
 * duration accordingly, and ripples subsequent clips and captions left.
 */
export function speedRampRanges(
  project: Project,
  ranges: readonly { startTicks: Tick; endTicks: Tick }[],
  speedMultiplier = 2.5,
): Project {
  const factor = Math.max(1.1, Math.min(8, speedMultiplier));
  const sorted = [...ranges].sort((a, b) => b.startTicks - a.startTicks);
  let current = project;

  for (const range of sorted) {
    const from = Math.min(range.startTicks, range.endTicks);
    const to = Math.max(range.startTicks, range.endTicks);
    const span = to - from;
    if (span <= 0) continue;
    const newSpan = Math.max(1, Math.round(span / factor));
    const saved = span - newSpan;
    if (saved <= 0) continue;

    let split = splitAt(current, from, { splitLinked: true });
    split = splitAt(split, to, { splitLinked: true });

    const tracks = split.tracks.map((track) => {
      if (track.locked) return track;
      const clips = track.clips.map((clip) => {
        const end = clipEnd(clip);
        if (end <= from) return clip;
        if (clip.startTicks >= to) {
          return { ...clip, startTicks: clip.startTicks - saved };
        }
        if (clip.startTicks >= from && end <= to) {
          const relOffset = clip.startTicks - from;
          const nextStart = from + Math.round(relOffset / factor);
          const nextDuration = Math.max(1, Math.round(clip.durationTicks / factor));
          return {
            ...clip,
            startTicks: nextStart,
            durationTicks: nextDuration,
            speed: Number(((clip.speed || 1) * factor).toFixed(2)),
          };
        }
        return clip;
      });
      return { ...track, clips: sortClips(clips) };
    });

    const captions = shiftCaptions(split.captions, to, -saved);
    const markers = split.markers.map((m) => (m.atTicks >= to ? { ...m, atTicks: m.atTicks - saved } : m));
    current = withDuration({ ...split, tracks, captions, markers });
  }

  return current;
}

export function beforeAfterBlockReason(project: Project): string | null {
  const visualAssets = project.assets.filter((a) => a.kind === 'video' || a.kind === 'image');
  if (visualAssets.length === 0) return 'Import or record at least one video or image first.';
  return null;
}

/**
 * Places a side-by-side Before / After split comparison at `atTicks` with
 * left and right media plates plus 'BEFORE' and 'AFTER' callout badges.
 */
export function addBeforeAfterSplit(
  project: Project,
  leftAssetId: string,
  rightAssetId: string,
  atTicks: Tick,
  durationTicks = Math.round(5 * TICKS_PER_SECOND),
): { project: Project; clipIds: string[] } {
  const leftAsset = assetById(project, leftAssetId);
  const rightAsset = assetById(project, rightAssetId);
  if (!leftAsset || !rightAsset) return { project, clipIds: [] };

  const beforeTrack = ensureOverlayVideoTrack(project, 'Before');
  const afterTrack = ensureOverlayVideoTrack(beforeTrack.project, 'After');
  const labelsTrack = ensureOverlayVideoTrack(afterTrack.project, 'Before / After Labels');

  const leftClip = createClip({
    kind: 'media',
    assetId: leftAssetId,
    startTicks: atTicks,
    durationTicks,
    label: `Before: ${leftAsset.name}`,
    transform: {
      ...defaultTransform(),
      x: 0.255,
      y: 0.52,
      scale: 0.47,
      fit: 'contain',
      radius: 12,
      borderWidth: 2,
      borderColor: '#f85149',
    },
    audio: { ...createClip({ startTicks: 0, durationTicks: TICKS_PER_SECOND }).audio, muted: true },
  });

  const rightClip = createClip({
    kind: 'media',
    assetId: rightAssetId,
    startTicks: atTicks,
    durationTicks,
    label: `After: ${rightAsset.name}`,
    transform: {
      ...defaultTransform(),
      x: 0.745,
      y: 0.52,
      scale: 0.47,
      fit: 'contain',
      radius: 12,
      borderWidth: 2,
      borderColor: '#3fb950',
    },
    audio: { ...createClip({ startTicks: 0, durationTicks: TICKS_PER_SECOND }).audio, muted: true },
  });

  const labelClip = createClip({
    kind: 'title',
    startTicks: atTicks,
    durationTicks,
    label: 'BEFORE vs AFTER',
    transform: { ...defaultTransform(), x: 0.5, y: 0.12 },
    text: {
      text: 'BEFORE   |   AFTER',
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSize: 48,
      color: '#ffffff',
      background: '#0d1117',
      backgroundOpacity: 0.85,
      align: 'center',
      maxWidth: 0.8,
      letterSpacing: 2,
      lineHeight: 1.2,
    },
  });

  let next = placeClip(labelsTrack.project, beforeTrack.trackId, leftClip, 'overwrite');
  next = placeClip(next, afterTrack.trackId, rightClip, 'overwrite');
  next = placeClip(next, labelsTrack.trackId, labelClip, 'overwrite');
  return { project: next, clipIds: [leftClip.id, rightClip.id, labelClip.id] };
}

export interface MarkerSegment {
  id: string;
  label: string;
  startTicks: Tick;
  endTicks: Tick;
  durationTicks: Tick;
  withinShortsCap: boolean;
}

/**
 * Builds contiguous marker-to-marker segments across the project timeline so
 * any chapter/marker span can be picked and exported as a Short/Reel.
 */
export function markerSegments(project: Project): MarkerSegment[] {
  const duration = project.durationTicks;
  if (duration <= 0) return [];
  const sorted = [...project.markers]
    .filter((m) => m.atTicks >= 0 && m.atTicks < duration)
    .sort((a, b) => a.atTicks - b.atTicks);

  const points: Array<{ atTicks: Tick; label: string }> = [];
  if (sorted.length === 0 || sorted[0]!.atTicks > 0) {
    points.push({ atTicks: 0, label: 'Intro' });
  }
  for (const marker of sorted) {
    const prev = points[points.length - 1];
    if (prev && prev.atTicks === marker.atTicks) {
      prev.label = marker.label;
    } else {
      points.push({ atTicks: marker.atTicks, label: marker.label });
    }
  }

  const shortsMaxTicks = 60 * TICKS_PER_SECOND;
  const segments: MarkerSegment[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i]!.atTicks;
    const end = i + 1 < points.length ? points[i + 1]!.atTicks : duration;
    if (end <= start) continue;
    const segDuration = end - start;
    segments.push({
      id: `seg_${i}_${start}`,
      label: points[i]!.label,
      startTicks: start,
      endTicks: end,
      durationTicks: segDuration,
      withinShortsCap: segDuration <= shortsMaxTicks,
    });
  }
  return segments;
}

/**
 * Extracts a [startTicks, endTicks] segment into a project (or trims in place)
 * and optionally reframes it to 9:16 for YouTube Shorts / Instagram Reels.
 */
export function extractSegmentProject(
  project: Project,
  startTicks: Tick,
  endTicks: Tick,
  options: { reframeVertical?: boolean } = {},
): Project {
  const duration = Math.max(0, endTicks - startTicks);
  if (duration <= 0) return project;
  const sliced = cloneProjectWithRange(project, startTicks, duration);
  const named: Project = { ...sliced, id: project.id, name: project.name };
  return options.reframeVertical ? reframe9x16(named) : named;
}

/**
 * Adds a 20-second Auto End Screen card (Subscribe badge + two video slots)
 * on a dedicated 'End Screen' overlay track.
 */
export function addEndScreen(
  project: Project,
  atTicks?: Tick,
  durationTicks = Math.round(20 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'End Screen');
  const start =
    atTicks !== undefined
      ? Math.max(0, atTicks)
      : Math.max(0, project.durationTicks - durationTicks);
  const clip = createClip({
    kind: 'endscreen',
    startTicks: start,
    durationTicks: Math.max(TICKS_PER_SECOND, durationTicks),
    label: 'End screen (Subscribe + 2 videos)',
    transform: defaultTransform(),
    endScreen: {
      heading: 'Watch next',
      leftTitle: 'Next lesson',
      rightTitle: 'Deep-dive playlist',
      showSubscribe: true,
      accent: project.brand?.accent ?? '#ff0033',
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

export function diagramRevealBlockReason(project: Project, assetId: string | null): string | null {
  if (!assetId) return 'Select a PNG/image or video diagram in Uploads first.';
  const asset = assetById(project, assetId);
  if (!asset) return 'Select a PNG/image or video diagram in Uploads first.';
  if (asset.kind === 'audio') return 'Diagram reveal requires an image or video asset.';
  return null;
}

/**
 * Places an architecture diagram image (or video) on a 'Diagram' overlay track
 * with step-by-step progressive reveal across `steps`.
 */
export function addDiagramReveal(
  project: Project,
  assetId: string,
  atTicks: Tick,
  steps = 4,
  durationTicks = Math.round(6 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const asset = assetById(project, assetId);
  if (!asset || asset.kind === 'audio') return { project, clipId: '' };
  const ensured = ensureOverlayVideoTrack(project, 'Diagram');
  const clampedSteps = Math.max(2, Math.min(12, Math.round(steps)));
  const clip = createClip({
    kind: 'media',
    assetId,
    startTicks: atTicks,
    durationTicks: Math.max(TICKS_PER_SECOND, durationTicks),
    label: `Diagram (${clampedSteps} steps): ${asset.name}`,
    transform: {
      ...defaultTransform(),
      x: 0.5,
      y: 0.5,
      scale: 0.88,
      fit: 'contain',
      radius: 12,
      shadow: 20,
    },
    effects: {
      ...defaultEffects(),
      revealSteps: clampedSteps,
      revealDirection: 'left-to-right',
    },
    audio: { ...createClip({ startTicks: 0, durationTicks: TICKS_PER_SECOND }).audio, muted: true },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** Split a chord string like "Ctrl + Shift + P" into individual keycap labels. */
export function parseKeyChord(chord: string): string[] {
  const parts = chord
    .split(/\s*\+\s*|\s+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : ['Ctrl', 'C'];
}

/**
 * Places a keyboard shortcut keycap overlay on the 'Overlays' track for shell
 * and IDE walkthroughs (e.g. "Ctrl + R", "⌘ + K", "kubectl").
 */
export function addKeystrokeOverlay(
  project: Project,
  atTicks: Tick,
  chord = 'Ctrl + Shift + P',
  label = 'Command Palette',
  durationTicks = Math.round(2.5 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Overlays');
  const keys = parseKeyChord(chord);
  const clip = createClip({
    kind: 'keystroke',
    startTicks: atTicks,
    durationTicks: Math.max(Math.round(0.5 * TICKS_PER_SECOND), durationTicks),
    label: `Keys: ${keys.join(' + ')}`,
    transform: { ...defaultTransform(), x: 0.5, y: 0.82 },
    keystroke: {
      keys,
      label,
      style: 'dark',
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

