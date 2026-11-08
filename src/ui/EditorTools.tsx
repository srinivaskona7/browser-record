import { useState } from 'react';
import { useEditor } from '../project/store';
import type { Clip, Project } from '../project/types';
import { createTrack } from '../project/factory';
import * as ops from '../project/ops';
import {
  VIDEO_EFFECTS,
  COLOR_FILTERS,
  BOUNDARY_TRANSITIONS,
  TEXT_STYLE_PRESETS,
  CINEMATIC_LUTS,
  type VideoEffectSpec,
  type ColorFilterSpec,
  type CinematicLutSpec,
  type BoundaryTransitionSpec,
  type TextStylePresetSpec,
} from '../effects/catalog';
import { SFX_PRESETS } from '../audio/sfx';
import { TICKS_PER_SECOND } from '../core/time';
import { formatSelectionScopeChip } from '../editor/selection';
import { Badge, Button } from './components';
import { SvgIcon, type IconName } from './icons';

export const EDITOR_TOOLS: ReadonlyArray<{ id: string; label: string; iconName: IconName }> = [
  { id: 'media', label: 'Media', iconName: 'uploads' },
  { id: 'audio', label: 'Audio', iconName: 'audio' },
  { id: 'text', label: 'Text', iconName: 'text' },
  { id: 'captions', label: 'Captions', iconName: 'captions' },
  { id: 'voiceover', label: 'Voiceover', iconName: 'mic' },
  { id: 'effects', label: 'Effects', iconName: 'effects' },
  { id: 'transitions', label: 'Transitions', iconName: 'transitions' },
  { id: 'filters', label: 'Filters', iconName: 'filters' },
  { id: 'adjust', label: 'Adjust', iconName: 'adjust' },
  { id: 'sfx', label: 'Sound FX', iconName: 'sound' },
  { id: 'more', label: 'More tools', iconName: 'more' },
] as const;

export type EditorTool =
  | 'media'
  | 'audio'
  | 'text'
  | 'captions'
  | 'voiceover'
  | 'effects'
  | 'transitions'
  | 'filters'
  | 'adjust'
  | 'sfx'
  | 'more';

let clipClipboard: Clip[] = [];

export function getClipClipboard(): Clip[] {
  return clipClipboard;
}

export function setClipClipboard(clips: Clip[]): void {
  clipClipboard = clips.map((c) => structuredClone(c));
}

function renderCatalogPreview(
  tool: EditorTool,
  item: VideoEffectSpec | BoundaryTransitionSpec | ColorFilterSpec | CinematicLutSpec | TextStylePresetSpec,
) {
  if (tool === 'text') {
    const preset = item as TextStylePresetSpec;
    const bg = preset.backgroundOpacity > 0 ? preset.background : '#141920';
    const textShadow = preset.glowColor
      ? `0 0 10px ${preset.glowColor}`
      : preset.shadowBlur > 0
        ? `0 2px 6px ${preset.shadowColor}`
        : undefined;
    return (
      <span
        className="catalog-art"
        style={{
          background: preset.gradientToColor
            ? `linear-gradient(135deg, ${bg}, #1c2430)`
            : bg,
          fontFamily: preset.fontFamily,
          fontWeight: preset.fontWeight,
          color: preset.color === '#FFFFFF00' ? '#ffffff' : preset.color,
          textShadow,
          WebkitTextStroke: preset.strokeWidth > 0 ? `1px ${preset.strokeColor}` : undefined,
          letterSpacing: `${Math.min(3, preset.letterSpacing)}px`,
        }}
      >
        Aa
      </span>
    );
  }
  if (tool === 'filters') {
    const filter = item as ColorFilterSpec;
    const b = (1 + filter.brightness + filter.exposure * 0.5).toFixed(2);
    const c = (1 + filter.contrast).toFixed(2);
    const s = Math.max(0, 1 + filter.saturation + filter.vibrance * 0.5).toFixed(2);
    const sep = filter.sepia.toFixed(2);
    const hue = Math.round(filter.hueRotateDeg);
    return (
      <span
        className="catalog-art"
        style={{
          background: `linear-gradient(160deg, #3a86ff 0%, #ffbe0b 52%, #fb5607 100%)`,
          filter: `brightness(${b}) contrast(${c}) saturate(${s}) sepia(${sep}) hue-rotate(${hue}deg)`,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <span style={{ background: 'rgba(0,0,0,0.45)', padding: '2px 6px', borderRadius: 4 }}>
          {filter.contrast >= 0 ? `+${Math.round(filter.contrast * 100)}% C` : `${Math.round(filter.contrast * 100)}% C`}
        </span>
      </span>
    );
  }
  if (tool === 'adjust') {
    const lut = item as CinematicLutSpec;
    return (
      <span
        className="catalog-art"
        style={{
          background: `linear-gradient(135deg, ${lut.shadowsHex} 0%, ${lut.highlightsHex} 100%)`,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <span style={{ background: 'rgba(0,0,0,0.55)', padding: '2px 6px', borderRadius: 4 }}>
          3D LUT · γ{lut.gamma.toFixed(2)}
        </span>
      </span>
    );
  }
  if (tool === 'transitions') {
    const tr = item as BoundaryTransitionSpec;
    const arrow = tr.directionX < 0 ? '←' : tr.directionX > 0 ? '→' : tr.directionY < 0 ? '↑' : tr.directionY > 0 ? '↓' : '⇄';
    return (
      <span
        className="catalog-art"
        style={{
          background: 'linear-gradient(90deg, #1e293b 0%, #334155 48%, #0f172a 52%, #1e293b 100%)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span>
          {arrow} {tr.defaultDurationSeconds}s
        </span>
      </span>
    );
  }
  const fx = item as VideoEffectSpec;
  const tag =
    fx.category === 'camera-motion'
      ? 'Motion'
      : fx.category === 'geometric-dynamics'
        ? 'Geometry'
        : 'Shader';
  return (
    <span
      className="catalog-art"
      style={{
        background:
          fx.category === 'camera-motion'
            ? 'linear-gradient(140deg, #1d3557, #0f172a)'
            : fx.category === 'geometric-dynamics'
              ? 'linear-gradient(140deg, #3b0764, #0f172a)'
              : 'linear-gradient(140deg, #064e3b, #0f172a)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span style={{ background: 'rgba(0,0,0,0.45)', padding: '2px 6px', borderRadius: 4 }}>
        {tag} · {fx.frequencyHz}Hz
      </span>
    </span>
  );
}

export function EditorToolLibrary({ tool, project, clip }: { tool: EditorTool; project: Project; clip: Clip | null }) {
  const [query, setQuery] = useState('');
  const apply = useEditor((s) => s.apply);
  const playhead = useEditor((s) => s.playheadTicks);
  const title = EDITOR_TOOLS.find((t) => t.id === tool)?.label ?? 'Tools';
  const catalog =
    tool === 'effects'
      ? VIDEO_EFFECTS
      : tool === 'transitions'
        ? BOUNDARY_TRANSITIONS
        : tool === 'filters'
          ? COLOR_FILTERS
          : tool === 'adjust'
            ? CINEMATIC_LUTS
            : tool === 'text'
              ? TEXT_STYLE_PRESETS
              : [];
  const active =
    tool === 'effects'
      ? clip?.effects.videoEffect
      : tool === 'filters'
        ? clip?.effects.colorFilter
        : tool === 'adjust'
          ? clip?.effects.lut
          : tool === 'transitions'
            ? clip?.transitionIn?.type
            : clip?.text?.stylePreset;
  const eligible =
    tool === 'text' ||
    Boolean(clip && project.tracks.some((t) => t.kind === 'video' && t.clips.some((c) => c.id === clip.id)));

  const addTitle = (preset?: string) => {
    let id = '';
    apply('Add text', (p) => {
      const existing = p.tracks.find((t) => t.name === 'Overlays' && !t.locked && !t.hidden);
      const track = existing ?? createTrack('video', 'Overlays');
      const result = ops.addTitleClip(existing ? p : ops.addTrack(p, track), track.id, playhead, 'Your text here');
      id = result.clipId;
      return preset ? ops.applyTextPreset(result.project, id, preset) : result.project;
    });
    useEditor.getState().selectClips([id]);
    useEditor.getState().setPanel('effects');
  };

  return (
    <section className="tool-library">
      <header className="tool-library-head">
        <h2>{title}</h2>
        <span>{catalog.length || ''}</span>
      </header>
      {tool === 'text' && (
        <Button variant="primary" onClick={() => addTitle()}>
          + Add text
        </Button>
      )}
      {tool === 'audio' ? (
        <div className="stack">
          <p className="field-hint">
            Import your own music or audio in Media. Select an audio or video clip to adjust volume, fades, voice
            processing, or extract audio.
          </p>
          <Button onClick={() => apply('Prepare music bed', (p) => ops.prepareMusicBedTrack(p).project)}>
            Create music bed track
          </Button>
          <Button
            disabled={!clip || !clip.assetId}
            onClick={() => clip && apply('Extract audio', (p) => ops.extractAudio(p, clip.id).project)}
          >
            Extract audio to track
          </Button>
          <Button onClick={() => apply('Add beat markers', (p) => ops.addBeatMarkers(p, 120))}>
            Add beat markers (120 BPM)
          </Button>
          {(['podcast-warm', 'crisp-tech', 'broadcast-punch', 'flat'] as const).map((preset) => (
            <Button
              key={preset}
              disabled={!clip}
              onClick={() => apply(`Voice: ${preset}`, (p) => ops.applyVoicePreset(p, preset, clip?.id))}
            >
              {preset.replaceAll('-', ' ')}
            </Button>
          ))}
        </div>
      ) : tool === 'sfx' ? (
        <div className="stack">
          <p className="field-hint">Locally synthesized procedural sound effects. Click to insert at the playhead.</p>
          {SFX_PRESETS.map((sfx) => (
            <button
              className="catalog-sound"
              key={sfx.id}
              title={sfx.description}
              onClick={() => apply(`Add ${sfx.label}`, (p) => ops.addProceduralSfxClip(p, sfx.id, playhead).project)}
            >
              <SvgIcon name="sound" size={16} />
              {sfx.label}
              <span>+</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <input
            className="input"
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder={`Search ${title.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!eligible && (
            <p className="hint-card">Select a video clip on the timeline to apply {title.toLowerCase()}.</p>
          )}
          {tool === 'transitions' && <p className="field-hint">Applies to the selected clip’s incoming boundary.</p>}
          {tool === 'adjust' && (
            <Button
              size="sm"
              onClick={() => apply('Add adjustment layer', (p) => ops.addAdjustmentLayer(p, playhead).project)}
            >
              + Add adjustment layer at playhead
            </Button>
          )}
          {tool !== 'text' && (
            <Button
              size="sm"
              disabled={!eligible}
              onClick={() =>
                clip &&
                apply(`Reset ${title}`, (p) =>
                  tool === 'effects'
                    ? ops.applyEffect(p, clip.id, 'none')
                    : tool === 'filters'
                      ? ops.applyFilter(p, clip.id, 'normal')
                      : tool === 'adjust'
                        ? ops.applyLUT(p, clip.id, 'none')
                        : ops.addTransition(p, clip.id, 'normal'),
                )
              }
            >
              None · Reset
            </Button>
          )}
          <div className={`catalog-grid catalog-${tool}`}>
            {catalog
              .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
              .map((item) => (
                <button
                  className="catalog-tile"
                  key={item.id}
                  disabled={!eligible}
                  aria-pressed={active === item.id}
                  onClick={() => {
                    if (tool === 'text') {
                      if (clip?.text) apply(item.name, (p) => ops.applyTextPreset(p, clip.id, item.id));
                      else addTitle(item.id);
                      return;
                    }
                    if (!clip) return;
                    apply(item.name, (p) =>
                      tool === 'effects'
                        ? ops.applyEffect(p, clip.id, item.id)
                        : tool === 'filters'
                          ? ops.applyFilter(p, clip.id, item.id)
                          : tool === 'adjust'
                            ? ops.applyLUT(p, clip.id, item.id)
                            : ops.addTransition(p, clip.id, item.id),
                    );
                  }}
                >
                  {renderCatalogPreview(tool, item)}
                  <span>{item.name}</span>
                </button>
              ))}
          </div>
          {catalog.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).length === 0 && (
            <p className="field-hint">No matches. Try another search.</p>
          )}
        </>
      )}
    </section>
  );
}

export function ClipQuickActions({ project }: { project: Project }) {
  const selection = useEditor((s) => s.selection);
  const selected = useEditor((s) => s.selectedClipIds);
  const tick = useEditor((s) => s.playheadTicks);
  const apply = useEditor((s) => s.apply);
  const selectClips = useEditor((s) => s.selectClips);
  const clip = selected[0] ? ops.findClipById(project, selected[0]) : undefined;
  const track = project.tracks.find((t) => t.clips.some((c) => c.id === clip?.id));
  const inside = Boolean(clip && tick > clip.startTicks && tick < clip.startTicks + clip.durationTicks);
  const selectedClips = selected
    .map((id) => ops.findClipById(project, id))
    .filter((c): c is Clip => Boolean(c));
  const scopeChip = formatSelectionScopeChip(selection, project);

  return (
    <div className="clip-quick-actions" role="toolbar" aria-label="Clip actions">
      <Badge tone={selection.kind === 'none' ? 'neutral' : 'ok'}>{scopeChip}</Badge>
      <Button size="sm" disabled={!inside} onClick={() => apply('Trim start', (p) => ops.trimStart(p, clip!.id, tick))}>
        Trim start
      </Button>
      <Button
        size="sm"
        disabled={!inside}
        onClick={() => apply('Split clip', (p) => ops.splitAt(p, tick, { clipIds: selected, splitLinked: true }))}
      >
        Split
      </Button>
      <Button size="sm" disabled={!inside} onClick={() => apply('Trim end', (p) => ops.trimEnd(p, clip!.id, tick))}>
        Trim end
      </Button>
      <Button
        size="sm"
        disabled={!clip}
        onClick={() => apply('Duplicate', (p) => ops.duplicateClips(p, selected, clip!.durationTicks))}
      >
        Duplicate
      </Button>
      <Button
        size="sm"
        disabled={!clip}
        onClick={() => {
          setClipClipboard(selectedClips);
        }}
      >
        Copy
      </Button>
      <Button
        size="sm"
        disabled={clipClipboard.length === 0}
        onClick={() => {
          let newIds: string[] = [];
          apply('Paste clips', (p) => {
            const res = ops.pasteClipsAtPlayhead(p, clipClipboard, tick);
            newIds = res.newClipIds;
            return res.project;
          });
          if (newIds.length > 0) selectClips(newIds);
        }}
      >
        Paste
      </Button>
      <Button
        size="sm"
        disabled={!inside || clip?.kind !== 'media'}
        onClick={() => apply('Freeze frame', (p) => ops.holdFrame(p, track!.id, clip!.id, tick, 2 * TICKS_PER_SECOND).project)}
      >
        Freeze
      </Button>
      <Button
        size="sm"
        disabled={!clip || clip.kind !== 'media'}
        aria-pressed={Boolean(clip?.reverse)}
        onClick={() => apply('Reverse clip', (p) => ops.toggleClipReverse(p, clip!.id))}
      >
        {clip?.reverse ? 'Reversed' : 'Reverse'}
      </Button>
      <Button
        size="sm"
        disabled={!clip || track?.kind !== 'video' || !clip.assetId}
        onClick={() => apply('Extract audio', (p) => ops.extractAudio(p, clip!.id).project)}
      >
        Extract audio
      </Button>
      {selected.length >= 2 && (
        <Button size="sm" onClick={() => apply('Group clips', (p) => ops.groupClips(p, selected))}>
          Group
        </Button>
      )}
      {Boolean(clip?.linkId) && (
        <Button size="sm" onClick={() => apply('Ungroup clips', (p) => ops.ungroupClips(p, selected))}>
          Ungroup
        </Button>
      )}
      <Button size="sm" disabled={!clip} onClick={() => apply('Mute clip', (p) => ops.muteClip(p, clip!.id))}>
        {clip?.audio.muted ? 'Unmute' : 'Mute'}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={!clip}
        onClick={() => apply('Delete clip', (p) => ops.deleteClips(p, selected, 'ripple'))}
      >
        Delete
      </Button>
    </div>
  );
}
