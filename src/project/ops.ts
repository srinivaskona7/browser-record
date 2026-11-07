import { TICKS_PER_SECOND, type Tick } from '../core/time';
import { newId } from '../core/ids';
import { assetById, createClip, createTrack, defaultEffects, defaultTransform, projectDuration } from './factory';
import type {
  AlertBannerTone,
  AlphaMaskProps,
  BlendMode,
  BrandKit,
  CaptionCue,
  CaptionPreset,
  CaptionStyle,
  Clip,
  ColorLookPreset,
  EmphasisStyle,
  PipPreset,
  Project,
  ShadowGlowPreset,
  SocialPlatform,
  StickerKind,
  TextProps,
  Track,
  TransitionProps,
  VoicePreset,
} from './types';
import {
  clamp01,
  normalizeHexColor,
  normalizeRotationDeg,
  resolveAlphaMaskShape,
  resolveBoundaryTransition,
  resolveCaptionStylePreset,
  resolveCinematicLut,
  resolveColorFilter,
  resolveEmphasisStyle,
  resolveFontFamily,
  resolvePlatformPreset,
  resolveSpeedCurveProfile,
  resolveTextAnimation,
  resolveTextStylePreset,
  resolveVideoEffect,
} from '../effects/catalog';
import { voicePresetOptions } from '../audio/chain';
import { SFX_PRESETS, type SfxKind } from '../audio/sfx';
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
    progressBar?: Partial<NonNullable<Clip['progressBar']>>;
    pulse?: Partial<NonNullable<Clip['pulse']>>;
    countdown?: Partial<NonNullable<Clip['countdown']>>;
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
      ...(patch.progressBar && current.progressBar ? { progressBar: { ...current.progressBar, ...patch.progressBar } } : {}),
      ...(patch.pulse && current.pulse ? { pulse: { ...current.pulse, ...patch.pulse } } : {}),
      ...(patch.countdown && current.countdown ? { countdown: { ...current.countdown, ...patch.countdown } } : {}),
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
 * 16:9 widescreen reframe preset (1920×1080 or 3840×2160 4K) for YouTube Long-Form
 * and LinkedIn Landscape feeds.
 */
export function reframe16x9(project: Project, is4k = false): Project {
  const width = is4k ? 3840 : 1920;
  const height = is4k ? 2160 : 1080;
  return {
    ...project,
    canvas: { ...project.canvas, width, height, safeMargin: 0.05 },
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
                shape: 'circle' as const,
                corner: 'bottom-right' as const,
                size: 0.24,
                margin: 0.03,
              },
            };
          }
          if (clip.kind === 'contact') {
            return { ...clip, transform: { ...clip.transform, x: 0.5, y: 0.94 } };
          }
          if (clip.kind === 'media' && track.name === 'Screen') {
            return {
              ...clip,
              transform: { ...clip.transform, x: 0.5, y: 0.5, scale: 1, fit: 'contain' },
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

/** Apply a named caption style preset, including all 39 social, broadcast, and DevOps presets. */
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
    case 'classroom':
      return { ...base, backgroundOpacity: 0.62, outlineWidth: 4, fontSize: 54, align: 'center', marginX: 0.08 };
    default: {
      const catalogItem = resolveCaptionStylePreset(preset);
      if (catalogItem) {
        return {
          ...base,
          preset: catalogItem.id,
          fontFamily: catalogItem.fontFamily,
          fontSize: catalogItem.fontSize,
          color: catalogItem.color.toLowerCase(),
          background: catalogItem.background.toLowerCase(),
          backgroundOpacity: catalogItem.backgroundOpacity,
          outlineColor: catalogItem.outlineColor.toLowerCase(),
          outlineWidth: catalogItem.outlineWidth,
          positionY: catalogItem.positionY,
          maxLineChars: catalogItem.maxLineChars,
          align: catalogItem.align,
          marginX: catalogItem.marginX,
          marginBottom: catalogItem.marginBottom,
          uppercase: catalogItem.uppercase,
          wordHighlight: catalogItem.wordHighlight,
          wordHighlightColor: catalogItem.wordHighlightColor.toLowerCase(),
        };
      }
      return { ...base, backgroundOpacity: 0.62, outlineWidth: 4, fontSize: 54, align: 'center', marginX: 0.08 };
    }
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
 * and optionally reframes it to 9:16, 4:5, or 1:1 for YouTube Shorts, Instagram Reels/Feed, or LinkedIn posts.
 */
export function extractSegmentProject(
  project: Project,
  startTicks: Tick,
  endTicks: Tick,
  options: { reframeVertical?: boolean; targetWidth?: number; targetHeight?: number } = {},
): Project {
  const duration = Math.max(0, endTicks - startTicks);
  if (duration <= 0) return project;
  const sliced = cloneProjectWithRange(project, startTicks, duration);
  const named: Project = { ...sliced, id: project.id, name: project.name };
  if (options.targetWidth && options.targetHeight) {
    if (options.targetWidth === 1080 && options.targetHeight === 1080) return reframe1x1(named);
    if (options.targetWidth === 1080 && options.targetHeight === 1350) return reframe4x5(named);
    if (options.targetWidth < options.targetHeight) return reframe9x16(named);
  }
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

// ============================================================================
// 30 YouTube & Instagram Creator Features (Layers, Sounds, Looks, Motion, Social)
// ============================================================================

/** 1. Set composite blend mode ('normal' | 'screen' | 'multiply' | 'overlay') on a clip layer. */
export function setClipBlendMode(project: Project, clipId: string, blendMode: BlendMode): Project {
  return updateClipDeep(project, clipId, { transform: { blendMode } });
}

/** 2. One-click Picture-in-Picture corner & floating placement presets for any layer. */
export function applyPipPreset(project: Project, clipId: string, preset: PipPreset): Project {
  const map: Record<PipPreset, Partial<Clip['transform']>> = {
    'top-left': { x: 0.24, y: 0.24, scale: 0.38, radius: 16, shadow: 24, borderWidth: 2, borderColor: '#ffffff' },
    'top-right': { x: 0.76, y: 0.24, scale: 0.38, radius: 16, shadow: 24, borderWidth: 2, borderColor: '#ffffff' },
    'bottom-left': { x: 0.24, y: 0.76, scale: 0.38, radius: 16, shadow: 24, borderWidth: 2, borderColor: '#ffffff' },
    'bottom-right': { x: 0.76, y: 0.76, scale: 0.38, radius: 16, shadow: 24, borderWidth: 2, borderColor: '#ffffff' },
    'floating-center': { x: 0.5, y: 0.5, scale: 0.72, radius: 20, shadow: 36, borderWidth: 3, borderColor: '#58a6ff' },
    'cinema-bar': { x: 0.5, y: 0.5, scale: 0.92, radius: 8, shadow: 16, borderWidth: 0, borderColor: '#000000' },
  };
  return updateClipDeep(project, clipId, { transform: map[preset] });
}

/** 3. Drop-shadow & neon border glow presets for code cards, B-roll and overlays. */
export function applyShadowGlowPreset(project: Project, clipId: string, preset: ShadowGlowPreset): Project {
  const map: Record<ShadowGlowPreset, Partial<Clip['transform']>> = {
    none: { shadow: 0, borderWidth: 0, radius: 0 },
    'soft-card': { shadow: 18, borderWidth: 1, borderColor: '#30363d', radius: 14 },
    'deep-studio': { shadow: 48, borderWidth: 2, borderColor: '#ffffff', radius: 22 },
    'neon-cyan': { shadow: 36, borderWidth: 4, borderColor: '#39d0d8', radius: 16 },
    'neon-amber': { shadow: 36, borderWidth: 4, borderColor: '#ffd166', radius: 16 },
  };
  return updateClipDeep(project, clipId, { transform: map[preset] });
}

/** 4a. Solo a track (mutes all other tracks of the same kind, or unmutes all if already soloed). */
export function soloTrack(project: Project, trackId: string): Project {
  const target = project.tracks.find((t) => t.id === trackId);
  if (!target) return project;
  const others = project.tracks.filter((t) => t.id !== trackId);
  const alreadySolo = !target.muted && others.every((t) => t.muted);
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      muted: alreadySolo ? false : t.id !== trackId,
    })),
  };
}

/** 4b. Unmute and unhide all tracks and reset track volumes to 100%. */
export function unmuteAllTracks(project: Project): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, muted: false, hidden: false, volume: 1 })),
  };
}

/** 5. Magnetic gap closer: removes empty timeline gaps between clips on unlocked tracks. */
export function closeTrackGaps(project: Project, trackId?: string): Project {
  const nextTracks = project.tracks.map((track) => {
    if (track.locked) return track;
    if (trackId && track.id !== trackId) return track;
    const sorted = sortClips(track.clips);
    let cursor: Tick = 0;
    const packed = sorted.map((clip) => {
      const moved = { ...clip, startTicks: cursor };
      cursor += clip.durationTicks;
      return moved;
    });
    return { ...track, clips: packed };
  });
  return withDuration({ ...project, tracks: nextTracks });
}

/** 6. Apply a curated voice EQ/compressor preset ('podcast-warm' | 'crisp-tech' | 'broadcast-punch' | 'de-reverb-tight' | 'flat') to narration clips. */
export function applyVoicePreset(project: Project, preset: VoicePreset, clipId?: string): Project {
  const spec = voicePresetOptions(preset);
  const gainByPreset: Record<VoicePreset, number> = {
    'podcast-warm': 1.15,
    'crisp-tech': 1.2,
    'broadcast-punch': 1.35,
    'de-reverb-tight': 1.1,
    flat: 1.0,
  };
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (clipId && clip.id !== clipId) return clip;
        if (!clipId && clip.kind !== 'media') return clip;
        return {
          ...clip,
          audio: {
            ...clip.audio,
            processed: spec.enabled,
            gain: gainByPreset[preset],
          },
        };
      }),
    };
  });
}

/** 7. Place a synthesized procedural sound-effect marker/clip on a dedicated 'SFX' audio track. */
export function addProceduralSfxClip(
  project: Project,
  sfxKind: SfxKind,
  atTicks: Tick,
): { project: Project; clipId: string; assetId: string } {
  const spec = SFX_PRESETS.find((item) => item.id === sfxKind) ?? SFX_PRESETS[0]!;
  const durationTicks = Math.max(Math.round(0.08 * TICKS_PER_SECOND), Math.round(spec.durationSeconds * TICKS_PER_SECOND));
  const assetId = `asset_sfx_${sfxKind}`;
  const hasAsset = project.assets.some((a) => a.id === assetId);
  const nextAssets = hasAsset
    ? project.assets
    : [
        ...project.assets,
        {
          id: assetId,
          kind: 'audio' as const,
          name: `SFX: ${spec.label}`,
          path: `media/sfx-${sfxKind}.wav`,
          durationTicks,
          sampleRate: 48_000,
          channels: 1,
          origin: 'generated' as const,
          mimeType: 'audio/wav',
          createdAt: new Date().toISOString(),
        },
      ];
  let working: Project = { ...project, assets: nextAssets };
  const existingTrack = working.tracks.find((t) => t.kind === 'audio' && t.name === 'SFX' && !t.locked);
  const sfxTrack = existingTrack ?? createTrack('audio', 'SFX');
  if (!existingTrack) working = addTrack(working, sfxTrack);

  const clip = createClip({
    kind: 'media',
    assetId,
    startTicks: atTicks,
    durationTicks,
    label: `SFX: ${spec.label}`,
    audio: {
      gain: 0.9,
      muted: false,
      fadeInTicks: Math.round(0.01 * TICKS_PER_SECOND),
      fadeOutTicks: Math.round(0.03 * TICKS_PER_SECOND),
      processed: false,
      pan: 0,
      duckUnderVoice: false,
    },
  });
  return {
    project: placeClip(working, sfxTrack.id, clip, 'overwrite'),
    clipId: clip.id,
    assetId,
  };
}

/** 8. Apply smooth audio fade-in and fade-out to a clip or all media clips across unlocked tracks. */
export function applyAudioFades(
  project: Project,
  fadeSeconds = 0.35,
  clipId?: string,
): Project {
  const fadeTicks = Math.max(0, Math.round(fadeSeconds * TICKS_PER_SECOND));
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (clipId && clip.id !== clipId) return clip;
        if (clip.kind !== 'media') return clip;
        const maxFade = Math.floor(clip.durationTicks / 3);
        const clamped = Math.min(fadeTicks, maxFade);
        return {
          ...clip,
          audio: {
            ...clip.audio,
            fadeInTicks: clamped,
            fadeOutTicks: clamped,
          },
        };
      }),
    };
  });
}

/** 9. Configure a background music bed track with -14 dB gain (~0.2 linear), soft fades, and auto-ducking under voice. */
export function prepareMusicBedTrack(project: Project, assetId?: string): { project: Project; trackId: string } {
  const existing = project.tracks.find((t) => t.kind === 'audio' && /music/i.test(t.name) && !t.locked);
  const track = existing ?? createTrack('audio', 'Music Bed');
  let working: Project = existing ? project : addTrack(project, track);
  working = {
    ...working,
    settings: { ...working.settings, duckingEnabled: true, duckingAmountDb: -10 },
  };
  if (assetId) {
    const asset = assetById(working, assetId);
    if (asset && asset.kind === 'audio') {
      const targetDuration = Math.max(working.durationTicks, asset.durationTicks, Math.round(10 * TICKS_PER_SECOND));
      const clip = createClip({
        kind: 'media',
        assetId,
        startTicks: 0,
        durationTicks: Math.min(targetDuration, asset.durationTicks),
        label: `Music: ${asset.name}`,
        audio: {
          gain: 0.22,
          muted: false,
          fadeInTicks: Math.round(1.0 * TICKS_PER_SECOND),
          fadeOutTicks: Math.round(1.5 * TICKS_PER_SECOND),
          processed: false,
          pan: 0,
          duckUnderVoice: true,
        },
      });
      working = placeClip(working, track.id, clip, 'overwrite');
    }
  }
  working = mapTracks(working, (t) =>
    t.id === track.id
      ? {
          ...t,
          volume: 0.25,
          clips: t.clips.map((c) => ({
            ...c,
            audio: {
              ...c.audio,
              gain: Math.min(c.audio.gain, 0.25),
              duckUnderVoice: true,
              fadeInTicks: Math.max(c.audio.fadeInTicks, Math.round(0.8 * TICKS_PER_SECOND)),
              fadeOutTicks: Math.max(c.audio.fadeOutTicks, Math.round(1.2 * TICKS_PER_SECOND)),
            },
          })),
        }
      : t,
  );
  return { project: working, trackId: track.id };
}

/** 10. Normalize clip audio gain to a target linear gain (or peak dBFS). */
export function normalizeClipGain(project: Project, clipId: string, targetGain = 1.25): Project {
  const clamped = Math.max(0.1, Math.min(4, Number(targetGain.toFixed(2))));
  return updateClipDeep(project, clipId, { audio: { gain: clamped, muted: false } });
}

/** 11. Apply a one-click colour grading look preset to a clip (or all video clips if clipId is omitted). */
export function applyColorLookPreset(
  project: Project,
  preset: ColorLookPreset,
  clipId?: string,
): Project {
  const looks: Record<ColorLookPreset, Partial<Clip['effects']>> = {
    neutral: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, vibrance: 0, exposure: 0, vignette: 0 },
    'cinema-teal': { brightness: -0.02, contrast: 0.14, saturation: -0.08, temperature: -0.18, vibrance: 0.12, exposure: 0 },
    'warm-creator': { brightness: 0.03, contrast: 0.08, saturation: 0.12, temperature: 0.22, vibrance: 0.15, exposure: 0.02 },
    'high-contrast-terminal': { brightness: -0.03, contrast: 0.24, saturation: 0.08, temperature: -0.05, vibrance: 0.1, exposure: 0 },
    'crisp-daylight': { brightness: 0.05, contrast: 0.1, saturation: 0.06, temperature: 0.04, vibrance: 0.1, exposure: 0.04 },
    'noir-mono': { brightness: -0.02, contrast: 0.22, saturation: -1, temperature: 0, vibrance: 0, exposure: 0, vignette: 0.35 },
    'vibrant-reel': { brightness: 0.04, contrast: 0.16, saturation: 0.28, temperature: 0.08, vibrance: 0.25, exposure: 0.02 },
  };
  const patch = looks[preset];
  if (clipId) return updateClipDeep(project, clipId, { effects: patch });
  return mapTracks(project, (track) => {
    if (track.kind !== 'video' || track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) =>
        clip.kind === 'media' ? { ...clip, effects: { ...clip.effects, ...patch } } : clip,
      ),
    };
  });
}

/** 12. Set radial vignette strength (0..1) on a clip. */
export function setClipVignette(project: Project, clipId: string, vignette: number): Project {
  return updateClipDeep(project, clipId, {
    effects: { vignette: Math.max(0, Math.min(1, Number(vignette.toFixed(2)))) },
  });
}

/** 13. Apply a Screen Studio style rounded frame with studio backdrop wallpaper padding around a screen clip. */
export function applyScreenStudioFrame(
  project: Project,
  clipId: string,
  padding = 0.06,
  backdropColor = '#161b22',
): Project {
  const clampedPad = Math.max(0, Math.min(0.18, Number(padding.toFixed(3))));
  return updateClipDeep(project, clipId, {
    transform: {
      scale: Number((1 - clampedPad * 2).toFixed(3)),
      radius: 24,
      shadow: 42,
      borderWidth: 2,
      borderColor: '#30363d',
    },
    effects: {
      backdropPadding: clampedPad,
      backdropColor,
    },
  });
}

/** 14. Add an animated watch-progress bar across the full timeline (top or bottom) for Shorts/Reels/Tutorials. */
export function addProgressBarOverlay(
  project: Project,
  position: 'top' | 'bottom' = 'top',
  color = '#ff0033',
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Progress Bar');
  const duration = Math.max(TICKS_PER_SECOND * 3, project.durationTicks);
  const clip = createClip({
    kind: 'progressbar',
    startTicks: 0,
    durationTicks: duration,
    label: `Progress bar (${position})`,
    transform: defaultTransform(),
    progressBar: {
      position,
      height: 0.01,
      color,
      backgroundColor: 'rgba(255, 255, 255, 0.18)',
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** 15. Auto-generate 2-second chapter bumper cards on a 'Chapter Bumpers' track from timeline markers. */
export function addChapterBumpersFromMarkers(
  project: Project,
  durationSeconds = 2.0,
): { project: Project; clipIds: string[] } {
  if (project.markers.length === 0) return { project, clipIds: [] };
  const ensured = ensureOverlayVideoTrack(project, 'Chapter Bumpers');
  let working = ensured.project;
  const clipIds: string[] = [];
  const sorted = [...project.markers].sort((a, b) => a.atTicks - b.atTicks);
  const durTicks = Math.max(Math.round(0.8 * TICKS_PER_SECOND), Math.round(durationSeconds * TICKS_PER_SECOND));

  sorted.forEach((marker, idx) => {
    const added = addTitleClip(
      working,
      ensured.trackId,
      marker.atTicks,
      `${String(idx + 1).padStart(2, '0')} · ${marker.label}`,
      'section',
      durTicks,
    );
    working = added.project;
    clipIds.push(added.clipId);
  });

  return { project: working, clipIds };
}

/** 16. Batch-apply a transition ('fade' | 'dissolve' | 'slide-left' | 'slide-right' | 'wipe') to all cuts on unlocked video tracks. */
export function applyTransitionToAllCuts(
  project: Project,
  type: TransitionProps['type'] = 'dissolve',
  durationSeconds = 0.35,
): Project {
  const durationTicks = Math.max(1, Math.round(durationSeconds * TICKS_PER_SECOND));
  return mapTracks(project, (track) => {
    if (track.kind !== 'video' || track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip, idx) => ({
        ...clip,
        transitionIn: idx > 0 || type === 'fade' ? { type, durationTicks } : clip.transitionIn,
        transitionOut: { type, durationTicks },
      })),
    };
  });
}

/** 17. Add a smooth Ken Burns slow zoom-and-drift keyframe curve across a clip so static diagrams/frames feel alive. */
export function addKenBurnsDrift(
  project: Project,
  clipId: string,
  endScale = 1.12,
): Project {
  const clip = findClip(project, clipId);
  if (!clip) return project;
  const others = clip.keyframes.filter((k) => k.target !== 'zoom' && k.target !== 'panX');
  const zoomTrack = {
    target: 'zoom' as const,
    keyframes: [
      { id: newId('kf'), atTicks: 0, value: 1, easing: 'ease-in-out' as const },
      { id: newId('kf'), atTicks: clip.durationTicks, value: Math.max(1.02, endScale), easing: 'ease-in-out' as const },
    ],
  };
  const panTrack = {
    target: 'panX' as const,
    keyframes: [
      { id: newId('kf'), atTicks: 0, value: -0.04, easing: 'ease-in-out' as const },
      { id: newId('kf'), atTicks: clip.durationTicks, value: 0.04, easing: 'ease-in-out' as const },
    ],
  };
  return updateClip(project, clipId, { keyframes: [...others, zoomTrack, panTrack] });
}

/** 18. Add a spotlight dimmer mask that darkens the surrounding screen while keeping the target region bright. */
export function addSpotlightMask(
  project: Project,
  clipId: string,
  rect: { x: number; y: number; width: number; height: number } = { x: 0.2, y: 0.25, width: 0.6, height: 0.45 },
): Project {
  const clip = findClip(project, clipId);
  if (!clip) return project;
  const masks = [
    ...clip.masks,
    {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      mode: 'spotlight' as const,
      strength: 70,
    },
  ];
  return updateClip(project, clipId, { masks });
}

/** 19. Add an animated cursor click ripple / pulse ring overlay at `(x, y)` on the 'Overlays' track. */
export function addClickPulse(
  project: Project,
  atTicks: Tick,
  x = 0.5,
  y = 0.5,
  color = '#ffd166',
  durationTicks = Math.round(1.2 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Overlays');
  const clip = createClip({
    kind: 'pulse',
    startTicks: atTicks,
    durationTicks: Math.max(Math.round(0.4 * TICKS_PER_SECOND), durationTicks),
    label: 'Click pulse highlight',
    transform: { ...defaultTransform(), x, y },
    pulse: {
      x,
      y,
      color,
      rings: 3,
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** 20. Cycle presenter camera bubble corners at marker boundaries so the speaker bubble never blocks one corner forever. */
export function cycleCameraCornersOnMarkers(project: Project): Project {
  if (project.markers.length === 0) return project;
  const sortedMarkers = [...project.markers].sort((a, b) => a.atTicks - b.atTicks);
  let working = project;
  for (const marker of sortedMarkers) {
    working = splitAt(working, marker.atTicks);
  }
  const corners: Array<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'> = [
    'bottom-right',
    'bottom-left',
    'top-right',
    'top-left',
  ];
  let idx = 0;
  return mapTracks(working, (track) => {
    if (track.kind !== 'video' || track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!clip.presenter) return clip;
        const corner = corners[idx % corners.length]!;
        idx += 1;
        return {
          ...clip,
          presenter: {
            ...clip.presenter,
            corner,
          },
        };
      }),
    };
  });
}

/** 21. Add a numbered tutorial Step Badge ('STEP 1', 'STEP 2', ...) in the upper-left corner. */
export function addStepBadge(
  project: Project,
  atTicks: Tick,
  stepNumber?: number,
  title = 'Configure cluster',
  durationTicks = Math.round(4 * TICKS_PER_SECOND),
): { project: Project; clipId: string; step: number } {
  const ensured = ensureOverlayVideoTrack(project, 'Steps');
  const existingSteps =
    ensured.project.tracks.find((t) => t.id === ensured.trackId)?.clips.length ?? 0;
  const step = stepNumber ?? existingSteps + 1;
  const text = `STEP ${step} · ${title}`;
  const clip = createClip({
    kind: 'title',
    startTicks: atTicks,
    durationTicks,
    label: text,
    transform: { ...defaultTransform(), x: 0.22, y: 0.1 },
    text: {
      text,
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSize: 42,
      color: '#ffffff',
      background: '#1f6feb',
      backgroundOpacity: 0.95,
      align: 'left',
      maxWidth: 0.4,
      letterSpacing: 1,
      lineHeight: 1.2,
    },
  });
  return {
    project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'),
    clipId: clip.id,
    step,
  };
}

/** 22. Add a GitHub/DevOps admonition alert banner ('warning' | 'danger' | 'tip' | 'note'). */
export function addAlertBanner(
  project: Project,
  atTicks: Tick,
  tone: AlertBannerTone = 'warning',
  message = 'Check your kubeconfig context before applying to prod',
  durationTicks = Math.round(4 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Alerts');
  const styles: Record<AlertBannerTone, { prefix: string; bg: string; fg: string }> = {
    warning: { prefix: '⚠️ WARNING', bg: '#9e6a03', fg: '#ffffff' },
    danger: { prefix: '🔥 DANGER', bg: '#da3633', fg: '#ffffff' },
    tip: { prefix: '💡 PRO TIP', bg: '#238636', fg: '#ffffff' },
    note: { prefix: 'ℹ️ NOTE', bg: '#1f6feb', fg: '#ffffff' },
  };
  const spec = styles[tone];
  const fullText = `${spec.prefix}: ${message}`;
  const clip = createClip({
    kind: 'title',
    startTicks: atTicks,
    durationTicks,
    label: fullText.slice(0, 40),
    transform: { ...defaultTransform(), x: 0.5, y: 0.16 },
    text: {
      text: fullText,
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 44,
      color: spec.fg,
      background: spec.bg,
      backgroundOpacity: 0.94,
      align: 'center',
      maxWidth: 0.86,
      letterSpacing: 0.4,
      lineHeight: 1.25,
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** 23. Add a lower-left Social Handle Pill ('youtube' | 'instagram' | 'github' | 'linkedin' | 'x'). */
export function addSocialFollowPill(
  project: Project,
  atTicks: Tick,
  platform: SocialPlatform = 'youtube',
  handle = '@devops-studio',
  durationTicks = Math.round(4 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Social Pills');
  const badges: Record<SocialPlatform, { icon: string; bg: string }> = {
    youtube: { icon: '▶ YouTube', bg: '#ff0033' },
    instagram: { icon: '◎ Instagram', bg: '#d62976' },
    github: { icon: '⌘ GitHub', bg: '#24292f' },
    linkedin: { icon: 'in LinkedIn', bg: '#0a66c2' },
    x: { icon: '𝕏', bg: '#0f1419' },
  };
  const spec = badges[platform];
  const label = `${spec.icon} · ${handle}`;
  const clip = createClip({
    kind: 'title',
    startTicks: atTicks,
    durationTicks,
    label,
    transform: { ...defaultTransform(), x: 0.24, y: 0.88 },
    text: {
      text: label,
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 38,
      color: '#ffffff',
      background: spec.bg,
      backgroundOpacity: 0.92,
      align: 'left',
      maxWidth: 0.44,
      letterSpacing: 0.3,
      lineHeight: 1.2,
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** 24. Add a persistent lower-third Topic Ticker bar across a lesson section. */
export function addTopicTicker(
  project: Project,
  atTicks: Tick,
  topic = 'LIVE DEMO · Zero-downtime Kubernetes rollout',
  durationTicks = Math.round(6 * TICKS_PER_SECOND),
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Topic Ticker');
  const clip = createClip({
    kind: 'title',
    startTicks: atTicks,
    durationTicks,
    label: topic.slice(0, 40),
    transform: { ...defaultTransform(), x: 0.5, y: 0.91 },
    text: {
      text: topic,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontWeight: 700,
      fontSize: 34,
      color: '#58a6ff',
      background: '#0d1117',
      backgroundOpacity: 0.92,
      align: 'center',
      maxWidth: 0.92,
      letterSpacing: 0.8,
      lineHeight: 1.2,
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** 25. Add a live ticking Countdown Timer badge ('00:30' -> '00:00') for fast-paced Shorts and deploy challenges. */
export function addCountdownOverlay(
  project: Project,
  atTicks: Tick,
  seconds = 10,
  label = 'Deploy in',
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Countdown');
  const clampedSeconds = Math.max(1, Math.min(3600, Math.round(seconds)));
  const durationTicks = clampedSeconds * TICKS_PER_SECOND;
  const clip = createClip({
    kind: 'countdown',
    startTicks: atTicks,
    durationTicks,
    label: `Countdown (${clampedSeconds}s)`,
    transform: { ...defaultTransform(), x: 0.84, y: 0.12 },
    countdown: {
      seconds: clampedSeconds,
      label,
      color: '#ffd166',
    },
  });
  return { project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'), clipId: clip.id };
}

/** 26. Reframe composition to 1:1 Square (1080×1080) for Instagram Carousels and LinkedIn feeds. */
export function reframe1x1(project: Project): Project {
  return {
    ...project,
    canvas: { ...project.canvas, width: 1080, height: 1080 },
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
                shape: 'circle' as const,
                corner: 'bottom-right' as const,
                size: 0.26,
                margin: 0.03,
              },
            };
          }
          if (clip.kind === 'media' && track.name === 'Screen') {
            return {
              ...clip,
              transform: { ...clip.transform, x: 0.5, y: 0.44, scale: 0.96, fit: 'contain' },
            };
          }
          return clip;
        }),
      };
    }),
  };
}

/** 27. Reframe composition to 4:5 Portrait (1080×1350) for maximum Instagram & LinkedIn mobile feed height. */
export function reframe4x5(project: Project): Project {
  return {
    ...project,
    canvas: { ...project.canvas, width: 1080, height: 1350 },
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
                shape: 'rounded' as const,
                corner: 'bottom-right' as const,
                size: 0.28,
                margin: 0.035,
              },
            };
          }
          if (clip.kind === 'media' && track.name === 'Screen') {
            return {
              ...clip,
              transform: { ...clip.transform, x: 0.5, y: 0.38, scale: 0.98, fit: 'contain' },
            };
          }
          return clip;
        }),
      };
    }),
  };
}

/** 29. Automatically generate timeline chapter markers from caption cues that start a new topic, step, or question. */
export function generateMarkersFromCaptions(
  project: Project,
  minGapSeconds = 12,
): Project {
  if (project.captions.length === 0) return project;
  const sorted = [...project.captions].sort((a, b) => a.startTicks - b.startTicks);
  const minGapTicks = Math.max(TICKS_PER_SECOND * 3, Math.round(minGapSeconds * TICKS_PER_SECOND));
  const generated = [...project.markers];
  const topicTrigger = /^(?:step\s+\d+|first|second|third|next|now\s+let's|finally|how\s+to|why\s+|let's\s+deploy|let's\s+build)/i;

  let lastAt = -minGapTicks;
  sorted.forEach((cue, idx) => {
    const clean = cue.text.trim();
    if (!clean) return;
    const isFirst = idx === 0 && cue.startTicks === 0;
    const matchesTopic = topicTrigger.test(clean) || clean.endsWith('?');
    if ((isFirst || matchesTopic || cue.startTicks - lastAt >= minGapTicks * 2) && cue.startTicks - lastAt >= minGapTicks) {
      const existsNear = generated.some((m) => Math.abs(m.atTicks - cue.startTicks) < TICKS_PER_SECOND * 2);
      if (!existsNear) {
        generated.push({
          id: newId('marker'),
          atTicks: cue.startTicks,
          label: clean.replace(/[?.!]+$/, '').slice(0, 36),
          color: '#58a6ff',
        });
        lastAt = cue.startTicks;
      }
    }
  });

  return {
    ...project,
    markers: generated.sort((a, b) => a.atTicks - b.atTicks),
  };
}

export interface PacingAuditReport {
  totalDurationSeconds: number;
  mediaClipCount: number;
  overlayClipCount: number;
  averageCutSeconds: number;
  captionCoveragePercent: number;
  hasHookInFirst5s: boolean;
  shortsReady: boolean;
  score: number;
  suggestions: string[];
}

/**
 * 30. Audit timeline pacing, visual variety, hook placement, and caption coverage
 * for YouTube retention and Instagram Reels readiness.
 */
export function auditVideoPacing(project: Project): PacingAuditReport {
  const totalDurationSeconds = project.durationTicks / TICKS_PER_SECOND;
  const videoTracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden);
  const allVideoClips = videoTracks.flatMap((t) => t.clips);
  const mediaClips = allVideoClips.filter((c) => c.kind === 'media');
  const overlayClips = allVideoClips.filter((c) => c.kind !== 'media');

  const averageCutSeconds =
    mediaClips.length > 0 ? totalDurationSeconds / mediaClips.length : totalDurationSeconds;

  const captionedTicks = project.captions.reduce(
    (acc, cue) => acc + Math.max(0, cue.endTicks - cue.startTicks),
    0,
  );
  const captionCoveragePercent =
    project.durationTicks > 0
      ? Math.min(100, Math.round((captionedTicks / project.durationTicks) * 100))
      : 0;

  const first5sTicks = 5 * TICKS_PER_SECOND;
  const hasHookInFirst5s = overlayClips.some((c) => c.startTicks < first5sTicks);
  const shortsReady =
    project.canvas.width < project.canvas.height &&
    totalDurationSeconds > 0 &&
    totalDurationSeconds <= 60;

  const suggestions: string[] = [];
  let score = 100;

  if (!hasHookInFirst5s && totalDurationSeconds > 0) {
    score -= 18;
    suggestions.push('Add a Hook title, CLI callout, or Intro template in the first 5 seconds to stop scroll drop-off.');
  }
  if (averageCutSeconds > 18 && totalDurationSeconds > 20) {
    score -= 20;
    suggestions.push(
      `Average cut length is ${averageCutSeconds.toFixed(1)}s. Add punch-ins, B-roll PiP, or jump-cut silences every 8–12s.`,
    );
  }
  if (captionCoveragePercent < 40 && totalDurationSeconds > 0) {
    score -= 15;
    suggestions.push('Caption coverage is under 40%. Transcribe or import subtitles for muted mobile viewers.');
  }
  if (overlayClips.length === 0 && totalDurationSeconds > 0) {
    score -= 15;
    suggestions.push('No callouts, step badges, or keystroke overlays found. Add visual anchors to highlight key commands.');
  }
  if (project.markers.length === 0 && totalDurationSeconds >= 60) {
    score -= 10;
    suggestions.push('Add timeline markers or auto-generate chapters from captions for YouTube chapter scrubbing.');
  }

  return {
    totalDurationSeconds: Number(totalDurationSeconds.toFixed(1)),
    mediaClipCount: mediaClips.length,
    overlayClipCount: overlayClips.length,
    averageCutSeconds: Number(averageCutSeconds.toFixed(1)),
    captionCoveragePercent,
    hasHookInFirst5s,
    shortsReady,
    score: Math.max(0, score),
    suggestions,
  };
}

// ============================================================================
// Full Suite of Video, Text, Motion, Color, Speed & Masking Tool Operations
// ============================================================================

function findTargetVideoClipIds(project: Project, explicitClipId?: string): string[] {
  if (explicitClipId && findClip(project, explicitClipId)) {
    return [explicitClipId];
  }
  const ids: string[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.locked) continue;
    for (const clip of track.clips) {
      if (clip.kind === 'media' || clip.kind === 'adjustment') {
        ids.push(clip.id);
      }
    }
  }
  if (ids.length > 0) return ids;
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.locked) continue;
    for (const clip of track.clips) {
      ids.push(clip.id);
    }
  }
  return ids;
}

function findTargetTextClipIds(project: Project, explicitClipId?: string): string[] {
  if (explicitClipId && findClip(project, explicitClipId)) {
    return [explicitClipId];
  }
  const ids: string[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.locked) continue;
    for (const clip of track.clips) {
      if (clip.kind === 'title' && clip.text) {
        ids.push(clip.id);
      }
    }
  }
  return ids;
}

function findTargetElementClipIds(project: Project, explicitClipId?: string): string[] {
  if (explicitClipId && findClip(project, explicitClipId)) {
    return [explicitClipId];
  }
  const ids: string[] = [];
  for (const track of project.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      ids.push(clip.id);
    }
  }
  return ids;
}

/**
 * 1. Core Video Effects & Dynamic Motion (148 Video Effects)
 * Tool: `applyEffect(effect: string)` (Target: `video`, Neutral state: `'none'`)
 * Supports both `applyEffect(project, effect)` and `applyEffect(project, clipId, effect)`.
 */
export function applyEffect(project: Project, effectOrClipId: string, maybeEffect?: string): Project {
  const hasExplicitClip = maybeEffect !== undefined;
  const clipId = hasExplicitClip ? effectOrClipId : undefined;
  const rawEffect = hasExplicitClip ? maybeEffect : effectOrClipId;

  if (!rawEffect || rawEffect === 'none' || rawEffect === 'normal') {
    const targetIds = new Set(findTargetVideoClipIds(project, clipId));
    if (targetIds.size === 0) return project;
    return mapTracks(project, (track) => {
      if (track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) =>
          targetIds.has(clip.id)
            ? { ...clip, effects: { ...clip.effects, videoEffect: 'none' } }
            : clip,
        ),
      };
    });
  }

  const resolved = resolveVideoEffect(rawEffect);
  const effectId = resolved ? resolved.id : rawEffect;
  const targetIds = new Set(findTargetVideoClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) =>
        targetIds.has(clip.id)
          ? { ...clip, effects: { ...clip.effects, videoEffect: effectId } }
          : clip,
      ),
    };
  });
}

/**
 * 2. Boundary Video Transitions (51 Filters)
 * Tool: `addTransition(filterId: string)` (Target: `videoBoundary`, Removal/neutral state: `'normal'`)
 * Supports both `addTransition(project, filterId)` and `addTransition(project, clipId, filterId, durationTicks?, edge?)`.
 */
export function addTransition(
  project: Project,
  filterIdOrClipId: string,
  maybeFilterId?: string,
  durationTicks?: Tick,
  edge: 'both' | 'in' | 'out' = 'both',
): Project {
  const isClipFirst = maybeFilterId !== undefined && Boolean(findClip(project, filterIdOrClipId));
  const clipId = isClipFirst ? filterIdOrClipId : undefined;
  const rawFilterId = isClipFirst ? maybeFilterId! : filterIdOrClipId;

  const isNeutral = !rawFilterId || rawFilterId === 'normal' || rawFilterId === 'none';
  if (isNeutral) {
    const targetIds = new Set(findTargetVideoClipIds(project, clipId));
    if (targetIds.size === 0) return project;
    const cleared: TransitionProps = { type: 'none', durationTicks: 0 };
    return mapTracks(project, (track) => {
      if (track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (!targetIds.has(clip.id)) return clip;
          return {
            ...clip,
            transitionIn: edge === 'in' || edge === 'both' ? cleared : clip.transitionIn,
            transitionOut: edge === 'out' || edge === 'both' ? cleared : clip.transitionOut,
          };
        }),
      };
    });
  }

  const spec = resolveBoundaryTransition(rawFilterId);
  const filterId = spec ? spec.id : rawFilterId;
  const defaultTicks = Math.round((spec?.defaultDurationSeconds ?? 0.5) * TICKS_PER_SECOND);
  const targetIds = new Set(findTargetVideoClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id)) return clip;
        const dur = Math.min(
          Math.max(1, durationTicks ?? defaultTicks),
          Math.max(1, Math.floor(clip.durationTicks / 2)),
        );
        const transition: TransitionProps = {
          type: filterId,
          durationTicks: dur,
          easing: spec?.easing ?? 'ease-in-out',
        };
        return {
          ...clip,
          transitionIn: edge === 'in' || edge === 'both' ? transition : clip.transitionIn,
          transitionOut: edge === 'out' || edge === 'both' ? transition : clip.transitionOut,
        };
      }),
    };
  });
}

/**
 * 3A. Color Grading Filters (77 Presets)
 * Tool: `applyFilter(filter: string)` (Target: `video`, Neutral state: `'normal'`)
 * Supports both `applyFilter(project, filter)` and `applyFilter(project, clipId, filter)`.
 */
export function applyFilter(project: Project, filterOrClipId: string, maybeFilter?: string): Project {
  const hasExplicitClip = maybeFilter !== undefined;
  const clipId = hasExplicitClip ? filterOrClipId : undefined;
  const rawFilter = hasExplicitClip ? maybeFilter : filterOrClipId;

  const targetIds = new Set(findTargetVideoClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  if (!rawFilter || rawFilter === 'normal' || rawFilter === 'none') {
    return mapTracks(project, (track) => {
      if (track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) =>
          targetIds.has(clip.id)
            ? {
                ...clip,
                effects: {
                  ...clip.effects,
                  colorFilter: 'normal',
                  brightness: 0,
                  contrast: 0,
                  exposure: 0,
                  saturation: 0,
                  temperature: 0,
                  vibrance: 0,
                  vignette: 0,
                },
              }
            : clip,
        ),
      };
    });
  }

  const spec = resolveColorFilter(rawFilter);
  const filterId = spec ? spec.id : rawFilter;
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id)) return clip;
        return {
          ...clip,
          effects: {
            ...clip.effects,
            colorFilter: filterId,
            brightness: spec ? spec.brightness : clip.effects.brightness,
            contrast: spec ? spec.contrast : clip.effects.contrast,
            exposure: spec ? spec.exposure : clip.effects.exposure,
            saturation: spec ? spec.saturation : clip.effects.saturation,
            temperature: spec ? spec.temperature : clip.effects.temperature,
            vibrance: spec ? spec.vibrance : clip.effects.vibrance,
            vignette: spec ? spec.vignette : clip.effects.vignette,
          },
        };
      }),
    };
  });
}

/**
 * Create an Adjustment Layer clip spanning `[atTicks, atTicks + durationTicks)` on an
 * `'Adjustment Layer'` overlay video track so 3D LUTs and color grades can affect the timeline.
 */
export function addAdjustmentLayer(
  project: Project,
  atTicks: Tick = 0,
  durationTicks?: Tick,
  lut = 'rec709_standard',
): { project: Project; clipId: string } {
  const ensured = ensureOverlayVideoTrack(project, 'Adjustment Layer');
  const span = durationTicks ?? Math.max(TICKS_PER_SECOND * 5, project.durationTicks || TICKS_PER_SECOND * 5);
  const spec = resolveCinematicLut(lut);
  const clip = createClip({
    kind: 'adjustment',
    startTicks: Math.max(0, atTicks),
    durationTicks: Math.max(1, span),
    label: spec ? `LUT: ${spec.name}` : `Adjustment Layer`,
    effects: {
      ...defaultEffects(),
      lut: spec ? spec.id : lut,
      contrast: spec ? spec.contrast : 0,
      saturation: spec ? spec.saturation : 0,
      temperature: spec ? spec.temperature : 0,
    },
  });
  return {
    project: placeClip(ensured.project, ensured.trackId, clip, 'overwrite'),
    clipId: clip.id,
  };
}

/**
 * 3B. Look-Up Tables (16 Cinematic 3D LUTs)
 * Tool: `applyLUT(table: string)` (Target: `video`, `adjustmentLayer`)
 * Supports both `applyLUT(project, table)` and `applyLUT(project, clipId, table)`.
 */
export function applyLUT(project: Project, tableOrClipId: string, maybeTable?: string): Project {
  const hasExplicitClip = maybeTable !== undefined;
  const clipId = hasExplicitClip ? tableOrClipId : undefined;
  const rawTable = hasExplicitClip ? maybeTable : tableOrClipId;

  const targetIds = new Set(findTargetVideoClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  if (!rawTable || rawTable === 'none' || rawTable === 'normal') {
    return mapTracks(project, (track) => {
      if (track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) =>
          targetIds.has(clip.id)
            ? { ...clip, effects: { ...clip.effects, lut: 'none' } }
            : clip,
        ),
      };
    });
  }

  const spec = resolveCinematicLut(rawTable);
  const lutId = spec ? spec.id : rawTable;
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id)) return clip;
        return {
          ...clip,
          effects: {
            ...clip.effects,
            lut: lutId,
            contrast: spec ? spec.contrast : clip.effects.contrast,
            saturation: spec ? spec.saturation : clip.effects.saturation,
            temperature: spec ? spec.temperature : clip.effects.temperature,
          },
        };
      }),
    };
  });
}

/**
 * 4A. Text Animations (77 Kinetic Typography Animations)
 * Tool: `setTextAnimation(animation: string)` (Target: `text`)
 * Supports both `setTextAnimation(project, animation)` and `setTextAnimation(project, clipId, animation)`.
 */
export function setTextAnimation(project: Project, animationOrClipId: string, maybeAnimation?: string): Project {
  const hasExplicitClip = maybeAnimation !== undefined;
  const clipId = hasExplicitClip ? animationOrClipId : undefined;
  const rawAnimation = hasExplicitClip ? maybeAnimation : animationOrClipId;

  const targetIds = new Set(findTargetTextClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  const isNeutral = !rawAnimation || rawAnimation === 'none' || rawAnimation === 'normal';
  const spec = isNeutral ? null : resolveTextAnimation(rawAnimation);
  const animId = isNeutral ? 'none' : spec ? spec.id : rawAnimation;

  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id) || !clip.text) return clip;
        return {
          ...clip,
          text: {
            ...clip.text,
            animation: animId,
            typewriter: spec?.behavior === 'typewriter' ? true : isNeutral ? false : clip.text.typewriter,
          },
        };
      }),
    };
  });
}

/**
 * 4B. Text Style Presets (34 Presets)
 * Tool: `applyTextPreset(name: string)` (Target: `text`)
 * Supports both `applyTextPreset(project, name)` and `applyTextPreset(project, clipId, name)`.
 */
export function applyTextPreset(project: Project, nameOrClipId: string, maybeName?: string): Project {
  const hasExplicitClip = maybeName !== undefined;
  const clipId = hasExplicitClip ? nameOrClipId : undefined;
  const rawName = hasExplicitClip ? maybeName : nameOrClipId;

  const targetIds = new Set(findTargetTextClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  const spec = resolveTextStylePreset(rawName);
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id) || !clip.text) return clip;
        if (!spec) {
          return {
            ...clip,
            text: { ...clip.text, stylePreset: rawName },
          };
        }
        return {
          ...clip,
          text: {
            ...clip.text,
            stylePreset: spec.id,
            fontFamily: spec.fontFamily,
            fontWeight: spec.fontWeight,
            fontSize: spec.fontSize,
            color: normalizeHexColor(spec.color),
            gradientToColor: spec.gradientToColor ? normalizeHexColor(spec.gradientToColor) : undefined,
            background: normalizeHexColor(spec.background),
            backgroundOpacity: spec.backgroundOpacity,
            strokeColor: normalizeHexColor(spec.strokeColor),
            strokeWidth: spec.strokeWidth,
            shadowColor: normalizeHexColor(spec.shadowColor),
            shadowBlur: spec.shadowBlur,
            glowColor: spec.glowColor ? normalizeHexColor(spec.glowColor) : undefined,
            glowBlur: spec.glowBlur,
            letterSpacing: spec.letterSpacing,
          },
        };
      }),
    };
  });
}

/**
 * 4C. Font Engine (406 Font Families)
 * Tool: `setTextFont(family: string)` (Target: `text`)
 * Supports both `setTextFont(project, family)` and `setTextFont(project, clipId, family)`.
 */
export function setTextFont(project: Project, familyOrClipId: string, maybeFamily?: string): Project {
  const hasExplicitClip = maybeFamily !== undefined;
  const clipId = hasExplicitClip ? familyOrClipId : undefined;
  const rawFamily = hasExplicitClip ? maybeFamily : familyOrClipId;

  const targetIds = new Set(findTargetTextClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  const resolvedFamily = resolveFontFamily(rawFamily);
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id) || !clip.text) return clip;
        return {
          ...clip,
          text: {
            ...clip.text,
            fontFamily: resolvedFamily,
          },
        };
      }),
    };
  });
}

/**
 * 4D. Emphasis Styles (5 Styles: Highlight, Underline, Circle, Sparkle, Strikethrough)
 * Tool: `setEmphasis(style: string)` (Target: `text`, Neutral state: `'none'`)
 * Supports both `setEmphasis(project, style)` and `setEmphasis(project, clipId, style)`.
 */
export function setEmphasis(project: Project, styleOrClipId: string, maybeStyle?: string): Project {
  const hasExplicitClip = maybeStyle !== undefined;
  const clipId = hasExplicitClip ? styleOrClipId : undefined;
  const rawStyle = hasExplicitClip ? maybeStyle : styleOrClipId;

  const targetIds = new Set(findTargetTextClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  const spec = resolveEmphasisStyle(rawStyle);
  const emphasis: EmphasisStyle = spec ? spec.id : 'none';
  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id) || !clip.text) return clip;
        return {
          ...clip,
          text: {
            ...clip.text,
            emphasis,
          },
        };
      }),
    };
  });
}

/**
 * 5. Automated Subtitles & Caption Styles (39 Styles)
 * Tool: `setCaptionStyle(style: string)` (Target: `captions`)
 */
export function setCaptionStyle(project: Project, style: string): Project {
  const resolved = resolveCaptionStylePreset(style);
  const presetId = resolved ? resolved.id : style;
  return {
    ...project,
    captionStyle: applyCaptionPreset(project.captionStyle, presetId),
  };
}

/**
 * 6. Time Remapping & Speed Curves (8 Curve Profiles)
 * Tool: `selectSpeedPanelPreset(preset: string)` (Target: `element`)
 * Supports both `selectSpeedPanelPreset(project, preset)` and `selectSpeedPanelPreset(project, clipId, preset)`.
 */
export function selectSpeedPanelPreset(
  project: Project,
  presetOrClipId: string,
  maybePreset?: string,
): Project {
  const hasExplicitClip = maybePreset !== undefined;
  const clipId = hasExplicitClip ? presetOrClipId : undefined;
  const rawPreset = hasExplicitClip ? maybePreset : presetOrClipId;

  const targetIds = new Set(findTargetElementClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  const spec = resolveSpeedCurveProfile(rawPreset);
  const curveId = spec ? spec.id : rawPreset;
  const nominalSpeed = spec ? spec.nominalSpeed : 1;

  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) => {
        if (!targetIds.has(clip.id)) return clip;
        return {
          ...clip,
          speedCurve: curveId,
          speed: nominalSpeed,
          audio: {
            ...clip.audio,
            preservePitch: spec ? spec.preservePitch : true,
          },
        };
      }),
    };
  });
}

/**
 * 7. Alpha Masking & Compositing (5 Shapes: Rectangle, Circle, Star, Heart, Split Screen)
 * Tool: `setMask(shape: string)` (Target: `element`)
 * Supports `setMask(project, shape, options?)` and `setMask(project, clipId, shape, options?)`.
 */
export function setMask(
  project: Project,
  shapeOrClipId: string,
  maybeShapeOrOptions?: string | Partial<AlphaMaskProps>,
  maybeOptions?: Partial<AlphaMaskProps>,
): Project {
  const hasExplicitClip = typeof maybeShapeOrOptions === 'string';
  const clipId = hasExplicitClip ? shapeOrClipId : undefined;
  const rawShape = hasExplicitClip ? maybeShapeOrOptions : shapeOrClipId;
  const options = hasExplicitClip ? maybeOptions : (maybeShapeOrOptions as Partial<AlphaMaskProps> | undefined);

  const targetIds = new Set(findTargetElementClipIds(project, clipId));
  if (targetIds.size === 0) return project;

  if (!rawShape || rawShape === 'none' || rawShape === 'normal') {
    return mapTracks(project, (track) => {
      if (track.locked) return track;
      return {
        ...track,
        clips: track.clips.map((clip) =>
          targetIds.has(clip.id) ? { ...clip, alphaMask: undefined } : clip,
        ),
      };
    });
  }

  const spec = resolveAlphaMaskShape(rawShape);
  const shapeId = spec ? spec.id : 'rectangle';
  const mask: AlphaMaskProps = {
    shape: shapeId,
    feather: clamp01(options?.feather ?? spec?.defaultFeather ?? 0),
    invert: options?.invert ?? spec?.defaultInvert ?? false,
    x: clamp01(options?.x ?? 0.5),
    y: clamp01(options?.y ?? 0.5),
    scaleX: Math.max(0.05, Math.min(2, options?.scaleX ?? spec?.defaultScaleX ?? 0.8)),
    scaleY: Math.max(0.05, Math.min(2, options?.scaleY ?? spec?.defaultScaleY ?? 0.8)),
    rotationDeg: normalizeRotationDeg(options?.rotationDeg ?? 0),
  };

  return mapTracks(project, (track) => {
    if (track.locked) return track;
    return {
      ...track,
      clips: track.clips.map((clip) =>
        targetIds.has(clip.id) ? { ...clip, alphaMask: mask } : clip,
      ),
    };
  });
}

/**
 * 8. One-Click Platform Workflow & Styling Preset (YouTube, Instagram, LinkedIn)
 * Tool: `applyPlatformPreset(presetId: string)`
 * Reframes the composition (16:9 4K/1080p, 9:16 Vertical, 4:5 Portrait, or 1:1 Square)
 * and applies the coordinated caption style, color filter, 3D LUT, video effect,
 * boundary transition, and kinetic title preset so every effect is 100% compatible.
 */
export function applyPlatformPreset(project: Project, presetId: string): Project {
  const spec = resolvePlatformPreset(presetId);
  if (!spec) return project;

  let next: Project;
  if (spec.aspectRatio === '9:16') {
    next = reframe9x16(project);
  } else if (spec.aspectRatio === '4:5') {
    next = reframe4x5(project);
  } else if (spec.aspectRatio === '1:1') {
    next = reframe1x1(project);
  } else {
    next = reframe16x9(project, spec.width >= 3840);
  }

  next = {
    ...next,
    canvas: {
      ...next.canvas,
      width: spec.width,
      height: spec.height,
      fps: { num: spec.fps, den: 1 },
      safeMargin: spec.safeAreaMargin,
    },
  };

  next = setCaptionStyle(next, spec.captionStyleId);
  next = applyFilter(next, spec.colorFilterId);
  next = applyLUT(next, spec.lutId);
  next = applyEffect(next, spec.videoEffectId);
  next = addTransition(next, spec.transitionId);
  next = applyTextPreset(next, spec.textPresetId);
  next = setTextAnimation(next, spec.textAnimationId);
  return next;
}

/** Rename the project while keeping non-empty fallback. */
export function renameProject(project: Project, name: string): Project {
  const trimmed = name.trim();
  return { ...project, name: trimmed.length > 0 ? trimmed : project.name };
}

/** Toggle horizontal or vertical mirror flip on a clip's transform. */
export function toggleClipFlip(project: Project, clipId: string, axis: 'x' | 'y'): Project {
  const clip = findClip(project, clipId);
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!clip || !track || track.locked) return project;
  const current = axis === 'x' ? Boolean(clip.transform.flipX) : Boolean(clip.transform.flipY);
  return updateClipDeep(project, clipId, {
    transform: axis === 'x' ? { flipX: !current } : { flipY: !current },
  });
}

/** Snap clip center X/Y to standard canvas alignment positions. */
export function alignClip(
  project: Project,
  clipId: string,
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
): Project {
  const clip = findClip(project, clipId);
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!clip || !track || track.locked) return project;
  const patch =
    alignment === 'left'
      ? { x: 0.25 }
      : alignment === 'center'
        ? { x: 0.5 }
        : alignment === 'right'
          ? { x: 0.75 }
          : alignment === 'top'
            ? { y: 0.2 }
            : alignment === 'middle'
              ? { y: 0.5 }
              : { y: 0.8 };
  return updateClipDeep(project, clipId, { transform: patch });
}

/** Toggle reverse playback on a clip (and any linked audio/video clips). */
export function toggleClipReverse(project: Project, clipId: string, reverse?: boolean): Project {
  const clip = findClip(project, clipId);
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!clip || !track || track.locked) return project;
  const nextReverse = reverse ?? !clip.reverse;
  const linked = new Set(linkedClipIds(project, clip));
  return mapTracks(project, (tr) => {
    if (tr.locked) return tr;
    return {
      ...tr,
      clips: tr.clips.map((c) => (linked.has(c.id) ? { ...c, reverse: nextReverse } : c)),
    };
  });
}

/** Paste copied clips at the given playhead tick on their matching tracks. */
export function pasteClipsAtPlayhead(
  project: Project,
  copiedClips: Clip[],
  atTicks: Tick,
): { project: Project; newClipIds: string[] } {
  if (copiedClips.length === 0) return { project, newClipIds: [] };
  const minStart = Math.min(...copiedClips.map((c) => c.startTicks));
  const linkMap = new Map<string, string>();
  const newClipIds: string[] = [];
  let working = project;

  for (const src of copiedClips) {
    const newClipId = newId('clip');
    newClipIds.push(newClipId);
    let newLinkId: string | undefined;
    if (src.linkId) {
      newLinkId = linkMap.get(src.linkId) ?? newId('link');
      linkMap.set(src.linkId, newLinkId);
    }
    const clone: Clip = {
      ...structuredClone(src),
      id: newClipId,
      startTicks: Math.max(0, atTicks + (src.startTicks - minStart)),
      ...(newLinkId ? { linkId: newLinkId } : { linkId: undefined }),
    };
    const track =
      working.tracks.find((t) => !t.locked && t.clips.some((c) => c.id === src.id)) ??
      working.tracks.find((t) => !t.locked && t.kind === 'video');
    if (track) {
      working = placeClip(working, track.id, clone, 'overwrite');
    }
  }
  return { project: withDuration(working), newClipIds };
}

/**
 * Extract audio from a video clip onto a dedicated Audio track while muting
 * the video clip's embedded audio so audio can be trimmed/faded independently.
 */
export function extractAudio(
  project: Project,
  clipId: string,
): { project: Project; audioClipId: string | null } {
  const sourceClip = findClip(project, clipId);
  const sourceTrack = project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!sourceClip || !sourceTrack || sourceTrack.kind !== 'video' || !sourceClip.assetId) {
    return { project, audioClipId: null };
  }
  let working = updateClipDeep(project, sourceClip.id, { audio: { muted: true } });
  let audioTrack = working.tracks.find((t) => t.kind === 'audio' && !t.locked && t.name === 'Extracted Audio');
  if (!audioTrack) {
    audioTrack = createTrack('audio', 'Extracted Audio');
    working = addTrack(working, audioTrack);
  }
  const extracted = createClip({
    kind: 'media',
    assetId: sourceClip.assetId,
    startTicks: sourceClip.startTicks,
    durationTicks: sourceClip.durationTicks,
    inTicks: sourceClip.inTicks,
    speed: sourceClip.speed,
    reverse: sourceClip.reverse,
    speedCurve: sourceClip.speedCurve,
    label: `${sourceClip.label ?? 'Video'} (Audio)`,
    audio: { ...sourceClip.audio, muted: false },
  });
  working = placeClip(working, audioTrack.id, extracted, 'overwrite');
  return { project: withDuration(working), audioClipId: extracted.id };
}

/** Add rhythmic beat markers across the project duration at the specified BPM. */
export function addBeatMarkers(project: Project, bpm = 120, maxMarkers = 32): Project {
  const safeBpm = Math.max(40, Math.min(240, bpm));
  const stepTicks = Math.max(1, Math.round((60 / safeBpm) * TICKS_PER_SECOND));
  const totalTicks = Math.max(project.durationTicks, 4 * TICKS_PER_SECOND);
  const beatMarkers = [];
  let beatIndex = 1;
  for (let tick = stepTicks; tick < totalTicks && beatIndex <= maxMarkers; tick += stepTicks) {
    beatMarkers.push({
      id: newId('marker'),
      atTicks: tick,
      label: `Beat ${beatIndex}`,
      color: '#38bdf8',
    });
    beatIndex += 1;
  }
  return {
    ...project,
    markers: [...project.markers.filter((m) => !m.label.startsWith('Beat ')), ...beatMarkers],
  };
}

/** Reset presenter camera bubble position, size, and visibility to defaults. */
export function resetPresenterPosition(project: Project, clipId: string): Project {
  const clip = findClip(project, clipId);
  if (!clip || !clip.presenter) return project;
  return updateClip(project, clipId, {
    presenter: {
      ...clip.presenter,
      corner: 'bottom-right',
      size: 0.24,
      margin: 0.03,
      visible: true,
    },
  });
}





