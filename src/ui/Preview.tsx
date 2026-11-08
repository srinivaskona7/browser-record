import { useEffect, useRef, useState } from 'react';
import { renderFrame, type SourceLookup } from '../render/compose';
import { MediaAssetResolver, prepareFrameSources } from '../render/sources';
import { ensureAssetFile } from '../app/actions';
import type { Project } from '../project/types';
import type { PreviewPlayer } from './player';
import { ManipulationOverlay } from './ManipulationOverlay';
import { useEditor } from '../project/store';
import { ensureProjectFontsLoaded } from '../effects/catalog';

async function withResolvedLookup<T>(
  project: Project,
  player: PreviewPlayer | null,
  timeTicks: number,
  fn: (lookup: SourceLookup) => Promise<T> | T,
): Promise<T> {
  await ensureProjectFontsLoaded(project);
  if (player) {
    return fn(player.sourceLookup());
  }
  const resolver = new MediaAssetResolver(project, {
    getFile: (asset) => ensureAssetFile(asset.path),
  });
  try {
    const prepared = await prepareFrameSources(project, timeTicks, resolver);
    return await fn((assetId) => prepared.sources.get(assetId) ?? null);
  } catch {
    return await fn(() => null);
  } finally {
    await resolver.close();
  }
}

/** Renders one frame at full project resolution as a PNG, with the same compositor and decoded media as export. */
export async function snapshotFrame(
  project: Project,
  player: PreviewPlayer | null,
  ticks: number,
  captionsEnabled: boolean,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = project.canvas.width;
  canvas.height = project.canvas.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  const timeTicks = ticks >= project.durationTicks ? Math.max(0, project.durationTicks - 1) : ticks;
  return withResolvedLookup(project, player, timeTicks, (lookup) => {
    renderFrame(ctx, project, {
      timeTicks,
      lookup,
      showSafeAreas: false,
      showCaptionGuides: false,
      captionsEnabled,
    });
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  });
}

/**
 * Renders the current frame into a 1280×720 YouTube thumbnail canvas (letterboxed
 * or filled cleanly from the composition) and returns a PNG Blob.
 */
export async function snapshotThumbnail(
  project: Project,
  player: PreviewPlayer | null,
  ticks: number,
  captionsEnabled = false,
  width = 1280,
  height = 720,
): Promise<Blob | null> {
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = project.canvas.width;
  sourceCanvas.height = project.canvas.height;
  const sctx = sourceCanvas.getContext('2d', { alpha: false });
  if (!sctx) return null;
  const timeTicks = ticks >= project.durationTicks ? Math.max(0, project.durationTicks - 1) : ticks;
  return withResolvedLookup(project, player, timeTicks, (lookup) => {
    renderFrame(sctx, project, {
      timeTicks,
      lookup,
      showSafeAreas: false,
      showCaptionGuides: false,
      showEndScreenGuide: false,
      captionsEnabled,
    });

    const thumb = document.createElement('canvas');
    thumb.width = width;
    thumb.height = height;
    const tctx = thumb.getContext('2d', { alpha: false });
    if (!tctx) return Promise.resolve(null);
    tctx.fillStyle = project.canvas.background;
    tctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
    const drawW = Math.round(sourceCanvas.width * scale);
    const drawH = Math.round(sourceCanvas.height * scale);
    const dx = Math.round((width - drawW) / 2);
    const dy = Math.round((height - drawH) / 2);
    tctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, dx, dy, drawW, drawH);
    return new Promise((resolve) => thumb.toBlob(resolve, 'image/png'));
  });
}

export function Preview({
  project,
  player,
  ticks,
  showSafeAreas,
  previewScale,
  showCaptionGuides,
  showEndScreenGuide = false,
  captionsEnabled,
  revision = 0,
  editable = false,
}: {
  project: Project;
  player: PreviewPlayer | null;
  ticks: number;
  showSafeAreas: boolean;
  previewScale: number;
  showCaptionGuides: boolean;
  showEndScreenGuide?: boolean;
  captionsEnabled: boolean;
  /** Bumped when the player has finished loading and a repaint would now find pixels. */
  revision?: number;
  /** Draw direct-manipulation handles over the selected clip (editor only). */
  editable?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compareOriginal = useEditor((state) => state.compareOriginal);
  const [fontsEpoch, setFontsEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void ensureProjectFontsLoaded(project).then(() => {
      if (!cancelled) setFontsEpoch((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetWidth = Math.max(320, Math.round(project.canvas.width * previewScale));
    const targetHeight = Math.round((project.canvas.height / project.canvas.width) * targetWidth);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = project.canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(canvas.width / project.canvas.width, canvas.height / project.canvas.height);
    // The playhead is allowed to sit exactly on the project end, where clip
    // lookups are end-exclusive and every layer resolves to nothing. Hold the
    // last frame there instead of flashing the bare background.
    const renderTicks = ticks >= project.durationTicks ? Math.max(0, project.durationTicks - 1) : ticks;
    try {
      renderFrame(ctx, project, {
        timeTicks: renderTicks,
        lookup: player ? player.sourceLookup() : () => null,
        showSafeAreas,
        showCaptionGuides,
        showEndScreenGuide,
        captionsEnabled,
        compareOriginal,
      });
    } finally {
      ctx.restore();
    }
  }, [
    project,
    player,
    ticks,
    showSafeAreas,
    previewScale,
    showCaptionGuides,
    showEndScreenGuide,
    captionsEnabled,
    compareOriginal,
    revision,
    fontsEpoch,
  ]);

  return (
    <div className="preview-shell" style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        style={{ aspectRatio: `${project.canvas.width} / ${project.canvas.height}` }}
        aria-label="Timeline preview"
      />
      {compareOriginal && (
        <div className="compare-badge" data-testid="compare-original-badge">
          Original (ungraded)
        </div>
      )}
      {editable && <ManipulationOverlay project={project} />}
    </div>
  );
}
