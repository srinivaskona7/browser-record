import { describe, expect, it } from 'vitest';
import { PRESETS, defaultPresetId, formatBytes, planBitrate, planQualitySamples } from '../src/export/presets';
import { createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { TICKS_PER_SECOND } from '../src/core/time';

describe('bitrate budget', () => {
  it('derives the one-hour / 4 Mbps / 1.8 GB relationship', () => {
    const budget = planBitrate({ durationSeconds: 3600, width: 3840, height: 2160, fps: 30, audioBitrate: 128_000, videoBitrate: 4_000_000 });
    expect(budget.estimatedGB).toBeGreaterThan(1.7);
    expect(budget.estimatedGB).toBeLessThan(1.9);
    expect(budget.warnings.length).toBeGreaterThan(0);
  });

  it('derives video bitrate from a target size and warns when it is too small', () => {
    const budget = planBitrate({ durationSeconds: 3600, width: 3840, height: 2160, fps: 30, audioBitrate: 128_000, targetBytes: 1_800_000_000 });
    expect(budget.videoMbps).toBeGreaterThan(3.8);
    expect(budget.videoMbps).toBeLessThan(4.2);
    const impossible = planBitrate({ durationSeconds: 600, width: 3840, height: 2160, fps: 30, audioBitrate: 320_000, targetBytes: 1_000_000 });
    expect(impossible.warnings.some((warning) => /smaller than the audio/i.test(warning))).toBe(true);
  });

  it('warns when the budget cannot keep terminal text sharp', () => {
    const budget = planBitrate({ durationSeconds: 600, width: 3840, height: 2160, fps: 30, audioBitrate: 128_000, videoBitrate: 1_000_000 });
    expect(budget.bitsPerPixel).toBeLessThan(0.02);
    expect(budget.plausible).toBe(false);
  });

  it('formats decimal units, matching the budget maths', () => {
    expect(formatBytes(1_800_000_000)).toBe('1.8 GB');
    expect(formatBytes(0)).toBe('0 B');
  });

  it('ships a 4-12 Mbps starting range for 4K', () => {
    for (const preset of PRESETS.filter((item) => item.height >= 2000)) {
      expect(preset.videoBitrate).toBeGreaterThanOrEqual(4_000_000);
      expect(preset.videoBitrate).toBeLessThanOrEqual(12_000_000 + 6_000_000);
    }
  });

  it('reduces video bitrate and estimated file size by 4x in Ultra-Compact VBR mode', async () => {
    const { applyCompactBitrateBudget } = await import('../src/export/presets');
    const standardBudget = planBitrate({
      durationSeconds: 600,
      width: 1920,
      height: 1080,
      fps: 30,
      audioBitrate: 192_000,
      videoBitrate: 8_000_000,
      compactSizeMode: false,
    });
    const compactRates = applyCompactBitrateBudget(8_000_000, 192_000, true);
    expect(compactRates.videoBitrate).toBe(2_000_000);
    expect(compactRates.audioBitrate).toBe(96_000);

    const compactBudget = planBitrate({
      durationSeconds: 600,
      width: 1920,
      height: 1080,
      fps: 30,
      audioBitrate: compactRates.audioBitrate,
      videoBitrate: compactRates.videoBitrate,
      compactSizeMode: true,
    });
    expect(compactBudget.estimatedBytes).toBeLessThanOrEqual(standardBudget.estimatedBytes * 0.26);
    expect(compactBudget.plausible).toBe(true);
  });
});

describe('quality sample planning', () => {
  it('keeps sample windows inside the project', () => {
    const project = createProject({ name: 'Sample', id: 'p', now: '2026-01-01T00:00:00.000Z' });
    const track = project.tracks[0]!;
    const withClip = ops.addAssetClip(
      { ...project, assets: [{ id: 'a', kind: 'video', name: 'a.webm', path: 'a.webm', durationTicks: 60 * TICKS_PER_SECOND, origin: 'recorded', createdAt: '2026-01-01T00:00:00.000Z' }] },
      track.id,
      'a',
      0,
      { mode: 'overwrite' },
    ).project;
    const plan = planQualitySamples(withClip, 6);
    expect(plan.busy.startTicks).toBeGreaterThanOrEqual(0);
    expect(plan.busy.startTicks + plan.busy.durationTicks).toBeLessThanOrEqual(withClip.durationTicks);
  });
});

describe('delivery defaults', () => {
  it('never starts above the composition size', () => {
    // A 1080p project must not default to a 4K preset: that export would be an
    // upscale labelled 4K.
    expect(defaultPresetId({ width: 1920, height: 1080 })).toBe('1080p-share');
    expect(defaultPresetId({ width: 3840, height: 2160 })).toBe('4k-balanced');
    expect(defaultPresetId({ width: 2560, height: 1440 })).toBe('custom');
    expect(defaultPresetId({ width: 1080, height: 1920 })).toBe('custom');
  });

  it('only matches a preset that fits the composition exactly', () => {
    const preset = PRESETS.find((item) => item.id === defaultPresetId({ width: 1280, height: 720 }));
    expect(preset).toBeUndefined();
  });
});
