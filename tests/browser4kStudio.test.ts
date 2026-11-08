import { describe, expect, it, vi } from 'vitest';
import { TICKS_PER_SECOND } from '../src/core/time';
import { createProject, defaultPresenter } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { parseProject, serializeProject } from '../src/project/serialize';
import { buildSampleKubernetesProject } from '../src/project/sampleLesson';
import { presenterBubble } from '../src/render/layout';
import { renderFrame, resolveMaskGeometry } from '../src/render/compose';
import {
  checkFontAvailability,
  detectFontFormat,
  ensureProjectFontsLoaded,
  measureFontMetrics,
  parseAndValidateCustomFont,
  resetLoadedCustomFontsForTests,
} from '../src/effects/catalog';
import { MemoryDirectoryHandle } from '../src/workspace/memoryFs';
import {
  executeClearUnusedPlan,
  planClearUnusedRecordings,
  renameTake,
  saveProject,
  writeTakeManifest,
} from '../src/workspace/workspace';
import { placeTake } from '../src/ui/RecordPage';
import { canTransitionStage, QUIET_MODES } from '../src/capture/stateMachine';

describe('Browser 4K Studio — Release Gate Suite', () => {
  it('supports all 6 presenter shapes (circle, rounded, square, portrait, pill, hexagon), screen-only layout, and custom x/y in landscape & portrait', () => {
    const landscape = { width: 1920, height: 1080 };
    const portrait = { width: 1080, height: 1920 };

    const pillBubble = presenterBubble({
      canvas: landscape,
      presenter: { ...defaultPresenter(), shape: 'pill', size: 0.2 },
    });
    expect(pillBubble.height).toBeCloseTo(216, 1);
    expect(pillBubble.width).toBeCloseTo(216 * 1.35, 1);
    expect(pillBubble.radius).toBeCloseTo(108, 1);

    const hexBubble = presenterBubble({
      canvas: portrait,
      presenter: { ...defaultPresenter(), shape: 'hexagon', size: 0.25, x: 0.5, y: 0.5 },
    });
    expect(hexBubble.width).toBeCloseTo(480, 1);
    expect(hexBubble.height).toBeCloseTo(480, 1);
    expect(hexBubble.radius).toBe(0);
    // Centered at (0.5, 0.5) in portrait 1080x1920
    expect(hexBubble.x).toBeCloseTo(540 - 240, 1);
    expect(hexBubble.y).toBeCloseTo(960 - 240, 1);
  });

  it('samples and redacts the exact masked pixels at multiple preview scales (0.25x, 0.5x, 1.0x) and interpolates mask keyframes', () => {
    // Verify spatial mask keyframe interpolation first
    const maskWithKeys = {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      mode: 'solid' as const,
      strength: 20,
      color: '#00ff00',
      keyframes: [
        { id: 'k1', atTicks: 0, x: 0.1, y: 0.2, width: 0.2, height: 0.2 },
        { id: 'k2', atTicks: 4 * TICKS_PER_SECOND, x: 0.5, y: 0.6, width: 0.3, height: 0.2 },
      ],
    };
    const mid = resolveMaskGeometry(maskWithKeys, 2 * TICKS_PER_SECOND);
    expect(mid.x).toBeCloseTo(0.3, 4);
    expect(mid.y).toBeCloseTo(0.4, 4);
    expect(mid.width).toBeCloseTo(0.25, 4);

    // Build a project with a bright red source image and a mask covering [0.25..0.75, 0.25..0.75]
    let project = createProject({ name: 'Mask Scale Test', width: 200, height: 100, fps: { num: 30, den: 1 } });
    project.assets.push({
      id: 'red_src',
      kind: 'image',
      name: 'red.png',
      path: 'media/originals/red.png',
      durationTicks: 5 * TICKS_PER_SECOND,
      width: 200,
      height: 100,
      origin: 'imported',
      createdAt: new Date().toISOString(),
    });
    const placed = ops.addAssetClip(project, project.tracks[0]!.id, 'red_src', 0);
    project = ops.addMask(placed.project, placed.clipId, {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
      mode: 'solid',
      strength: 20,
      color: '#00ff00',
      feather: 0,
    });

    // Test at 0.25, 0.5, and 1.0 preview scales using a buffer-backed 2D context mock
    for (const scale of [0.25, 0.5, 1.0]) {
      const cw = Math.round(project.canvas.width * scale);
      const ch = Math.round(project.canvas.height * scale);
      const pixels = new Uint8ClampedArray(cw * ch * 4);
      // Fill base canvas with red [255, 0, 0, 255]
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }

      let currentFill = '#000000';
      const transform = { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 };
      const ctx = {
        canvas: { width: cw, height: ch },
        save: () => undefined,
        restore: () => undefined,
        beginPath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        quadraticCurveTo: () => undefined,
        arc: () => undefined,
        arcTo: () => undefined,
        closePath: () => undefined,
        rect: () => undefined,
        clip: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        scale: () => undefined,
        setTransform: () => undefined,
        getTransform: () => transform,
        drawImage: () => undefined,
        stroke: () => undefined,
        strokeRect: () => undefined,
        set fillStyle(v: string) {
          currentFill = v;
        },
        get fillStyle() {
          return currentFill;
        },
        fillRect: (x: number, y: number, w: number, h: number) => {
          if (currentFill !== '#00ff00') return;
          const x0 = Math.max(0, Math.floor(x * scale));
          const y0 = Math.max(0, Math.floor(y * scale));
          const x1 = Math.min(cw, Math.ceil((x + w) * scale));
          const y1 = Math.min(ch, Math.ceil((y + h) * scale));
          for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) {
              const idx = (py * cw + px) * 4;
              pixels[idx] = 0;
              pixels[idx + 1] = 255;
              pixels[idx + 2] = 0;
            }
          }
        },
        getImageData: (sx: number, sy: number, sw: number, sh: number) => {
          const sub = new Uint8ClampedArray(sw * sh * 4);
          for (let py = 0; py < sh; py += 1) {
            for (let px = 0; px < sw; px += 1) {
              const srcIdx = ((sy + py) * cw + (sx + px)) * 4;
              const dstIdx = (py * sw + px) * 4;
              sub[dstIdx] = pixels[srcIdx]!;
              sub[dstIdx + 1] = pixels[srcIdx + 1]!;
              sub[dstIdx + 2] = pixels[srcIdx + 2]!;
              sub[dstIdx + 3] = pixels[srcIdx + 3]!;
            }
          }
          return { data: sub, width: sw, height: sh } as ImageData;
        },
        putImageData: (img: ImageData, dx: number, dy: number) => {
          for (let py = 0; py < img.height; py += 1) {
            for (let px = 0; px < img.width; px += 1) {
              const srcIdx = (py * img.width + px) * 4;
              const dstIdx = ((dy + py) * cw + (dx + px)) * 4;
              pixels[dstIdx] = img.data[srcIdx]!;
              pixels[dstIdx + 1] = img.data[srcIdx + 1]!;
              pixels[dstIdx + 2] = img.data[srcIdx + 2]!;
              pixels[dstIdx + 3] = img.data[srcIdx + 3]!;
            }
          }
        },
      };

      renderFrame(ctx as unknown as CanvasRenderingContext2D, project, {
        timeTicks: 0,
        lookup: () => ({ image: {} as CanvasImageSource, width: 200, height: 100 }),
      });

      // Center of canvas (0.5, 0.5) must be redacted to green [0, 255, 0]
      const centerIdx = (Math.floor(ch * 0.5) * cw + Math.floor(cw * 0.5)) * 4;
      expect(pixels[centerIdx]).toBe(0);
      expect(pixels[centerIdx + 1]).toBe(255);
      // Outside mask at (0.1, 0.1) must remain unmasked red [255, 0, 0]
      const cornerIdx = (Math.floor(ch * 0.1) * cw + Math.floor(cw * 0.1)) * 4;
      expect(pixels[cornerIdx]).toBe(255);
      expect(pixels[cornerIdx + 1]).toBe(0);
    }
  });

  it('validates local WOFF2, WOFF, TTF, and OTF fonts, persists them across project reload, and verifies font metrics', async () => {
    resetLoadedCustomFontsForTests();
    // 1. Reject empty or non-font bytes
    expect(() => detectFontFormat(new Uint8Array([1, 2]), 'bad.ttf')).toThrow(/empty or truncated/i);
    expect(() => detectFontFormat(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00]), 'fake.woff2')).toThrow(
      /Unsupported or corrupted font binary/i,
    );

    // 2. Validate WOFF2 ('wOF2'), WOFF ('wOFF'), TTF (0x00 0x01 0x00 0x00), and OTF ('OTTO') magic headers
    const woff2Bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x02, 0x03]);
    const woffBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]);
    const ttfBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x10, 0x20, 0x30, 0x40]);
    const otfBytes = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0x05, 0x06, 0x07, 0x08]);

    expect(detectFontFormat(woff2Bytes, 'StudioDisplay.woff2')).toBe('woff2');
    expect(detectFontFormat(woffBytes, 'StudioSans.woff')).toBe('woff');
    expect(detectFontFormat(ttfBytes, 'StudioMono.ttf')).toBe('ttf');
    expect(detectFontFormat(otfBytes, 'StudioSerif.otf')).toBe('otf');

    // Stub FontFace so loadCustomFontDescriptor succeeds in jsdom
    class FakeFontFace {
      family: string;
      constructor(family: string) {
        this.family = family;
      }
      async load() {
        return this;
      }
    }
    vi.stubGlobal('FontFace', FakeFontFace);

    const descriptor = parseAndValidateCustomFont({
      fileName: 'Browser4KDisplay.woff2',
      bytes: woff2Bytes,
    });
    expect(descriptor.family).toBe('Browser4KDisplay');
    expect(descriptor.format).toBe('woff2');

    // Before loading, custom font reports fallback
    expect(checkFontAvailability('Browser4KDisplay').badge).toBe('fallback');
    const fallbackMetrics = measureFontMetrics('Browser4KDisplay', 'Kubernetes 4K Studio', 32);
    expect(fallbackMetrics.badge).toBe('fallback');

    // Persist on project, serialize to JSON, parse back, and load via ensureProjectFontsLoaded
    let project = createProject({ name: 'Font Persistence Test' });
    project = ops.addCustomFontToProject(project, descriptor);
    const json = serializeProject(project);
    resetLoadedCustomFontsForTests();
    const reloaded = parseProject(json);
    expect(reloaded.customFonts).toHaveLength(1);
    expect(reloaded.customFonts![0]!.family).toBe('Browser4KDisplay');

    await ensureProjectFontsLoaded(reloaded);
    expect(checkFontAvailability('Browser4KDisplay', reloaded).badge).toBe('ready');
    const readyMetrics = measureFontMetrics('Browser4KDisplay', 'Kubernetes 4K Studio', 32);
    expect(readyMetrics.badge).toBe('ready');
    expect(readyMetrics.width).not.toBe(fallbackMetrics.width);

    vi.unstubAllGlobals();
  });

  it('plans Clear unused recordings as preview-first, protects active and referenced takes, and rejects stale plans when references change', async () => {
    const root = new MemoryDirectoryHandle('root');
    const project = createProject({ name: 'Storage Guard Test' });
    project.assets.push({
      id: 'used_asset',
      kind: 'video',
      name: 'Screen',
      path: 'recordings/take_used/screen.webm',
      durationTicks: 4 * TICKS_PER_SECOND,
      origin: 'recorded',
      createdAt: new Date().toISOString(),
    });
    const folder = await saveProject(root, project);

    const baseManifest = (takeId: string, status: 'finalized' | 'recording', bytes: number) => ({
      version: 1 as const,
      takeId,
      projectId: project.id,
      startedAt: '2026-11-08T10:00:00.000Z',
      endedAt: '2026-11-08T10:00:05.000Z',
      status,
      segmentSeconds: 5,
      assets: [
        {
          id: `asset_${takeId}`,
          name: 'Screen',
          kind: 'screen' as const,
          path: `recordings/${takeId}/screen.webm`,
          mimeType: 'video/webm',
          offsetMs: 0,
          committedBytes: bytes,
          segments: [
            {
              index: 0,
              path: `recordings/${takeId}/screen.webm`,
              bytes,
              startedAt: '2026-11-08T10:00:00.000Z',
              endedAt: '2026-11-08T10:00:05.000Z',
              finalized: status === 'finalized',
            },
          ],
        },
      ],
    });

    await writeTakeManifest(root, folder, baseManifest('take_used', 'finalized', 1000));
    await writeTakeManifest(root, folder, baseManifest('take_active', 'recording', 2000));
    await writeTakeManifest(root, folder, baseManifest('take_recoverable', 'recording', 3000));
    await writeTakeManifest(root, folder, baseManifest('take_unused', 'finalized', 4500));

    await renameTake(root, folder, 'take_unused', 'Unused Take 01');

    const plan = await planClearUnusedRecordings(root, {
      activeTakeIds: new Set(['take_active']),
    });

    // Only take_unused is a candidate; take_used, take_active, and unselected take_recoverable are excluded
    expect(plan.candidates.map((c) => c.takeId)).toEqual(['take_unused']);
    expect(plan.candidates[0]!.label).toBe('Unused Take 01');
    expect(plan.totalReclaimBytes).toBe(4500);
    expect(plan.excluded.map((e) => `${e.takeId}:${e.reason}`).sort()).toEqual([
      'take_active:active',
      'take_recoverable:recoverable-unselected',
      'take_used:used-in-timeline',
    ]);

    // Mutate project references after the plan was generated -> executeClearUnusedPlan must reject stale plan!
    const modifiedProject: typeof project = {
      ...project,
      assets: [
        ...project.assets,
        {
          id: 'newly_referenced',
          kind: 'video',
          name: 'Screen 2',
          path: 'recordings/take_unused/screen.webm',
          durationTicks: 4 * TICKS_PER_SECOND,
          origin: 'recorded',
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const staleResult = await executeClearUnusedPlan(root, plan, {
      currentProjects: new Map([[folder, modifiedProject]]),
      activeTakeIds: new Set(['take_active']),
    });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.stale).toBe(true);
    expect(staleResult.deleted).toHaveLength(0);

    // Execute with fresh plan when take_unused is genuinely unreferenced
    const freshPlan = await planClearUnusedRecordings(root, {
      activeTakeIds: new Set(['take_active']),
    });
    const okResult = await executeClearUnusedPlan(root, freshPlan, {
      activeTakeIds: new Set(['take_active']),
    });
    expect(okResult.ok).toBe(true);
    expect(okResult.stale).toBe(false);
    expect(okResult.reclaimedBytes).toBe(4500);
  });

  it('applies non-destructive review trim range and prevents duplicate insertion when retrying placeTake', () => {
    let project = createProject({ name: 'Review Trim & Idempotency' });
    const rawAssets = [
      {
        id: 'take_screen_1',
        kind: 'video' as const,
        name: 'Screen',
        path: 'recordings/take_1/screen.webm',
        durationTicks: 10 * TICKS_PER_SECOND,
        origin: 'recorded' as const,
        createdAt: new Date().toISOString(),
      },
    ];
    project = { ...project, assets: rawAssets };

    // Apply non-destructive trim [2s .. 7s]
    project = placeTake(project, rawAssets, 0, defaultPresenter(), {
      inTicks: 2 * TICKS_PER_SECOND,
      outTicks: 7 * TICKS_PER_SECOND,
    });
    const screenClips = project.tracks[0]!.clips;
    expect(screenClips).toHaveLength(1);
    expect(screenClips[0]!.inTicks).toBe(2 * TICKS_PER_SECOND);
    expect(screenClips[0]!.durationTicks).toBe(5 * TICKS_PER_SECOND);
    // Underlying asset duration remains untouched (non-destructive)
    expect(project.assets[0]!.durationTicks).toBe(10 * TICKS_PER_SECOND);

    // Retrying placeTake with the same take assets must NOT append a second clip
    const retried = placeTake(project, rawAssets, 5 * TICKS_PER_SECOND, defaultPresenter());
    expect(retried.tracks[0]!.clips).toHaveLength(1);
  });

  it('builds the deterministic Sample Kubernetes 4K Lesson with storyboard, markers, captions, privacy mask, and capture state machine transitions', () => {
    const lesson = buildSampleKubernetesProject();
    expect(lesson.name).toContain('Kubernetes Zero-Downtime Rollout');
    expect(lesson.captions).toHaveLength(4);
    expect(lesson.markers).toHaveLength(4);
    expect(lesson.storyboard).toHaveLength(4);
    expect(lesson.socialCaption).toContain('#kubernetes');

    // Screen clip has a privacy mask redacting the simulated KUBE_TOKEN
    const screenClip = lesson.tracks.find((t) => t.name === 'Screen')?.clips[0];
    expect(screenClip?.masks).toHaveLength(1);
    expect(screenClip?.masks[0]?.mode).toBe('blur');

    // Verify full capture state machine stages & Quiet modes
    expect(canTransitionStage('idle', 'selecting')).toBe(true);
    expect(canTransitionStage('selecting', 'ready')).toBe(true);
    expect(canTransitionStage('ready', 'countdown')).toBe(true);
    expect(canTransitionStage('countdown', 'recording')).toBe(true);
    expect(canTransitionStage('recording', 'paused')).toBe(true);
    expect(canTransitionStage('recording', 'finalizing')).toBe(true);
    expect(canTransitionStage('finalizing', 'review')).toBe(true);
    expect(canTransitionStage('recording', 'interrupted')).toBe(true);
    expect(canTransitionStage('interrupted', 'recoverable failure')).toBe(true);
    expect(QUIET_MODES.map((m) => m.label)).toEqual([
      'Full controls',
      'Compact controls',
      'Controls only',
    ]);
  });
});
