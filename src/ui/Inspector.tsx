import { useMemo, useState } from 'react';
import { TICKS_PER_SECOND, formatClock } from '../core/time';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import * as ops from '../project/ops';
import type { BrandKit, Clip, ContactStyle, Project } from '../project/types';
import { Badge, Button, Field, Panel, Select, Slider, Toggle } from './components';
import { DeleteProjectDialog } from './DeleteProjectDialog';

export function Inspector({ clip, trackKind }: { clip: Clip; trackKind: string }) {
  const apply = useEditor((state) => state.apply);
  const playhead = useEditor((state) => state.playheadTicks);
  const localTicks = Math.max(0, playhead - clip.startTicks);

  const patch = (label: string, deep: Parameters<typeof ops.updateClipDeep>[2]) =>
    apply(label, (p) => ops.updateClipDeep(p, clip.id, deep));
  const setClip = (label: string, value: Partial<Clip>) => apply(label, (p) => ops.updateClip(p, clip.id, value));

  const hasVideo = trackKind === 'video';
  const isPresenter = Boolean(clip.presenter);
  const keyframes = useMemo(
    () => Object.fromEntries(clip.keyframes.map((group) => [group.target, group.keyframes.length])) as Record<string, number>,
    [clip.keyframes],
  );

  const addKeyframe = (target: 'x' | 'y' | 'scale' | 'opacity' | 'volume' | 'zoom', value: number) =>
    apply(`Keyframe ${target}`, (p) => ops.upsertKeyframe(p, clip.id, target, localTicks, value));

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="panel" style={{ boxShadow: 'none' }}>
        <div className="panel-body" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>{clip.label ?? clip.kind}</strong>
            <Badge>{trackKind}</Badge>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.6 }} className="mono">
            start {formatClock(clip.startTicks)} · dur {formatClock(clip.durationTicks)}
            <br />
            in {formatClock(clip.inTicks)} · {clip.speed.toFixed(2)}×
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
            min={0.25}
            max={4}
            step={0.05}
            value={clip.speed}
            format={(value) => `${value.toFixed(2)}×`}
            onChange={(value) => setClip('Set speed', { speed: value })}
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
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" onClick={() => addKeyframe('zoom', clip.effects.zoom)}>
              Key zoom here
            </Button>
            <Button size="sm" onClick={() => addKeyframe('x', clip.transform.x)}>
              Key position
            </Button>
          </div>
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
                { value: 'side-by-side', label: 'Side by side' },
                { value: 'full', label: 'Camera only' },
              ]}
            />
          </Field>
          <Field label="Corner">
            <Select
              value={clip.presenter!.corner}
              onChange={(value) => patch('Bubble corner', { presenter: { corner: value } })}
              options={[
                { value: 'bottom-right', label: 'Bottom right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'top-right', label: 'Top right' },
                { value: 'top-left', label: 'Top left' },
              ]}
            />
          </Field>
          <Slider label="Bubble size" min={0.1} max={0.7} step={0.01} value={clip.presenter!.size} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => patch('Bubble size', { presenter: { size: value } })} />
          <Field label="Shape">
            <Select
              value={clip.presenter!.shape}
              onChange={(value) => patch('Bubble shape', { presenter: { shape: value } })}
              options={[
                { value: 'circle', label: 'Circle' },
                { value: 'rounded', label: 'Rounded rectangle' },
                { value: 'square', label: 'Square' },
                { value: 'portrait', label: 'Portrait card (3:4)' },
              ]}
            />
          </Field>
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
            label="Chroma key (experimental)"
            checked={clip.presenter!.chromaKey}
            onChange={(value) => patch('Chroma key', { presenter: { chromaKey: value } })}
          />
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
                { value: 'spotlight', label: 'Spotlight dimmer' },
              ]}
            />
            <Slider label="X" min={0} max={1} step={0.01} value={mask.x} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask position', (p) => ops.updateMask(p, clip.id, index, { x: value }))} />
            <Slider label="Y" min={0} max={1} step={0.01} value={mask.y} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask position', (p) => ops.updateMask(p, clip.id, index, { y: value }))} />
            <Slider label="Width" min={0.03} max={1} step={0.01} value={mask.width} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask size', (p) => ops.updateMask(p, clip.id, index, { width: value }))} />
            <Slider label="Height" min={0.03} max={1} step={0.01} value={mask.height} format={(v) => `${Math.round(v * 100)}%`} onChange={(value) => apply('Mask size', (p) => ops.updateMask(p, clip.id, index, { height: value }))} />
            <Slider label="Strength" min={2} max={40} step={1} value={mask.strength} onChange={(value) => apply('Mask strength', (p) => ops.updateMask(p, clip.id, index, { strength: value }))} />
          </div>
        ))}
        <Button
          size="sm"
          onClick={() =>
            apply('Add mask', (p) => ops.addMask(p, clip.id, { x: 0.35, y: 0.35, width: 0.3, height: 0.15, mode: 'blur', strength: 14 }))
          }
        >
          Add mask at centre
        </Button>
      </InspectorSection>

      <InspectorSection title="Keyframes">
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
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="panel" style={{ boxShadow: 'none' }} open={title === 'Transform' || title === 'Timing'}>
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
          Select a clip on the timeline to edit its transform, colour, audio and masks. With nothing selected, this
          panel edits project-level settings.
        </div>
        <ProjectSettingsPanel project={project} />
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
            onClick={() => apply('Set 16:9 1080p', (p) => ({ ...p, canvas: { ...p.canvas, width: 1920, height: 1080 } }))}
          >
            16:9 (1920×1080)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => apply('Reframe 9:16', (p) => ops.reframe9x16(p))}>
            9:16 Shorts (1080×1920)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => apply('9:16 follow presenter', (p) => ops.reframeFollowPresenter(p))}>
            9:16 follow presenter
          </Button>
        </div>
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
