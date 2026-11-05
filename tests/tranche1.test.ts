import { describe, expect, it } from 'vitest';
import { createClip, createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { formatChapters, formatChapterTime, formatDescription } from '../src/project/chapters';
import { parseProject, serializeProject } from '../src/project/serialize';
import { sourceTicks } from '../src/render/compositorQuery';
import { TICKS_PER_SECOND } from '../src/core/time';
import type { Project } from '../src/project/types';

const sec = (value: number) => Math.round(value * TICKS_PER_SECOND);

function withVideo(): { project: Project; trackId: string; clipId: string } {
  const base = createProject({ name: 'T', width: 1920, height: 1080, id: 'proj_t', now: '2026-01-01T00:00:00.000Z' });
  const trackId = base.tracks.find((t) => t.kind === 'video')!.id;
  const clip = createClip({ kind: 'media', assetId: 'asset_x', startTicks: 0, durationTicks: sec(10), label: 'Screen' });
  const project = { ...base, durationTicks: sec(10), tracks: base.tracks.map((t) => (t.id === trackId ? { ...t, clips: [clip] } : t)) };
  return { project, trackId, clipId: clip.id };
}

describe('hold frame', () => {
  it('inserts a frozen, muted copy and pushes the rest of the clip right', () => {
    const { project, trackId, clipId } = withVideo();
    const result = ops.holdFrame(project, trackId, clipId, sec(4), sec(3));
    const clips = result.project.tracks.find((t) => t.id === trackId)!.clips.sort((a, b) => a.startTicks - b.startTicks);
    expect(clips).toHaveLength(3);
    const hold = clips[1]!;
    expect(hold.freezeAt).toBe(sec(4));
    expect(hold.audio.muted).toBe(true);
    expect(sourceTicks(hold, sec(4) + sec(2))).toBe(sec(4));
    expect(clips[2]!.startTicks).toBe(sec(7));
  });

  it('does nothing when the playhead is outside the clip', () => {
    const { project, trackId, clipId } = withVideo();
    expect(ops.holdFrame(project, trackId, clipId, sec(12), sec(3)).project).toBe(project);
  });
});

describe('brand bars and chapters', () => {
  it('adds a header and footer spanning the timeline with the brand text', () => {
    const { project } = withVideo();
    const branded = { ...project, brand: { name: 'Kona', role: 'DevOps', email: 'a@b.c', linkedin: 'https://x' } };
    const result = ops.addBrandBars(branded, branded.brand!);
    const clips = result.project.tracks.flatMap((t) => t.clips);
    const titles = clips.filter((c) => c.kind === 'title');
    const contact = clips.find((c) => c.kind === 'contact');
    expect(titles).toHaveLength(1);
    expect(contact?.contact?.email).toBe('a@b.c');
    expect(clips.every((c) => c.durationTicks === sec(10))).toBe(true);
    expect(titles[0]!.text?.text).toContain('Kona · DevOps');
    expect(contact?.contact?.style).toBe('glass');
    expect(result.project.tracks.map((t) => t.name)).toEqual(expect.arrayContaining(['Header', 'Footer']));
  });

  it('formats YouTube chapter lines in time order', () => {
    const markers = [
      { id: 'b', atTicks: sec(75), label: 'Deploy', color: '#fff' },
      { id: 'a', atTicks: 0, label: 'Intro', color: '#fff' },
    ];
    expect(formatChapters(markers)).toBe('0:00 Intro\n1:15 Deploy');
    expect(formatChapterTime(sec(3725))).toBe('1:02:05');
  });
});

describe('stickers and new heading presets', () => {
  it('adds a sticker clip with its kind and a bottom-right position', () => {
    const { project, trackId } = withVideo();
    const result = ops.addStickerClip(project, trackId, 0, 'subscribe');
    const clip = result.project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === result.clipId)!;
    expect(clip.kind).toBe('sticker');
    expect(clip.sticker?.kind).toBe('subscribe');
    expect(clip.transform.x).toBeGreaterThan(0.7);
  });

  it('gives the code preset a monospace font and dark background', () => {
    const { project, trackId } = withVideo();
    const result = ops.addTitleClip(project, trackId, 0, '$ kubectl', 'code');
    const clip = result.project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === result.clipId)!;
    expect(clip.text?.fontFamily).toMatch(/monospace/);
    expect(clip.text?.background).toBe('#0d1117');
  });

  it('rejects a sticker clip without sticker properties', () => {
    const { project, trackId } = withVideo();
    const bad = createClip({ kind: 'sticker', startTicks: 0, durationTicks: TICKS_PER_SECOND });
    const broken = { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [bad] } : t)) };
    expect(() => parseProject(JSON.parse(serializeProject(broken)))).toThrow(/no sticker properties/);
  });
});

describe('contact bar', () => {
  it('copies the brand kit style and accent onto the contact clip', () => {
    const { project, trackId } = withVideo();
    const brand = { name: 'Kona', role: 'DevOps', email: 'a@b.c', linkedin: 'https://x', style: 'gradient' as const, accent: '#ff0033' };
    const result = ops.addContactClip(project, trackId, 0, brand);
    const clip = result.project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === result.clipId)!;
    expect(clip.contact).toMatchObject({ style: 'gradient', accent: '#ff0033', email: 'a@b.c' });
  });

  it('defaults to the glass style and blue accent when the brand kit has neither', () => {
    const { project, trackId } = withVideo();
    const result = ops.addContactClip(project, trackId, 0, { name: 'K', role: 'R', email: '', linkedin: '' });
    const clip = result.project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === result.clipId)!;
    expect(clip.contact).toMatchObject({ style: 'glass', accent: '#1f6feb' });
  });

  it('rejects a contact clip without contact properties', () => {
    const { project, trackId } = withVideo();
    const bad = createClip({ kind: 'contact', startTicks: 0, durationTicks: TICKS_PER_SECOND });
    const broken = { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [bad] } : t)) };
    expect(() => parseProject(JSON.parse(serializeProject(broken)))).toThrow(/no contact properties/);
  });
})

describe('editing moves for short-form and tutorial content', () => {
  it('adds a blur mask to the selected media clip', () => {
    const { project, clipId } = withVideo();
    const result = ops.addBlurBox(project, clipId);
    const clip = result.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;
    expect(clip.masks).toHaveLength(1);
    expect(clip.masks[0]).toMatchObject({ mode: 'blur' });
  });

  it('adds a zoom punch-in that returns to 1.0', () => {
    const { project, clipId } = withVideo();
    const result = ops.addPunchIn(project, clipId);
    const clip = result.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;
    const zoom = clip.keyframes.find((k) => k.target === 'zoom')!;
    expect(zoom.keyframes.map((k) => k.value)).toEqual([1, 1.2, 1]);
  });

  it('marks the terminal preset as a typewriter with monospace type', () => {
    const { project, trackId } = withVideo();
    const result = ops.addTitleClip(project, trackId, 0, 'kubectl get pods', 'terminal');
    const clip = result.project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === result.clipId)!;
    expect(clip.text?.typewriter).toBe(true);
    expect(clip.text?.fontFamily).toMatch(/monospace/);
  });

  it('adds thumbnail and metric presets as large centred text on the overlay track', () => {
    const { project, trackId } = withVideo();
    for (const preset of ['thumbnail', 'metric'] as const) {
      const result = ops.addTitleClip(project, trackId, 0, 'X', preset);
      const clip = result.project.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === result.clipId)!;
      expect(clip.kind).toBe('title');
      expect(clip.text?.align).toBe('center');
      expect(clip.text?.fontSize).toBeGreaterThanOrEqual(150);
    }
  });

  it('does not overwrite existing zoom keyframes when adding a punch-in', () => {
    const { project, trackId, clipId } = withVideo();
    const zoomed = ops.updateClip(project, clipId, {
      keyframes: [{ target: 'zoom', keyframes: [{ id: 'k1', atTicks: 0, value: 1, easing: 'linear' }, { id: 'k2', atTicks: sec(2), value: 2, easing: 'linear' }] }],
    });
    const result = ops.addPunchIn(zoomed, clipId);
    expect(result).toBe(zoomed);
    const clip = result.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.id === clipId)!;
    expect(clip.keyframes[0]?.keyframes.map((k) => k.value)).toEqual([1, 2]);
  });

  it('explains why punch-in and full camera cannot apply', () => {
    const { project, trackId, clipId } = withVideo();
    expect(ops.punchInBlockReason(project, clipId)).toBeNull();
    const zoomed = ops.updateClip(project, clipId, {
      keyframes: [{ target: 'zoom', keyframes: [{ id: 'k1', atTicks: 0, value: 1, easing: 'linear' }] }],
    });
    expect(ops.punchInBlockReason(zoomed, clipId)).toMatch(/zoom keyframes/);
    expect(ops.punchInBlockReason(project, 'missing')).toMatch(/Select a clip/);
    expect(ops.fullCameraBlockReason(project, 0, 0)).toMatch(/greater than zero/);
    const locked = { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, locked: true, clips: [createClip({ kind: 'media', assetId: 'cam', startTicks: 0, durationTicks: sec(10), presenter: { layout: 'bubble' } as never })] } : t)) };
    expect(ops.fullCameraBlockReason(locked, 0, sec(3))).toMatch(/locked/);
    const withCamera = { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, clips: [createClip({ kind: 'media', assetId: 'cam', startTicks: 0, durationTicks: sec(10), presenter: { layout: 'bubble' } as never })] } : t)) };
    expect(ops.fullCameraBlockReason(withCamera, 0, sec(3))).toBeNull();
  });

  it('adds an intro template with header, footer and hook on separate tracks', () => {
    const base = createProject({ name: 'I', width: 1920, height: 1080, id: 'proj_i', now: '2026-01-01T00:00:00.000Z' });
    const brand = { name: 'Kona Srinivas', role: 'DevOps', email: 'a@b.c', linkedin: 'https://x.y/z' };
    const project = { ...base, durationTicks: sec(10), brand };
    const result = ops.addIntroTemplate(project, brand, 'Hook line');
    expect(result.clipIds).toHaveLength(3);
    const names = result.project.tracks.filter((t) => t.kind === 'video').map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Header', 'Footer', 'Intro']));
    const all = result.project.tracks.flatMap((t) => t.clips);
    const kinds = result.clipIds.map((id) => all.find((c) => c.id === id)!.kind);
    expect(kinds).toEqual(['title', 'contact', 'title']);
  });

  it('cuts silent ranges and ripples later clips left', () => {
    const { project, trackId, clipId } = withVideo();
    const cut = ops.cutSilences(project, [{ startTicks: sec(1), endTicks: sec(2) }, { startTicks: sec(4), endTicks: sec(5) }]);
    const clip = cut.tracks.find((t) => t.id === trackId)!.clips.find((c) => c.startTicks === 0)!;
    expect(clip.id).toBeDefined();
    expect(cut.durationTicks).toBe(project.durationTicks - sec(2));
    expect(clipId).toBeDefined();
  });

  it('adds a zoom highlight inside the clip and refuses over existing zoom keys', () => {
    const { project, clipId } = withVideo();
    const zoomed = ops.addZoomHighlight(project, clipId, sec(1), sec(2), 1.3);
    const track = zoomed.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!.keyframes[0]!;
    expect(track.keyframes.map((k) => k.value)).toEqual([1, 1.3, 1.3, 1]);
    expect(ops.addZoomHighlight(zoomed, clipId, sec(1), sec(2))).toBe(zoomed);
  });

  it('blocks full camera with no camera clip in the span, and blur box on non-media', () => {
    const { project, trackId } = withVideo();
    expect(ops.fullCameraBlockReason(project, 0, sec(3))).toMatch(/No camera clip/);
    const title = ops.addTitleClip(project, trackId, 0, 'T', 'title');
    expect(ops.blurBoxBlockReason(title.project, title.clipId)).toMatch(/media clips only/);
    expect(ops.blurBoxBlockReason(project, null)).toMatch(/Select a clip/);
  });

  it('puts the intro hook on its own track and leaves Overlays untouched', () => {
    const base = createProject({ name: 'I2', width: 1920, height: 1080, id: 'proj_i2', now: '2026-01-01T00:00:00.000Z' });
    const brand = { name: 'K', role: 'D', email: 'a@b.c', linkedin: 'https://x.y/z' };
    const withOverlay = ops.addTitleClip({ ...base, durationTicks: sec(10) }, (base.tracks.find((t) => t.kind === 'video') ?? base.tracks[0]!).id, 0, 'Existing', 'title', sec(3));
    const overlayTrack = withOverlay.project.tracks.find((t) => t.clips.some((c) => c.id === withOverlay.clipId))!;
    const intro = ops.addIntroTemplate(withOverlay.project, brand, 'Hook');
    const kept = intro.project.tracks.find((t) => t.id === overlayTrack.id)!.clips.find((c) => c.id === withOverlay.clipId);
    expect(kept?.durationTicks).toBe(sec(3));
    expect(intro.project.tracks.some((t) => t.name === 'Intro')).toBe(true);
  });

  it('builds a description with a 0:00 first chapter and contact lines', () => {
    const brand = { name: 'Kona Srinivas', role: 'DevOps', email: 'a@b.c', linkedin: 'https://x.y/z' };
    const markers = [{ id: 'm1', atTicks: sec(65), label: 'Deploy' }] as never;
    const text = formatDescription(markers, brand);
    expect(text.split('\n')[0]).toBe('0:00 Intro');
    expect(text).toContain('1:05 Deploy');
    expect(text).toContain('Kona Srinivas · DevOps\na@b.c\nhttps://x.y/z');
    expect(formatDescription([{ id: 'm0', atTicks: 0, label: 'Start' }] as never).startsWith('0:00 Start')).toBe(true);
  });

  it('switches only the camera clip inside the span to full frame', () => {
    const base = createProject({ name: 'F', width: 1920, height: 1080, id: 'proj_f', now: '2026-01-01T00:00:00.000Z' });
    const trackId = base.tracks.find((t) => t.kind === 'video')!.id;
    const camera = createClip({ kind: 'media', assetId: 'cam', startTicks: 0, durationTicks: sec(10), presenter: { layout: 'bubble' } as never });
    const project = { ...base, durationTicks: sec(10), tracks: base.tracks.map((t) => (t.id === trackId ? { ...t, clips: [camera] } : t)) };
    const result = ops.fullCameraSpan(project, sec(2), sec(5));
    const layouts = result.tracks.flatMap((t) => t.clips).sort((a, b) => a.startTicks - b.startTicks).map((c) => c.presenter?.layout);
    expect(layouts).toEqual(['bubble', 'full', 'bubble']);
  });
});
