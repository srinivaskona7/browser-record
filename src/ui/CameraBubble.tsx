import { useRef, useState, type RefObject } from 'react';
import type { PresenterProps } from '../project/types';
import {
  PRESENTER_BUBBLE_EFFECTS,
  PRESENTER_BUBBLE_SHAPES,
  cornerFromNormalizedCenter,
  presenterEffectFilter,
} from '../render/layout';

export interface CameraBubblePosition {
  x: number;
  y: number;
}

export interface CameraBubbleProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  presenter: PresenterProps;
  stage: 'idle' | 'selecting' | 'ready' | 'countdown' | 'recording' | 'paused' | 'finishing';
  position: CameraBubblePosition | null;
  cameraLive?: boolean;
  onStartPreview?: () => void;
  onPositionChange: (pos: CameraBubblePosition | null) => void;
  onUpdatePresenter: (patch: Partial<PresenterProps>) => void;
}

function dimensionsForPresenter(presenter: PresenterProps): { width: number; height: number } {
  const scale = presenter.size <= 0.2 ? 0.82 : presenter.size >= 0.36 ? 1.18 : 1;
  if (presenter.shape === 'pill') {
    return { width: Math.round(228 * scale), height: Math.round(156 * scale) };
  }
  if (presenter.shape === 'portrait') {
    return { width: Math.round(164 * scale), height: Math.round(218 * scale) };
  }
  const side = Math.round(188 * scale);
  return { width: side, height: side };
}

function viewportPositionForCorner(
  corner: PresenterProps['corner'] | 'center',
  width: number,
  height: number,
): { pos: CameraBubblePosition; normX: number; normY: number; corner: PresenterProps['corner'] } {
  const vw = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 720;
  const padX = 24;
  const padY = 68;
  if (corner === 'top-left') {
    return {
      pos: { x: padX, y: padY },
      normX: (padX + width / 2) / vw,
      normY: (padY + height / 2) / vh,
      corner: 'top-left',
    };
  }
  if (corner === 'top-right') {
    const x = Math.max(padX, vw - width - padX);
    return {
      pos: { x, y: padY },
      normX: (x + width / 2) / vw,
      normY: (padY + height / 2) / vh,
      corner: 'top-right',
    };
  }
  if (corner === 'bottom-left') {
    const y = Math.max(padY, vh - height - padY);
    return {
      pos: { x: padX, y },
      normX: (padX + width / 2) / vw,
      normY: (y + height / 2) / vh,
      corner: 'bottom-left',
    };
  }
  if (corner === 'center') {
    const x = Math.max(padX, Math.round((vw - width) / 2));
    const y = Math.max(padY, Math.round((vh - height) / 2));
    return {
      pos: { x, y },
      normX: 0.5,
      normY: 0.5,
      corner: 'bottom-right',
    };
  }
  const x = Math.max(padX, vw - width - padX);
  const y = Math.max(padY, vh - height - padY);
  return {
    pos: { x, y },
    normX: (x + width / 2) / vw,
    normY: (y + height / 2) / vh,
    corner: 'bottom-right',
  };
}

/**
 * Standalone floating Camera Bubble component (`<CameraBubble />`), decoupled
 * from the horizontal stealth recording control bar. Supports free dragging and
 * corner snapping during preview, active recording, and across app tabs, plus
 * live shape (`Circle`, `Square`, `Rounded`, `Portrait`, `Pill`, `Hex`) and
 * camera bubble visual effect switching.
 */
export function CameraBubble({
  videoRef,
  presenter,
  stage,
  position,
  cameraLive = true,
  onStartPreview,
  onPositionChange,
  onUpdatePresenter,
}: CameraBubbleProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const dims = dimensionsForPresenter(presenter);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-bubble-controls="true"]')) return;
    if (event.button !== 0 || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    boxRef.current.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !boxRef.current) return;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const x = Math.min(Math.max(8, event.clientX - drag.offsetX), Math.max(8, vw - dims.width - 8));
    const y = Math.min(Math.max(8, event.clientY - drag.offsetY), Math.max(8, vh - dims.height - 8));
    drag.moved = true;
    onPositionChange({ x, y });
    const normX = Math.max(0.05, Math.min(0.95, (x + dims.width / 2) / vw));
    const normY = Math.max(0.05, Math.min(0.95, (y + dims.height / 2) / vh));
    onUpdatePresenter({
      x: normX,
      y: normY,
      corner: cornerFromNormalizedCenter(normX, normY),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    boxRef.current?.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  };

  const snapToPlace = (place: PresenterProps['corner'] | 'center') => {
    const resolved = viewportPositionForCorner(place, dims.width, dims.height);
    onPositionChange(place === 'bottom-right' ? null : resolved.pos);
    if (place === 'center') {
      onUpdatePresenter({ x: 0.5, y: 0.5 });
    } else {
      onUpdatePresenter({ corner: resolved.corner, x: undefined, y: undefined });
    }
  };

  const resetBubble = () => {
    onPositionChange(null);
    onUpdatePresenter({ corner: 'bottom-right', x: undefined, y: undefined });
  };

  const filterCss = presenterEffectFilter(presenter.effect);
  const borderRadius =
    presenter.shape === 'circle'
      ? '50%'
      : presenter.shape === 'pill'
        ? '999px'
        : presenter.shape === 'rounded'
          ? '28px'
          : presenter.shape === 'portrait'
            ? '22px'
            : '12px';

  const outlineColor =
    presenter.effect === 'neon-ring'
      ? '#38bdf8'
      : stage === 'recording'
        ? '#ff5c7c'
        : presenter.borderColor || '#c3adff';

  return (
    <div
      ref={boxRef}
      className={`rec-selfview camera-bubble-widget${stage === 'recording' ? ' is-recording' : ''}`}
      data-testid="camera-bubble"
      data-shape={presenter.shape}
      data-effect={presenter.effect ?? 'none'}
      data-corner={presenter.corner}
      aria-label="Live camera self-view"
      title="Drag to move anywhere while recording. Double-click to reset."
      onDoubleClick={resetBubble}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : {}),
        width: dims.width,
        height: dims.height,
        borderRadius,
        outline: presenter.shape === 'hexagon' ? 'none' : `3px solid ${outlineColor}`,
        boxShadow:
          presenter.effect === 'neon-ring'
            ? '0 0 24px rgba(56, 189, 248, 0.72), 0 14px 36px rgba(0, 0, 0, 0.65)'
            : undefined,
      }}
    >
      <div
        className="camera-bubble-viewport"
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius,
          clipPath:
            presenter.shape === 'hexagon'
              ? 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'
              : 'none',
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: presenter.mirror ? 'scaleX(-1)' : 'none',
            filter: filterCss !== 'none' ? filterCss : undefined,
          }}
        />
        {!cameraLive && stage === 'idle' && (
          <div
            data-bubble-controls="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: 12,
              textAlign: 'center',
              background:
                'radial-gradient(circle at 35% 28%, rgba(195, 173, 255, 0.28), rgba(22, 20, 30, 0.94) 75%)',
              color: '#f5f2ff',
              filter: filterCss !== 'none' ? filterCss : undefined,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', opacity: 0.9 }}>
              CAMERA BUBBLE
            </span>
            <span style={{ fontSize: 10.5, color: '#b2abc4', lineHeight: 1.3 }}>
              Drag anywhere · {presenter.shape}
            </span>
            {onStartPreview && (
              <button
                type="button"
                className="camera-bubble-pill"
                onClick={() => onStartPreview()}
                title="Turn on live camera preview inside the bubble"
              >
                Live preview
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick on-bubble HUD trigger & corner/shape/effect popover (works while idle AND while recording) */}
      <div className="camera-bubble-hud" data-bubble-controls="true">
        <div className="camera-bubble-quick-row" role="group" aria-label="Quick bubble controls">
          {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => {
            const icons: Record<PresenterProps['corner'], string> = {
              'top-left': '↖',
              'top-right': '↗',
              'bottom-left': '↙',
              'bottom-right': '↘',
            };
            const active = presenter.corner === corner && presenter.x === undefined;
            return (
              <button
                key={corner}
                type="button"
                data-testid={`bubble-place-${corner}`}
                className={`camera-bubble-chip${active ? ' is-active' : ''}`}
                aria-label={`Move bubble to ${corner}`}
                title={`Snap camera bubble to ${corner}`}
                onClick={() => snapToPlace(corner)}
              >
                {icons[corner]}
              </button>
            );
          })}
          <button
            type="button"
            data-testid="camera-bubble-options-toggle"
            className={`camera-bubble-chip${optionsOpen ? ' is-active' : ''}`}
            aria-label="Bubble shape and effects"
            aria-expanded={optionsOpen}
            title="Customize bubble shape (Square, Circle, Rounded…) and visual effects"
            onClick={() => setOptionsOpen((prev) => !prev)}
          >
            ✦ Style
          </button>
        </div>

        {optionsOpen && (
          <div
            className="camera-bubble-popover"
            data-testid="camera-bubble-options-popover"
            role="dialog"
            aria-label="Camera bubble options"
          >
            <div className="camera-bubble-section-label">Shape</div>
            <div className="camera-bubble-pill-grid" role="group" aria-label="Bubble shape options">
              {PRESENTER_BUBBLE_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`bubble-shape-${s.id}`}
                  className={`camera-bubble-pill${presenter.shape === s.id ? ' is-active' : ''}`}
                  aria-pressed={presenter.shape === s.id}
                  onClick={() => onUpdatePresenter({ shape: s.id })}
                >
                  {s.shortLabel}
                </button>
              ))}
            </div>

            <div className="camera-bubble-section-label">Effect</div>
            <div className="camera-bubble-pill-grid" role="group" aria-label="Bubble effect options">
              {PRESENTER_BUBBLE_EFFECTS.map((fx) => (
                <button
                  key={fx.id}
                  type="button"
                  data-testid={`bubble-effect-${fx.id}`}
                  className={`camera-bubble-pill${(presenter.effect ?? 'none') === fx.id ? ' is-active' : ''}`}
                  aria-pressed={(presenter.effect ?? 'none') === fx.id}
                  onClick={() => onUpdatePresenter({ effect: fx.id })}
                >
                  {fx.shortLabel}
                </button>
              ))}
            </div>

            <div className="camera-bubble-section-label">Size &amp; Position</div>
            <div className="camera-bubble-pill-grid" role="group" aria-label="Bubble size and mirror">
              {[
                { label: 'S', size: 0.18 },
                { label: 'M', size: 0.28 },
                { label: 'L', size: 0.38 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`camera-bubble-pill${Math.abs(presenter.size - preset.size) < 0.04 ? ' is-active' : ''}`}
                  onClick={() => onUpdatePresenter({ size: preset.size })}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`camera-bubble-pill${presenter.mirror ? ' is-active' : ''}`}
                aria-pressed={presenter.mirror}
                onClick={() => onUpdatePresenter({ mirror: !presenter.mirror })}
              >
                Mirror
              </button>
              <button
                type="button"
                data-testid="bubble-place-center"
                className="camera-bubble-pill"
                onClick={() => snapToPlace('center')}
              >
                ⊕ Center
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
