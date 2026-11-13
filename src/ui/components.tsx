import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { trapTab } from './focusTrap';

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'icon';
}) {
  const variantClass = variant === 'default' ? '' : `btn-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'icon' ? 'btn-icon' : '';
  // A glyph or one short word (✕, +, ▶, "Split") cannot reach 44px wide on its own; the class
  // gives it the touch width floor (styles.css, pointer: coarse) without touching longer labels.
  const glyphClass = size !== 'icon' && isShortLabel(children) ? 'btn-glyph' : '';
  return (
    <button
      type="button"
      className={`btn ${variantClass} ${sizeClass} ${glyphClass} ${className}`.replace(/\s+/g, ' ').trim()}
      {...props}
    >
      {children}
    </button>
  );
}

/** At most this many visible characters gets the 44px width floor on touch screens. */
export const SHORT_LABEL_GRAPHEMES = 5;

/** True for a glyph or one short word: a plain-text label of at most five visible characters. */
export function isShortLabel(children: ReactNode): boolean {
  if (typeof children !== 'string' && typeof children !== 'number') return false;
  const label = String(children).trim();
  // Several words can wrap, so a width floor could undercut them; only a single word qualifies.
  if (!label || /\s/.test(label)) return false;
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(label)].length <= SHORT_LABEL_GRAPHEMES;
}

export function Panel({
  title,
  subtitle,
  action,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headerAction = action ?? actions;
  return (
    <section className={`panel ${className}`.trim()}>
      {(title !== undefined || subtitle !== undefined || headerAction !== undefined) && (
        <header className="panel-head">
          <div>
            {title !== undefined && <h2 className="panel-title">{title}</h2>}
            {subtitle !== undefined && (
              <div className="field-hint" style={{ marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
          {headerAction}
        </header>
      )}
      <div className={`panel-body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  disabled,
  label,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  id?: string;
  disabled?: boolean;
  /** Accessible name. The visible caption is a plain div, so the select needs one. */
  label?: string;
  'aria-label'?: string;
}) {
  return (
    <select
      id={id}
      className="select"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label
      htmlFor={inputId}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid var(--line)',
        background: 'var(--surface-0)',
        fontSize: 'var(--token-font-base)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span>{label}</span>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
      />
    </label>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  id,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  format?: (value: number) => string;
  id?: string;
}) {
  return (
    <div className="field">
      {label && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="field-label">{label}</span>
          <span className="mono" style={{ fontSize: 'var(--token-font-sm)' }}>
            {format ? format(value) : value}
          </span>
        </div>
      )}
      <input
        id={id}
        className="input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'default' | 'accent' | 'ok' | 'warn' | 'danger';
  children: ReactNode;
}) {
  const normalized = tone === 'default' ? 'neutral' : tone === 'accent' ? 'ok' : tone;
  const cls = normalized === 'neutral' ? '' : `badge-${normalized}`;
  return <span className={`badge ${cls}`.trim()}>{children}</span>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label ?? 'Progress'}>
        <div className="progress-fill" style={{ transform: `scaleX(${(Math.min(100, Math.max(0, value * 100))) / 100})` }} />
      </div>
    </div>
  );
}

export function Dialog({
  open,
  title,
  children,
  onClose,
  wide = false,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      // Disabled buttons and closed <details> content are skipped, and focus that fell to
      // <body> is pulled back in (src/ui/focusTrap.ts).
      if (ref.current) trapTab(event, ref.current);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} tabIndex={-1} ref={ref}>
        <header className="panel-head">
          <h2 style={{ margin: 0, fontSize: 'var(--token-font-lg)', fontWeight: 650 }}>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </Button>
        </header>
        <div className="panel-body">{children}</div>
        {footer && (
          <footer className="dialog-footer">{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  children,
  action,
}: {
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const content = children ?? body;
  return (
    <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--text-2)' }}>
      <div style={{ fontSize: 'var(--token-font-lg)', fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>{title}</div>
      {content && <div style={{ fontSize: 'var(--token-font-base)', lineHeight: 1.6, maxWidth: 52 + 'ch', margin: '0 auto 14px' }}>{content}</div>}
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  sub,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  sub?: ReactNode;
}) {
  const caption = hint ?? sub;
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {caption && <span style={{ fontSize: 'var(--token-font-xs)', color: 'var(--text-3)' }}>{caption}</span>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 280);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="row" style={{ color: 'var(--text-2)', fontSize: 'var(--token-font-base)' }}>
      <span aria-hidden="true" className="mono">
        {'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[tick % 10]}
      </span>
      {label}
    </span>
  );
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Array<{ id: number; message: string; tone: 'info' | 'error' | 'success' }>;
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200 }}>
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          className="toast"
          data-tone={toast.tone}
          style={{ bottom: 22 + index * 54, pointerEvents: 'auto' }}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{toast.message}</span>
          <Button variant="ghost" size="sm" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            ✕
          </Button>
        </div>
      ))}
    </div>
  );
}
