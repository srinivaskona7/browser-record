import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { TICKS_PER_SECOND, formatClock } from '../core/time';
import { formatSelectionScopeChip } from '../editor/selection';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import * as ops from '../project/ops';
import type { BrandKit, Clip, ContactStyle, Project } from '../project/types';
import {
  ALPHA_MASK_SHAPES,
  BOUNDARY_TRANSITIONS,
  CINEMATIC_LUTS,
  COLOR_FILTERS,
  EMPHASIS_STYLES,
  FONT_FAMILIES,
  PLATFORM_WORKFLOW_PRESETS,
  SPEED_CURVE_PROFILES,
  TEXT_ANIMATIONS,
  TEXT_STYLE_PRESETS,
  VIDEO_EFFECTS,
  checkFontAvailability,
  loadCustomFontDescriptor,
  parseAndValidateCustomFont,
  saveUserTextStylePreset,
} from '../effects/catalog';
import { Badge, Button, Field, Panel, Select, Slider, Toggle } from './components';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { ColorWheelsPanel, HslBandsPanel, ToneCurvePanel } from './ColorGrading';
import {
  PRESENTER_BUBBLE_EFFECTS,
  PRESENTER_BUBBLE_SHAPES,
  cornerFromNormalizedCenter,
} from '../render/layout';

const InspectorFocus = createContext<{ section: string; query: string }>({ section: 'All', query: '' });

export function Inspector({
  clip,
  trackKind,
  initialSection = 'All',
}: {
  clip: Clip;
  trackKind: string;
  initialSection?: string;
}) {
  const apply = useEditor((state) => state.apply);
  const beginGesture = useEditor((state) => state.beginGesture);
  const updateGesture = useEditor((state) => state.updateGesture);
  const endGesture = useEditor((state) => state.endGesture);
  const cancelGesture = useEditor((state) => state.cancelGesture);
  const compareOriginal = useEditor((state) => state.compareOriginal);
  const setCompareOriginal = useEditor((state) => state.setCompareOriginal);
  const gestureOpen = useRef(false);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const lutInputRef = useRef<HTMLInputElement>(null);
  const [fontUploadError, setFontUploadError] = useState<string | null>(null);
  const [lutUploadError, setLutUploadError] = useState<string | null>(null);
  const playhead = useEditor((state) => state.playheadTicks);
  const project = useEditor((state) => state.project);
  const selection = useEditor((state) => state.selection);
  const isPresenter = Boolean(clip.presenter);
  const [section, setSection] = useState(
    initialSection === 'Presenter layout' && !isPresenter ? 'Transform' : initialSection,
  );
  const [query, setQuery] = useState('');
  const localTicks = Math.max(0, playhead - clip.startTicks);

  const patch = (label: string, deep: Parameters<typeof ops.updateClipDeep>[2]) =>
    apply(label, (p) => ops.updateClipDeep(p, clip.id, deep));
  const setClip = (label: string, value: Partial<Clip>) => apply(label, (p) => ops.updateClip(p, clip.id, value));
  /** One undo entry per pointer gesture, not one per pixel moved. */
  const beginOnce = (label: string) => {
    if (gestureOpen.current) return;
    beginGesture(label);
    gestureOpen.current = true;
  };
  const commitGesture = () => {
    if (!gestureOpen.current) return;
    gestureOpen.current = false;
    endGesture();
  };

  const hasVideo = trackKind === 'video';
  const keyframes = useMemo(
    () => Object.fromEntries(clip.keyframes.map((group) => [group.target, group.keyframes.length])) as Record<string, number>,
    [clip.keyframes],
  );

  const addKeyframe = (target: 'x' | 'y' | 'scale' | 'opacity' | 'volume' | 'zoom', value: number) =>
    apply(`Keyframe ${target}`, (p) => ops.upsertKeyframe(p, clip.id, target, localTicks, value));

  const scopeChip = project ? formatSelectionScopeChip(selection, project) : 'No selection';

  return (
    <InspectorFocus.Provider value={{ section, query }}>
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="eyebrow">ACTIVE SCOPE</span>
        <Badge tone="ok">{scopeChip}</Badge>
      </div>
      <input
        className="input"
        aria-label="Search inspector controls"
        placeholder="Search inspector controls…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select label="Clip inspector section" value={section} onChange={setSection} options={['All', 'Transform', 'Timing', 'Colour', 'Audio', 'Text', 'Masks (manual)', 'Keyframes', ...(isPresenter ? ['Presenter layout'] : [])].map((value) => ({ value, label: value === 'All' ? 'All clip controls' : value }))} />
      <div className="panel" style={{ boxShadow: 'none' }}>
        <div className="panel-body" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>{clip.label ?? clip.kind}</strong>
            <Badge>{trackKind}</Badge>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }} className="mono">
            start {formatClock(clip.startTicks)} · dur {formatClock(clip.durationTicks)}
            <br />
            in {formatClock(clip.inTicks)} · {clip.speed.toFixed(2)}×{clip.reverse ? ' · reversed' : ''}
          </div>
        </div>
      </div>

      <InspectorSection title="Timing">
        <Field label="Duration (seconds)">
          <input
            className="input mono"
            type="number"
            min={0.1}
            step={0.1}
            value={Number((clip.durationTicks / TICKS_PER_SECOND).toFixed(2))}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              if (!Number.isFinite(seconds) || seconds <= 0) return;
              apply('Set duration', (p) => ops.trimEnd(p, clip.id, clip.startTicks + Math.round(seconds * TICKS_PER_SECOND)));
            }}
          />
        </Field>
        <Field label="Speed" hint="Cuts and captions keep their timing; linked audio follows the visual cut.">
          <Slider
            label="Playback rate"
            min={0.1}
            max={10}
            step={0.05}
            value={clip.speed}
            format={(value) => `${value.toFixed(2)}×`}
            onChange={(value) => setClip('Set speed', { speed: value })}
          />
        </Field>
        <Toggle
          label="Reverse playback"
          checked={Boolean(clip.reverse)}
          onChange={(value) => apply('Reverse playback', (p) => ops.toggleClipReverse(p, clip.id, value))}
        />
        <Field label="Speed curve preset (8 curves)">
          <Select
            value={clip.speedCurve ?? 'constant_speed'}
            onChange={(value) => apply(`Speed curve: ${value}`, (p) => ops.selectSpeedPanelPreset(p, clip.id, value))}
            options={SPEED_CURVE_PROFILES.map((item) => ({
              value: item.id,
              label: `${item.name} (${item.nominalSpeed}×)`,
            }))}
          />
        </Field>
        <Field label="Boundary transition (51 filters)">
          <Select
            value={clip.transitionIn?.type ?? 'normal'}
            onChange={(value) => apply(`Transition: ${value}`, (p) => ops.addTransition(p, clip.id, value))}
            options={[
              { value: 'normal', label: 'Normal (no transition)' },
              ...BOUNDARY_TRANSITIONS.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => apply('Fade in', (p) => ops.updateClipDeep(p, clip.id, { transitionIn: { type: 'fade', durationTicks: Math.round(0.5 * TICKS_PER_SECOND) } }))}>
            Fade in 0.5s
          </Button>
          <Button size="sm" onClick={() => apply('Fade out', (p) => ops.updateClipDeep(p, clip.id, { transitionOut: { type: 'fade', durationTicks: Math.round(0.5 * TICKS_PER_SECOND) } }))}>
            Fade out
          </Button>
        </div>
      </InspectorSection>

      {hasVideo && clip.kind !== 'title' && (
        <InspectorSection title="Transform">
          <Slider label="Position X" min={0} max={1} step={0.005} value={clip.transform.x} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Move clip', { transform: { x: value } })} />
          <Slider label="Position Y" min={0} max={1} step={0.005} value={clip.transform.y} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Move clip', { transform: { y: value } })} />
          <Slider label="Scale" min={0.05} max={3} step={0.01} value={clip.transform.scale} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Scale clip', { transform: { scale: value } })} />
          <Slider label="Zoom (teaching)" min={1} max={4} step={0.01} value={clip.effects.zoom} format={(v) => `${v.toFixed(2)}×`} onChange={(value) => patch('Zoom', { effects: { zoom: value } })} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => addKeyframe('zoom', clip.effects.zoom)}>
              Key zoom here
            </Button>
            <Button size="sm" onClick={() => addKeyframe('x', clip.transform.x)}>
              Key position
            </Button>
            <Button
              size="sm"
              aria-pressed={Boolean(clip.transform.flipX)}
              onClick={() => apply('Flip horizontal', (p) => ops.toggleClipFlip(p, clip.id, 'x'))}
            >
              Flip H
            </Button>
            <Button
              size="sm"
              aria-pressed={Boolean(clip.transform.flipY)}
              onClick={() => apply('Flip vertical', (p) => ops.toggleClipFlip(p, clip.id, 'y'))}
            >
              Flip V
            </Button>
          </div>
          <Field label="Alignment">
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((align) => (
                <Button
                  key={align}
                  size="sm"
                  variant="ghost"
                  onClick={() => apply(`Align ${align}`, (p) => ops.alignClip(p, clip.id, align))}
                >
                  {align}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Fit">
            <Select
              value={clip.transform.fit}
              onChange={(value) => patch('Fit mode', { transform: { fit: value } })}
              options={[
                { value: 'contain', label: 'Contain (letterbox)' },
                { value: 'cover', label: 'Cover (fill, crops)' },
                { value: 'fill', label: 'Fill (stretch)' },
              ]}
            />
          </Field>
          <Field label="Video effect & dynamic motion (148 effects)">
            <Select
              value={clip.effects.videoEffect ?? 'none'}
              onChange={(value) => apply(`Effect: ${value}`, (p) => ops.applyEffect(p, clip.id, value))}
              options={[
                { value: 'none', label: 'None (neutral)' },
                ...VIDEO_EFFECTS.map((item) => ({ value: item.id, label: `${item.name} (${item.category})` })),
              ]}
            />
          </Field>
          <Field label="Alpha shape mask (5 shapes)">
            <Select
              value={clip.alphaMask?.shape ?? 'none'}
              onChange={(value) => apply(`Alpha mask: ${value}`, (p) => ops.setMask(p, clip.id, value))}
              options={[
                { value: 'none', label: 'None' },
                ...ALPHA_MASK_SHAPES.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </Field>
          {clip.alphaMask && clip.alphaMask.shape !== 'none' && (
            <>
              <Slider
                label="Mask feather"
                min={0}
                max={1}
                step={0.02}
                value={clip.alphaMask.feather}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(value) =>
                  apply('Mask feather', (p) => ops.setMask(p, clip.id, clip.alphaMask!.shape, { ...clip.alphaMask, feather: value }))
                }
              />
              <Toggle
                label="Invert alpha mask"
                checked={clip.alphaMask.invert}
                onChange={(value) =>
                  apply('Invert mask', (p) => ops.setMask(p, clip.id, clip.alphaMask!.shape, { ...clip.alphaMask, invert: value }))
                }
              />
            </>
          )}
          <Field label="Blend mode">
            <Select
              value={clip.transform.blendMode ?? 'normal'}
              onChange={(value) => apply('Blend mode', (p) => ops.setClipBlendMode(p, clip.id, value))}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'screen', label: 'Screen (glow / light)' },
                { value: 'multiply', label: 'Multiply (darken)' },
                { value: 'overlay', label: 'Overlay (contrast)' },
              ]}
            />
          </Field>
          <Field label="PiP placement preset">
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'floating-center', 'cinema-bar'] as const).map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="ghost"
                  onClick={() => apply(`PiP: ${preset}`, (p) => ops.applyPipPreset(p, clip.id, preset))}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Shadow / Glow preset">
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(['none', 'soft-card', 'deep-studio', 'neon-cyan', 'neon-amber'] as const).map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant="ghost"
                  onClick={() => apply(`Glow: ${preset}`, (p) => ops.applyShadowGlowPreset(p, clip.id, preset))}
                >
                  {preset}
                </Button>
              ))}
            </div>
          </Field>
          <Slider label="Rotation" min={-180} max={180} step={1} value={clip.transform.rotationDeg} format={(v) => `${v}°`} onChange={(value) => patch('Rotate clip', { transform: { rotationDeg: value } })} />
          <Slider label="Opacity" min={0} max={1} step={0.01} value={clip.transform.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Clip opacity', { transform: { opacity: value } })} />
          <Slider label="Corner radius" min={0} max={120} step={1} value={clip.transform.radius} format={(v) => `${v}px`} onChange={(value) => patch('Corner radius', { transform: { radius: value } })} />
          <Slider label="Shadow" min={0} max={80} step={1} value={clip.transform.shadow} format={(v) => `${v}px`} onChange={(value) => patch('Shadow', { transform: { shadow: value } })} />
          <Slider
            label="Studio frame padding"
            min={0}
            max={0.16}
            step={0.01}
            value={clip.effects.backdropPadding ?? 0}
            format={(v) => (v <= 0 ? 'off' : `${Math.round(v * 100)}%`)}
            onChange={(value) =>
              apply('Studio frame padding', (p) =>
                value <= 0
                  ? ops.updateClipDeep(p, clip.id, { effects: { backdropPadding: 0 }, transform: { scale: 1 } })
                  : ops.applyScreenStudioFrame(p, clip.id, value),
              )
            }
          />
          <Slider
            label="Diagram reveal steps"
            min={1}
            max={12}
            step={1}
            value={clip.effects.revealSteps ?? 1}
            format={(v) => (v <= 1 ? 'off' : `${v} steps`)}
            onChange={(value) => patch('Diagram reveal steps', { effects: { revealSteps: value <= 1 ? undefined : value } })}
          />
        </InspectorSection>
      )}

      {isPresenter && (
        <InspectorSection title="Presenter layout">
          <Field label="Layout">
            <Select
              value={clip.presenter!.layout}
              onChange={(value) => patch('Presenter layout', { presenter: { layout: value } })}
              options={[
                { value: 'bubble', label: 'Bubble over screen' },
                { value: 'side-by-side', label: 'Side by side (Split)' },
                { value: 'full', label: 'Camera only' },
                { value: 'screen-only', label: 'Screen only' },
              ]}
            />
          </Field>
          <Field label="Shape">
            <Select
              aria-label="Presenter bubble shape"
              value={clip.presenter!.shape}
              onChange={(value) => patch('Bubble shape', { presenter: { shape: value } })}
              options={PRESENTER_BUBBLE_SHAPES.map((s) => ({ value: s.id, label: s.label }))}
            />
          </Field>
          <Field label="Bubble effect">
            <Select
              aria-label="Presenter bubble effect"
              value={clip.presenter!.effect ?? 'none'}
              onChange={(value) =>
                patch('Bubble effect', {
                  presenter: { effect: value as NonNullable<NonNullable<Clip['presenter']>['effect']> },
                })
              }
              options={PRESENTER_BUBBLE_EFFECTS.map((fx) => ({ value: fx.id, label: fx.label }))}
            />
          </Field>
          <Field label="Corner">
            <Select
              value={clip.presenter!.corner}
              onChange={(value) => patch('Bubble corner', { presenter: { corner: value, x: undefined, y: undefined } })}
              options={[
                { value: 'bottom-right', label: 'Bottom right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'top-right', label: 'Top right' },
                { value: 'top-left', label: 'Top left' },
              ]}
            />
          </Field>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Presenter quick placement">
            {(
              [
                { id: 'top-left', label: '↖ Top-L' },
                { id: 'top-right', label: '↗ Top-R' },
                { id: 'bottom-left', label: '↙ Bot-L' },
                { id: 'bottom-right', label: '↘ Bot-R' },
              ] as const
            ).map((place) => (
              <Button
                key={place.id}
                size="sm"
                variant={
                  clip.presenter!.corner === place.id &&
                  typeof clip.presenter!.x !== 'number' &&
                  typeof clip.presenter!.y !== 'number'
                    ? 'primary'
                    : 'ghost'
                }
                onClick={() => patch('Bubble corner', { presenter: { corner: place.id, x: undefined, y: undefined } })}
              >
                {place.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant={
                typeof clip.presenter!.x === 'number' &&
                Math.abs(clip.presenter!.x - 0.5) < 0.03 &&
                typeof clip.presenter!.y === 'number' &&
                Math.abs(clip.presenter!.y - 0.5) < 0.03
                  ? 'primary'
                  : 'ghost'
              }
              onClick={() => patch('Center presenter bubble', { presenter: { x: 0.5, y: 0.5 } })}
            >
              ⊕ Center
            </Button>
          </div>
          <Slider
            label="Position X"
            min={0.05}
            max={0.95}
            step={0.01}
            value={
              typeof clip.presenter!.x === 'number'
                ? clip.presenter!.x
                : clip.presenter!.corner === 'top-left' || clip.presenter!.corner === 'bottom-left'
                  ? 0.16
                  : 0.84
            }
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(value) => {
              const curY =
                typeof clip.presenter!.y === 'number'
                  ? clip.presenter!.y
                  : clip.presenter!.corner === 'top-left' || clip.presenter!.corner === 'top-right'
                    ? 0.18
                    : 0.82;
              patch('Bubble position X', {
                presenter: {
                  x: value,
                  y: curY,
                  corner: cornerFromNormalizedCenter(value, curY),
                },
              });
            }}
          />
          <Slider
            label="Position Y"
            min={0.05}
            max={0.95}
            step={0.01}
            value={
              typeof clip.presenter!.y === 'number'
                ? clip.presenter!.y
                : clip.presenter!.corner === 'top-left' || clip.presenter!.corner === 'top-right'
                  ? 0.18
                  : 0.82
            }
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(value) => {
              const curX =
                typeof clip.presenter!.x === 'number'
                  ? clip.presenter!.x
                  : clip.presenter!.corner === 'top-left' || clip.presenter!.corner === 'bottom-left'
                    ? 0.16
                    : 0.84;
              patch('Bubble position Y', {
                presenter: {
                  x: curX,
                  y: value,
                  corner: cornerFromNormalizedCenter(curX, value),
                },
              });
            }}
          />
          <Slider label="Bubble size" min={0.1} max={0.7} step={0.01} value={clip.presenter!.size} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Bubble size', { presenter: { size: value } })} />
          <Slider label="Shadow" min={0} max={60} step={1} value={clip.presenter!.shadow} format={(v) => (v === 0 ? 'none' : `${v}px`)} onChange={(value) => patch('Bubble shadow', { presenter: { shadow: value } })} />
          <Slider label="Outline" min={0} max={24} step={1} value={clip.presenter!.border} format={(v) => (v === 0 ? 'none' : `${v}px`)} onChange={(value) => patch('Bubble outline', { presenter: { border: value } })} />
          {clip.presenter!.border > 0 && (
            <Field label="Outline colour">
              <input
                className="input"
                type="color"
                value={clip.presenter!.borderColor}
                onChange={(event) => patch('Bubble outline colour', { presenter: { borderColor: event.target.value } })}
                aria-label="Presenter outline colour"
              />
            </Field>
          )}
          <Toggle label="Mirror camera" checked={clip.presenter!.mirror} onChange={(value) => patch('Mirror camera', { presenter: { mirror: value } })} />
          <Toggle
            label="Visible in preview & export"
            checked={clip.presenter!.visible !== false}
            onChange={(value) => patch('Presenter visibility', { presenter: { visible: value } })}
          />
          <Toggle
            label="Chroma key (experimental)"
            checked={clip.presenter!.chromaKey}
            onChange={(value) => patch('Chroma key', { presenter: { chromaKey: value } })}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => apply('Reset presenter position', (p) => ops.resetPresenterPosition(p, clip.id))}
          >
            Reset camera position
          </Button>
        </InspectorSection>
      )}

      {clip.kind === 'title' && clip.text && (
        <InspectorSection title="Text">
          <Field label="Text">
            <textarea
              className="textarea"
              value={clip.text.text}
              onChange={(event) => apply('Edit title', (p) => ops.updateClipDeep(p, clip.id, { text: { text: event.target.value } }))}
            />
          </Field>
          <Field label="Highlight lines (1-based, e.g. 1, 3-4)" hint="Draws an accent bar behind specific code or terminal lines.">
            <input
              className="input mono"
              defaultValue={ops.formatHighlightLines(clip.text.highlightLines)}
              placeholder="e.g. 1, 3"
              onBlur={(event) => {
                const parsed = ops.parseHighlightLines(event.target.value);
                apply('Highlight code lines', (p) => ops.setCodeHighlightLines(p, clip.id, parsed));
              }}
            />
          </Field>
          <Toggle
            label="CLI mode ($ prompt + dimmed output)"
            checked={Boolean(clip.text.cliMode)}
            onChange={(value) => patch('CLI styling', { text: { cliMode: value } })}
          />
          <Toggle
            label="Typewriter reveal"
            checked={Boolean(clip.text.typewriter)}
            onChange={(value) => patch('Typewriter reveal', { text: { typewriter: value } })}
          />
          <Field label="Kinetic animation (77 animations)">
            <Select
              value={clip.text.animation ?? 'none'}
              onChange={(value) => apply(`Text animation: ${value}`, (p) => ops.setTextAnimation(p, clip.id, value))}
              options={[
                { value: 'none', label: 'None' },
                ...TEXT_ANIMATIONS.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </Field>
          <Field label="Typography preset (34 presets)">
            <Select
              value={clip.text.stylePreset ?? 'none'}
              onChange={(value) => apply(`Text preset: ${value}`, (p) => ops.applyTextPreset(p, clip.id, value))}
              options={[
                { value: 'none', label: 'Custom style' },
                ...TEXT_STYLE_PRESETS.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </Field>
          <Field
            label="Font family (406 fonts + uploaded)"
            hint={
              checkFontAvailability(clip.text.fontFamily, project).badge === 'fallback'
                ? 'Font not installed locally — rendering with fallback font in preview & export'
                : 'Font verified and ready for preview & export'
            }
          >
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <Select
                value={clip.text.fontFamily}
                onChange={(value) => apply(`Font: ${value}`, (p) => ops.setTextFont(p, clip.id, value))}
                options={[
                  ...(project?.customFonts ?? []).map((f) => ({
                    value: f.family,
                    label: `${f.family} (uploaded .${f.format})`,
                  })),
                  ...FONT_FAMILIES.map((family) => ({ value: family, label: family })),
                ]}
              />
              <Badge tone={checkFontAvailability(clip.text.fontFamily, project).badge === 'ready' ? 'ok' : 'warn'}>
                {checkFontAvailability(clip.text.fontFamily, project).badge}
              </Badge>
            </div>
          </Field>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input
              ref={fontInputRef}
              type="file"
              accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
              aria-label="Upload custom font file"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setFontUploadError(null);
                void file
                  .arrayBuffer()
                  .then(async (buf) => {
                    const descriptor = parseAndValidateCustomFont({
                      fileName: file.name,
                      bytes: new Uint8Array(buf),
                    });
                    await loadCustomFontDescriptor(descriptor);
                    apply(`Upload font: ${descriptor.family}`, (p) => {
                      const withFont = ops.addCustomFontToProject(p, descriptor);
                      return ops.setTextFont(withFont, clip.id, descriptor.family);
                    });
                  })
                  .catch((err: unknown) => {
                    setFontUploadError((err as Error).message);
                  });
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => fontInputRef.current?.click()}>
              Upload font (.woff2/.woff/.ttf/.otf)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const saved = saveUserTextStylePreset(clip.label ?? 'Custom Style', {
                  fontFamily: clip.text!.fontFamily,
                  fontWeight: clip.text!.fontWeight,
                  fontSize: clip.text!.fontSize,
                  color: clip.text!.color,
                  gradientToColor: clip.text!.gradientToColor,
                  background: clip.text!.background,
                  backgroundOpacity: clip.text!.backgroundOpacity,
                  strokeColor: clip.text!.strokeColor,
                  strokeWidth: clip.text!.strokeWidth,
                  shadowColor: clip.text!.shadowColor,
                  shadowBlur: clip.text!.shadowBlur,
                  glowColor: clip.text!.glowColor,
                  glowBlur: clip.text!.glowBlur,
                  letterSpacing: clip.text!.letterSpacing,
                });
                apply(`Save style: ${saved.name}`, (p) => ops.applyTextPreset(p, clip.id, saved.id));
              }}
            >
              + Save to My styles
            </Button>
          </div>
          {fontUploadError && <div className="warn-card">{fontUploadError}</div>}
          {project?.customFonts && project.customFonts.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="field-label">Uploaded project fonts ({project.customFonts.length})</span>
              {project.customFonts.map((f) => (
                <div key={f.id} className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                  <span>
                    {f.family} <span className="mono">(.{f.format})</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => apply(`Remove font ${f.family}`, (p) => ops.removeCustomFontFromProject(p, f.id))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Field label="Emphasis style (5 styles)">
            <Select
              value={clip.text.emphasis ?? 'none'}
              onChange={(value) => apply(`Emphasis: ${value}`, (p) => ops.setEmphasis(p, clip.id, value))}
              options={[
                { value: 'none', label: 'None' },
                ...EMPHASIS_STYLES.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </Field>
          <Slider label="Font size" min={16} max={220} step={1} value={clip.text.fontSize} format={(v) => `${v}px`} onChange={(value) => patch('Title size', { text: { fontSize: value } })} />
          <Slider label="Background opacity" min={0} max={1} step={0.01} value={clip.text.backgroundOpacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Title background', { text: { backgroundOpacity: value } })} />
          <Field label="Align">
            <Select
              value={clip.text.align}
              onChange={(value) => patch('Title align', { text: { align: value } })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Field>
        </InspectorSection>
      )}

      {clip.kind === 'keystroke' && clip.keystroke && (
        <InspectorSection title="Keystroke overlay">
          <Field label="Keys (separated by +)" hint="e.g. Ctrl + Shift + P or ⌘ + K">
            <input
              className="input mono"
              defaultValue={clip.keystroke.keys.join(' + ')}
              onBlur={(event) => {
                const keys = ops.parseKeyChord(event.target.value);
                patch('Edit keystroke keys', { keystroke: { keys } });
              }}
            />
          </Field>
          <Field label="Action label">
            <input
              className="input"
              value={clip.keystroke.label ?? ''}
              onChange={(event) => patch('Edit keystroke label', { keystroke: { label: event.target.value } })}
            />
          </Field>
          <Field label="Theme">
            <Select
              value={clip.keystroke.style}
              onChange={(value) => patch('Keystroke theme', { keystroke: { style: value } })}
              options={[
                { value: 'dark', label: 'Dark keycaps' },
                { value: 'light', label: 'Light keycaps' },
              ]}
            />
          </Field>
        </InspectorSection>
      )}

      {clip.kind === 'endscreen' && clip.endScreen && (
        <InspectorSection title="End screen (20s)">
          <Field label="Heading">
            <input
              className="input"
              value={clip.endScreen.heading}
              onChange={(event) => patch('End screen heading', { endScreen: { heading: event.target.value } })}
            />
          </Field>
          <Field label="Left video slot label">
            <input
              className="input"
              value={clip.endScreen.leftTitle}
              onChange={(event) => patch('End screen left slot', { endScreen: { leftTitle: event.target.value } })}
            />
          </Field>
          <Field label="Right video slot label">
            <input
              className="input"
              value={clip.endScreen.rightTitle}
              onChange={(event) => patch('End screen right slot', { endScreen: { rightTitle: event.target.value } })}
            />
          </Field>
          <Toggle
            label="Show Subscribe badge"
            checked={clip.endScreen.showSubscribe}
            onChange={(value) => patch('End screen subscribe', { endScreen: { showSubscribe: value } })}
          />
        </InspectorSection>
      )}

      <InspectorSection title="Colour">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Button
            size="sm"
            variant={compareOriginal ? 'primary' : 'ghost'}
            aria-pressed={compareOriginal}
            onClick={() => setCompareOriginal(!compareOriginal)}
          >
            {compareOriginal ? 'Comparing Original (Click for Graded)' : 'Compare Original / Graded'}
          </Button>
          <input
            ref={lutInputRef}
            type="file"
            accept=".cube"
            aria-label="Import .cube LUT file"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setLutUploadError(null);
              void file
                .text()
                .then((text) => {
                  apply(`Import .cube LUT (${file.name})`, (p) => ops.importCustomCubeLut(p, text, clip.id));
                })
                .catch((err: unknown) => {
                  setLutUploadError((err as Error).message);
                });
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => lutInputRef.current?.click()}>
            Import .cube LUT…
          </Button>
        </div>
        {lutUploadError && <div className="warn-card">{lutUploadError}</div>}
        <Field label="Color filter (77 presets)">
          <Select
            value={clip.effects.colorFilter ?? 'normal'}
            onChange={(value) => apply(`Color filter: ${value}`, (p) => ops.applyFilter(p, clip.id, value))}
            options={[
              { value: 'normal', label: 'Normal (neutral)' },
              ...COLOR_FILTERS.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
        <Field label="Look preset (16 stylized cinematic looks)">
          <Select
            value={clip.effects.lut ?? 'none'}
            onChange={(value) => apply(`Look preset: ${value}`, (p) => ops.applyLUT(p, clip.id, value))}
            options={[
              { value: 'none', label: 'None' },
              ...(clip.effects.customLutData
                ? [{ value: clip.effects.customLutData.id, label: `${clip.effects.customLutData.name} (imported .cube)` }]
                : []),
              ...CINEMATIC_LUTS.map((item) => ({ value: item.id, label: `${item.name} (stylized)` })),
            ]}
          />
        </Field>
        <p className="hint">
          The 16 built-in looks are stylized presets. Import a .cube file to grade the actual pixels with a real
          {clip.effects.customLutData ? ` ${clip.effects.customLutData.size}³` : ' 3D'} lattice.
        </p>
        {clip.effects.customLutData && (
          <>
            <Slider
              label="Imported LUT strength"
              min={0}
              max={1}
              step={0.01}
              value={clip.effects.lutStrength ?? 1}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => apply('LUT strength', (p) => ops.setLutStrength(p, [clip.id], value))}
            />
            <p className="hint">
              {clip.effects.customLutData.name}: {clip.effects.customLutData.size}³ lattice (domain [
              {clip.effects.customLutData.domainMin.join(', ')}]..[
              {clip.effects.customLutData.domainMax.join(', ')}], {clip.effects.customLutData.lattice.length / 3}{' '}
              samples) saved with this project, so it survives a refresh and a backup restore.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => apply('Remove imported LUT', (p) => ops.clearCustomLut(p, [clip.id]))}
            >
              Remove imported LUT
            </Button>
          </>
        )}
        <ColorWheelsPanel
          wheels={clip.effects.colorWheels ?? {}}
          onChange={(scope, value) => {
            beginOnce('Colour wheel');
            updateGesture((p) => ops.setColorWheel(p, [clip.id], scope, value));
          }}
          onCommit={commitGesture}
          onCancel={() => {
            gestureOpen.current = false;
            cancelGesture();
          }}
          onReset={() => apply('Reset colour wheels', (p) => ops.resetColorWheels(p, [clip.id]))}
        />
        <HslBandsPanel
          bands={clip.effects.hslBands ?? {}}
          onChange={(band, value) => {
            beginOnce('HSL adjustment');
            updateGesture((p) => ops.setHslBandAdjustment(p, [clip.id], band, value));
          }}
          onCommit={commitGesture}
          onReset={() => apply('Reset HSL', (p) => ops.clearHslBands(p, [clip.id]))}
        />
        <ToneCurvePanel
          curves={clip.effects.toneCurves ?? {}}
          onChange={(channel, points) => {
            beginOnce('Tone curve');
            updateGesture((p) => ops.setToneCurve(p, [clip.id], channel, points));
          }}
          onCommit={commitGesture}
          onReset={() => apply('Reset tone curves', (p) => ops.clearToneCurves(p, [clip.id]))}
        />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" onClick={() => apply('Reset colour grading', (p) => ops.resetColorGrading(p, [clip.id]))}>
            Reset all grading
          </Button>
        </div>
        <Field label="Look preset">
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {(['neutral', 'cinema-teal', 'warm-creator', 'high-contrast-terminal', 'crisp-daylight', 'vibrant-reel', 'noir-mono'] as const).map((look) => (
              <Button
                key={look}
                size="sm"
                variant="ghost"
                onClick={() => apply(`Look: ${look}`, (p) => ops.applyColorLookPreset(p, look, clip.id))}
              >
                {look}
              </Button>
            ))}
          </div>
        </Field>
        <Slider label="Exposure" min={-1} max={1} step={0.01} value={clip.effects.exposure} format={(v) => v.toFixed(2)} onChange={(value) => patch('Exposure', { effects: { exposure: value } })} />
        <Slider label="Vibrance" min={-1} max={1} step={0.01} value={clip.effects.vibrance} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Vibrance', { effects: { vibrance: value } })} />
        <Slider label="Brightness" min={-0.5} max={0.5} step={0.01} value={clip.effects.brightness} format={(v) => `${Math.round(v * 100)}`} onChange={(value) => patch('Brightness', { effects: { brightness: value } })} />
        <Slider label="Contrast" min={-0.5} max={0.5} step={0.01} value={clip.effects.contrast} format={(v) => `${Math.round(v * 100)}`} onChange={(value) => patch('Contrast', { effects: { contrast: value } })} />
        <Slider label="Saturation" min={-1} max={1} step={0.01} value={clip.effects.saturation} format={(v) => `${Math.round(v * 100)}`} onChange={(value) => patch('Saturation', { effects: { saturation: value } })} />
        <Slider label="Temperature" min={-1} max={1} step={0.01} value={clip.effects.temperature} format={(v) => v.toFixed(2)} onChange={(value) => patch('Temperature', { effects: { temperature: value } })} />
        <Slider
          label="Vignette"
          min={0}
          max={1}
          step={0.05}
          value={clip.effects.vignette ?? 0}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(value) => apply('Vignette', (p) => ops.setClipVignette(p, clip.id, value))}
        />
      </InspectorSection>

      <InspectorSection title="Audio">
        <Toggle label="Mute clip" checked={clip.audio.muted} onChange={(value) => patch('Mute clip', { audio: { muted: value } })} />
        <Toggle
          label="Speech chain (HPF/EQ/comp/limiter)"
          checked={clip.audio.processed}
          onChange={(value) => patch('Speech processing', { audio: { processed: value } })}
        />
        <Field label="Voice mastering preset">
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {(['podcast-warm', 'crisp-tech', 'broadcast-punch', 'de-reverb-tight', 'flat'] as const).map((vp) => (
              <Button
                key={vp}
                size="sm"
                variant="ghost"
                onClick={() => apply(`Voice: ${vp}`, (p) => ops.applyVoicePreset(p, vp, clip.id))}
              >
                {vp}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => apply('Normalize clip gain', (p) => ops.normalizeClipGain(p, clip.id, 1.25))}
            >
              Normalize (+2 dB)
            </Button>
          </div>
        </Field>
        <Slider label="Gain" min={0} max={2} step={0.01} value={clip.audio.gain} format={(v) => `${(20 * Math.log10(Math.max(0.0001, v))).toFixed(1)} dB`} onChange={(value) => patch('Clip gain', { audio: { gain: value } })} />
        <Slider label="Pan" min={-1} max={1} step={0.01} value={clip.audio.pan} format={(v) => (v === 0 ? 'centre' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`)} onChange={(value) => patch('Clip pan', { audio: { pan: value } })} />
        <Slider label="Fade in" min={0} max={5} step={0.05} value={clip.audio.fadeInTicks / TICKS_PER_SECOND} format={(v) => `${v.toFixed(2)}s`} onChange={(value) => patch('Fade in', { audio: { fadeInTicks: Math.round(value * TICKS_PER_SECOND) } })} />
        <Slider label="Fade out" min={0} max={5} step={0.05} value={clip.audio.fadeOutTicks / TICKS_PER_SECOND} format={(v) => `${v.toFixed(2)}s`} onChange={(value) => patch('Fade out', { audio: { fadeOutTicks: Math.round(value * TICKS_PER_SECOND) } })} />
      </InspectorSection>

      <InspectorSection title="Masks (manual)">
        {clip.masks.length === 0 && <div className="field-hint">No masks. Masks are placed manually — there is no automatic face or secret tracking.</div>}
        {clip.masks.map((mask, index) => (
          <div key={index} className="stack" style={{ gap: 6, padding: 8, border: '1px solid var(--line)', borderRadius: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="field-label">Mask {index + 1}</span>
              <Button size="sm" variant="danger" onClick={() => apply('Remove mask', (p) => ops.removeMask(p, clip.id, index))}>
                Remove
              </Button>
            </div>
            <Select
              value={mask.mode}
              onChange={(value) => apply('Mask mode', (p) => ops.updateMask(p, clip.id, index, { mode: value }))}
              options={[
                { value: 'blur', label: 'Blur' },
                { value: 'pixelate', label: 'Pixelate' },
                { value: 'solid', label: 'Solid cover' },
                { value: 'spotlight', label: 'Spotlight dimmer' },
              ]}
            />
            {mask.mode === 'solid' && (
              <Field label="Cover colour">
                <input
                  className="input"
                  type="color"
                  aria-label={`Mask ${index + 1} cover colour`}
                  value={mask.color ?? '#000000'}
                  onChange={(event) => apply('Mask colour', (p) => ops.updateMask(p, clip.id, index, { color: event.target.value }))}
                />
              </Field>
            )}
            <Slider label="X" min={0} max={1} step={0.01} value={mask.x} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask position', (p) => ops.updateMask(p, clip.id, index, { x: value }))} />
            <Slider label="Y" min={0} max={1} step={0.01} value={mask.y} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask position', (p) => ops.updateMask(p, clip.id, index, { y: value }))} />
            <Slider label="Width" min={0.03} max={1} step={0.01} value={mask.width} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask size', (p) => ops.updateMask(p, clip.id, index, { width: value }))} />
            <Slider label="Height" min={0.03} max={1} step={0.01} value={mask.height} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask size', (p) => ops.updateMask(p, clip.id, index, { height: value }))} />
            {mask.mode !== 'solid' && (
              <Slider label="Strength" min={2} max={40} step={1} value={mask.strength} onChange={(value) => apply('Mask strength', (p) => ops.updateMask(p, clip.id, index, { strength: value }))} />
            )}
            {mask.mode !== 'spotlight' && (
              <Slider
                label="Feather"
                min={0}
                max={0.45}
                step={0.01}
                value={mask.feather ?? 0}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(value) => apply('Mask feather', (p) => ops.updateMask(p, clip.id, index, { feather: value }))}
              />
            )}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  apply('Keyframe mask', (p) =>
                    ops.upsertMaskKeyframe(p, clip.id, index, {
                      atTicks: localTicks,
                      x: mask.x,
                      y: mask.y,
                      width: mask.width,
                      height: mask.height,
                    }),
                  )
                }
              >
                + Keyframe mask at {formatClock(localTicks)} ({mask.keyframes?.length ?? 0})
              </Button>
              {(mask.keyframes?.length ?? 0) > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => apply('Clear mask keyframes', (p) => ops.clearMaskKeyframes(p, clip.id, index))}
                >
                  Clear mask keys
                </Button>
              )}
            </div>
          </div>
        ))}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            onClick={() =>
              apply('Add mask', (p) => ops.addMask(p, clip.id, { x: 0.35, y: 0.35, width: 0.3, height: 0.15, mode: 'blur', strength: 14, feather: 0 }))
            }
          >
            Add mask at centre
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              apply('Add solid mask', (p) =>
                ops.addMask(p, clip.id, { x: 0.35, y: 0.35, width: 0.3, height: 0.15, mode: 'solid', strength: 20, color: '#000000', feather: 0 }),
              )
            }
          >
            + Solid cover
          </Button>
        </div>
      </InspectorSection>

      <InspectorSection title="Keyframes">
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          <Button
            size="sm"
            variant="ghost"
            disabled={clip.keyframes.length === 0}
            onClick={() => {
              const target = ops.jumpToAdjacentKeyframe(clip, localTicks, 'prev');
              if (target !== null) useEditor.getState().setPlayhead(clip.startTicks + target);
            }}
          >
            ◀ Prev key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={clip.keyframes.length === 0}
            onClick={() => {
              const target = ops.jumpToAdjacentKeyframe(clip, localTicks, 'next');
              if (target !== null) useEditor.getState().setPlayhead(clip.startTicks + target);
            }}
          >
            Next key ▶
          </Button>
        </div>
        {clip.keyframes.length === 0 && <div className="field-hint">No keyframes.</div>}
        {clip.keyframes.map((group) => (
          <div key={group.target} className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
            <span className="mono">
              {group.target} · {group.keyframes.length}
            </span>
            <Button size="sm" variant="ghost" onClick={() => apply('Clear keyframes', (p) => ops.clearKeyframes(p, clip.id, group.target))}>
              Clear
            </Button>
          </div>
        ))}
        <div className="field-hint">
          {Object.entries(keyframes).length > 0 ? `Tracks: ${Object.keys(keyframes).join(', ')}` : 'Add keyframes from Transform above.'}
        </div>
      </InspectorSection>
    </div>
    </InspectorFocus.Provider>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { section: focus, query } = useContext(InspectorFocus);
  if (focus !== 'All' && focus !== title) return null;
  if (query.trim() && !title.toLowerCase().includes(query.trim().toLowerCase())) {
    // Keep section visible when its title matches or when query is cleared
  }
  return (
    <details key={`${focus}-${title}`} className="panel" style={{ boxShadow: 'none' }} open={focus === title || Boolean(query.trim()) || title === 'Transform' || title === 'Timing'}>
      <summary
        style={{
          cursor: 'pointer',
          padding: '9px 12px',
          fontSize: 11.5,
          fontWeight: 650,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--text-2)',
        }}
      >
        {title}
      </summary>
      <div className="panel-body stack" style={{ padding: 12, gap: 10 }}>
        {children}
      </div>
    </details>
  );
}

export function NoSelection({ project }: { project: Project }) {
  return (
    <Panel title="Inspector">
      <div className="stack" style={{ gap: 10 }}>
        <div className="field-hint">
          Select a clip on the timeline to inspect and adjust its transform, timing, colour, audio, or masks for{' '}
          <strong>{project.name}</strong>. Composition settings and project deletion live under the <strong>Project ▾</strong> menu or <strong>More</strong> tool.
        </div>
      </div>
    </Panel>
  );
}

const EMPTY_BRAND: BrandKit = { name: '', role: '', email: '', linkedin: '' };

function BrandKitFields({ brand }: { brand: BrandKit | undefined }) {
  const apply = useEditor((state) => state.apply);
  const current = brand ?? EMPTY_BRAND;
  // Fields commit on blur so typing does not add one undo step per keystroke.
  const field = (key: keyof BrandKit, label: string, placeholder: string) => (
    <Field label={label} key={`${key}-${current[key]}`}>
      <input
        className="input"
        defaultValue={current[key]}
        placeholder={placeholder}
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value === current[key]) return;
          apply('Edit brand kit', (p) => ({ ...p, brand: { ...(p.brand ?? EMPTY_BRAND), [key]: value } }));
        }}
      />
    </Field>
  );
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="field-label">Brand kit (header and footer)</div>
      {field('name', 'Name', 'Kona Srinivas')}
      {field('role', 'Role', 'DevOps')}
      {field('email', 'Email', 'you@example.com')}
      {field('linkedin', 'LinkedIn', 'https://www.linkedin.com/in/…')}
      <Field label="Contact bar style">
        <Select<ContactStyle>
          value={current.style ?? 'glass'}
          onChange={(value) => apply('Contact bar style', (p) => ({ ...p, brand: { ...(p.brand ?? EMPTY_BRAND), style: value } }))}
          options={[
            { value: 'glass', label: 'Glass' },
            { value: 'gradient', label: 'Accent gradient' },
            { value: 'solid', label: 'Solid dark' },
            { value: 'accent', label: 'Solid accent' },
          ]}
        />
      </Field>
      <Field label="Accent colour">
        <input
          type="color"
          value={current.accent ?? '#1f6feb'}
          onChange={(event) => apply('Accent colour', (p) => ({ ...p, brand: { ...(p.brand ?? EMPTY_BRAND), accent: event.target.value } }))}
        />
      </Field>
      <div className="field-hint">Stored in this project only. Used by Add → Brand → Header and footer.</div>
    </div>
  );
}

export function ProjectSettingsPanel({ project }: { project: Project }) {
  const apply = useEditor((state) => state.apply);
  const projectFolder = useSession((state) => state.projectFolder);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <BrandKitFields brand={project.brand} />
      <Field label="Composition size">
        <div className="row">
          <input
            className="input mono"
            type="number"
            value={project.canvas.width}
            min={320}
            onChange={(event) => {
              const width = Number(event.target.value);
              if (!Number.isFinite(width) || width < 320) return;
              apply('Canvas width', (p) => ({
                ...p,
                canvas: { ...p.canvas, width, height: Math.round((width / p.canvas.width) * p.canvas.height) },
              }));
            }}
            aria-label="Composition width"
          />
          <span style={{ color: 'var(--text-3)' }}>×</span>
          <input
            className="input mono"
            type="number"
            value={project.canvas.height}
            min={240}
            onChange={(event) => {
              const height = Number(event.target.value);
              if (!Number.isFinite(height) || height < 240) return;
              apply('Canvas height', (p) => ({ ...p, canvas: { ...p.canvas, height } }));
            }}
            aria-label="Composition height"
          />
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => apply('Reframe 16:9 4K', (p) => ops.reframe16x9(p, true))}
          >
            16:9 4K (3840×2160)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => apply('Reframe 16:9 1080p', (p) => ops.reframe16x9(p, false))}
          >
            16:9 (1920×1080)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => apply('Reframe 9:16', (p) => ops.reframe9x16(p))}>
            9:16 Shorts / Reels (1080×1920)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => apply('Reframe 4:5', (p) => ops.reframe4x5(p))}>
            4:5 Insta / LinkedIn (1080×1350)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => apply('Reframe 1:1', (p) => ops.reframe1x1(p))}>
            1:1 Square Post (1080×1080)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => apply('9:16 follow presenter', (p) => ops.reframeFollowPresenter(p))}>
            9:16 follow presenter
          </Button>
        </div>
      </Field>
      <Field label="YouTube / Instagram / LinkedIn workflow preset" hint="One-click reframe + compatible LUT, color filter, transition, caption style, and title preset.">
        <Select
          value=""
          onChange={(value) => {
            if (!value) return;
            apply(`Platform preset: ${value}`, (p) => ops.applyPlatformPreset(p, value));
          }}
          options={[
            { value: '', label: 'Choose a YouTube, Instagram, or LinkedIn preset…' },
            ...PLATFORM_WORKFLOW_PRESETS.map((item) => ({
              value: item.id,
              label: `${item.name} — ${item.width}×${item.height}`,
            })),
          ]}
        />
      </Field>
      <Field label="Frame rate">
        <Select
          value={`${project.canvas.fps.num}/${project.canvas.fps.den}`}
          onChange={(value) => {
            const [num, den] = value.split('/').map(Number);
            apply('Frame rate', (p) => ({ ...p, canvas: { ...p.canvas, fps: { num: num ?? 30, den: den ?? 1 } } }));
          }}
          options={[
            { value: '24/1', label: '24 fps' },
            { value: '25/1', label: '25 fps' },
            { value: '30/1', label: '30 fps' },
            { value: '30000/1001', label: '29.97 fps' },
            { value: '60/1', label: '60 fps' },
          ]}
        />
      </Field>
      <Field label="Background">
        <input
          className="input"
          type="color"
          value={project.canvas.background.startsWith('#') ? project.canvas.background : '#0b0f14'}
          onChange={(event) => apply('Canvas background', (p) => ({ ...p, canvas: { ...p.canvas, background: event.target.value } }))}
          style={{ height: 36 }}
        />
      </Field>
      <Field label="Project notes">
        <textarea
          className="textarea"
          defaultValue={project.notes}
          placeholder="Lesson outline, chapter list, recording reminders…"
          onBlur={(event) => apply('Project notes', (p) => ({ ...p, notes: event.target.value }))}
        />
      </Field>
      <div className="field-hint">
        Deleting a project removes its folder, its takes and the media inside it. Saved exports stay where they were
        saved.
      </div>
      <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={!projectFolder}>
        Delete this project and its recordings…
      </Button>
      <DeleteProjectDialog
        open={deleteOpen}
        folder={projectFolder}
        name={project.name}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
