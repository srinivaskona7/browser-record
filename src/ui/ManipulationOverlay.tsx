import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../project/store';
import * as ops from '../project/ops';
import { computePlacement, presenterBubble } from '../render/layout';
import type { Clip, PresenterProps, Project } from '../project/types';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
/** Base size of the scaled box pieces (styles.css .manipulation-fill / -edge), in px. */
const PIECE_BASE = 100;
type Handle = (typeof HANDLES)[number];

interface ManipulableTarget {
  clip: Clip;
  isPresenterBubble: boolean;
  placement: { x: number; y: number; width: number; height: number; rotation: number };
}

function resolveManipulableClip(project: Project, ids: readonly string[]): ManipulableTarget | null {
  for (const id of ids) {
    const clip = ops.findClipById(project, id);
    if (!clip) continue;
    if (clip.presenter && (clip.presenter.layout ?? 'bubble') === 'bubble') {
      const bubble = presenterBubble({ canvas: project.canvas, presenter: clip.presenter });
      return {
        clip,
        isPresenterBubble: true,
        placement: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height, rotation: 0 },
      };
    }
    if (clip.assetId) {
      const asset = project.assets.find((item) => item.id === clip.assetId);
      if (asset?.width && asset?.height) {
        return {
          clip,
          isPresenterBubble: false,
          placement: computePlacement({
            canvas: project.canvas,
            source: { width: asset.width, height: asset.height },
            transform: clip.transform,
          }),
        };
      }
    }
    if (clip.kind === 'title' || clip.kind === 'sticker' || clip.kind === 'contact') {
      const w = project.canvas.width * Math.max(0.18, Math.min(0.9, (clip.text?.maxWidth ?? 0.45) * clip.transform.scale));
      const h = project.canvas.height * Math.max(0.1, Math.min(0.5, 0.16 * clip.transform.scale));
      return {
        clip,
        isPresenterBubble: false,
        placement: {
          x: clip.transform.x * project.canvas.width - w / 2,
          y: clip.transform.y * project.canvas.height - h / 2,
          width: w,
          height: h,
          rotation: (clip.transform.rotationDeg * Math.PI) / 180,
        },
      };
    }
  }
  return null;
}

function nearestCorner(x: number, y: number): PresenterProps['corner'] {
  if (x < 0.5 && y < 0.5) return 'top-left';
  if (x >= 0.5 && y < 0.5) return 'top-right';
  if (x < 0.5 && y >= 0.5) return 'bottom-left';
  return 'bottom-right';
}

/**
 * Direct manipulation for the preview: move, scale and rotate the selected
 * clip (or presenter camera bubble in both portrait and landscape) with pointer
 * handles, plus keyboard equivalents. Commits one undo entry per gesture.
 */
export function ManipulationOverlay({ project }: { project: Project }) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectClips = useEditor((state) => state.selectClips);
  const beginGesture = useEditor((state) => state.beginGesture);
  const updateGesture = useEditor((state) => state.updateGesture);
  const endGesture = useEditor((state) => state.endGesture);
  const cancelGesture = useEditor((state) => state.cancelGesture);
  const showSafeAreas = useEditor((state) => state.showSafeAreas);
  const playheadTicks = useEditor((state) => state.playheadTicks);
  const [canvasRect, setCanvasRect] = useState<Rect | null>(null);
  const drag = useRef<{
    pointerId: number;
    mode: 'move' | Handle | 'rotate';
    isPresenterBubble: boolean;
    startX: number;
    startY: number;
    startTransform: Clip['transform'];
    startPresenter?: PresenterProps;
    startBubbleCenterNorm?: { x: number; y: number };
    centerX: number;
    centerY: number;
    startAngle: number;
  } | null>(null);

  const measure = useCallback(() => {
    const host = canvasHostRef.current;
    const canvas = host?.parentElement?.querySelector('canvas.preview-canvas') as HTMLCanvasElement | null;
    const shell = host?.parentElement;
    if (!canvas || !shell) return;
    const canvasBox = canvas.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    setCanvasRect({
      left: canvasBox.left - shellBox.left,
      top: canvasBox.top - shellBox.top,
      width: canvasBox.width,
      height: canvasBox.height,
    });
  }, []);

  useEffect(() => {
    measure();
    const host = canvasHostRef.current;
    const shell = host?.parentElement;
    if (!shell || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    const canvas = shell.querySelector('canvas.preview-canvas');
    if (canvas) observer.observe(canvas);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const selected = resolveManipulableClip(project, selectedClipIds);
  const placement = selected?.placement ?? null;

  const toFractions = (dxPx: number, dyPx: number) => ({
    x: canvasRect && canvasRect.width > 0 ? dxPx / canvasRect.width : 0,
    y: canvasRect && canvasRect.height > 0 ? dyPx / canvasRect.height : 0,
  });

  const snappedX = (value: number, widthFraction: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    const half = widthFraction / 2;
    const targets = [0.5, half, 1 - half];
    for (const target of targets) {
      if (Math.abs(clamped - target) < 0.008) return target;
    }
    return clamped;
  };

  const snappedY = (value: number, heightFraction: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    const half = heightFraction / 2;
    const targets = [0.5, half, 1 - half];
    for (const target of targets) {
      if (Math.abs(clamped - target) < 0.008) return target;
    }
    return clamped;
  };

  const patchTransform = (patch: Partial<Clip['transform']>) => {
    if (!selected) return;
    updateGesture((next) => ops.updateClipDeep(next, selected.clip.id, { transform: patch }));
  };

  const patchPresenter = (patch: Partial<PresenterProps>) => {
    if (!selected) return;
    updateGesture((next) => ops.updateClipDeep(next, selected.clip.id, { presenter: patch }));
  };

  const startDrag = (event: React.PointerEvent, mode: 'move' | Handle | 'rotate') => {
    if (!selected || !placement || !canvasRect) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    // canvasRect is relative to the preview shell; pointer events are in viewport pixels, so the
    // pivot for rotate and corner-scale must be too, or it sits wherever the shell is offset to.
    const shell = canvasHostRef.current?.parentElement?.getBoundingClientRect();
    const centerX =
      (shell?.left ?? 0) + canvasRect.left + (placement.x + placement.width / 2) * (canvasRect.width / project.canvas.width);
    const centerY =
      (shell?.top ?? 0) + canvasRect.top + (placement.y + placement.height / 2) * (canvasRect.height / project.canvas.height);
    beginGesture(
      selected.isPresenterBubble
        ? mode === 'move'
          ? 'Move presenter bubble'
          : 'Resize presenter bubble'
        : mode === 'move'
          ? 'Move clip'
          : mode === 'rotate'
            ? 'Rotate clip'
            : 'Scale clip',
    );
    drag.current = {
      pointerId: event.pointerId,
      mode,
      isPresenterBubble: selected.isPresenterBubble,
      startX: event.clientX,
      startY: event.clientY,
      startTransform: { ...selected.clip.transform },
      ...(selected.clip.presenter ? { startPresenter: { ...selected.clip.presenter } } : {}),
      startBubbleCenterNorm: {
        x: (placement.x + placement.width / 2) / project.canvas.width,
        y: (placement.y + placement.height / 2) / project.canvas.height,
      },
      centerX,
      centerY,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    };
  };

  const onMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId || !canvasRect || !selected || !placement) return;
    event.preventDefault();
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (state.isPresenterBubble && state.startPresenter && state.startBubbleCenterNorm) {
      if (state.mode === 'move') {
        const delta = toFractions(dx, dy);
        const wFrac = placement.width / project.canvas.width;
        const hFrac = placement.height / project.canvas.height;
        const nextX = snappedX(state.startBubbleCenterNorm.x + delta.x, wFrac);
        const nextY = snappedY(state.startBubbleCenterNorm.y + delta.y, hFrac);
        patchPresenter({
          x: nextX,
          y: nextY,
          corner: nearestCorner(nextX, nextY),
        });
        return;
      }
      if (state.mode !== 'rotate') {
        const startDistance = Math.max(8, Math.hypot(state.startX - state.centerX, state.startY - state.centerY));
        const distance = Math.hypot(event.clientX - state.centerX, event.clientY - state.centerY);
        const size = Math.max(0.08, Math.min(0.85, (state.startPresenter.size * distance) / startDistance));
        patchPresenter({ size });
      }
      return;
    }

    if (state.mode === 'move') {
      const delta = toFractions(dx, dy);
      // The placement is already scaled; its half-size is what snaps a clip edge to the canvas edge.
      const widthFraction = placement.width / project.canvas.width;
      const heightFraction = placement.height / project.canvas.height;
      patchTransform({
        x: snappedX(state.startTransform.x + delta.x, widthFraction),
        y: snappedY(state.startTransform.y + delta.y, heightFraction),
      });
      return;
    }
    if (state.mode === 'rotate') {
      const angle = Math.atan2(event.clientY - state.centerY, event.clientX - state.centerX);
      const degrees = ((angle - state.startAngle) * 180) / Math.PI;
      patchTransform({ rotationDeg: ((state.startTransform.rotationDeg + degrees) % 360 + 360) % 360 });
      return;
    }
    // Corner scale: distance from the clip centre relative to the grab distance.
    const startDistance = Math.max(
      8,
      Math.hypot(state.startX - state.centerX, state.startY - state.centerY),
    );
    const distance = Math.hypot(event.clientX - state.centerX, event.clientY - state.centerY);
    const scale = Math.max(0.05, Math.min(4, (state.startTransform.scale * distance) / startDistance));
    patchTransform({ scale });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    endGesture();
  };

  // A cancelled pointer (the OS took it, a palm, a scroll) reverts the drag instead of leaving
  // the gesture open for the next edit to land in.
  const cancelDrag = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    cancelGesture();
  };

  // Unmounting mid-drag (the selection was cleared) still closes the gesture as one entry.
  useEffect(
    () => () => {
      if (!drag.current) return;
      drag.current = null;
      useEditor.getState().endGesture();
    },
    [],
  );

  const nudge = (event: React.KeyboardEvent) => {
    if (!selected) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    if (selected.isPresenterBubble && selected.clip.presenter) {
      const curX = (placement!.x + placement!.width / 2) / project.canvas.width;
      const curY = (placement!.y + placement!.height / 2) / project.canvas.height;
      const map: Record<string, Partial<PresenterProps>> = {
        ArrowLeft: { x: Math.max(0, curX - step) },
        ArrowRight: { x: Math.min(1, curX + step) },
        ArrowUp: { y: Math.max(0, curY - step) },
        ArrowDown: { y: Math.min(1, curY + step) },
      };
      const patch = map[event.key];
      if (patch) {
        event.preventDefault();
        useEditor
          .getState()
          .apply('Nudge presenter bubble', (next) =>
            ops.updateClipDeep(next, selected.clip.id, { presenter: patch }),
          );
      }
      return;
    }
    const map: Record<string, Partial<Clip['transform']>> = {
      ArrowLeft: { x: Math.max(0, selected.clip.transform.x - step) },
      ArrowRight: { x: Math.min(1, selected.clip.transform.x + step) },
      ArrowUp: { y: Math.max(0, selected.clip.transform.y - step) },
      ArrowDown: { y: Math.min(1, selected.clip.transform.y + step) },
      '[': { rotationDeg: (selected.clip.transform.rotationDeg - 1 + 360) % 360 },
      ']': { rotationDeg: (selected.clip.transform.rotationDeg + 1) % 360 },
    };
    const patch = map[event.key];
    if (patch) {
      event.preventDefault();
      useEditor
        .getState()
        .apply('Nudge clip on canvas', (next) => ops.updateClipDeep(next, selected.clip.id, { transform: patch }));
    }
  };

  // Click on empty canvas selects the topmost clip (including presenter bubble) under the pointer.
  const onCanvasPointerDown = (event: React.PointerEvent) => {
    if (event.target !== event.currentTarget || !canvasRect) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (event.clientX - bounds.left) / bounds.width;
    const fy = (event.clientY - bounds.top) / bounds.height;
    // Check presenter bubbles first because they sit on top of the screen track
    for (const track of [...project.tracks].reverse()) {
      if (track.kind !== 'video' || track.hidden) continue;
      for (const clip of [...track.clips].reverse()) {
        if (playheadTicks < clip.startTicks || playheadTicks >= ops.clipEnd(clip)) continue;
        if (clip.presenter && clip.presenter.visible !== false && (clip.presenter.layout ?? 'bubble') === 'bubble') {
          const b = presenterBubble({ canvas: project.canvas, presenter: clip.presenter });
          const x0 = b.x / project.canvas.width;
          const y0 = b.y / project.canvas.height;
          const x1 = (b.x + b.width) / project.canvas.width;
          const y1 = (b.y + b.height) / project.canvas.height;
          if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) {
            selectClips([clip.id]);
            return;
          }
        }
      }
    }
    for (const track of [...project.tracks].reverse()) {
      if (track.kind !== 'video' || track.hidden) continue;
      for (const clip of [...track.clips].reverse()) {
        if (playheadTicks < clip.startTicks || playheadTicks >= ops.clipEnd(clip)) continue;
        const asset = clip.assetId ? project.assets.find((item) => item.id === clip.assetId) : null;
        if (!asset?.width || !asset?.height) continue;
        const place = computePlacement({
          canvas: project.canvas,
          source: { width: asset.width, height: asset.height },
          transform: clip.transform,
        });
        const x0 = place.x / project.canvas.width;
        const y0 = place.y / project.canvas.height;
        const x1 = (place.x + place.width) / project.canvas.width;
        const y1 = (place.y + place.height) / project.canvas.height;
        if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) {
          selectClips([clip.id]);
          return;
        }
      }
    }
  };

  if (!selected || !placement || !canvasRect) {
    return <div ref={canvasHostRef} className="manipulation-layer" aria-hidden />;
  }

  // Every piece hangs off the clip centre, rotated with the clip, and moves by transform only:
  // a drag never touches left/top/width/height (styles.css "Direct manipulation").
  const scaleX = canvasRect.width / project.canvas.width;
  const scaleY = canvasRect.height / project.canvas.height;
  const width = placement.width * scaleX;
  const height = placement.height * scaleY;
  const halfW = width / 2;
  const halfH = height / 2;
  const centreX = canvasRect.left + (placement.x + placement.width / 2) * scaleX;
  const centreY = canvasRect.top + (placement.y + placement.height / 2) * scaleY;
  const rotation = selected.isPresenterBubble ? 0 : selected.clip.transform.rotationDeg;
  const origin = `translate3d(${centreX}px, ${centreY}px, 0) rotate(${rotation}deg)`;
  const at = (x: number, y: number | string) =>
    `${origin} translate3d(${x}px, ${typeof y === 'number' ? `${y}px` : y}, 0)`;
  const scaleLabel = selected.isPresenterBubble
    ? `${Math.round((selected.clip.presenter?.size ?? 0.24) * 100)}%`
    : `${Math.round(selected.clip.transform.scale * 100)}%`;

  return (
    <div ref={canvasHostRef} className="manipulation-layer">
      <div
        className="manipulation-layer"
        style={{
          left: canvasRect.left,
          top: canvasRect.top,
          right: 'auto',
          bottom: 'auto',
          width: canvasRect.width,
          height: canvasRect.height,
          pointerEvents: 'auto',
        }}
        onPointerDown={onCanvasPointerDown}
      />
      {showSafeAreas && (
        <div
          aria-hidden
          className="manipulation-layer"
          style={{
            left: canvasRect.left + canvasRect.width * 0.05,
            top: canvasRect.top + canvasRect.height * 0.05,
            right: 'auto',
            bottom: 'auto',
            width: canvasRect.width * 0.9,
            height: canvasRect.height * 0.9,
            border: '1px dashed rgba(218, 250, 156, 0.45)',
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        className="manipulation-layer"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
      >
        <div
          className="manipulation-fill"
          role="group"
          aria-label={`Selected clip ${selected.clip.label ?? selected.clip.kind}. Arrow keys move, [ and ] rotate.`}
          tabIndex={0}
          style={{ transform: `${at(-halfW, -halfH)} scale(${width / PIECE_BASE}, ${height / PIECE_BASE})` }}
          onPointerDown={(event) => startDrag(event, 'move')}
          onKeyDown={nudge}
        />
        <div className="manipulation-edge" data-side="top" aria-hidden style={{ transform: `${at(-halfW, -halfH)} translateY(-50%) scaleX(${width / PIECE_BASE})` }} />
        <div className="manipulation-edge" data-side="bottom" aria-hidden style={{ transform: `${at(-halfW, halfH)} translateY(-50%) scaleX(${width / PIECE_BASE})` }} />
        <div className="manipulation-edge" data-side="left" aria-hidden style={{ transform: `${at(-halfW, -halfH)} translateX(-50%) scaleY(${height / PIECE_BASE})` }} />
        <div className="manipulation-edge" data-side="right" aria-hidden style={{ transform: `${at(halfW, -halfH)} translateX(-50%) scaleY(${height / PIECE_BASE})` }} />
        <span className="manipulation-badge" style={{ transform: `${at(-halfW, -halfH)} translateY(calc(-100% - 6px))` }}>
          {selected.clip.label ?? (selected.isPresenterBubble ? 'Presenter' : 'Clip')} · {scaleLabel}
        </span>
        {!selected.isPresenterBubble && (
          <div
            className="manipulation-rotate"
            role="button"
            tabIndex={-1}
            aria-label="Rotate clip"
            style={{ transform: `${at(0, `calc(${-halfH}px - var(--rotate-gap))`)} translate(-50%, -50%)` }}
            onPointerDown={(event) => startDrag(event, 'rotate')}
          />
        )}
        {HANDLES.map((handle) => (
          <div
            key={handle}
            className={`manipulation-handle ${handle}`}
            role="button"
            tabIndex={-1}
            aria-label={`Scale from ${handle} corner`}
            style={{
              transform: `${at(handle.endsWith('w') ? -halfW : halfW, handle.startsWith('n') ? -halfH : halfH)} translate(-50%, -50%)`,
            }}
            onPointerDown={(event) => startDrag(event, handle)}
          />
        ))}
      </div>
    </div>
  );
}
