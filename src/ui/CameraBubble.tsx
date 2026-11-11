import { useRef, type RefObject } from 'react';
import type { PresenterProps } from '../project/types';
import {
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

/**
 * Standalone floating Camera Bubble component (`<CameraBubble />`), decoupled
 * from the recording control bar. Supports free dragging and position
 * presets via Camera appearance settings. Renders the camera image only — no
 * timer, buttons, labels, or toolbar overlay the live image.
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
  const resetBubble = () => {
    onPositionChange(null);
    onUpdatePresenter({ corner: 'bottom-right', x: undefined, y: undefined });
  };

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const dims = dimensionsForPresenter(presenter);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
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
    </div>
  );
}
