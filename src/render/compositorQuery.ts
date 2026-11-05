import type { Tick } from '../core/time';
import type { Clip, KeyframeTrack, Project, Track } from '../project/types';
import { clamp, ease } from './layout';

/** Clip active at a timeline position (end exclusive). */
export function activeClipAt(track: Track, ticks: Tick): Clip | null {
  for (const clip of track.clips) {
    if (ticks >= clip.startTicks && ticks < clip.startTicks + clip.durationTicks) return clip;
  }
  return null;
}

export function localTicks(clip: Clip, timelineTicks: Tick): Tick {
  return clamp(timelineTicks - clip.startTicks, 0, clip.durationTicks);
}

/** Where to read the source media, accounting for trim-in and speed. */
export function sourceTicks(clip: Clip, timelineTicks: Tick): Tick {
  if (clip.freezeAt !== undefined) return clip.freezeAt;
  return clip.inTicks + Math.round(localTicks(clip, timelineTicks) * (clip.speed || 1));
}

export function keyframeValue(
  clip: Clip,
  target: KeyframeTrack['target'],
  atLocalTicks: Tick,
  fallback: number,
): number {
  const groups = clip.keyframes?.filter((k) => k.target === target && k.keyframes.length > 0);
  const group = groups?.[0];
  if (!group) return fallback;
  const frames = [...group.keyframes].sort((a, b) => a.atTicks - b.atTicks);
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return fallback;
  if (atLocalTicks <= first.atTicks) return first.value;
  if (atLocalTicks >= last.atTicks) return last.value;
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (atLocalTicks >= a.atTicks && atLocalTicks <= b.atTicks) {
      const span = b.atTicks - a.atTicks;
      const progress = span === 0 ? 0 : (atLocalTicks - a.atTicks) / span;
      const eased = ease(progress, b.easing);
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

/** Opacity including transition fades at both ends of the clip. */
export function clipOpacity(clip: Clip, timelineTicks: Tick): number {
  const local = localTicks(clip, timelineTicks);
  const base = keyframeValue(clip, 'opacity', local, clip.transform.opacity);
  let factor = 1;
  const fadeIn = clip.transitionIn?.type === 'none' ? 0 : clip.transitionIn?.durationTicks ?? 0;
  const fadeOut = clip.transitionOut?.type === 'none' ? 0 : clip.transitionOut?.durationTicks ?? 0;
  if (fadeIn > 0 && local < fadeIn) factor = Math.min(factor, local / fadeIn);
  const fromEnd = clip.durationTicks - local;
  if (fadeOut > 0 && fromEnd < fadeOut) factor = Math.min(factor, fromEnd / fadeOut);
  return clamp(base * factor, 0, 1);
}

/** Linear gain including fade in/out and mute. */
export function clipGain(clip: Clip, timelineTicks: Tick): number {
  if (clip.audio.muted) return 0;
  const local = localTicks(clip, timelineTicks);
  let gain = keyframeValue(clip, 'volume', local, clip.audio.gain);
  if (clip.audio.fadeInTicks > 0 && local < clip.audio.fadeInTicks) {
    gain *= local / clip.audio.fadeInTicks;
  }
  const fromEnd = clip.durationTicks - local;
  if (clip.audio.fadeOutTicks > 0 && fromEnd < clip.audio.fadeOutTicks) {
    gain *= fromEnd / clip.audio.fadeOutTicks;
  }
  return clamp(gain, 0, 4);
}

/** Effective track gain (track volume, mute, solo handled by caller). */
export function trackGain(track: Track): number {
  return track.muted ? 0 : clamp(track.volume, 0, 2);
}

export interface VisibleLayer {
  track: Track;
  clip: Clip;
}

/** Clips visible at a time, ordered bottom-to-top by track order. */
export function visibleLayers(project: Project, ticks: Tick, options: { includeHidden?: boolean } = {}): VisibleLayer[] {
  const layers: VisibleLayer[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video') continue;
    if (track.hidden && !options.includeHidden) continue;
    const clip = activeClipAt(track, ticks);
    if (clip) layers.push({ track, clip });
  }
  return layers;
}

export interface AudioLayer {
  track: Track;
  clip: Clip;
  gain: number;
}

export function audibleLayers(project: Project, ticks: Tick): AudioLayer[] {
  const layers: AudioLayer[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue;
    const clip = activeClipAt(track, ticks);
    if (!clip) continue;
    const gain = clipGain(clip, ticks) * trackGain(track);
    if (gain <= 0) continue;
    const mutedElsewhere = project.tracks.some((t) => t.muted && t.kind === 'audio');
    if (mutedElsewhere && track.muted) continue;
    layers.push({ track, clip, gain });
  }
  return layers;
}

/** Caption cues that overlap a position. */
export function activeCues(project: Project, ticks: Tick) {
  return project.captions.filter((cue) => ticks >= cue.startTicks && ticks < cue.endTicks);
}

/** Nearest edit point for snap targets: clip edges, playhead, markers, zero. */
export function snapTargets(project: Project, excludeClipIds: readonly string[] = []): Tick[] {
  const excluded = new Set(excludeClipIds);
  const targets = new Set<number>([0]);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue;
      targets.add(clip.startTicks);
      targets.add(clip.startTicks + clip.durationTicks);
    }
  }
  for (const marker of project.markers) targets.add(marker.atTicks);
  for (const cue of project.captions) {
    targets.add(cue.startTicks);
    targets.add(cue.endTicks);
  }
  return [...targets].sort((a, b) => a - b);
}

export function snapTicks(value: Tick, targets: readonly Tick[], threshold: Tick): Tick {
  let best = value;
  let bestDistance = threshold + 1;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= threshold && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}
