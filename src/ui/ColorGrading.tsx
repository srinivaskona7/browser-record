import { useId, useRef, useState } from 'react';
import type { ColorWheelValue, HslColorBand, ToneCurvePoint } from '../project/types';
import { HSL_COLOR_BANDS } from '../effects/catalog';
import { Button } from './components';

/** A draggable HSV wheel: angle chooses hue, distance chooses saturation. */
export function ColorWheel({
  label,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  label: string;
  value: ColorWheelValue;
  onChange: (value: ColorWheelValue) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const size = 92;
  const radius = size / 2 - 7;
  const [dragging, setDragging] = useState(false);
  const pointerId = useRef<number | null>(null);

  const updateFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const distance = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2 - 7));
    const hue = (Math.atan2(dy, dx) * 180) / Math.PI;
    onChange({ ...value, hueDeg: (hue + 360) % 360, sat: distance });
  };

  const rad = (value.hueDeg * Math.PI) / 180;
  const knobX = size / 2 + Math.cos(rad) * value.sat * radius;
  const knobY = size / 2 + Math.sin(rad) * value.sat * radius;

  return (
    <div className="color-wheel">
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${label} colour wheel`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(value.hueDeg)}
        aria-valuetext={`Hue ${Math.round(value.hueDeg)}°, saturation ${Math.round(value.sat * 100)}%`}
        className="color-wheel-disc"
        style={{ width: size, height: size }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerId.current = event.pointerId;
          setDragging(true);
          updateFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (!dragging || pointerId.current !== event.pointerId) return;
          updateFromEvent(event);
        }}
        onPointerUp={() => {
          setDragging(false);
          pointerId.current = null;
          onCommit();
        }}
        onPointerCancel={() => {
          setDragging(false);
          pointerId.current = null;
          onCancel();
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            onChange({ ...value, hueDeg: (value.hueDeg + (event.key === 'ArrowRight' ? step : -step) + 360) % 360 });
            onCommit();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const next = Math.max(0, Math.min(1, value.sat + (event.key === 'ArrowUp' ? 0.05 : -0.05)));
            onChange({ ...value, sat: next });
            onCommit();
          }
        }}
      >
        <span className="color-wheel-knob" style={{ left: knobX, top: knobY }} />
      </div>
      <div className="color-wheel-meta">
        <span>{label}</span>
        <span className="mono">{Math.round(value.hueDeg)}° · {Math.round(value.sat * 100)}%</span>
      </div>
      <input
        className="input mono"
        type="number"
        aria-label={`${label} luminance`}
        min={-1}
        max={1}
        step={0.01}
        value={Number(value.luma.toFixed(2))}
        onChange={(event) => {
          const luma = Number(event.target.value);
          if (!Number.isFinite(luma)) return;
          onChange({ ...value, luma: Math.max(-1, Math.min(1, luma)) });
        }}
        onBlur={onCommit}
      />
    </div>
  );
}

export function ColorWheelsPanel({
  wheels,
  onChange,
  onCommit,
  onCancel,
  onReset,
}: {
  wheels: { global?: ColorWheelValue; shadows?: ColorWheelValue; midtones?: ColorWheelValue; highlights?: ColorWheelValue };
  onChange: (scope: 'global' | 'shadows' | 'midtones' | 'highlights', value: ColorWheelValue) => void;
  onCommit: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const neutral: ColorWheelValue = { hueDeg: 0, sat: 0, luma: 0 };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">COLOR WHEELS</span>
        <Button size="sm" variant="ghost" onClick={onReset}>Reset all</Button>
      </div>
      <div className="color-wheel-grid">
        {(
          [
            ['shadows', 'Shadows'],
            ['midtones', 'Midtones'],
            ['highlights', 'Highlights'],
            ['global', 'Global'],
          ] as const
        ).map(([scope, label]) => (
          <ColorWheel
            key={scope}
            label={label}
            value={wheels[scope] ?? neutral}
            onChange={(value) => onChange(scope, value)}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
}

export function HslBandsPanel({
  bands,
  onChange,
  onCommit,
  onReset,
}: {
  bands: Partial<Record<HslColorBand, { hue: number; sat: number; luma: number }>>;
  onChange: (band: HslColorBand, patch: { hue?: number; sat?: number; luma?: number }) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const [band, setBand] = useState<HslColorBand>('red');
  const current = bands[band] ?? { hue: 0, sat: 0, luma: 0 };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">PER-COLOUR HSL</span>
        <Button size="sm" variant="ghost" onClick={onReset}>Reset</Button>
      </div>
      <div className="row" role="group" aria-label="HSL colour band" style={{ gap: 4, flexWrap: 'wrap' }}>
        {HSL_COLOR_BANDS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="band-chip"
            aria-pressed={band === item.id}
            title={item.label}
            onClick={() => setBand(item.id)}
            style={{ background: item.swatch }}
          >
            <span className="sr-only">{item.label}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Hue shift</span>
        <input
          className="input"
          type="range"
          min={-180}
          max={180}
          step={1}
          value={current.hue}
          aria-label={`${band} hue shift`}
          onChange={(event) => onChange(band, { hue: Number(event.target.value) })}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
        <span className="mono">{Math.round(current.hue)}°</span>
      </label>
      <label className="field">
        <span>Saturation</span>
        <input
          className="input"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={current.sat}
          aria-label={`${band} saturation`}
          onChange={(event) => onChange(band, { sat: Number(event.target.value) })}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
        <span className="mono">{Math.round(current.sat * 100)}%</span>
      </label>
      <label className="field">
        <span>Luminance</span>
        <input
          className="input"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={current.luma}
          aria-label={`${band} luminance`}
          onChange={(event) => onChange(band, { luma: Number(event.target.value) })}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
        />
        <span className="mono">{Math.round(current.luma * 100)}%</span>
      </label>
    </div>
  );
}

const CHANNELS = [
  { id: 'rgb', label: 'Master' },
  { id: 'red', label: 'Red' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
] as const;

/** Editable tone curve: drag points, click to add, double-click (or alt-click) to remove. */
export function ToneCurvePanel({
  curves,
  onChange,
  onCommit,
  onReset,
}: {
  curves: { rgb?: ToneCurvePoint[]; red?: ToneCurvePoint[]; green?: ToneCurvePoint[]; blue?: ToneCurvePoint[] };
  onChange: (channel: 'rgb' | 'red' | 'green' | 'blue', points: ToneCurvePoint[]) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const [channel, setChannel] = useState<'rgb' | 'red' | 'green' | 'blue'>('rgb');
  const points = curves[channel];
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const size = 180;
  const pad = 8;
  const id = useId();

  const identity: ToneCurvePoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
  const active = points && points.length > 1 ? points : identity;

  const toLocal = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left - pad) / (rect.width - pad * 2))),
      y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top - pad) / (rect.height - pad * 2))),
    };
  };

  const sorted = [...active].sort((a, b) => a.x - b.x);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="eyebrow">TONE CURVES</span>
        <Button size="sm" variant="ghost" onClick={onReset}>Reset</Button>
      </div>
      <div className="row" style={{ gap: 4 }}>
        {CHANNELS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={channel === item.id ? 'primary' : 'ghost'}
            aria-pressed={channel === item.id}
            onClick={() => setChannel(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="tone-curve"
        role="img"
        aria-labelledby={`${id}-label`}
        onPointerMove={(event) => {
          if (dragIndex === null) return;
          const point = toLocal(event);
          const next = [...sorted];
          next[dragIndex] = point;
          onChange(channel, next);
        }}
        onPointerUp={() => {
          if (dragIndex === null) return;
          setDragIndex(null);
          onCommit();
        }}
        onPointerLeave={() => {
          if (dragIndex === null) return;
          setDragIndex(null);
          onCommit();
        }}
        onDoubleClick={(event) => {
          const point = toLocal(event as unknown as React.PointerEvent<SVGSVGElement>);
          if (sorted.length <= 2) return;
          const nearest = sorted.reduce(
            (best, candidate, index) =>
              Math.hypot(candidate.x - point.x, candidate.y - point.y) < best.distance
                ? { index, distance: Math.hypot(candidate.x - point.x, candidate.y - point.y) }
                : best,
            { index: -1, distance: Number.POSITIVE_INFINITY },
          );
          if (nearest.index >= 0 && nearest.distance < 0.08) {
            onChange(
              channel,
              sorted.filter((_, index) => index !== nearest.index),
            );
            onCommit();
          }
        }}
        onClick={(event) => {
          if (dragIndex !== null) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const point = {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left - pad) / (rect.width - pad * 2))),
            y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top - pad) / (rect.height - pad * 2))),
          };
          onChange(channel, [...sorted, point].sort((a, b) => a.x - b.x));
          onCommit();
        }}
      >
        <title id={`${id}-label`}>{channel} tone curve editor</title>
        <rect x={pad} y={pad} width={size - pad * 2} height={size - pad * 2} className="tone-curve-bg" />
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction} className="tone-curve-guide">
            <line x1={pad + fraction * (size - pad * 2)} y1={pad} x2={pad + fraction * (size - pad * 2)} y2={size - pad} />
            <line x1={pad} y1={pad + fraction * (size - pad * 2)} x2={size - pad} y2={pad + fraction * (size - pad * 2)} />
          </g>
        ))}
        <polyline
          className="tone-curve-line"
          points={sorted
            .map((point) => `${pad + point.x * (size - pad * 2)},${size - pad - point.y * (size - pad * 2)}`)
            .join(' ')}
        />
        {sorted.map((point, index) => (
          <circle
            key={`${point.x}-${index}`}
            className="tone-curve-point"
            cx={pad + point.x * (size - pad * 2)}
            cy={size - pad - point.y * (size - pad * 2)}
            r={5}
            tabIndex={0}
            role="button"
            aria-label={`Curve point ${index + 1}: input ${Math.round(point.x * 100)}%, output ${Math.round(point.y * 100)}%`}
            onPointerDown={(event) => {
              event.stopPropagation();
              setDragIndex(index);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Delete' && event.key !== 'Backspace') return;
              event.preventDefault();
              if ((event.key === 'Delete' || event.key === 'Backspace') && sorted.length > 2) {
                onChange(channel, sorted.filter((_, i) => i !== index));
                onCommit();
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                const delta = event.key === 'ArrowUp' ? 0.01 : -0.01;
                const next = [...sorted];
                next[index] = { ...point, y: Math.max(0, Math.min(1, point.y + delta)) };
                onChange(channel, next);
                onCommit();
              }
            }}
          />
        ))}
      </svg>
      <p className="hint">Click to add a point, drag to shape, double-click a point to remove it.</p>
    </div>
  );
}
