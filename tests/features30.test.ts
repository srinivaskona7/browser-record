import { describe, expect, it } from 'vitest';
import { createClip, createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { parseProject, serializeProject } from '../src/project/serialize';
import { SFX_PRESETS, encodeWavMono, synthesizeSfxSamples } from '../src/audio/sfx';
import { computeNormalizeGain, voicePresetOptions } from '../src/audio/chain';
import { PRESETS, presetById } from '../src/export/presets';
import { renderFrame } from '../src/render/compose';
import type { Ctx2D } from '../src/render/text';
import { TICKS_PER_SECOND, type Tick } from '../src/core/time';

const sec = (n: number): Tick => Math.round(n * TICKS_PER_SECOND);

function sampleProject() {
  const base = createProject({ name: 'YouTube & Insta Master' });
  const videoAsset = {
    id: 'asset_vid',
    name: 'demo.webm',
    kind: 'video' as const,
    path: 'media/demo.webm',
    durationTicks: sec(40),
    width: 1920,
    height: 1080,
    origin: 'recorded' as const,
    createdAt: '2026-11-05T00:00:00.000Z',
  };
  const audioAsset = {
    id: 'asset_music',
    name: 'lofi-bed.wav',
    kind: 'audio' as const,
    path: 'media/lofi-bed.wav',
    durationTicks: sec(60),
    sampleRate: 48_000,
    channels: 2,
    origin: 'imported' as const,
    createdAt: '2026-11-05T00:00:00.000Z',
  };
  const withAssets = { ...base, assets: [videoAsset, audioAsset] };
  const screenId = withAssets.tracks.find((t) => t.name === 'Screen')!.id;
  return ops.addAssetClip(withAssets, screenId, 'asset_vid', 0).project;
}

describe('30 YouTube & Instagram creator editing, layer, sound, look & social features', () => {
  it('1–5. Layer blend modes, PiP placement presets, shadow/glow presets, solo/unmute, and magnetic gap closer', () => {
    let project = sampleProject();
    const screenTrack = project.tracks.find((t) => t.name === 'Screen')!;
    const clipId = screenTrack.clips[0]!.id;

    // 1. Blend mode
    project = ops.setClipBlendMode(project, clipId, 'screen');
    expect(ops.findClip(project, clipId)?.transform.blendMode).toBe('screen');

    // 2. PiP placement preset
    project = ops.applyPipPreset(project, clipId, 'top-left');
    expect(ops.findClip(project, clipId)?.transform.x).toBeCloseTo(0.24);
    expect(ops.findClip(project, clipId)?.transform.scale).toBeCloseTo(0.38);

    // 3. Shadow / glow preset
    project = ops.applyShadowGlowPreset(project, clipId, 'neon-cyan');
    expect(ops.findClip(project, clipId)?.transform.borderColor).toBe('#39d0d8');
    expect(ops.findClip(project, clipId)?.transform.shadow).toBe(36);

    // 4. Solo & unmute tracks
    project = ops.soloTrack(project, screenTrack.id);
    expect(project.tracks.find((t) => t.id === screenTrack.id)?.muted).toBe(false);
    expect(project.tracks.filter((t) => t.id !== screenTrack.id).every((t) => t.muted)).toBe(true);
    project = ops.unmuteAllTracks(project);
    expect(project.tracks.every((t) => !t.muted && !t.hidden)).toBe(true);

    // 5. Magnetic gap closer
    const secondClip = createClip({ kind: 'media', assetId: 'asset_vid', startTicks: sec(50), durationTicks: sec(10) });
    project = ops.placeClip(project, screenTrack.id, secondClip, 'overwrite');
    project = ops.closeTrackGaps(project, screenTrack.id);
    const clipsAfter = project.tracks.find((t) => t.id === screenTrack.id)!.clips;
    expect(clipsAfter[1]!.startTicks).toBe(sec(40));
  });

  it('6–10. Voice EQ presets, procedural SFX synthesis & WAV encoding, audio fades, music bed ducking, and gain normalization', () => {
    // 6. Voice presets
    const podcast = voicePresetOptions('podcast-warm');
    expect(podcast.enabled).toBe(true);
    expect(podcast.eq.length).toBeGreaterThanOrEqual(3);
    expect(voicePresetOptions('flat').enabled).toBe(false);

    let project = sampleProject();
    const clipId = project.tracks.find((t) => t.name === 'Screen')!.clips[0]!.id;
    project = ops.applyVoicePreset(project, 'broadcast-punch', clipId);
    expect(ops.findClip(project, clipId)?.audio.gain).toBeCloseTo(1.35);

    // 7. Procedural SFX synthesizer & WAV encoder
    expect(SFX_PRESETS).toHaveLength(6);
    for (const preset of SFX_PRESETS) {
      const samples = synthesizeSfxSamples(preset.id, 8000);
      expect(samples.length).toBeGreaterThan(100);
      const wav = encodeWavMono(samples, 8000);
      expect(String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!)).toBe('RIFF');
      expect(wav.byteLength).toBe(44 + samples.length * 2);
    }
    const addedSfx = ops.addProceduralSfxClip(project, 'whoosh', sec(3));
    expect(addedSfx.project.tracks.some((t) => t.name === 'SFX')).toBe(true);

    // 8. Smooth audio fades
    project = ops.applyAudioFades(addedSfx.project, 0.5, clipId);
    expect(ops.findClip(project, clipId)?.audio.fadeInTicks).toBe(sec(0.5));
    expect(ops.findClip(project, clipId)?.audio.fadeOutTicks).toBe(sec(0.5));

    // 9. Music bed + ducking
    const bed = ops.prepareMusicBedTrack(project, 'asset_music');
    expect(bed.project.settings.duckingEnabled).toBe(true);
    const musicTrack = bed.project.tracks.find((t) => t.id === bed.trackId)!;
    expect(musicTrack.volume).toBeCloseTo(0.25);
    expect(musicTrack.clips[0]!.audio.duckUnderVoice).toBe(true);

    // 10. Gain normalization
    expect(computeNormalizeGain(-7, -1)).toBeGreaterThan(1.9);
    const normalized = ops.normalizeClipGain(bed.project, clipId, 1.5);
    expect(ops.findClip(normalized, clipId)?.audio.gain).toBe(1.5);
  });

  it('11–15. Colour look presets, vignette, Screen Studio frame, progress bar overlay, and chapter bumpers', () => {
    let project = sampleProject();
    const clipId = project.tracks.find((t) => t.name === 'Screen')!.clips[0]!.id;

    // 11. Colour look preset
    project = ops.applyColorLookPreset(project, 'cinema-teal', clipId);
    expect(ops.findClip(project, clipId)?.effects.contrast).toBeCloseTo(0.14);
    expect(ops.findClip(project, clipId)?.effects.temperature).toBeCloseTo(-0.18);

    // 12. Vignette
    project = ops.setClipVignette(project, clipId, 0.45);
    expect(ops.findClip(project, clipId)?.effects.vignette).toBe(0.45);

    // 13. Screen Studio frame
    project = ops.applyScreenStudioFrame(project, clipId, 0.06, '#161b22');
    expect(ops.findClip(project, clipId)?.effects.backdropPadding).toBe(0.06);
    expect(ops.findClip(project, clipId)?.transform.scale).toBeCloseTo(0.88);

    // 14. Animated progress bar
    const withBar = ops.addProgressBarOverlay(project, 'top', '#ff0033');
    expect(ops.findClip(withBar.project, withBar.clipId)?.kind).toBe('progressbar');

    // 15. Chapter bumpers from markers
    const withMarkers = {
      ...withBar.project,
      markers: [
        { id: 'm1', atTicks: 0, label: 'Setup', color: '#ffd166' },
        { id: 'm2', atTicks: sec(15), label: 'Deploy', color: '#ffd166' },
      ],
    };
    const bumpers = ops.addChapterBumpersFromMarkers(withMarkers, 2.0);
    expect(bumpers.clipIds).toHaveLength(2);
    expect(ops.findClip(bumpers.project, bumpers.clipIds[0]!)?.text?.text).toContain('01 · Setup');
  });

  it('16–20. Batch transitions, Ken Burns drift, spotlight dimmer mask, click pulse, and camera corner cycling', () => {
    let project = sampleProject();
    const clipId = project.tracks.find((t) => t.name === 'Screen')!.clips[0]!.id;

    // 16. Batch transitions
    project = ops.applyTransitionToAllCuts(project, 'dissolve', 0.4);
    expect(ops.findClip(project, clipId)?.transitionOut.type).toBe('dissolve');

    // 17. Ken Burns slow drift
    project = ops.addKenBurnsDrift(project, clipId, 1.14);
    const kfs = ops.findClip(project, clipId)!.keyframes;
    expect(kfs.some((k) => k.target === 'zoom')).toBe(true);
    expect(kfs.some((k) => k.target === 'panX')).toBe(true);

    // 18. Spotlight dimmer mask
    project = ops.addSpotlightMask(project, clipId);
    expect(ops.findClip(project, clipId)!.masks.some((m) => m.mode === 'spotlight')).toBe(true);

    // 19. Click pulse overlay
    const pulse = ops.addClickPulse(project, sec(4), 0.6, 0.4);
    expect(ops.findClip(pulse.project, pulse.clipId)?.kind).toBe('pulse');

    // 20. Camera bubble corner cycling on markers
    const camTrackId = pulse.project.tracks.find((t) => t.name === 'Camera')!.id;
    const camClip = createClip({
      kind: 'media',
      assetId: 'asset_vid',
      startTicks: 0,
      durationTicks: sec(30),
      presenter: {
        layout: 'bubble',
        corner: 'bottom-right',
        size: 0.26,
        margin: 0.03,
        shape: 'circle',
        mirror: true,
        chromaKey: false,
        shadow: 24,
        border: 3,
        borderColor: '#ffffff',
      },
    });
    let withCam = ops.placeClip(pulse.project, camTrackId, camClip, 'overwrite');
    withCam = { ...withCam, markers: [{ id: 'mk1', atTicks: sec(15), label: 'Part 2', color: '#ffd166' }] };
    const cycled = ops.cycleCameraCornersOnMarkers(withCam);
    const camClips = cycled.tracks.find((t) => t.id === camTrackId)!.clips;
    expect(camClips).toHaveLength(2);
    expect(camClips[0]!.presenter?.corner).not.toBe(camClips[1]!.presenter?.corner);
  });

  it('21–25. Step badges, alert banners, social follow pills, topic tickers, and live countdown overlays', () => {
    let project = sampleProject();

    // 21. Step badge auto-increments
    const step1 = ops.addStepBadge(project, sec(1), undefined, 'Build container');
    expect(step1.step).toBe(1);
    const step2 = ops.addStepBadge(step1.project, sec(8), undefined, 'Push image');
    expect(step2.step).toBe(2);

    // 22. Alert banner
    const alert = ops.addAlertBanner(step2.project, sec(3), 'danger', 'Do not run in production');
    expect(ops.findClip(alert.project, alert.clipId)?.text?.text).toContain('DANGER');

    // 23. Social follow pill
    const social = ops.addSocialFollowPill(alert.project, sec(5), 'instagram', '@srinivas.devops');
    expect(ops.findClip(social.project, social.clipId)?.text?.text).toContain('Instagram');

    // 24. Topic ticker
    const ticker = ops.addTopicTicker(social.project, sec(0), 'K8S ZERO DOWNTIME');
    expect(ops.findClip(ticker.project, ticker.clipId)?.text?.text).toBe('K8S ZERO DOWNTIME');

    // 25. Countdown overlay + serialization round-trip
    const cd = ops.addCountdownOverlay(ticker.project, sec(2), 15, 'Rollout in');
    project = cd.project;
    expect(ops.findClip(project, cd.clipId)?.kind).toBe('countdown');
    const roundTrip = parseProject(serializeProject(project));
    expect(ops.findClip(roundTrip, cd.clipId)?.countdown?.seconds).toBe(15);
  });

  it('26–30. 1:1 & 4:5 Instagram reframes, social/master export presets, auto markers from captions, and pacing audit', () => {
    let project = sampleProject();

    // 26. 1:1 Square reframe
    const sq = ops.reframe1x1(project);
    expect(sq.canvas.width).toBe(1080);
    expect(sq.canvas.height).toBe(1080);

    // 27. 4:5 Portrait reframe
    const portrait = ops.reframe4x5(project);
    expect(portrait.canvas.width).toBe(1080);
    expect(portrait.canvas.height).toBe(1350);

    // 28. Instagram 1:1, 4:5 and 4K60 master export presets
    expect(presetById('insta-square-1080')?.width).toBe(1080);
    expect(presetById('insta-portrait-4x5')?.height).toBe(1350);
    expect(presetById('4k60-master')?.videoBitrate).toBe(18_000_000);
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);

    // 29. Auto markers from captions
    project = {
      ...project,
      captions: [
        { id: 'c1', startTicks: 0, endTicks: sec(4), text: 'Step 1: Set up the cluster' },
        { id: 'c2', startTicks: sec(15), endTicks: sec(19), text: 'How do we verify the pods?' },
        { id: 'c3', startTicks: sec(30), endTicks: sec(35), text: 'Finally, test the ingress endpoint' },
      ],
    };
    const withAutoMarkers = ops.generateMarkersFromCaptions(project, 10);
    expect(withAutoMarkers.markers.length).toBe(3);

    // 30. Video pacing audit
    const auditBefore = ops.auditVideoPacing(withAutoMarkers);
    expect(auditBefore.hasHookInFirst5s).toBe(false);
    expect(auditBefore.suggestions.length).toBeGreaterThan(0);

    const withHook = ops.addStepBadge(withAutoMarkers, sec(1)).project;
    const auditAfter = ops.auditVideoPacing(withHook);
    expect(auditAfter.hasHookInFirst5s).toBe(true);
    expect(auditAfter.score).toBeGreaterThan(auditBefore.score);
  });

  it('renders progressbar, pulse, countdown, spotlight mask, vignette, and backdropPadding in renderFrame', () => {
    let project = sampleProject();
    const screenClipId = project.tracks.find((t) => t.name === 'Screen')!.clips[0]!.id;
    project = ops.applyScreenStudioFrame(project, screenClipId, 0.06, '#161b22');
    project = ops.setClipVignette(project, screenClipId, 0.4);
    project = ops.addSpotlightMask(project, screenClipId);
    project = ops.addProgressBarOverlay(project, 'top', '#ff0033').project;
    project = ops.addClickPulse(project, 0, 0.5, 0.5).project;
    project = ops.addCountdownOverlay(project, 0, 10, 'Deploy in').project;

    const fillTexts: string[] = [];
    let arcCalls = 0;
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {
        arcCalls += 1;
      },
      rect: () => {},
      clip: () => {},
      fill: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      setLineDash: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: (text: string) => fillTexts.push(text),
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 12 }),
      drawImage: () => {},
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      font: '16px sans-serif',
      textAlign: 'left',
      textBaseline: 'middle',
      filter: 'none',
    } as unknown as Ctx2D;

    renderFrame(mockCtx, project, {
      timeTicks: sec(0.5),
      lookup: () => ({ image: {} as CanvasImageSource, width: 1920, height: 1080 }),
      captionsEnabled: true,
    });

    expect(arcCalls).toBeGreaterThanOrEqual(4);
    expect(fillTexts.some((t) => t.includes('Deploy in 00:10'))).toBe(true);
  });
});
