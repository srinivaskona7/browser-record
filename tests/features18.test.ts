import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClip, createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { parseProject, serializeProject } from '../src/project/serialize';
import { scanFrameForSecretRegions, scanProjectTextSecrets, scanTextForSecrets } from '../src/project/secretScan';
import { renderFrame } from '../src/render/compose';
import type { Ctx2D } from '../src/render/text';
import { beforeAfterRegions, diagramRevealProgress, endScreenZone } from '../src/render/layout';
import { PRESETS, planBitrate, presetById } from '../src/export/presets';
import { TICKS_PER_SECOND, type Tick } from '../src/core/time';

const sec = (n: number): Tick => Math.round(n * TICKS_PER_SECOND);

function withVisualAssets(project = createProject({ name: 'DevOps Lesson' })) {
  const screenAsset = {
    id: 'asset_screen',
    name: 'terminal.webm',
    kind: 'video' as const,
    path: 'media/terminal.webm',
    durationTicks: sec(30),
    width: 1920,
    height: 1080,
    sizeBytes: 1024,
    mimeType: 'video/webm',
    hasAudio: true,
    origin: 'recorded' as const,
    createdAt: '2026-11-05T00:00:00.000Z',
  };
  const diagramAsset = {
    id: 'asset_diagram',
    name: 'k8s-arch.png',
    kind: 'image' as const,
    path: 'media/k8s-arch.png',
    durationTicks: sec(5),
    width: 1600,
    height: 900,
    sizeBytes: 512,
    mimeType: 'image/png',
    hasAudio: false,
    origin: 'imported' as const,
    createdAt: '2026-11-05T00:00:00.000Z',
  };
  const withAssets = { ...project, assets: [screenAsset, diagramAsset] };
  const screenTrackId = withAssets.tracks.find((t) => t.name === 'Screen')!.id;
  return ops.addAssetClip(withAssets, screenTrackId, 'asset_screen', 0).project;
}

describe('18 YouTube/Instagram DevOps features', () => {
  it('1 & 9. jump-cuts silences (cutSilences) and speed-ramps idle sections (speedRampRanges)', () => {
    const base = withVisualAssets();
    const cut = ops.cutSilences(base, [{ startTicks: sec(5), endTicks: sec(10) }]);
    expect(cut.durationTicks).toBe(sec(25));

    // Speed ramp 10s idle section [10s..20s] at 2.5x -> becomes 4s (saves 6s, total 30 - 6 = 24s)
    const ramped = ops.speedRampRanges(base, [{ startTicks: sec(10), endTicks: sec(20) }], 2.5);
    expect(ramped.durationTicks).toBe(sec(24));
    const screenClips = ramped.tracks.find((t) => t.name === 'Screen')!.clips;
    expect(screenClips).toHaveLength(3);
    expect(screenClips[1]!.speed).toBe(2.5);
    expect(screenClips[1]!.durationTicks).toBe(sec(4));
  });

  it('2 & 14. reframes to 9:16 vertical and supports presenter-following panX keyframes', () => {
    let base = withVisualAssets();
    const camTrackId = base.tracks.find((t) => t.name === 'Camera')!.id;
    const camClip = createClip({
      kind: 'media',
      assetId: 'asset_screen',
      startTicks: 0,
      durationTicks: sec(15),
      presenter: {
        layout: 'bubble',
        corner: 'bottom-left',
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
    base = ops.placeClip(base, camTrackId, camClip, 'overwrite');

    const vertical = ops.reframe9x16(base);
    expect(vertical.canvas.width).toBe(1080);
    expect(vertical.canvas.height).toBe(1920);
    const updatedCam = vertical.tracks.find((t) => t.id === camTrackId)!.clips[0]!;
    expect(updatedCam.presenter?.shape).toBe('portrait');

    const follow = ops.reframeFollowPresenter(base);
    expect(follow.canvas.width).toBe(1080);
    expect(follow.canvas.height).toBe(1920);
    const screenClip = follow.tracks.find((t) => t.name === 'Screen')!.clips[0]!;
    const panXTrack = screenClip.keyframes.find((k) => k.target === 'panX');
    expect(panXTrack).toBeDefined();
    expect(panXTrack!.keyframes.length).toBeGreaterThanOrEqual(2);
  });

  it('3 & 16. computes 20s end-screen zones and places an auto end-screen clip', () => {
    const zones = endScreenZone({ width: 1920, height: 1080 });
    expect(zones.windowSeconds).toBe(20);
    expect(zones.leftVideo.x).toBeLessThan(zones.rightVideo.x);
    expect(zones.subscribe.width).toBeGreaterThan(0);

    const base = withVisualAssets();
    const { project: withEnd, clipId } = ops.addEndScreen(base);
    const endClip = ops.findClip(withEnd, clipId);
    expect(endClip?.kind).toBe('endscreen');
    expect(endClip?.durationTicks).toBe(sec(20));
    expect(endClip?.startTicks).toBe(sec(10));
    expect(endClip?.endScreen?.showSubscribe).toBe(true);

    const roundTrip = parseProject(serializeProject(withEnd));
    expect(ops.findClip(roundTrip, clipId)?.endScreen?.leftTitle).toBe('Next lesson');
  });

  it('4 & 10. supports code line highlights and CLI ($ prompt + output) preset', () => {
    expect(ops.parseHighlightLines('1, 3-5, 3')).toEqual([1, 3, 4, 5]);
    expect(ops.formatHighlightLines([1, 3, 4])).toBe('1, 3, 4');

    const base = createProject({ name: 'Code' });
    const trackId = base.tracks[0]!.id;
    const { project: withCode, clipId } = ops.addTitleClip(
      base,
      trackId,
      0,
      `$ helm upgrade --install api ./chart
    Release "api" has been upgraded.`,
      'cli',
    );
    const cliClip = ops.findClip(withCode, clipId)!;
    expect(cliClip.text?.cliMode).toBe(true);

    const highlighted = ops.setCodeHighlightLines(withCode, clipId, [1]);
    expect(ops.findClip(highlighted, clipId)?.text?.highlightLines).toEqual([1]);
  });

  it('5. reports zoomHighlightBlockReason and adds zoom highlight keyframes', () => {
    const base = withVisualAssets();
    expect(ops.zoomHighlightBlockReason(base, null)).toMatch(/Select a clip/);
    const screenClipId = base.tracks.find((t) => t.name === 'Screen')!.clips[0]!.id;
    expect(ops.zoomHighlightBlockReason(base, screenClipId)).toBeNull();

    const zoomed = ops.addZoomHighlight(base, screenClipId, sec(2), sec(4), 1.4);
    expect(ops.zoomHighlightBlockReason(zoomed, screenClipId)).toMatch(/already has zoom keyframes/);
  });

  it('6. places B-roll picture-in-picture on a dedicated B-Roll overlay track', () => {
    const base = withVisualAssets();
    expect(ops.brollPipBlockReason(base, null)).toMatch(/Select/);
    expect(ops.brollPipBlockReason(base, 'asset_diagram')).toBeNull();

    const { project: withBroll, clipId } = ops.addBrollPip(base, 'asset_diagram', sec(3), sec(4));
    const brollTrack = withBroll.tracks.find((t) => t.name === 'B-Roll');
    expect(brollTrack).toBeDefined();
    const clip = ops.findClip(withBroll, clipId)!;
    expect(clip.transform.scale).toBeCloseTo(0.42);
    expect(clip.audio.muted).toBe(true);
    // Screen clip underneath is untouched
    expect(withBroll.tracks.find((t) => t.name === 'Screen')!.clips).toHaveLength(1);
  });

  it('7. scans text/frames for candidate secrets (experimental) and adds blur masks', () => {
    const textMatches = scanTextForSecrets(
      `export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
api_key = "super_secret_token_value_123"`,
    );
    expect(textMatches.length).toBeGreaterThanOrEqual(2);
    expect(textMatches[0]!.preview).toContain('••••');

    const base = withVisualAssets();
    const screenClipId = base.tracks.find((t) => t.name === 'Screen')!.clips[0]!.id;
    const withTitle = ops.addTitleClip(base, base.tracks[0]!.id, 0, 'token: ghp_1234567890abcdefghijklmnopqrstuv').project;
    expect(scanProjectTextSecrets(withTitle).length).toBeGreaterThanOrEqual(1);

    // Synthetic frame with alternating dark/bright pixels on row 2
    const width = 100;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let x = 10; x < 80; x += 1) {
      const val = x % 2 === 0 ? 240 : 10;
      const idx = (5 * width + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
    const regions = scanFrameForSecretRegions({ width, height, data });
    expect(regions.length).toBeGreaterThanOrEqual(1);

    const blurred = ops.autoBlurSecretsOnClip(base, screenClipId, regions);
    expect(ops.findClip(blurred, screenClipId)!.masks.length).toBe(regions.length);
  });

  it('8. applies DevOps terminal, short-form pop, and minimal-pill caption presets', () => {
    const project = createProject({ name: 'Captions' });
    const devops = ops.applyCaptionPreset(project.captionStyle, 'devops-terminal');
    expect(devops.preset).toBe('devops-terminal');
    expect(devops.fontFamily).toContain('monospace');

    const pop = ops.applyCaptionPreset(project.captionStyle, 'hormozi-pop');
    expect(pop.uppercase).toBe(true);
    expect(pop.wordHighlight).toBe(true);

    const pill = ops.applyCaptionPreset(project.captionStyle, 'minimal-pill');
    expect(pill.backgroundOpacity).toBeCloseTo(0.85);
  });

  it('11. creates a Before / After split layout across two media assets', () => {
    const base = withVisualAssets();
    const regions = beforeAfterRegions({ width: 1920, height: 1080 });
    expect(regions.left.width).toBeCloseTo(regions.right.width);
    expect(regions.dividerX).toBe(960);

    const { project: split, clipIds } = ops.addBeforeAfterSplit(base, 'asset_screen', 'asset_diagram', sec(2), sec(5));
    expect(clipIds).toHaveLength(3);
    expect(split.tracks.some((t) => t.name === 'Before')).toBe(true);
    expect(split.tracks.some((t) => t.name === 'After')).toBe(true);
  });

  it('13. provides a Shorts/Reels export preset (1080x1920, 60s cap, size check)', () => {
    const shorts = presetById('shorts-vertical');
    expect(shorts).toBeDefined();
    expect(shorts!.width).toBe(1080);
    expect(shorts!.height).toBe(1920);
    expect(shorts!.maxDurationSeconds).toBe(60);
    expect(PRESETS.some((p) => p.id === 'shorts-vertical')).toBe(true);

    const overDuration = planBitrate({
      durationSeconds: 75,
      width: 1080,
      height: 1920,
      fps: 30,
      audioBitrate: 128_000,
      videoBitrate: 6_000_000,
      maxDurationSeconds: 60,
      maxBytes: 60_000_000,
    });
    expect(overDuration.warnings.some((w) => w.includes('60s Shorts/Reels cap'))).toBe(true);
  });

  it('15. builds marker segments for Shorts and extracts a vertical 9:16 segment', () => {
    const base = {
      ...withVisualAssets(),
      markers: [
        { id: 'm1', atTicks: sec(10), label: 'Build image', color: '#ffd166' },
        { id: 'm2', atTicks: sec(22), label: 'Deploy to cluster', color: '#ffd166' },
      ],
    };
    const segments = ops.markerSegments(base);
    expect(segments.map((s) => s.label)).toEqual(['Intro', 'Build image', 'Deploy to cluster']);
    expect(segments.every((s) => s.withinShortsCap)).toBe(true);

    const extracted = ops.extractSegmentProject(base, segments[1]!.startTicks, segments[1]!.endTicks, {
      reframeVertical: true,
    });
    expect(extracted.durationTicks).toBe(sec(12));
    expect(extracted.canvas.width).toBe(1080);
    expect(extracted.canvas.height).toBe(1920);
  });

  it('17. places an architecture diagram with step-by-step progressive reveal', () => {
    const base = withVisualAssets();
    const { project: withDiag, clipId } = ops.addDiagramReveal(base, 'asset_diagram', sec(1), 4, sec(8));
    const clip = ops.findClip(withDiag, clipId)!;
    expect(clip.effects.revealSteps).toBe(4);

    expect(diagramRevealProgress(0, sec(8), 4)).toEqual({ fraction: 0.25, currentStep: 1, totalSteps: 4 });
    expect(diagramRevealProgress(sec(2.1), sec(8), 4)).toEqual({ fraction: 0.5, currentStep: 2, totalSteps: 4 });
    expect(diagramRevealProgress(sec(7.9), sec(8), 4)).toEqual({ fraction: 1, currentStep: 4, totalSteps: 4 });
  });

  it('18. parses key chords and places a keyboard shortcut overlay clip', () => {
    expect(ops.parseKeyChord('Ctrl + Shift + P')).toEqual(['Ctrl', 'Shift', 'P']);
    const base = createProject({ name: 'IDE Walkthrough' });
    const { project: withKeys, clipId } = ops.addKeystrokeOverlay(base, sec(1), '⌘ + K', 'Clear terminal');
    const clip = ops.findClip(withKeys, clipId)!;
    expect(clip.kind).toBe('keystroke');
    expect(clip.keystroke?.keys).toEqual(['⌘', 'K']);
    expect(clip.keystroke?.label).toBe('Clear terminal');

    const roundTrip = parseProject(serializeProject(withKeys));
    expect(ops.findClip(roundTrip, clipId)?.keystroke?.keys).toEqual(['⌘', 'K']);
  });

  it('renders CLI prompt styling, code line highlights, keystroke keycaps, end screen, and 20s guide via renderFrame', () => {
    let project = withVisualAssets();
    const overlayTrack = ops.addTrack(project, {
      id: 'trk_cli',
      kind: 'video',
      name: 'CLI',
      clips: [],
      muted: false,
      hidden: false,
      locked: false,
      volume: 1,
      height: 54,
    });
    const addedCli = ops.addTitleClip(overlayTrack, 'trk_cli', 0, '$ kubectl get nodes\nnode-1 Ready', 'cli');
    project = ops.setCodeHighlightLines(addedCli.project, addedCli.clipId, [1]);
    project = ops.addKeystrokeOverlay(project, 0, 'Ctrl + C', 'Stop').project;
    project = ops.addEndScreen(project, 0, sec(20)).project;

    const fillTexts: string[] = [];
    const fillRects: Array<[number, number, number, number]> = [];
    const strokeRects: Array<[number, number, number, number]> = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      rect: () => {},
      clip: () => {},
      fill: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      setLineDash: () => {},
      fillRect: (x: number, y: number, w: number, h: number) => fillRects.push([x, y, w, h]),
      strokeRect: (x: number, y: number, w: number, h: number) => strokeRects.push([x, y, w, h]),
      fillText: (text: string) => fillTexts.push(text),
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 14 }),
      drawImage: () => {},
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '16px sans-serif',
      textAlign: 'left',
      textBaseline: 'middle',
      filter: 'none',
    } as unknown as Ctx2D;

    renderFrame(mockCtx, project, {
      timeTicks: sec(1),
      lookup: () => null,
      showEndScreenGuide: true,
      captionsEnabled: true,
    });

    expect(fillTexts).toContain('$ ');
    expect(fillTexts).toContain('kubectl get nodes');
    expect(fillTexts).toContain('Ctrl');
    expect(fillTexts).toContain('Stop');
    expect(fillTexts).toContain('Watch next');
    expect(fillTexts).toContain('SUBSCRIBE');
    expect(strokeRects.length).toBeGreaterThanOrEqual(3);
    expect(fillRects.length).toBeGreaterThan(2);
  });

  it('enforces public npm registry (https://registry.npmjs.org/) in .npmrc and package-lock.json', () => {
    const npmrc = readFileSync(resolve(process.cwd(), '.npmrc'), 'utf8');
    expect(npmrc).toContain('registry=https://registry.npmjs.org/');

    const lockfile = readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8');
    const resolvedUrls = [...lockfile.matchAll(/"resolved":\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(resolvedUrls.length).toBeGreaterThan(0);
    const nonPublic = resolvedUrls.filter((url) => !url.startsWith('https://registry.npmjs.org/'));
    expect(nonPublic).toEqual([]);
  });
});
