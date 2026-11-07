import { TICKS_PER_SECOND, type Tick } from '../core/time';
import type { AlphaMaskProps, CaptionCue, Clip, Project, StickerKind } from '../project/types';
import {
  resolveBoundaryTransition,
  resolveCinematicLut,
  resolveColorFilter,
  resolveEmphasisStyle,
  resolveTextAnimation,
  resolveVideoEffect,
} from '../effects/catalog';
import { activeClipAt, activeCues, clipOpacity, keyframeValue, localTicks, sourceTicks } from './compositorQuery';
import {
  clamp,
  computePlacement,
  cropRect,
  diagramRevealProgress,
  ease,
  endScreenZone,
  presenterBubble,
  safeArea,
  sideBySideRegions,
  type Rect,
} from './layout';
import { chunkCaptionText, fontString, wrapLines, type Ctx2D } from './text';

export interface DrawableSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Resolve an asset to something drawable at a given source-time. Preview and
 * export supply different implementations; the scene renderer is identical.
 */
export type SourceLookup = (assetId: string, atSourceTicks: Tick) => DrawableSource | null;

export interface RenderOptions {
  lookup: SourceLookup;
  showSafeAreas?: boolean;
  showCaptionGuides?: boolean;
  showEndScreenGuide?: boolean;
  captionsEnabled?: boolean;
  /** Preview uses true so overlays remain visible while scrubbing. */
  showTrackBadges?: boolean;
  timeTicks: Tick;
}

const PRESENTER_TRACK_HINT = /camera|webcam|presenter/i;

function isPresenterClip(clip: Clip, trackName: string): boolean {
  return Boolean(clip.presenter) || PRESENTER_TRACK_HINT.test(trackName);
}

export function renderFrame(ctx: Ctx2D, project: Project, options: RenderOptions): void {
  const { width, height } = project.canvas;
  const ticks = options.timeTicks;
  const presenterClips: Array<{ clip: Clip; drawable: DrawableSource }> = [];
  const screenClips: Array<{ clip: Clip; drawable: DrawableSource }> = [];
  const overlayClips: Clip[] = [];

  ctx.save();
  ctx.fillStyle = project.canvas.background;
  ctx.fillRect(0, 0, width, height);

  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const clip = activeClipAt(track, ticks);
    if (!clip) continue;
    if (
      clip.kind === 'title' ||
      clip.kind === 'arrow' ||
      clip.kind === 'sticker' ||
      clip.kind === 'contact' ||
      clip.kind === 'keystroke' ||
      clip.kind === 'endscreen' ||
      clip.kind === 'progressbar' ||
      clip.kind === 'pulse' ||
      clip.kind === 'countdown' ||
      clip.kind === 'adjustment'
    ) {
      overlayClips.push(clip);
      continue;
    }
    if (clip.kind === 'solid') {
      ctx.save();
      ctx.globalAlpha = clipOpacity(clip, ticks);
      ctx.fillStyle = clip.text?.background ?? '#000';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      continue;
    }
    if (!clip.assetId) continue;
    const drawable = options.lookup(clip.assetId, sourceTicks(clip, ticks));
    if (!drawable) continue;
    if (isPresenterClip(clip, track.name)) presenterClips.push({ clip, drawable });
    else screenClips.push({ clip, drawable });
  }

  const presenter = presenterClips[0];
  const layout = presenter?.clip.presenter?.layout ?? 'bubble';

  if (presenter && layout === 'full') {
    drawMediaClip(ctx, presenter.clip, presenter.drawable, ticks, { width, height, x: 0, y: 0 });
  } else if (presenter && layout === 'side-by-side') {
    const regions = sideBySideRegions({ width, height });
    for (const entry of screenClips) {
      drawMediaClip(ctx, entry.clip, entry.drawable, ticks, regions.screen);
    }
    drawMediaClip(ctx, presenter.clip, presenter.drawable, ticks, regions.camera);
  } else {
    for (const entry of screenClips) {
      drawMediaClip(ctx, entry.clip, entry.drawable, ticks, { width, height, x: 0, y: 0 });
    }
    if (presenter) {
      if (!presenter.clip.presenter) {
        drawMediaClip(ctx, presenter.clip, presenter.drawable, ticks, { width, height, x: 0, y: 0 });
      } else {
        drawPresenterBubble(ctx, project, presenter.clip, presenter.drawable, ticks);
      }
    }
  }

  for (const clip of overlayClips) {
    if (clip.kind === 'adjustment') drawAdjustmentClip(ctx, project, clip, ticks);
    else if (clip.kind === 'title') drawTextClip(ctx, project, clip, ticks);
    else if (clip.kind === 'arrow') drawArrowClip(ctx, project, clip, ticks);
    else if (clip.kind === 'sticker') drawStickerClip(ctx, project, clip, ticks);
    else if (clip.kind === 'contact') drawContactClip(ctx, project, clip, ticks);
    else if (clip.kind === 'keystroke') drawKeystrokeClip(ctx, project, clip, ticks);
    else if (clip.kind === 'endscreen') drawEndScreenClip(ctx, project, clip, ticks);
    else if (clip.kind === 'progressbar') drawProgressBarClip(ctx, project, clip, ticks);
    else if (clip.kind === 'pulse') drawPulseClip(ctx, project, clip, ticks);
    else if (clip.kind === 'countdown') drawCountdownClip(ctx, project, clip, ticks);
  }

  if (options.captionsEnabled !== false) {
    for (const cue of activeCues(project, ticks)) drawCue(ctx, project, cue, ticks);
  }

  if (options.showCaptionGuides) drawCaptionGuide(ctx, project);
  if (options.showEndScreenGuide) drawEndScreenGuide(ctx, project, ticks);

  if (options.showSafeAreas) {
    const area = safeArea({ width, height }, project.canvas.safeMargin);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.75)';
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = Math.max(2, width / 960);
    ctx.strokeRect(area.x, area.y, area.width, area.height);
    ctx.restore();
  }
  ctx.restore();
}

function drawMediaClip(
  ctx: Ctx2D,
  clip: Clip,
  drawable: DrawableSource,
  ticks: Tick,
  region: { x: number; y: number; width: number; height: number },
): void {
  const local = localTicks(clip, ticks);
  const localSec = local / TICKS_PER_SECOND;
  const clipProgress = clamp(local / Math.max(1, clip.durationTicks), 0, 1);
  const effectSpec = resolveVideoEffect(clip.effects.videoEffect);

  let zoom = keyframeValue(clip, 'zoom', local, clip.effects.zoom);
  let panX = keyframeValue(clip, 'panX', local, clip.effects.panX);
  let panY = keyframeValue(clip, 'panY', local, clip.effects.panY);

  if (effectSpec) {
    const phase = localSec * effectSpec.frequencyHz * Math.PI * 2;
    panX += Math.sin(phase) * effectSpec.shakeAmpX;
    panY += Math.cos(phase * 1.27) * effectSpec.shakeAmpY;
    zoom = Math.max(0.2, zoom * (1 + effectSpec.zoomDelta * Math.sin(clipProgress * Math.PI)));
  }

  const transState = computeTransitionTransform(clip, local, region.width, region.height);
  zoom = Math.max(0.1, zoom * transState.scale);

  const placement = computePlacement({
    canvas: { width: region.width, height: region.height },
    source: { width: drawable.width, height: drawable.height },
    transform: clip.transform,
    zoom,
    panX,
    panY,
  });
  const crop = cropRect(clip.transform, { width: drawable.width, height: drawable.height });
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;

  if (clip.effects.backdropPadding && clip.effects.backdropPadding > 0) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = clip.effects.backdropColor ?? '#161b22';
    ctx.fillRect(region.x, region.y, region.width, region.height);
    ctx.restore();
  }

  ctx.save();
  if (clip.transform.blendMode && clip.transform.blendMode !== 'normal') {
    ctx.globalCompositeOperation =
      clip.transform.blendMode === 'screen'
        ? 'screen'
        : clip.transform.blendMode === 'multiply'
          ? 'multiply'
          : 'overlay';
  }

  if (clip.alphaMask && clip.alphaMask.shape !== 'none') {
    applyAlphaMaskClip(ctx, clip.alphaMask, region);
  }

  ctx.beginPath();
  const radius = Math.min(clip.transform.radius, placement.width / 2, placement.height / 2);
  const reveal =
    clip.effects.revealSteps && clip.effects.revealSteps > 1
      ? diagramRevealProgress(local, clip.durationTicks, clip.effects.revealSteps)
      : null;
  const clipW =
    (reveal && clip.effects.revealDirection !== 'top-to-bottom' ? placement.width * reveal.fraction : placement.width) *
    transState.wipeFractionX;
  const clipH =
    (reveal && clip.effects.revealDirection === 'top-to-bottom' ? placement.height * reveal.fraction : placement.height) *
    transState.wipeFractionY;
  roundRect(ctx, placement.x + region.x, placement.y + region.y, clipW, clipH, radius);
  ctx.clip();
  ctx.globalAlpha = opacity;
  if (clip.transform.shadow > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = clip.transform.shadow;
  }
  const cx = placement.x + placement.width / 2 + region.x;
  const cy = placement.y + placement.height / 2 + region.y;
  ctx.translate(cx, cy);

  let totalRotRad = placement.rotation + (transState.rotationDeg * Math.PI) / 180;
  if (effectSpec) {
    if (effectSpec.spinRevolutions !== 0) {
      totalRotRad += clipProgress * effectSpec.spinRevolutions * Math.PI * 2;
    } else if (effectSpec.rotationAmpDeg !== 0) {
      totalRotRad +=
        ((Math.sin(localSec * effectSpec.frequencyHz * Math.PI * 2) * effectSpec.rotationAmpDeg) * Math.PI) / 180;
    }
  }
  if (totalRotRad !== 0) ctx.rotate(totalRotRad);
  if (effectSpec?.flipX || effectSpec?.flipY) {
    ctx.scale(effectSpec.flipX ? -1 : 1, effectSpec.flipY ? -1 : 1);
  }

  ctx.translate(-placement.width / 2 + transState.offsetX, -placement.height / 2 + transState.offsetY);
  ctx.filter = cssFilter(clip, localSec);
  ctx.drawImage(drawable.image, crop.x, crop.y, crop.width, crop.height, 0, 0, placement.width, placement.height);

  // Chromatic aberration / RGB split shader pass
  const rgbShift = (effectSpec?.rgbSplit ?? 0) + transState.rgbJitter;
  if (rgbShift > 0) {
    const shiftPx = Math.max(2, placement.width * rgbShift);
    ctx.globalAlpha = opacity * 0.35;
    ctx.drawImage(
      drawable.image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -shiftPx,
      0,
      placement.width,
      placement.height,
    );
    ctx.drawImage(
      drawable.image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      shiftPx,
      0,
      placement.width,
      placement.height,
    );
    ctx.globalAlpha = opacity;
  }
  ctx.filter = 'none';

  // Color filter / 3D LUT split-tone & stylized overlays
  drawGradingAndShaderOverlays(ctx, clip, placement.width, placement.height, localSec, opacity, transState.flashAlpha);
  ctx.restore();

  if (clip.transform.borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = clip.transform.borderColor;
    ctx.lineWidth = clip.transform.borderWidth;
    ctx.beginPath();
    roundRect(ctx, placement.x + region.x, placement.y + region.y, placement.width, placement.height, radius);
    ctx.stroke();
    ctx.restore();
  }

  const vignetteStrength = Math.max(clip.effects.vignette ?? 0, effectSpec?.vignettePulse ?? 0);
  if (vignetteStrength > 0) {
    ctx.save();
    ctx.globalAlpha = opacity * clamp(vignetteStrength, 0, 1);
    const borderW = Math.max(8, Math.min(region.width, region.height) * 0.08);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = borderW;
    ctx.strokeRect(
      region.x + borderW / 2,
      region.y + borderW / 2,
      region.width - borderW,
      region.height - borderW,
    );
    ctx.restore();
  }

  for (const mask of clip.masks) drawMask(ctx, mask, region, opacity);
}

interface TransitionRenderState {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotationDeg: number;
  wipeFractionX: number;
  wipeFractionY: number;
  flashAlpha: number;
  rgbJitter: number;
}

function computeTransitionTransform(
  clip: Clip,
  local: Tick,
  width: number,
  height: number,
): TransitionRenderState {
  const neutral: TransitionRenderState = {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    rotationDeg: 0,
    wipeFractionX: 1,
    wipeFractionY: 1,
    flashAlpha: 0,
    rgbJitter: 0,
  };
  const trans = clip.transitionIn;
  if (!trans || trans.type === 'none' || trans.type === 'normal' || trans.durationTicks <= 0 || local >= trans.durationTicks) {
    return neutral;
  }
  const rawProgress = clamp(local / trans.durationTicks, 0, 1);
  const spec = resolveBoundaryTransition(trans.type);
  const progress = ease(rawProgress, trans.easing ?? spec?.easing ?? 'ease-out');
  const rem = 1 - progress;

  if (trans.type === 'slide-left' || trans.type === 'slide-right' || trans.type === 'wipe') {
    const direction = trans.type === 'slide-left' ? -1 : 1;
    return { ...neutral, offsetX: direction * rem * width };
  }
  if (!spec) return neutral;

  return {
    offsetX: spec.directionX * rem * width,
    offsetY: spec.directionY * rem * height,
    scale: 1 + (spec.zoomScale - 1) * rem,
    rotationDeg: spec.rotationDeg * rem,
    wipeFractionX: spec.mode === 'wipe-left' || spec.mode === 'wipe-right' ? Math.max(0.02, progress) : 1,
    wipeFractionY: spec.mode === 'wipe-up' || spec.mode === 'wipe-down' ? Math.max(0.02, progress) : 1,
    flashAlpha: spec.flashStrength * rem,
    rgbJitter: spec.rgbJitter * rem,
  };
}

function applyAlphaMaskClip(
  ctx: Ctx2D,
  mask: AlphaMaskProps,
  region: { x: number; y: number; width: number; height: number },
): void {
  const cx = region.x + mask.x * region.width;
  const cy = region.y + mask.y * region.height;
  const rx = Math.max(2, (region.width * mask.scaleX) / 2);
  const ry = Math.max(2, (region.height * mask.scaleY) / 2);
  if (mask.feather > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = mask.feather * 40;
  }
  ctx.beginPath();
  if (mask.invert) {
    ctx.rect(region.x, region.y, region.width, region.height);
  }
  if (mask.shape === 'circle') {
    ctx.arc(cx, cy, Math.min(rx, ry), 0, Math.PI * 2, mask.invert);
  } else if (mask.shape === 'split-screen') {
    ctx.rect(region.x, region.y, region.width * clamp(mask.scaleX, 0.05, 1), region.height);
  } else if (mask.shape === 'star') {
    const spikes = 5;
    const outerR = Math.min(rx, ry);
    const innerR = outerR * 0.45;
    for (let i = 0; i < spikes * 2; i += 1) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (mask.shape === 'heart') {
    const w = rx * 2;
    const h = ry * 2;
    const topY = cy - h * 0.3;
    ctx.moveTo(cx, cy + h * 0.45);
    ctx.quadraticCurveTo(cx - w * 0.55, cy, cx - w * 0.28, topY);
    ctx.quadraticCurveTo(cx, topY - h * 0.15, cx, cy - h * 0.05);
    ctx.quadraticCurveTo(cx, topY - h * 0.15, cx + w * 0.28, topY);
    ctx.quadraticCurveTo(cx + w * 0.55, cy, cx, cy + h * 0.45);
    ctx.closePath();
  } else {
    ctx.rect(cx - rx, cy - ry, rx * 2, ry * 2);
  }
  ctx.clip();
}

function drawGradingAndShaderOverlays(
  ctx: Ctx2D,
  clip: Clip,
  width: number,
  height: number,
  localSec: number,
  opacity: number,
  transitionFlashAlpha: number,
): void {
  const filterSpec = resolveColorFilter(clip.effects.colorFilter);
  if (filterSpec && filterSpec.tintOpacity > 0) {
    ctx.fillStyle = hexToRgba(filterSpec.tintHex, filterSpec.tintOpacity * opacity);
    ctx.fillRect(0, 0, width, height);
  }
  const lutSpec = resolveCinematicLut(clip.effects.lut);
  if (lutSpec && lutSpec.tintStrength > 0) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, hexToRgba(lutSpec.shadowsHex, lutSpec.tintStrength * opacity));
    grad.addColorStop(1, hexToRgba(lutSpec.highlightsHex, lutSpec.tintStrength * opacity));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
  const effectSpec = resolveVideoEffect(clip.effects.videoEffect);
  if (effectSpec) {
    if (effectSpec.scanlines > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${effectSpec.scanlines * 0.45})`;
      const step = Math.max(4, Math.round(height / 90));
      for (let y = 0; y < height; y += step * 2) {
        ctx.fillRect(0, y, width, step);
      }
    }
    if (effectSpec.lightLeak > 0) {
      const leakGrad = ctx.createLinearGradient(0, 0, width * 0.65, height * 0.65);
      leakGrad.addColorStop(0, `rgba(255, 140, 66, ${effectSpec.lightLeak * opacity})`);
      leakGrad.addColorStop(1, 'rgba(255, 140, 66, 0)');
      ctx.fillStyle = leakGrad;
      ctx.fillRect(0, 0, width, height);
    }
    if (effectSpec.flashAmp > 0) {
      const pulse = Math.max(0, Math.sin(localSec * effectSpec.frequencyHz * Math.PI * 2));
      ctx.fillStyle = `rgba(255, 255, 255, ${pulse * effectSpec.flashAmp * opacity})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
  if (transitionFlashAlpha > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${clamp(transitionFlashAlpha, 0, 1)})`;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawAdjustmentClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const { width, height } = project.canvas;
  const localSec = localTicks(clip, ticks) / TICKS_PER_SECOND;
  ctx.save();
  if (clip.alphaMask && clip.alphaMask.shape !== 'none') {
    applyAlphaMaskClip(ctx, clip.alphaMask, { x: 0, y: 0, width, height });
  }
  drawGradingAndShaderOverlays(ctx, clip, width, height, localSec, opacity, 0);
  ctx.restore();
}

function drawMask(
  ctx: Ctx2D,
  mask: Clip['masks'][number],
  region: { x: number; y: number; width: number; height: number },
  opacity: number,
): void {
  const width = region.width;
  const height = region.height;
  const rect = {
    x: region.x + mask.x * width,
    y: region.y + mask.y * height,
    width: mask.width * width,
    height: mask.height * height,
  };
  if (rect.width <= 0 || rect.height <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  if (mask.mode === 'spotlight') {
    const dimAlpha = clamp(mask.strength / 100, 0.25, 0.88);
    ctx.fillStyle = `rgba(0, 0, 0, ${dimAlpha})`;
    // Top band
    ctx.fillRect(region.x, region.y, width, Math.max(0, rect.y - region.y));
    // Bottom band
    const bottomY = rect.y + rect.height;
    ctx.fillRect(region.x, bottomY, width, Math.max(0, region.y + height - bottomY));
    // Left band
    ctx.fillRect(region.x, rect.y, Math.max(0, rect.x - region.x), rect.height);
    // Right band
    const rightX = rect.x + rect.width;
    ctx.fillRect(rightX, rect.y, Math.max(0, region.x + width - rightX), rect.height);

    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = Math.max(2, width / 640);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else if (mask.mode === 'pixelate') {
    const scale = Math.max(4, mask.strength);
    const w = Math.max(1, Math.floor(rect.width / scale));
    const h = Math.max(1, Math.floor(rect.height / scale));
    const off = createCanvas(w, h);
    if (off) {
      const octx = off.getContext('2d') as CanvasRenderingContext2D | null;
      if (octx) {
        octx.imageSmoothingEnabled = true;
        octx.drawImage(ctx.canvas as CanvasImageSource, rect.x, rect.y, rect.width, rect.height, 0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off as unknown as CanvasImageSource, 0, 0, w, h, rect.x, rect.y, rect.width, rect.height);
        ctx.imageSmoothingEnabled = true;
      }
    }
  } else {
    const off = createCanvas(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
    if (off) {
      const octx = off.getContext('2d') as CanvasRenderingContext2D | null;
      if (octx) {
        octx.filter = `blur(${mask.strength}px)`;
        octx.drawImage(ctx.canvas as CanvasImageSource, rect.x, rect.y, rect.width, rect.height, 0, 0, octx.canvas.width, octx.canvas.height);
        ctx.drawImage(off as unknown as CanvasImageSource, rect.x, rect.y, rect.width, rect.height);
      }
    }
  }
  ctx.restore();
}

function drawPresenterBubble(
  ctx: Ctx2D,
  project: Project,
  clip: Clip,
  drawable: DrawableSource,
  ticks: Tick,
): void {
  const bubble = presenterBubble({ canvas: { width: project.canvas.width, height: project.canvas.height }, presenter: clip.presenter! });
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  ctx.save();
  ctx.beginPath();
  if (bubble.radius > 0) {
    roundRect(ctx, bubble.x, bubble.y, bubble.width, bubble.height, bubble.radius);
  } else {
    ctx.rect(bubble.x, bubble.y, bubble.width, bubble.height);
  }
  ctx.clip();
  ctx.globalAlpha = opacity;
  if (clip.presenter!.shadow > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = clip.presenter!.shadow;
  }
  const crop = cropRect(clip.transform, { width: drawable.width, height: drawable.height });
  // Crop the original to the bubble's aspect ratio so a portrait card is not
  // a stretched square.
  const targetAspect = bubble.width / bubble.height;
  const cropAspect = crop.width / crop.height;
  let sw = crop.width;
  let sh = crop.height;
  if (cropAspect > targetAspect) sw = crop.height * targetAspect;
  else sh = crop.width / targetAspect;
  const sx = crop.x + (crop.width - sw) / 2;
  const sy = crop.y + (crop.height - sh) / 2;
  if (clip.presenter!.mirror) {
    ctx.translate(bubble.x + bubble.width, bubble.y);
    ctx.scale(-1, 1);
    ctx.drawImage(drawable.image, sx, sy, sw, sh, 0, 0, bubble.width, bubble.height);
  } else {
    ctx.drawImage(drawable.image, sx, sy, sw, sh, bubble.x, bubble.y, bubble.width, bubble.height);
  }
  if (clip.presenter!.chromaKey) applyChromaKey(ctx, bubble);
  ctx.restore();
  drawPresenterBorder(ctx, bubble, clip.presenter!.border, clip.presenter!.borderColor, opacity);
}

/** Ring around the presenter card. Drawn after the clip so it is never cropped. */
function drawPresenterBorder(
  ctx: Ctx2D,
  bubble: Rect & { radius: number },
  width: number,
  color: string,
  opacity: number,
): void {
  if (!Number.isFinite(width) || width <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  // Inset by half the stroke so the ring stays inside the card bounds.
  const inset = width / 2;
  ctx.beginPath();
  if (bubble.radius > 0) {
    roundRect(ctx, bubble.x + inset, bubble.y + inset, bubble.width - width, bubble.height - width, Math.max(0, bubble.radius - inset));
  } else {
    ctx.rect(bubble.x + inset, bubble.y + inset, bubble.width - width, bubble.height - width);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Chroma key is a per-frame pixel pass; experimental and disabled by default.
 * It is documented as such in the capability matrix.
 */
export function applyChromaKey(ctx: Ctx2D, rect: { x: number; y: number; width: number; height: number }): void {
  try {
    // getImageData works in device pixels, but the renderer draws after
    // ctx.scale() (0.5 in preview, letterbox scale on export) and sometimes
    // after a mirroring scale(-1, 1). Sampling in layout units — what this used
    // to do — reads the wrong pixels entirely. Map the rect through the live
    // transform, then normalise to a positive-extent device rectangle.
    const t = typeof (ctx as { getTransform?: () => DOMMatrix }).getTransform === 'function'
      ? (ctx as unknown as { getTransform: () => DOMMatrix }).getTransform()
      : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const x0 = rect.x * t.a + rect.y * t.c + t.e;
    const y0 = rect.x * t.b + rect.y * t.d + t.f;
    const x1 = (rect.x + rect.width) * t.a + (rect.y + rect.height) * t.c + t.e;
    const y1 = (rect.x + rect.width) * t.b + (rect.y + rect.height) * t.d + t.f;
    const left = Math.max(0, Math.floor(Math.min(x0, x1)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1)));
    const right = Math.floor(Math.max(x0, x1));
    const bottom = Math.floor(Math.max(y0, y1));
    const x = left;
    const y = top;
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    const data = ctx.getImageData(x, y, w, h);
    const pixels = data.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      if (g > 90 && g > r * 1.25 && g > b * 1.25) pixels[i + 3] = 0;
    }
    ctx.putImageData(data, x, y);
  } catch {
    // Tainted canvas or unsupported context: leave the frame untouched.
  }
}

function cssFilter(clip: Clip, localSec = 0): string {
  const { brightness, contrast, exposure, saturation, temperature, vibrance } = clip.effects;
  const filterSpec = resolveColorFilter(clip.effects.colorFilter);
  const lutSpec = resolveCinematicLut(clip.effects.lut);
  const effectSpec = resolveVideoEffect(clip.effects.videoEffect);

  const parts: string[] = [];
  const b = 1 + brightness + exposure * 0.5;
  if (b !== 1) parts.push(`brightness(${clamp(b, 0, 3)})`);
  const c = 1 + contrast;
  if (c !== 1) parts.push(`contrast(${clamp(c, 0, 3)})`);
  const s = 1 + saturation + vibrance * 0.5;
  if (s !== 1) parts.push(`saturate(${clamp(s, 0, 3)})`);
  const sepiaVal = Math.max(temperature > 0 ? temperature : 0, filterSpec?.sepia ?? 0);
  if (sepiaVal > 0) parts.push(`sepia(${clamp(sepiaVal, 0, 1)})`);
  let hueDeg = temperature < 0 ? temperature * 30 : 0;
  if (filterSpec?.hueRotateDeg) hueDeg += filterSpec.hueRotateDeg;
  if (effectSpec?.hueSwingDeg) hueDeg += Math.sin(localSec * effectSpec.frequencyHz * Math.PI * 2) * effectSpec.hueSwingDeg;
  if (lutSpec && lutSpec.gamma !== 1) {
    parts.push(`brightness(${clamp(lutSpec.gamma, 0.5, 1.5)})`);
  }
  if (hueDeg !== 0) parts.push(`hue-rotate(${Math.round(hueDeg)}deg)`);
  return parts.join(' ') || 'none';
}

/** Scale 0→1 over the first and last 0.35 s, so the pill pops in and out. */
function stickerScale(clip: Clip, ticks: Tick): number {
  const ramp = Math.round(0.35 * 720_000);
  const local = Math.max(0, ticks - clip.startTicks);
  const fromEnd = clip.durationTicks - local;
  const t = Math.min(1, local / ramp, fromEnd / ramp);
  return 1 - Math.pow(1 - Math.max(0, t), 3);
}

function drawStickerClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const sticker = clip.sticker;
  if (!sticker) return;
  const opacity = clipOpacity(clip, ticks);
  const scale = stickerScale(clip, ticks);
  if (opacity <= 0 || scale <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const fontSize = Math.max(12, 44 * (width / 1920));
  const label = clip.label ?? '';
  const iconSize = fontSize * 1.1;
  ctx.save();
  ctx.font = fontString({ fontFamily: 'Inter', fontSize, fontWeight: 700 });
  const textWidth = ctx.measureText(label).width;
  const padX = fontSize * 0.8;
  const pillWidth = iconSize + fontSize * 0.6 + textWidth + padX * 2;
  const pillHeight = fontSize * 2;
  const cx = width * clip.transform.x;
  const cy = height * clip.transform.y;
  ctx.globalAlpha = opacity;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.fillStyle = sticker.color;
  roundRect(ctx, -pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();
  const iconX = -pillWidth / 2 + padX;
  ctx.fillStyle = sticker.textColor;
  ctx.strokeStyle = sticker.textColor;
  ctx.lineWidth = Math.max(2, fontSize * 0.12);
  drawStickerIcon(ctx, sticker.kind, iconX, 0, iconSize);
  ctx.fillStyle = sticker.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, iconX + iconSize + fontSize * 0.6, 0);
  ctx.restore();
}

/** Simple vector icons drawn from paths, so they stay sharp at any size. */
function drawStickerIcon(ctx: Ctx2D, kind: StickerKind, x: number, cy: number, size: number): void {
  const top = cy - size / 2;
  if (kind === 'bell') {
    ctx.beginPath();
    ctx.moveTo(x + size * 0.2, top + size * 0.7);
    ctx.quadraticCurveTo(x + size * 0.2, top + size * 0.05, x + size * 0.5, top + size * 0.05);
    ctx.quadraticCurveTo(x + size * 0.8, top + size * 0.05, x + size * 0.8, top + size * 0.7);
    ctx.lineTo(x + size * 0.92, top + size * 0.8);
    ctx.lineTo(x + size * 0.08, top + size * 0.8);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + size * 0.5, top + size * 0.9, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (kind === 'like') {
    ctx.beginPath();
    ctx.rect(x, top + size * 0.45, size * 0.22, size * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + size * 0.28, top + size * 0.95);
    ctx.lineTo(x + size * 0.28, top + size * 0.45);
    ctx.lineTo(x + size * 0.5, top + size * 0.05);
    ctx.quadraticCurveTo(x + size * 0.62, top + size * 0.05, x + size * 0.6, top + size * 0.35);
    ctx.lineTo(x + size * 0.92, top + size * 0.45);
    ctx.lineTo(x + size * 0.92, top + size * 0.95);
    ctx.closePath();
    ctx.stroke();
    return;
  }
  // Subscribe: a play triangle in a circle.
  ctx.beginPath();
  ctx.arc(x + size / 2, cy, size / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.4, top + size * 0.3);
  ctx.lineTo(x + size * 0.72, cy);
  ctx.lineTo(x + size * 0.4, top + size * 0.7);
  ctx.closePath();
  ctx.fill();
}

/** Contact bar: name and role on the left, email and LinkedIn with icons on the right. */
function drawContactClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const contact = clip.contact;
  if (!contact) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const fs = Math.max(14, 34 * (width / 1920));
  const barW = width * 0.6;
  const barH = fs * 3.4;
  const pad = fs * 0.9;
  // Slide up from below over the first 0.4 s; the fade is handled by clipOpacity.
  const ramp = Math.round(0.4 * 720_000);
  const local = Math.max(0, ticks - clip.startTicks);
  const ease = 1 - Math.pow(1 - Math.min(1, local / ramp), 3);
  const cx = width * clip.transform.x;
  const cy = height * clip.transform.y + (1 - ease) * barH * 0.6;
  const x0 = cx - barW / 2;
  const y0 = cy - barH / 2;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs, fontWeight: 700 });
  // Background, by style.
  if (contact.style === 'glass') {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = fs * 0.8;
    ctx.shadowOffsetY = fs * 0.2;
    ctx.fillStyle = 'rgba(12,18,30,0.55)';
  } else if (contact.style === 'gradient') {
    const grad = ctx.createLinearGradient(x0, 0, x0 + barW, 0);
    grad.addColorStop(0, contact.accent);
    grad.addColorStop(1, '#0d1117');
    ctx.fillStyle = grad;
  } else if (contact.style === 'accent') {
    ctx.fillStyle = contact.accent;
  } else {
    ctx.fillStyle = '#0d1117';
  }
  roundRect(ctx, x0, y0, barW, barH, fs * 0.6);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (contact.style === 'glass') {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(1, fs * 0.04);
    ctx.stroke();
  }
  // Left: name and role.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 1.15, fontWeight: 700 });
  ctx.fillText(contact.name, x0 + pad, cy - fs * 0.45);
  ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 0.72, fontWeight: 500 });
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(contact.role, x0 + pad, cy + fs * 0.6);
  // Right: email and LinkedIn rows, right-aligned, each with an icon.
  const iconSize = fs * 0.95;
  const right = x0 + barW - pad;
  ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 0.78, fontWeight: 500 });
  const rows: Array<{ text: string; y: number; icon: 'mail' | 'linkedin' }> = [
    { text: contact.email, y: cy - fs * 0.45, icon: 'mail' },
    { text: contact.linkedin.replace(/^https?:\/\/(www\.)?/, ''), y: cy + fs * 0.6, icon: 'linkedin' },
  ];
  for (const row of rows) {
    if (!row.text) continue;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(row.text, right, row.y);
    const textW = ctx.measureText(row.text).width;
    const iconX = right - textW - fs * 0.5 - iconSize;
    drawContactIcon(ctx, row.icon, iconX, row.y, iconSize);
  }
  ctx.restore();
}

/** Envelope and LinkedIn badge drawn from paths, so they stay sharp at any size. */
function drawContactIcon(ctx: Ctx2D, kind: 'mail' | 'linkedin', x: number, cy: number, size: number): void {
  const top = cy - size / 2;
  if (kind === 'linkedin') {
    ctx.fillStyle = '#0a66c2';
    roundRect(ctx, x, top, size, size, size * 0.18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = fontString({ fontFamily: 'Inter', fontSize: size * 0.7, fontWeight: 800 });
    ctx.fillText('in', x + size / 2, cy + size * 0.05);
    return;
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, size * 0.09);
  ctx.lineJoin = 'round';
  roundRect(ctx, x, top + size * 0.18, size, size * 0.66, size * 0.1);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size * 0.05, top + size * 0.25);
  ctx.lineTo(x + size / 2, top + size * 0.6);
  ctx.lineTo(x + size * 0.95, top + size * 0.25);
  ctx.stroke();
}

function drawArrowClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const arrow = clip.arrow;
  if (!arrow) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const x1 = width * arrow.from.x;
  const y1 = height * arrow.from.y;
  const x2 = width * arrow.to.x;
  const y2 = height * arrow.to.y;
  const stroke = Math.max(2, height * arrow.width);
  const head = stroke * 5;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = arrow.color;
  ctx.fillStyle = arrow.color;
  ctx.lineWidth = stroke;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTextClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const text = clip.text;
  if (!text) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const maxWidth = width * text.maxWidth;
  const fontSize = Math.max(8, text.fontSize * (width / 1920));
  const animSpec = resolveTextAnimation(text.animation);
  const emphasisSpec = resolveEmphasisStyle(text.emphasis);

  ctx.save();
  if (clip.alphaMask && clip.alphaMask.shape !== 'none') {
    applyAlphaMaskClip(ctx, clip.alphaMask, { x: 0, y: 0, width, height });
  }
  ctx.globalAlpha = opacity;
  const elapsed = Math.max(0, ticks - clip.startTicks) / Math.max(1, clip.durationTicks);
  const entranceProgress = animSpec ? clamp(elapsed / Math.max(0.05, animSpec.entranceFraction), 0, 1) : 1;
  const isTypewriter = Boolean(text.typewriter) || animSpec?.behavior === 'typewriter';
  const shown = isTypewriter
    ? text.text.slice(0, Math.floor(text.text.length * Math.min(1, elapsed / 0.6)))
    : text.text;

  const lines = wrapLines(ctx, shown, {
    fontFamily: text.fontFamily,
    fontSize,
    fontWeight: text.fontWeight,
    maxWidth,
    lineHeight: text.lineHeight,
    letterSpacing: text.letterSpacing,
  });
  ctx.font = fontString({ fontFamily: text.fontFamily, fontSize, fontWeight: text.fontWeight });
  ctx.textAlign = text.align;
  ctx.textBaseline = 'middle';
  const lineHeight = fontSize * text.lineHeight;
  const blockHeight = lines.length * lineHeight;

  let animOffsetX = 0;
  let animOffsetY = 0;
  let animScale = 1;
  if (animSpec) {
    const rem = 1 - ease(entranceProgress, 'ease-out');
    animOffsetX = animSpec.offsetX * width * rem;
    animOffsetY = animSpec.offsetY * height * rem;
    animScale = animSpec.initialScale + (1 - animSpec.initialScale) * ease(entranceProgress, 'ease-out');
    if (animSpec.behavior === 'word-bounce' || animSpec.behavior === 'wave') {
      animOffsetY += Math.sin(elapsed * Math.PI * 4) * fontSize * 0.14 * (1 - elapsed * 0.5);
    } else if (animSpec.behavior === 'glitch') {
      animOffsetX += Math.sin(elapsed * Math.PI * 18) * fontSize * 0.08;
    }
  }

  const centerX = width * clip.transform.x + animOffsetX;
  const centerY = height * clip.transform.y + animOffsetY;
  if (animScale !== 1 || (animSpec && animSpec.rotationDeg !== 0)) {
    ctx.translate(centerX, centerY);
    ctx.scale(animScale, animScale);
    if (animSpec && animSpec.rotationDeg !== 0) {
      const remRot = ((1 - entranceProgress) * animSpec.rotationDeg * Math.PI) / 180;
      ctx.rotate(remRot);
    }
    ctx.translate(-centerX, -centerY);
  }

  const startY = centerY - blockHeight / 2 + lineHeight / 2;
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  const padX = fontSize * 0.4;
  const boxX = text.align === 'left' ? centerX - maxWidth / 2 - padX : centerX - widest / 2 - padX;
  const boxW = text.align === 'left' ? Math.max(widest, maxWidth * 0.5) + padX * 2 : widest + padX * 2;
  if (text.backgroundOpacity > 0) {
    ctx.fillStyle = hexToRgba(text.background, text.backgroundOpacity);
    ctx.fillRect(
      boxX,
      startY - lineHeight / 2,
      boxW,
      blockHeight,
    );
  }

  if (emphasisSpec?.id === 'highlight') {
    ctx.fillStyle = hexToRgba(emphasisSpec.accentColor, 0.38);
    ctx.fillRect(boxX, startY - lineHeight * 0.42, boxW, blockHeight * 0.92);
  }

  if (text.glowColor && (text.glowBlur ?? 0) > 0) {
    ctx.shadowColor = text.glowColor;
    ctx.shadowBlur = text.glowBlur!;
  } else if (text.shadowColor && (text.shadowBlur ?? 0) > 0) {
    ctx.shadowColor = text.shadowColor;
    ctx.shadowBlur = text.shadowBlur!;
  }

  const highlighted = text.highlightLines && text.highlightLines.length > 0 ? new Set(text.highlightLines) : null;
  lines.forEach((line, index) => {
    const lineY = startY + index * lineHeight;
    if (highlighted?.has(index + 1)) {
      ctx.fillStyle = 'rgba(255, 209, 102, 0.22)';
      ctx.fillRect(boxX, lineY - lineHeight / 2, boxW, lineHeight);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(boxX, lineY - lineHeight / 2, Math.max(4, fontSize * 0.12), lineHeight);
    }
    const x = text.align === 'left' ? centerX - maxWidth / 2 : text.align === 'right' ? centerX + maxWidth / 2 : centerX;
    const promptMatch = text.cliMode ? /^(\s*(?:\$|#|❯|>)\s+)(.*)$/.exec(line) : null;
    if (promptMatch && text.align === 'left') {
      const promptToken = promptMatch[1]!;
      const rest = promptMatch[2]!;
      ctx.fillStyle = '#3fb950';
      ctx.fillText(promptToken, x, lineY);
      const promptW = ctx.measureText(promptToken).width;
      ctx.fillStyle = '#f0f6fc';
      ctx.fillText(rest, x + promptW, lineY);
    } else {
      if (text.strokeWidth && text.strokeWidth > 0) {
        ctx.strokeStyle = text.strokeColor ?? '#000000';
        ctx.lineWidth = text.strokeWidth * (width / 1920);
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, lineY);
      }
      if (text.gradientToColor && !text.cliMode) {
        const grad = ctx.createLinearGradient(boxX, lineY - fontSize / 2, boxX + boxW, lineY + fontSize / 2);
        grad.addColorStop(0, text.color);
        grad.addColorStop(1, text.gradientToColor);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = text.cliMode ? '#8b949e' : text.color;
      }
      ctx.fillText(line, x, lineY);
    }
  });

  if (emphasisSpec && emphasisSpec.id !== 'highlight') {
    ctx.strokeStyle = emphasisSpec.accentColor;
    ctx.fillStyle = emphasisSpec.accentColor;
    ctx.lineWidth = Math.max(2, fontSize * emphasisSpec.strokeWidthRatio);
    if (emphasisSpec.id === 'underline') {
      const underY = startY + (lines.length - 1) * lineHeight + fontSize * 0.48;
      ctx.beginPath();
      ctx.moveTo(boxX + padX * 0.5, underY);
      ctx.lineTo(boxX + boxW - padX * 0.5, underY);
      ctx.stroke();
    } else if (emphasisSpec.id === 'strikethrough') {
      const midY = startY + ((lines.length - 1) * lineHeight) / 2;
      ctx.beginPath();
      ctx.moveTo(boxX + padX * 0.4, midY);
      ctx.lineTo(boxX + boxW - padX * 0.4, midY);
      ctx.stroke();
    } else if (emphasisSpec.id === 'circle') {
      ctx.beginPath();
      roundRect(ctx, boxX - padX * 0.3, startY - lineHeight * 0.65, boxW + padX * 0.6, blockHeight + lineHeight * 0.3, blockHeight * 0.6);
      ctx.stroke();
    } else if (emphasisSpec.id === 'sparkle') {
      const r = Math.max(4, fontSize * 0.18);
      ctx.beginPath();
      ctx.arc(boxX, startY - lineHeight * 0.35, r, 0, Math.PI * 2);
      ctx.arc(boxX + boxW, startY + blockHeight - lineHeight * 0.65, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawKeystrokeClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const keystroke = clip.keystroke;
  if (!keystroke || keystroke.keys.length === 0) return;
  const opacity = clipOpacity(clip, ticks);
  const scale = stickerScale(clip, ticks);
  if (opacity <= 0 || scale <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const fs = Math.max(12, 38 * (width / 1920));
  const padX = fs * 0.55;
  const keyGap = fs * 0.65;
  const keyH = fs * 1.75;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = fontString({ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: fs, fontWeight: 700 });
  const keyWidths = keystroke.keys.map((k) => Math.max(keyH, ctx.measureText(k).width + padX * 2));
  const totalKeysW = keyWidths.reduce((a, b) => a + b, 0) + Math.max(0, keystroke.keys.length - 1) * keyGap;
  const labelW = keystroke.label ? ctx.measureText(keystroke.label).width + padX * 1.5 : 0;
  const cardW = totalKeysW + labelW + padX * 2;
  const cardH = keyH + fs * 0.8;
  const cx = width * clip.transform.x;
  const cy = height * clip.transform.y;

  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  ctx.fillStyle = keystroke.style === 'light' ? 'rgba(240, 246, 252, 0.92)' : 'rgba(13, 17, 23, 0.88)';
  roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, fs * 0.45);
  ctx.fill();

  let cursorX = -cardW / 2 + padX;
  keystroke.keys.forEach((key, idx) => {
    const kw = keyWidths[idx]!;
    ctx.fillStyle = keystroke.style === 'light' ? '#ffffff' : '#21262d';
    roundRect(ctx, cursorX, -keyH / 2, kw, keyH, fs * 0.28);
    ctx.fill();
    ctx.strokeStyle = keystroke.style === 'light' ? '#d0d7de' : '#58a6ff';
    ctx.lineWidth = Math.max(1.5, fs * 0.06);
    ctx.stroke();

    ctx.fillStyle = keystroke.style === 'light' ? '#0d1117' : '#f0f6fc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(key, cursorX + kw / 2, 0);
    cursorX += kw;

    if (idx < keystroke.keys.length - 1) {
      ctx.fillStyle = '#8b949e';
      ctx.fillText('+', cursorX + keyGap / 2, 0);
      cursorX += keyGap;
    }
  });

  if (keystroke.label) {
    ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 0.78, fontWeight: 600 });
    ctx.fillStyle = keystroke.style === 'light' ? '#24292f' : '#ffd166';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(keystroke.label, cursorX + padX * 0.75, 0);
  }
  ctx.restore();
}

function drawEndScreenClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const endScreen = clip.endScreen;
  if (!endScreen) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const zones = endScreenZone({ width, height });
  const fs = Math.max(12, 36 * (width / 1920));

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = 'rgba(11, 15, 20, 0.76)';
  ctx.fillRect(0, 0, width, height);

  ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 1.35, fontWeight: 800 });
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(endScreen.heading, width / 2, height * 0.1);

  if (endScreen.showSubscribe) {
    const sub = zones.subscribe;
    ctx.fillStyle = endScreen.accent;
    roundRect(ctx, sub.x - sub.width * 0.4, sub.y + sub.height * 0.2, sub.width * 1.8, sub.height * 0.55, sub.height * 0.28);
    ctx.fill();
    ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 0.9, fontWeight: 700 });
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SUBSCRIBE', width / 2, sub.y + sub.height * 0.48);
  }

  for (const [slot, title] of [
    [zones.leftVideo, endScreen.leftTitle],
    [zones.rightVideo, endScreen.rightTitle],
  ] as const) {
    ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
    roundRect(ctx, slot.x, slot.y, slot.width, slot.height, fs * 0.45);
    ctx.fill();
    ctx.strokeStyle = endScreen.accent;
    ctx.lineWidth = Math.max(2, fs * 0.08);
    ctx.stroke();

    ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs * 0.85, fontWeight: 700 });
    ctx.fillStyle = '#f0f6fc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, slot.x + slot.width / 2, slot.y + slot.height / 2);
  }

  ctx.restore();
}

function drawEndScreenGuide(ctx: Ctx2D, project: Project, ticks: Tick): void {
  const width = project.canvas.width;
  const height = project.canvas.height;
  const zones = endScreenZone({ width, height });
  const inLast20s = project.durationTicks > 0 && project.durationTicks - ticks <= 20 * TICKS_PER_SECOND;
  const color = inLast20s ? 'rgba(63, 185, 80, 0.85)' : 'rgba(88, 166, 255, 0.65)';
  const fs = Math.max(10, 24 * (width / 1920));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = Math.max(2, width / 960);

  ctx.strokeRect(zones.subscribe.x, zones.subscribe.y, zones.subscribe.width, zones.subscribe.height);
  ctx.strokeRect(zones.leftVideo.x, zones.leftVideo.y, zones.leftVideo.width, zones.leftVideo.height);
  ctx.strokeRect(zones.rightVideo.x, zones.rightVideo.y, zones.rightVideo.width, zones.rightVideo.height);

  ctx.setLineDash([]);
  ctx.font = fontString({ fontFamily: 'Inter', fontSize: fs, fontWeight: 600 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Subscribe slot', zones.subscribe.x + zones.subscribe.width / 2, zones.subscribe.y - 6);
  ctx.fillText('Video slot 1 (20s end screen)', zones.leftVideo.x + zones.leftVideo.width / 2, zones.leftVideo.y - 6);
  ctx.fillText('Video slot 2 (20s end screen)', zones.rightVideo.x + zones.rightVideo.width / 2, zones.rightVideo.y - 6);
  ctx.restore();
}

function drawProgressBarClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const bar = clip.progressBar;
  if (!bar) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const barH = Math.max(4, height * bar.height);
  const y = bar.position === 'top' ? 0 : height - barH;
  const progress = clamp((ticks - clip.startTicks) / Math.max(1, clip.durationTicks), 0, 1);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = bar.backgroundColor;
  ctx.fillRect(0, y, width, barH);
  ctx.fillStyle = bar.color;
  ctx.fillRect(0, y, width * progress, barH);
  ctx.restore();
}

function drawPulseClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const pulse = clip.pulse;
  if (!pulse) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const cx = width * pulse.x;
  const cy = height * pulse.y;
  const progress = clamp((ticks - clip.startTicks) / Math.max(1, clip.durationTicks), 0, 1);
  const maxR = Math.min(width, height) * 0.085;
  const rings = Math.max(1, pulse.rings);

  ctx.save();
  ctx.strokeStyle = pulse.color;
  for (let i = 0; i < rings; i += 1) {
    const phase = (progress + i / rings) % 1;
    const radius = Math.max(4, maxR * phase);
    ctx.globalAlpha = opacity * (1 - phase);
    ctx.lineWidth = Math.max(2, (width / 640) * (1 - phase * 0.5));
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = opacity;
  ctx.fillStyle = pulse.color;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(5, width * 0.005), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCountdownClip(ctx: Ctx2D, project: Project, clip: Clip, ticks: Tick): void {
  const cd = clip.countdown;
  if (!cd) return;
  const opacity = clipOpacity(clip, ticks);
  if (opacity <= 0) return;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const elapsedSec = Math.max(0, (ticks - clip.startTicks) / TICKS_PER_SECOND);
  const remaining = Math.max(0, Math.ceil(cd.seconds - elapsedSec));
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const clock = `${mm}:${ss}`;
  const display = cd.label ? `${cd.label} ${clock}` : clock;
  const fs = Math.max(14, 42 * (width / 1920));

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = fontString({ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: fs, fontWeight: 800 });
  const textW = ctx.measureText(display).width;
  const padX = fs * 0.6;
  const boxW = textW + padX * 2;
  const boxH = fs * 1.65;
  const cx = width * clip.transform.x;
  const cy = height * clip.transform.y;

  ctx.fillStyle = 'rgba(13, 17, 23, 0.9)';
  roundRect(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, fs * 0.35);
  ctx.fill();
  ctx.strokeStyle = cd.color;
  ctx.lineWidth = Math.max(2, fs * 0.08);
  ctx.stroke();

  ctx.fillStyle = cd.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(display, cx, cy);
  ctx.restore();
}

export function drawCue(ctx: Ctx2D, project: Project, cue: CaptionCue, ticks: Tick): void {
  const style = project.captionStyle;
  const width = project.canvas.width;
  const height = project.canvas.height;
  const unit = width / 1920;
  const fontSize = Math.max(10, style.fontSize * unit);
  ctx.save();
  ctx.font = `600 ${fontSize}px ${style.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  let text = cue.text;
  if (style.uppercase) text = text.toUpperCase();
  const lines = chunkCaptionText(text, style.maxLineChars);
  const lineHeight = fontSize * 1.28;
  const blockHeight = lines.length * lineHeight;
  const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
  const centerX = width / 2;
  const bottomY = height * (1 - style.marginBottom);
  const topY = bottomY - blockHeight;
  const padding = fontSize * 0.35;
  const boxWidth = maxWidth + padding * 2;
  const boxX = style.align === 'left' ? width * style.marginX : style.align === 'right' ? width * (1 - style.marginX) - boxWidth : centerX - boxWidth / 2;

  if (style.backgroundOpacity > 0) {
    ctx.fillStyle = hexToRgba(style.background, style.backgroundOpacity);
    roundRect(ctx, boxX, topY - padding * 0.6, boxWidth, blockHeight + padding * 1.2, fontSize * 0.18);
    ctx.fill();
  }
  if (style.outlineWidth > 0) {
    ctx.lineWidth = style.outlineWidth * unit;
    ctx.strokeStyle = style.outlineColor;
    ctx.lineJoin = 'round';
  }
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align === 'left' ? 'left' : style.align === 'right' ? 'right' : 'center';
  const textX = style.align === 'left' ? boxX + padding : style.align === 'right' ? boxX + boxWidth - padding : centerX;
  lines.forEach((line, index) => {
    const y = topY + index * lineHeight + fontSize * 0.92;
    if (style.outlineWidth > 0) ctx.strokeText(line, textX, y);
    ctx.fillText(line, textX, y);
    if (style.wordHighlight && cue.words?.length) {
      drawWordHighlight(ctx, cue, line, textX, y, fontSize, ticks, style.wordHighlightColor, style.align);
    }
  });
  ctx.restore();
}

function drawWordHighlight(
  ctx: Ctx2D,
  cue: CaptionCue,
  line: string,
  textX: number,
  baselineY: number,
  fontSize: number,
  ticks: Tick,
  color: string,
  align: 'left' | 'center' | 'right',
): void {
  const word = cue.words?.find((w) => ticks >= w.startTicks && ticks < w.endTicks && line.includes(w.text));
  if (!word) return;
  const index = line.indexOf(word.text);
  if (index < 0) return;
  const prefix = line.slice(0, index);
  const prefixWidth = ctx.measureText(prefix).width;
  const wordWidth = ctx.measureText(word.text).width;
  const lineWidth = ctx.measureText(line).width;
  const lineStartX =
    align === 'left' ? textX : align === 'right' ? textX - lineWidth : textX - lineWidth / 2;
  const x = lineStartX + prefixWidth;
  ctx.save();
  ctx.fillStyle = color;
  const h = fontSize * 0.12;
  const y = baselineY + fontSize * 0.12;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, y, wordWidth, h);
  ctx.restore();
}

function drawCaptionGuide(ctx: Ctx2D, project: Project): void {
  const width = project.canvas.width;
  const height = project.canvas.height;
  const y = height * project.captionStyle.positionY;
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.4)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = Math.max(2, width / 1200);
  ctx.beginPath();
  ctx.moveTo(width * project.captionStyle.marginX, y);
  ctx.lineTo(width * (1 - project.captionStyle.marginX), y);
  ctx.stroke();
  ctx.restore();
}

export function roundRect(ctx: Ctx2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgb')) {
    const inner = hex.replace(/rgba?\(|\)/g, '').split(',').map((v) => Number(v.trim()));
    const [r, g, b, a = 1] = inner;
    return `rgba(${r}, ${g}, ${b}, ${clamp(a * alpha, 0, 1)})`;
  }
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return `rgba(0,0,0,${alpha})`;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    return canvas;
  }
  return null;
}

