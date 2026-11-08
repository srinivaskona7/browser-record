import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../project/store';
import * as ops from '../project/ops';
import { computePlacement } from '../render/layout';
import type { Clip, Project } from '../project/types';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const HANDLES = ['nw', 'ne', 'sw', 'se'] as const;
type Handle = (typeof HANDLES)[number];

function mediaClip(project: Project, ids: readonly string[]): { clip: Clip; asset: Project['assets'][number] } | null {
  for (const id of ids) {
    const clip = ops.findClipById(project, id);
    if (!clip?.assetId) continue;
    const asset = project.assets.find((item) => item.id === clip.assetId);
    if (!asset?.width || !asset?.height) continue;
    return { clip, asset };
  }
  return null;
}

/**
 * Direct manipulation for the preview: move, scale and rotate the selected
 * clip with pointer handles, plus keyboard equivalents. One undo entry per
 * gesture (the store records a snapshot on begin and commits on release).
 */
export function ManipulationOverlay({ project }: { project: Project }) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectClips = useEditor((state) => state.selectClips);
  const beginGesture = useEditor((state) => state.beginGesture);
  const updateGesture = useEditor((state) => state.updateGesture);
  const endGesture = useEditor((state) => state.endGesture);
  const showSafeAreas = useEditor((state) => state.showSafeAreas);
  const playheadTicks = useEditor((state) => state.playheadTicks);
  const [canvasRect, setCanvasRect] = useState<Rect | null>(null);
  const drag = useRef<{
    mode: 'move' | Handle | 'rotate';
    startX: number;
    startY: number;
    start: Clip['transform'];
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

  const selected = mediaClip(project, selectedClipIds);
  const placement =
    selected && canvasRect
      ? computePlacement({
          canvas: project.canvas,
          source: { width: selected.asset.width!, height: selected.asset.height! },
          transform: selected.clip.transform,
        })
      : null;

  const toFractions = (dxPx: number, dyPx: number) => ({
    x: canvasRect ? dxPx / canvasRect.width : 0,
    y: canvasRect ? dyPx / canvasRect.height : 0,
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

  const startDrag = (event: React.PointerEvent, mode: 'move' | Handle | 'rotate') => {
    if (!selected || !placement || !canvasRect) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const centerX = canvasRect.left + (placement.x + placement.width / 2) * (canvasRect.width / project.canvas.width);
    const centerY = canvasRect.top + (placement.y + placement.height / 2) * (canvasRect.height / project.canvas.height);
    beginGesture(mode === 'move' ? 'Move clip' : mode === 'rotate' ? 'Rotate clip' : 'Scale clip');
    drag.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...selected.clip.transform },
      centerX,
      centerY,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    };
  };

  const onMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state || !canvasRect || !selected || !placement) return;
    event.preventDefault();
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (state.mode === 'move') {
      const delta = toFractions(dx, dy);
      const widthFraction = (placement.width / project.canvas.width) * state.start.scale;
      const heightFraction = (placement.height / project.canvas.height) * state.start.scale;
      patchTransform({
        x: snappedX(state.start.x + delta.x, widthFraction),
        y: snappedY(state.start.y + delta.y, heightFraction),
      });
      return;
    }
    if (state.mode === 'rotate') {
      const angle = Math.atan2(event.clientY - state.centerY, event.clientX - state.centerX);
      const degrees = ((angle - state.startAngle) * 180) / Math.PI;
      patchTransform({ rotationDeg: ((state.start.rotationDeg + degrees) % 360 + 360) % 360 });
      return;
    }
    // Corner scale: distance from the clip centre relative to the grab distance.
    const startDistance = Math.max(
      8,
      Math.hypot(state.startX - state.centerX, state.startY - state.centerY),
    );
    const distance = Math.hypot(event.clientX - state.centerX, event.clientY - state.centerY);
    const scale = Math.max(0.05, Math.min(4, (state.start.scale * distance) / startDistance));
    patchTransform({ scale });
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    endGesture();
  };

  const nudge = (event: React.KeyboardEvent) => {
    if (!selected) return;
    const step = event.shiftKey ? 0.05 : 0.01;
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

  // Click on empty canvas selects the topmost clip under the pointer.
  const onCanvasPointerDown = (event: React.PointerEvent) => {
    if (event.target !== event.currentTarget || !canvasRect) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (event.clientX - bounds.left) / bounds.width;
    const fy = (event.clientY - bounds.top) / bounds.height;
    for (const track of [...project.tracks].reverse()) {
      if (track.kind !== 'video' || track.hidden) continue;
      for (const clip of [...track.clips].reverse()) {
        // Only clips present under the playhead are visible on the canvas.
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

  const scaleX = canvasRect.width / project.canvas.width;
  const scaleY = canvasRect.height / project.canvas.height;
  const box = {
    left: canvasRect.left + placement.x * scaleX,
    top: canvasRect.top + placement.y * scaleY,
    width: placement.width * scaleX,
    height: placement.height * scaleY,
  };

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
        className="manipulation-box"
        role="group"
        aria-label={`Selected clip ${selected.clip.label ?? selected.clip.kind}. Arrow keys move, [ and ] rotate.`}
        tabIndex={0}
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          transform: `rotate(${selected.clip.transform.rotationDeg}deg)`,
          transformOrigin: 'center',
        }}
        onPointerDown={(event) => startDrag(event, 'move')}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={nudge}
      >
        <span className="manipulation-badge">
          {selected.clip.label ?? 'Clip'} · {Math.round(selected.clip.transform.scale * 100)}%
        </span>
        <div
          className="manipulation-rotate"
          role="button"
          tabIndex={-1}
          aria-label="Rotate clip"
          onPointerDown={(event) => startDrag(event, 'rotate')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
        />
        {HANDLES.map((handle) => (
          <div
            key={handle}
            className={`manipulation-handle ${handle}`}
            role="button"
            tabIndex={-1}
            aria-label={`Scale from ${handle} corner`}
            onPointerDown={(event) => startDrag(event, handle)}
            onPointerMove={onMove}
            onPointerUp={endDrag}
          />
        ))}
      </div>
    </div>
  );
}
