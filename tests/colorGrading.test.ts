import { afterEach, describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/core/time';
import {
  HSL_COLOR_BANDS,
  applyPixelGradingToImageData,
  evaluate3dLutTrilinear,
  evaluateToneCurve,
  hasAdvancedPixelGrading,
  parseCubeLut,
  registerPersistedCustomLut,
  resolveCinematicLut,
} from '../src/effects/catalog';
import { createClip, createProject } from '../src/project/factory';
import * as ops from '../src/project/ops';
import { parseProject, serializeProject } from '../src/project/serialize';
import { useEditor } from '../src/project/store';
import { defaultEffects } from '../src/project/factory';
import type { CustomLutData, Project } from '../src/project/types';

function identityCube(size = 2): string {
  const lines = [`TITLE "Identity ${size}"`, `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lines.push(`${r / (size - 1)} ${g / (size - 1)} ${b / (size - 1)}`);
      }
    }
  }
  return lines.join('\n');
}

function inversionCube(size = 2): string {
  const lines = ['TITLE "Invert"', `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        lines.push(`${1 - r / (size - 1)} ${1 - g / (size - 1)} ${1 - b / (size - 1)}`);
      }
    }
  }
  return lines.join('\n');
}

function customLutDataFrom(cubeText: string, name: string): CustomLutData {
  const spec = parseCubeLut(cubeText, name);
  return {
    id: spec.id,
    name: spec.name,
    size: spec.latticeSize ?? 2,
    domainMin: spec.domainMin ?? [0, 0, 0],
    domainMax: spec.domainMax ?? [1, 1, 1],
    lattice: spec.lattice ?? [],
  };
}

function seededProject(): { project: Project; clipId: string } {
  let project = createProject({ name: 'Grading Fixture' });
  const asset = {
    id: 'asset_grade',
    name: 'grade.mp4',
    kind: 'video' as const,
    path: 'media/grade.mp4',
    durationTicks: 10 * TICKS_PER_SECOND,
    width: 1920,
    height: 1080,
    origin: 'imported' as const,
    createdAt: '2026-11-08T00:00:00.000Z',
  };
  project.assets.push(asset);
  const track = project.tracks.find((item) => item.kind === 'video')!;
  const clip = createClip({
    kind: 'media',
    assetId: asset.id,
    startTicks: 0,
    durationTicks: 6 * TICKS_PER_SECOND,
  });
  project = ops.placeClip(project, track.id, clip, 'overwrite');
  return { project, clipId: clip.id };
}

afterEach(() => {
  useEditor.getState().closeProject();
});

describe('3D LUT parsing and interpolation', () => {
  it('parses a valid .cube with title, size, domain and exact lattice', () => {
    const cube = ['TITLE "Kubernetes Teal"', 'LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1', ...identityCube().split('\n').slice(2)].join('\n');
    const spec = parseCubeLut(cube, 'fallback.cube');
    expect(spec.name).toBe('Kubernetes Teal');
    expect(spec.latticeSize).toBe(2);
    expect(spec.domainMin).toEqual([0, 0, 0]);
    expect(spec.domainMax).toEqual([1, 1, 1]);
    expect(spec.lattice).toHaveLength(2 * 2 * 2 * 3);
  });

  it('returns the same colour for an identity lattice at lattice points and midpoints', () => {
    const spec = parseCubeLut(identityCube(2));
    expect(evaluate3dLutTrilinear(spec, 0.25, 0.5, 0.75)).toEqual([0.25, 0.5, 0.75]);
    expect(evaluate3dLutTrilinear(spec, 0.5, 0.5, 0.5).map((value) => Math.round(value * 100))).toEqual([50, 50, 50]);
  });

  it('inverts through a real lattice rather than a tint approximation', () => {
    const spec = parseCubeLut(inversionCube(2));
    expect(evaluate3dLutTrilinear(spec, 1, 1, 1)).toEqual([0, 0, 0]);
    expect(evaluate3dLutTrilinear(spec, 0, 0, 0)).toEqual([1, 1, 1]);
    const [r, g, b] = evaluate3dLutTrilinear(spec, 0.2, 0.6, 0.9);
    expect(r).toBeCloseTo(0.8, 5);
    expect(g).toBeCloseTo(0.4, 5);
    expect(b).toBeCloseTo(0.1, 5);
  });

  it('rejects a file with no LUT data instead of silently grading with garbage', () => {
    expect(() => parseCubeLut('not a cube at all', 'broken.cube')).toThrow(/does not contain any 3D LUT data/);
  });

  it('resamples a sparse but valid cube into a full lattice', () => {
    const sparse = ['LUT_3D_SIZE 2', '0 0 0', '1 1 1'].join('\n');
    const spec = parseCubeLut(sparse, 'sparse.cube');
    expect(spec.latticeSize).toBe(2);
    expect(spec.lattice).toHaveLength(8 * 3);
  });

  it('rejects oversized .cube uploads before parsing', () => {
    const { project, clipId } = seededProject();
    const huge = 'x'.repeat(8 * 1024 * 1024 + 1);
    expect(() => ops.applyCubeLutText(project, huge, 'huge.cube', clipId)).toThrow(/8 MB limit/);
  });
});

describe('colour grading ops', () => {
  it('stores and clamps colour wheels per scope', () => {
    const { project, clipId } = seededProject();
    let next = ops.setColorWheel(project, [clipId], 'shadows', { hueDeg: 400, sat: 2, luma: -3 });
    const wheel = ops.findClipById(next, clipId)!.effects.colorWheels!.shadows!;
    expect(wheel.hueDeg).toBeGreaterThanOrEqual(0);
    expect(wheel.hueDeg).toBeLessThan(360);
    expect(wheel.sat).toBe(1);
    expect(wheel.luma).toBe(-1);

    next = ops.resetColorWheel(next, [clipId], 'shadows');
    expect(ops.findClipById(next, clipId)!.effects.colorWheels).toBeUndefined();
  });

  it('sets and clears 8-band HSL adjustments', () => {
    const { project, clipId } = seededProject();
    expect(HSL_COLOR_BANDS).toHaveLength(8);
    let next = ops.setHslBandAdjustment(project, [clipId], 'green', { hue: 200, sat: -2, luma: 0.4 });
    const band = ops.findClipById(next, clipId)!.effects.hslBands!.green!;
    expect(band.hue).toBe(180);
    expect(band.sat).toBe(-1);
    expect(band.luma).toBe(0.4);
    next = ops.clearHslBands(next, [clipId]);
    expect(ops.findClipById(next, clipId)!.effects.hslBands).toBeUndefined();
  });

  it('sorts tone-curve points by input and evaluates an S-curve', () => {
    const { project, clipId } = seededProject();
    const points = [
      { x: 0.75, y: 0.9 },
      { x: 0, y: 0 },
      { x: 0.25, y: 0.1 },
      { x: 1, y: 1 },
    ];
    const next = ops.setToneCurve(project, [clipId], 'rgb', points);
    const stored = ops.findClipById(next, clipId)!.effects.toneCurves!.rgb!;
    expect(stored.map((point) => point.x)).toEqual([0, 0.25, 0.75, 1]);
    expect(evaluateToneCurve(stored, 0.5)).toBeCloseTo(0.5, 5);
    expect(evaluateToneCurve(stored, 0.25)).toBeCloseTo(0.1, 5);
    expect(evaluateToneCurve(stored, 0.75)).toBeCloseTo(0.9, 5);
    expect(ops.findClipById(ops.clearToneCurves(next, [clipId]), clipId)!.effects.toneCurves).toBeUndefined();
  });

  it('persists an imported LUT lattice on the clip and survives a serialize round trip', () => {
    const { project, clipId } = seededProject();
    const { project: withLut, lutId } = ops.applyCubeLutText(project, inversionCube(2), 'Invert.cube', clipId);
    const data = ops.findClipById(withLut, clipId)!.effects.customLutData!;
    expect(data.lattice).toHaveLength(8 * 3);
    expect(data.size).toBe(2);

    const restored = parseProject(JSON.parse(serializeProject(withLut)));
    const restoredData = ops.findClipById(restored, clipId)!.effects.customLutData!;
    expect(restoredData.id).toBe(lutId);
    expect(restoredData.lattice).toEqual(data.lattice);

    // The persisted data re-registers into a spec that really inverts pixels.
    const spec = registerPersistedCustomLut(restoredData);
    expect(evaluate3dLutTrilinear(spec, 0.1, 0.2, 0.3)[0]).toBeCloseTo(0.9, 4);
  });

  it('clears the imported lattice when a built-in LUT is chosen', () => {
    const { project: seeded } = seededProject();
    const clipId = seeded.tracks.find((track) => track.kind === 'video')!.clips[0]!.id;
    const imported = ops.applyCubeLutText(seeded, inversionCube(2), 'Invert.cube', clipId).project;
    expect(ops.findClipById(imported, clipId)!.effects.customLutData).toBeDefined();
    const builtIn = ops.applyLUT(imported, clipId, 'hollywood_bloom');
    expect(ops.findClipById(builtIn, clipId)!.effects.customLutData).toBeUndefined();
  });

  it('applies LUT strength as a blend and honours zero strength', () => {
    const { project, clipId } = seededProject();
    const imported = ops.applyCubeLutText(project, inversionCube(2), 'Invert.cube', clipId).project;
    const data: Uint8ClampedArray = new Uint8ClampedArray([51, 102, 204, 255]);

    const full = new Uint8ClampedArray(data);
    applyPixelGradingToImageData(full, { ...defaultEffects(), ...ops.findClipById(imported, clipId)!.effects, lutStrength: 1 });
    expect(Array.from(full.slice(0, 3))).toEqual([204, 153, 51]);

    const off = new Uint8ClampedArray(data);
    applyPixelGradingToImageData(off, { ...defaultEffects(), ...ops.findClipById(imported, clipId)!.effects, lutStrength: 0 });
    expect(Array.from(off.slice(0, 3))).toEqual([51, 102, 204]);

    const half = new Uint8ClampedArray(data);
    applyPixelGradingToImageData(half, { ...defaultEffects(), ...ops.findClipById(imported, clipId)!.effects, lutStrength: 0.5 });
    expect(half[0]).toBeGreaterThan(51);
    expect(half[0]).toBeLessThan(204);
  });

  it('reports advanced grading only when there is real pixel work', () => {
    expect(hasAdvancedPixelGrading(defaultEffects())).toBe(false);
    // Built-in cinematic looks are stylized presets, not real lattice grading.
    expect(hasAdvancedPixelGrading({ ...defaultEffects(), lut: 'hollywood_bloom' })).toBe(false);
    expect(
      hasAdvancedPixelGrading({ ...defaultEffects(), customLutData: customLutDataFrom(inversionCube(2), 'Invert.cube') }),
    ).toBe(true);
    expect(
      hasAdvancedPixelGrading({
        ...defaultEffects(),
        customLutData: customLutDataFrom(inversionCube(2), 'Invert.cube'),
        lutStrength: 0,
      }),
    ).toBe(false);
    expect(
      hasAdvancedPixelGrading({
        ...defaultEffects(),
        hslBands: { red: { hue: 10, sat: 0, luma: 0 } },
      }),
    ).toBe(true);
    expect(
      hasAdvancedPixelGrading({
        ...defaultEffects(),
        colorWheels: { global: { hueDeg: 0, sat: 0, luma: 0.2 } },
      }),
    ).toBe(true);
  });

  it('resetColorGrading clears LUT, wheels, HSL and curves in one step', () => {
    const { project, clipId } = seededProject();
    let next = ops.applyCubeLutText(project, inversionCube(2), 'Invert.cube', clipId).project;
    next = ops.setColorWheel(next, [clipId], 'global', { hueDeg: 90, sat: 0.4, luma: 0.1 });
    next = ops.setHslBandAdjustment(next, [clipId], 'blue', { hue: -20, sat: 0.2, luma: 0 });
    next = ops.setToneCurve(next, [clipId], 'red', [
      { x: 0, y: 0 },
      { x: 1, y: 0.8 },
    ]);
    const reset = ops.resetColorGrading(next, [clipId]);
    const effects = ops.findClipById(reset, clipId)!.effects;
    expect(effects.lut).toBe('none');
    expect(effects.customLutData).toBeUndefined();
    expect(effects.colorWheels).toBeUndefined();
    expect(effects.hslBands).toBeUndefined();
    expect(effects.toneCurves).toBeUndefined();
    expect(resolveCinematicLut(effects.lut)).toBeNull();
  });
});

describe('gesture undo coalescing', () => {
  it('records exactly one undo entry for a multi-step pointer gesture', () => {
    const { project, clipId } = seededProject();
    const store = useEditor.getState();
    store.loadProject(project);
    const originalX = ops.findClipById(project, clipId)!.transform.x;

    store.beginGesture('Move clip');
    for (let step = 1; step <= 5; step += 1) {
      useEditor.getState().updateGesture((current) =>
        ops.updateClipDeep(current, clipId, { transform: { x: 0.5 + step * 0.01 } }),
      );
    }
    useEditor.getState().endGesture();

    const after = useEditor.getState();
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.label).toBe('Move clip');
    expect(ops.findClipById(after.project!, clipId)!.transform.x).toBeCloseTo(0.55, 5);

    after.undo();
    expect(ops.findClipById(useEditor.getState().project!, clipId)!.transform.x).toBe(originalX);
    expect(useEditor.getState().history).toHaveLength(0);
  });

  it('does not push an undo entry when a gesture never changed anything', () => {
    const { project } = seededProject();
    useEditor.getState().loadProject(project);
    useEditor.getState().beginGesture('Move clip');
    useEditor.getState().endGesture();
    expect(useEditor.getState().history).toHaveLength(0);
  });

  it('cancelGesture restores the pre-gesture project', () => {
    const { project, clipId } = seededProject();
    useEditor.getState().loadProject(project);
    const originalX = ops.findClipById(project, clipId)!.transform.x;
    useEditor.getState().beginGesture('Move clip');
    useEditor.getState().updateGesture((current) =>
      ops.updateClipDeep(current, clipId, { transform: { x: 0.9 } }),
    );
    useEditor.getState().cancelGesture();
    expect(useEditor.getState().gesture).toBeNull();
    expect(ops.findClipById(useEditor.getState().project!, clipId)!.transform.x).toBe(originalX);
  });
});
