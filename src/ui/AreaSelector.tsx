import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import {
  AREA_ASPECTS,
  type AreaAspect,
  type AreaRect,
  moveAreaPx,
  nudgeArea,
  planAreaCrop,
  resizeAreaPx,
  type Size,
  toAreaFractions,
  toAreaPixels,
} from '../capture/areaSelection';
import { Button } from './components';
import { trapTab } from './focusTrap';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
const CORNERS: ReadonlyArray<{ id: Corner; x: 0 | 1; y: 0 | 1 }> = [
  { id: 'nw', x: 0, y: 0 },
  { id: 'ne', x: 1, y: 0 },
  { id: 'sw', x: 0, y: 1 },
  { id: 'se', x: 1, y: 1 },
];

interface Drag {
  pointerId: number;
  mode: 'move' | 'resize' | 'draw';
  origin: { left: number; top: number };
  bounds: Size;
  /** Pointer at pointerdown, in selector pixels. */
  start: { x: number; y: number };
  startPx: AreaRect;
  /** The corner that stays put (resize, draw). */
  anchor: { x: number; y: number };
  /** The dragged corner at pointerdown (resize). */
  corner: { x: number; y: number };
  latest: AreaRect | null;
}

/**
 * Translate to a point given in fractions of the selector. Container query units size the
 * pieces from CSS, so the per-frame drag feedback is transform-only: no left/top/width/height.
 */
const at = (x: number, y: number) => `translate3d(calc(${x} * 100cqw), calc(${y} * 100cqh), 0)`;

const percent = (value: number) => Math.round(value * 100);

/**
 * Cap-style area preflight. The frame stands for the entire screen (it has the screen's
 * aspect ratio), so the selection is kept in fractions and crops the capture exactly.
 * A drag edits a local draft and commits once on pointer-up; pointercancel reverts it.
 */
export function AreaCaptureOverlay({
  value,
  aspect,
  screenAspect,
  sourceSize,
  throttledWhenHidden = false,
  onChange,
  onAspectChange,
  onCancel,
  onConfirm,
}: {
  value: AreaRect;
  aspect: AreaAspect;
  /** Screen width ÷ height. */
  screenAspect: number;
  /** Expected stream size of the entire screen, for the output-size label. */
  sourceSize: Size;
  /** No frame-driven crop here: the recording slows while the tab is hidden (areaCrop.ts). */
  throttledWhenHidden?: boolean;
  onChange: (next: AreaRect) => void;
  onAspectChange: (aspect: AreaAspect) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<AreaRect | null>(null);
  const rect = draft ?? value;
  const output = planAreaCrop(rect, sourceSize);
  const committed = planAreaCrop(value, sourceSize);

  // A modal: the selection takes focus, Escape cancels and Tab stays inside.
  const cancelOnEscape = useEffectEvent(() => onCancel());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    fillRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelOnEscape();
        return;
      }
      if (rootRef.current) trapTab(event, rootRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const bounds = { width: box.width, height: box.height };
    const startPx = toAreaPixels(value, bounds);
    const start = { x: event.clientX - box.left, y: event.clientY - box.top };
    const part = (event.target as HTMLElement).closest<HTMLElement>('[data-area-part]')?.dataset.areaPart;
    const corner = CORNERS.find((item) => item.id === part);
    let mode: Drag['mode'] = 'draw';
    let anchor = start;
    let cornerPoint = start;
    if (part === 'fill') {
      mode = 'move';
    } else if (corner) {
      mode = 'resize';
      cornerPoint = { x: startPx.x + corner.x * startPx.width, y: startPx.y + corner.y * startPx.height };
      anchor = { x: startPx.x + (1 - corner.x) * startPx.width, y: startPx.y + (1 - corner.y) * startPx.height };
    }
    event.preventDefault();
    fillRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      mode,
      origin: { left: box.left, top: box.top },
      bounds,
      start,
      startPx,
      anchor,
      corner: cornerPoint,
      latest: null,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const point = { x: event.clientX - current.origin.left, y: event.clientY - current.origin.top };
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    // A click on the empty frame is not a new box.
    if (current.mode === 'draw' && !current.latest && Math.hypot(dx, dy) < 4) return;
    const px =
      current.mode === 'move'
        ? moveAreaPx(current.startPx, dx, dy, current.bounds)
        : current.mode === 'resize'
          ? resizeAreaPx(current.anchor, { x: current.corner.x + dx, y: current.corner.y + dy }, current.bounds, aspect)
          : resizeAreaPx(current.anchor, point, current.bounds, aspect);
    current.latest = toAreaFractions(px, current.bounds);
    setDraft(current.latest);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    drag.current = null;
    setDraft(null);
    if (commit && current.latest) onChange(current.latest);
  };

  const onFillKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = nudgeArea(value, event.key, event.shiftKey, aspect, screenAspect);
    if (!next) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <section
      ref={rootRef}
      className="area-capture-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="area-capture-title"
      aria-describedby="area-capture-hint"
    >
      <div className="area-overlay-header">
        <span className="eyebrow">AREA CAPTURE</span>
        <h2 id="area-capture-title" className="area-overlay-title">
          Select capture region
        </h2>
        <p id="area-capture-hint" className="field-hint">
          The frame stands for your entire screen. Drag the box or a corner, or drag across the frame to draw a new box.
          Arrow keys move it; Shift + Arrow keys resize it.
        </p>
        {throttledWhenHidden && (
          <p className="field-hint">
            This browser crops the area on the page itself: keep this tab visible, or the recording drops to about one
            frame per second.
          </p>
        )}
      </div>
      <div
        className="area-overlay-canvas"
        style={{ '--area-aspect': screenAspect } as CSSProperties}
        data-dragging={draft ? 'true' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, false)}
        onLostPointerCapture={(event) => endDrag(event, false)}
      >
        <div className="area-shade" aria-hidden="true" style={{ transform: `scaleY(${rect.y})` }} />
        <div
          className="area-shade"
          aria-hidden="true"
          style={{ transform: `${at(0, rect.y + rect.height)} scaleY(${1 - rect.y - rect.height})` }}
        />
        <div className="area-shade" aria-hidden="true" style={{ transform: `${at(0, rect.y)} scale(${rect.x}, ${rect.height})` }} />
        <div
          className="area-shade"
          aria-hidden="true"
          style={{ transform: `${at(rect.x + rect.width, rect.y)} scale(${1 - rect.x - rect.width}, ${rect.height})` }}
        />
        <div
          ref={fillRef}
          className="area-fill"
          data-area-part="fill"
          role="group"
          aria-roledescription="capture region"
          aria-label={`${percent(rect.width)}% by ${percent(rect.height)}% of the screen, from ${percent(rect.x)}% left and ${percent(rect.y)}% top`}
          tabIndex={0}
          onKeyDown={onFillKeyDown}
          style={{ transform: `${at(rect.x, rect.y)} scale(${rect.width}, ${rect.height})` }}
        />
        <div className="area-edge" data-side="top" aria-hidden="true" style={{ transform: `${at(rect.x, rect.y)} scaleX(${rect.width})` }} />
        <div
          className="area-edge"
          data-side="bottom"
          aria-hidden="true"
          style={{ transform: `${at(rect.x, rect.y + rect.height)} translateY(-100%) scaleX(${rect.width})` }}
        />
        <div className="area-edge" data-side="left" aria-hidden="true" style={{ transform: `${at(rect.x, rect.y)} scaleY(${rect.height})` }} />
        <div
          className="area-edge"
          data-side="right"
          aria-hidden="true"
          style={{ transform: `${at(rect.x + rect.width, rect.y)} translateX(-100%) scaleY(${rect.height})` }}
        />
        {CORNERS.map((corner) => (
          <div
            key={corner.id}
            className="area-handle"
            data-area-part={corner.id}
            data-corner={corner.id}
            aria-hidden="true"
            style={{
              transform: `${at(rect.x + corner.x * rect.width, rect.y + corner.y * rect.height)} translate(-50%, -50%)`,
            }}
          />
        ))}
        <div
          className="area-size-label"
          aria-hidden="true"
          style={{
            transform: `${at(rect.x + rect.width / 2, rect.y)} translate(-50%, ${rect.y < 0.1 ? '8px' : 'calc(-100% - 8px)'})`,
          }}
        >
          {output.sw} × {output.sh}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        Recording {committed.sw} by {committed.sh} pixels.
      </p>
      <div className="area-overlay-controls">
        <div className="area-aspect-ratio-row" role="group" aria-label="Aspect ratio">
          {AREA_ASPECTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={aspect === option.id}
              onClick={() => onAspectChange(option.id)}
              className={`area-aspect-btn${aspect === option.id ? ' area-aspect-btn-active' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="row area-overlay-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Confirm area
          </Button>
        </div>
      </div>
    </section>
  );
}
