import { describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND } from '../src/core/time';
import {
  ALPHA_MASK_SHAPES,
  BOUNDARY_TRANSITIONS,
  CAPTION_STYLES,
  CINEMATIC_LUTS,
  COLOR_FILTERS,
  EMPHASIS_STYLES,
  FONT_FAMILIES,
  PLATFORM_WORKFLOW_PRESETS,
  SPEED_CURVE_PROFILES,
  TEXT_ANIMATIONS,
  TEXT_STYLE_PRESETS,
  VIDEO_EFFECTS,
  audioMsToTicks,
  normalizeCanvasPoint,
  normalizeHexColor,
  normalizeRotationDeg,
  timelineSecondsToTicks,
  ticksToAudioMs,
  ticksToTimelineSeconds,
} from '../src/effects/catalog';
import { PRESETS, presetById } from '../src/export/presets';
import { createClip, createProject, createTrack } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { useEditor } from '../src/project/store';
import { renderFrame } from '../src/render/compose';
import { clipOpacity, instantaneousSpeed, sourceTicks } from '../src/render/compositorQuery';
import type { Ctx2D } from '../src/render/text';

function makeMockCtx(): Ctx2D {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  return {
    canvas: { width: 1920, height: 1080 } as unknown as HTMLCanvasElement,
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    setLineDash: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 14 } as TextMetrics),
    createLinearGradient: vi.fn(() => gradient),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16) } as unknown as ImageData)),
    putImageData: vi.fn(),
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    filter: 'none',
    font: '16px Inter',
    textAlign: 'center',
    textBaseline: 'middle',
    imageSmoothingEnabled: true,
  } as unknown as Ctx2D;
}

function makeSeededProject() {
  let project = createProject({ name: 'Effects Suite Project' });
  const asset = {
    id: 'asset_demo_vid',
    name: 'demo.mp4',
    kind: 'video' as const,
    path: 'media/demo.mp4',
    durationTicks: 10 * TICKS_PER_SECOND,
    width: 1920,
    height: 1080,
    origin: 'recorded' as const,
    createdAt: '2026-11-07T00:00:00.000Z',
  };
  project.assets.push(asset);
  const videoTrack = project.tracks.find((t) => t.kind === 'video')!;
  const mediaClip = createClip({
    kind: 'media',
    assetId: asset.id,
    startTicks: 0,
    durationTicks: 6 * TICKS_PER_SECOND,
  });
  project = ops.placeClip(project, videoTrack.id, mediaClip, 'overwrite');
  const overlayTrack = createTrack('video', 'Overlays');
  project = ops.addTrack(project, overlayTrack);
  const titleRes = ops.addTitleClip(project, overlayTrack.id, 0, 'Hello Kubernetes World');
  project = titleRes.project;
  return { project, mediaClipId: mediaClip.id, titleClipId: titleRes.clipId, assetId: asset.id };
}

describe('Full Suite of Video, Text, Motion & Color Editing Effects and Tools', () => {
  it('exposes exact catalog counts matching specifications', () => {
    expect(VIDEO_EFFECTS).toHaveLength(148);
    expect(BOUNDARY_TRANSITIONS).toHaveLength(51);
    expect(COLOR_FILTERS).toHaveLength(77);
    expect(CINEMATIC_LUTS).toHaveLength(16);
    expect(TEXT_ANIMATIONS).toHaveLength(77);
    expect(TEXT_STYLE_PRESETS).toHaveLength(34);
    expect(FONT_FAMILIES).toHaveLength(406);
    expect(EMPHASIS_STYLES).toHaveLength(5);
    expect(CAPTION_STYLES).toHaveLength(39);
    expect(SPEED_CURVE_PROFILES).toHaveLength(8);
    expect(ALPHA_MASK_SHAPES).toHaveLength(5);
  });

  it('1. Core Video Effects & Dynamic Motion (148 Video Effects) — applyEffect & neutral none', () => {
    const { project, mediaClipId, assetId } = makeSeededProject();
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_handheld')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_handheld_zoom')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_handheld_flash')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_shake')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_super_shake')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_steady_in')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_steady_out')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_drift_up')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_drift_down')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_roll')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_spin')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_flip')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_bounce')).toBe(true);
    expect(VIDEO_EFFECTS.some((e) => e.id === 'video_wavy')).toBe(true);

    const p1 = ops.applyEffect(project, mediaClipId, 'video_super_shake');
    expect(ops.findClipById(p1, mediaClipId)?.effects.videoEffect).toBe('video_super_shake');

    const ctx = makeMockCtx();
    renderFrame(ctx, p1, {
      timeTicks: Math.round(0.5 * TICKS_PER_SECOND),
      lookup: (id) => (id === assetId ? { image: {} as CanvasImageSource, width: 1920, height: 1080 } : null),
    });
    expect(ctx.drawImage).toHaveBeenCalled();

    // Neutral state: 'none'
    const cleared = ops.applyEffect(p1, mediaClipId, 'none');
    expect(ops.findClipById(cleared, mediaClipId)?.effects.videoEffect).toBe('none');
  });

  it('2. Boundary Video Transitions (51 Filters) — addTransition & neutral normal', () => {
    const { project, mediaClipId } = makeSeededProject();
    const p1 = ops.addTransition(project, mediaClipId, 'whip_pan_left');
    const clip = ops.findClipById(p1, mediaClipId)!;
    expect(clip.transitionIn.type).toBe('whip_pan_left');
    expect(clip.transitionIn.durationTicks).toBeGreaterThan(0);

    // Removal/neutral state: 'normal'
    const cleared = ops.addTransition(p1, mediaClipId, 'normal');
    const clearedClip = ops.findClipById(cleared, mediaClipId)!;
    expect(clearedClip.transitionIn.type).toBe('none');
    expect(clearedClip.transitionIn.durationTicks).toBe(0);
    expect(clipOpacity(clearedClip, 10)).toBe(1);
  });

  it('3. Color Grading Filters (77) & Cinematic 3D LUTs (16) — applyFilter, applyLUT & adjustmentLayer', () => {
    const { project, mediaClipId, assetId } = makeSeededProject();
    const graded = ops.applyFilter(project, mediaClipId, 'Cyberpunk Teal & Orange');
    const clip = ops.findClipById(graded, mediaClipId)!;
    expect(clip.effects.colorFilter).toBe('cyberpunk_teal_and_orange');
    expect(clip.effects.contrast).toBeGreaterThan(0);

    // Neutral state: 'normal'
    const neutral = ops.applyFilter(graded, mediaClipId, 'normal');
    expect(ops.findClipById(neutral, mediaClipId)?.effects.colorFilter).toBe('normal');
    expect(ops.findClipById(neutral, mediaClipId)?.effects.contrast).toBe(0);

    // Apply 3D LUT to video clip and to Adjustment Layer
    const withLut = ops.applyLUT(neutral, mediaClipId, 'hollywood_blockbuster');
    expect(ops.findClipById(withLut, mediaClipId)?.effects.lut).toBe('hollywood_blockbuster');

    const adj = ops.addAdjustmentLayer(withLut, 0, 3 * TICKS_PER_SECOND, 'kodachrome_64_vintage');
    const adjClip = ops.findClipById(adj.project, adj.clipId)!;
    expect(adjClip.kind).toBe('adjustment');
    expect(adjClip.effects.lut).toBe('kodachrome_64_vintage');

    const ctx = makeMockCtx();
    renderFrame(ctx, adj.project, {
      timeTicks: Math.round(0.5 * TICKS_PER_SECOND),
      lookup: (id) => (id === assetId ? { image: {} as CanvasImageSource, width: 1920, height: 1080 } : null),
    });
    // Built-in cinematic looks stay on the stylized split-tone path; imported
    // .cube lattices are the ones graded on real pixels (see colorGrading.test.ts).
    expect(ctx.createLinearGradient).toHaveBeenCalled();
  });

  it('4. Kinetic Typography (77 Animations, 34 Presets, 406 Fonts, 5 Emphasis Styles)', () => {
    const { project, titleClipId } = makeSeededProject();
    let p = ops.setTextAnimation(project, titleClipId, 'Karaoke Word Reveal');
    expect(ops.findClipById(p, titleClipId)?.text?.animation).toBe('karaoke_word_reveal');

    p = ops.applyTextPreset(p, titleClipId, 'Neon Cyber Glow');
    const styledText = ops.findClipById(p, titleClipId)!.text!;
    expect(styledText.stylePreset).toBe('neon_cyber_glow');
    expect(styledText.gradientToColor).toBe('#00BBF9');
    expect(styledText.glowBlur).toBeGreaterThan(0);

    p = ops.setTextFont(p, titleClipId, 'JetBrains Mono');
    expect(ops.findClipById(p, titleClipId)?.text?.fontFamily).toBe('JetBrains Mono');

    for (const style of ['highlight', 'underline', 'circle', 'sparkle', 'strikethrough'] as const) {
      p = ops.setEmphasis(p, titleClipId, style);
      expect(ops.findClipById(p, titleClipId)?.text?.emphasis).toBe(style);
      const ctx = makeMockCtx();
      renderFrame(ctx, p, {
        timeTicks: Math.round(0.5 * TICKS_PER_SECOND),
        lookup: () => null,
      });
      expect(ctx.fillText).toHaveBeenCalled();
    }
  });

  it('5. Automated Subtitles & Caption Styles (39 Styles) — setCaptionStyle', () => {
    const { project } = makeSeededProject();
    const p1 = ops.setCaptionStyle(project, 'mrbeast_boxed_highlight');
    expect(p1.captionStyle.preset).toBe('mrbeast_boxed_highlight');
    expect(p1.captionStyle.wordHighlight).toBe(true);
    expect(p1.captionStyle.uppercase).toBe(true);

    const p2 = ops.setCaptionStyle(p1, 'tiktok_reels_pop');
    expect(p2.captionStyle.preset).toBe('tiktok_reels_pop');
    expect(p2.captionStyle.wordHighlightColor).toBe('#ff007f');
  });

  it('6. Time Remapping & Speed Curves (8 Curve Profiles) — selectSpeedPanelPreset & sourceTicks', () => {
    const { project, mediaClipId } = makeSeededProject();
    const pBullet = ops.selectSpeedPanelPreset(project, mediaClipId, 'Bullet Time');
    const clip = ops.findClipById(pBullet, mediaClipId)!;
    expect(clip.speedCurve).toBe('bullet_time');
    expect(clip.audio.preservePitch).toBe(true);

    // At clip midpoint (u = 0.5), Bullet Time drops to 0.25x while start (u = 0) is 1.5x
    const startVel = instantaneousSpeed(clip, clip.startTicks);
    const midVel = instantaneousSpeed(clip, clip.startTicks + Math.round(clip.durationTicks * 0.5));
    expect(startVel).toBeCloseTo(1.5, 2);
    expect(midVel).toBeCloseTo(0.25, 2);
    expect(sourceTicks(clip, clip.startTicks + Math.round(clip.durationTicks * 0.5))).toBeGreaterThan(0);
  });

  it('7. Alpha Masking & Compositing (5 Shapes) — setMask with feather & invert', () => {
    const { project, mediaClipId, assetId } = makeSeededProject();
    for (const shape of ['rectangle', 'circle', 'star', 'heart', 'split-screen'] as const) {
      const masked = ops.setMask(project, mediaClipId, shape, {
        feather: 0.25,
        invert: true,
        x: 0.5,
        y: 0.5,
        scaleX: 0.7,
        scaleY: 0.7,
      });
      const clip = ops.findClipById(masked, mediaClipId)!;
      expect(clip.alphaMask?.shape).toBe(shape);
      expect(clip.alphaMask?.feather).toBe(0.25);
      expect(clip.alphaMask?.invert).toBe(true);

      const ctx = makeMockCtx();
      renderFrame(ctx, masked, {
        timeTicks: Math.round(0.2 * TICKS_PER_SECOND),
        lookup: (id) => (id === assetId ? { image: {} as CanvasImageSource, width: 1920, height: 1080 } : null),
      });
      expect(ctx.clip).toHaveBeenCalled();
    }

    const unmasked = ops.setMask(project, mediaClipId, 'none');
    expect(ops.findClipById(unmasked, mediaClipId)?.alphaMask).toBeUndefined();
  });

  it('8. Coordinate System, Rotation, Time & Color Invariants + Store Bindings', () => {
    expect(normalizeCanvasPoint(1.4, -0.2)).toEqual({ x: 1, y: 0 });
    expect(normalizeRotationDeg(-90)).toBe(270);
    expect(normalizeRotationDeg(450)).toBe(90);
    const twoSecTicks = timelineSecondsToTicks(2.5);
    expect(ticksToTimelineSeconds(twoSecTicks)).toBeCloseTo(2.5, 5);
    expect(ticksToAudioMs(twoSecTicks)).toBeCloseTo(2500, 3);
    expect(audioMsToTicks(2500)).toBe(twoSecTicks);
    expect(normalizeHexColor('#0f8')).toBe('#00FF88');
    expect(normalizeHexColor('#11223344')).toBe('#11223344');

    // Verify store-bound tool actions
    const { project, mediaClipId, titleClipId } = makeSeededProject();
    useEditor.getState().loadProject(project);
    useEditor.getState().selectClips([mediaClipId]);
    useEditor.getState().applyEffect('video_handheld');
    useEditor.getState().addTransition('fade');
    useEditor.getState().applyFilter('Warm Glow');
    useEditor.getState().applyLUT('rec709_standard');
    useEditor.getState().selectSpeedPanelPreset('Flash In');
    useEditor.getState().setMask('circle');

    const updatedMedia = ops.findClipById(useEditor.getState().project!, mediaClipId)!;
    expect(updatedMedia.effects.videoEffect).toBe('video_handheld');
    expect(updatedMedia.transitionIn.type).toBe('fade');
    expect(updatedMedia.effects.colorFilter).toBe('warm_glow');
    expect(updatedMedia.effects.lut).toBe('rec709_standard');
    expect(updatedMedia.speedCurve).toBe('flash_in');
    expect(updatedMedia.alphaMask?.shape).toBe('circle');

    useEditor.getState().selectClips([titleClipId]);
    useEditor.getState().setTextAnimation('Typewriter');
    useEditor.getState().applyTextPreset('Viral Creator Gold');
    useEditor.getState().setTextFont('Montserrat');
    useEditor.getState().setEmphasis('sparkle');
    useEditor.getState().setCaptionStyle('hormozi-pop');

    const updatedTitle = ops.findClipById(useEditor.getState().project!, titleClipId)!;
    expect(updatedTitle.text?.animation).toBe('typewriter');
    expect(updatedTitle.text?.stylePreset).toBe('viral_hormozi_gold');
    expect(updatedTitle.text?.fontFamily).toBe('Montserrat');
    expect(updatedTitle.text?.emphasis).toBe('sparkle');
    expect(useEditor.getState().project?.captionStyle.preset).toBe('hormozi-pop');
  });

  it('9. YouTube, Instagram & LinkedIn Presets — full workflow & export compatibility across 16:9, 9:16, 4:5, and 1:1', () => {
    expect(PLATFORM_WORKFLOW_PRESETS).toHaveLength(12);
    expect(PLATFORM_WORKFLOW_PRESETS.filter((p) => p.platform === 'youtube')).toHaveLength(4);
    expect(PLATFORM_WORKFLOW_PRESETS.filter((p) => p.platform === 'instagram')).toHaveLength(4);
    expect(PLATFORM_WORKFLOW_PRESETS.filter((p) => p.platform === 'linkedin')).toHaveLength(4);

    // Every platform workflow preset maps to a valid export preset and renders cleanly with all effects & masks
    for (const preset of PLATFORM_WORKFLOW_PRESETS) {
      const delivery = presetById(preset.exportPresetId as Parameters<typeof presetById>[0]);
      expect(delivery).toBeDefined();
      expect(delivery?.width).toBe(preset.width);
      expect(delivery?.height).toBe(preset.height);

      const { project, mediaClipId, titleClipId, assetId } = makeSeededProject();
      let configured = ops.applyPlatformPreset(project, preset.id);
      expect(configured.canvas.width).toBe(preset.width);
      expect(configured.canvas.height).toBe(preset.height);
      expect(configured.captionStyle.preset).toBe(preset.captionStyleId);

      // Combine with alpha mask, speed curve, and emphasis to verify 100% cross-compatibility
      configured = ops.setMask(configured, mediaClipId, 'circle', { feather: 0.15, invert: false });
      configured = ops.selectSpeedPanelPreset(configured, mediaClipId, 'Montage Ramp');
      configured = ops.setEmphasis(configured, titleClipId, 'highlight');

      const ctx = makeMockCtx();
      renderFrame(ctx, configured, {
        timeTicks: Math.round(0.4 * TICKS_PER_SECOND),
        lookup: (id) => (id === assetId ? { image: {} as CanvasImageSource, width: 1920, height: 1080 } : null),
      });
      expect(ctx.drawImage).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled();
    }

    // Verify dedicated LinkedIn, Instagram, and YouTube export presets exist in PRESETS
    expect(PRESETS.some((p) => p.id === 'youtube-4k-longform')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'youtube-1080p-hd')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'youtube-shorts')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'insta-reels')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'insta-portrait-4x5')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'insta-square-1080')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'linkedin-feed-1080p')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'linkedin-square-1080')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'linkedin-portrait-4x5')).toBe(true);
    expect(PRESETS.some((p) => p.id === 'linkedin-vertical-9x16')).toBe(true);
  });
});
