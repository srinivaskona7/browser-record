import { useMemo, useRef, useState } from 'react';
import { formatClock, TICKS_PER_SECOND } from '../core/time';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import * as ops from '../project/ops';
import type { Project } from '../project/types';
import { CAPTION_STYLES } from '../effects/catalog';
import { Badge, Button, Field, Panel, Select, Slider } from './components';
import {
  normalizePunctuation,
  parseSubtitles,
  rebalanceCues,
  serializeSrt,
  serializeTranscript,
  serializeVtt,
  mergeAdjacentCues,
  findAndReplace,
} from '../captions/subtitles';
import { applyGlossary, findFillers, removeWordAt, suggestGlossaryFixes } from '../captions/glossary';
import { downloadBlob, saveRecordingManifestFile } from '../app/actions';
import { detectSilences, mixdownProject } from '../audio/mixdown';
import { buildProjectAudioResolver } from './TranscribeDialog';
import { newId } from '../core/ids';

export function CaptionsPanel({
  project,
  onOpenTranscribe,
}: {
  project: Project;
  onOpenTranscribe: () => void;
}) {
  const apply = useEditor((state) => state.apply);
  const playhead = useEditor((state) => state.playheadTicks);
  const setPlayhead = useEditor((state) => state.setPlayhead);
  const selectedCueId = useEditor((state) => state.selectedCueId);
  const selectCue = useEditor((state) => state.selectCue);
  const toast = useSession((state) => state.pushToast);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [silenceBusy, setSilenceBusy] = useState(false);
  const [silenceThreshold, setSilenceThreshold] = useState(-42);
  const [silenceDuration, setSilenceDuration] = useState(0.8);
  const fileInput = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState<'glossary' | 'fillers' | null>(null);

  const cues = useMemo(() => [...project.captions].sort((a, b) => a.startTicks - b.startTicks), [project.captions]);
  const activeCue = cues.find((cue) => playhead >= cue.startTicks && playhead < cue.endTicks);
  const glossarySuggestions = useMemo(
    () => cues.flatMap((cue) => suggestGlossaryFixes(cue.text, project.settings.glossary).map((s) => ({ ...s, cueId: cue.id }))),
    [cues, project.settings.glossary],
  );
  const fillerSuggestions = useMemo(() => findFillers(cues), [cues]);

  const updateCue = (cueId: string, text: string, label = 'Edit caption') =>
    apply(label, (p) => ({ ...p, captions: p.captions.map((cue) => (cue.id === cueId ? { ...cue, text } : cue)) }));

  const removeSilences = async () => {
    setSilenceBusy(true);
    try {
      const resolver = buildProjectAudioResolver(project);
      const mix = await mixdownProject(project, resolver, {
        sampleRate: project.settings.sampleRate,
        startTicks: 0,
        durationTicks: project.durationTicks,
        channels: 1,
        ducking: false,
      });
      const ranges = detectSilences(mix.buffer, {
        thresholdDb: silenceThreshold,
        minDurationTicks: Math.round(silenceDuration * TICKS_PER_SECOND),
        paddingTicks: Math.round(0.12 * TICKS_PER_SECOND),
      });
      if (ranges.length === 0) {
        toast('No silences matched that threshold.', 'info');
        return;
      }
      apply(`Remove ${ranges.length} silences`, (p) => ops.cutSilences(p, ranges));
      toast(`Removed ${ranges.length} silent ranges (undoable).`, 'success');
    } catch (error) {
      toast(`Silence detection failed: ${(error as Error).message}`, 'error');
    } finally {
      setSilenceBusy(false);
    }
  };

  const speedRampSilences = async () => {
    setSilenceBusy(true);
    try {
      const resolver = buildProjectAudioResolver(project);
      const mix = await mixdownProject(project, resolver, {
        sampleRate: project.settings.sampleRate,
        startTicks: 0,
        durationTicks: project.durationTicks,
        channels: 1,
        ducking: false,
      });
      const ranges = detectSilences(mix.buffer, {
        thresholdDb: silenceThreshold,
        minDurationTicks: Math.round(silenceDuration * TICKS_PER_SECOND),
        paddingTicks: Math.round(0.12 * TICKS_PER_SECOND),
      });
      if (ranges.length === 0) {
        toast('No idle/silent ranges matched that threshold.', 'info');
        return;
      }
      apply(`Speed-ramp ${ranges.length} idle ranges (2.5×)`, (p) => ops.speedRampRanges(p, ranges, 2.5));
      toast(`Speed-ramped ${ranges.length} idle ranges to 2.5× (undoable).`, 'success');
    } catch (error) {
      toast(`Idle detection failed: ${(error as Error).message}`, 'error');
    } finally {
      setSilenceBusy(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = parseSubtitles(text);
      if (result.value.length === 0) {
        toast(`No cues parsed. ${result.issues[0]?.message ?? 'Check the file format.'}`, 'error');
        return;
      }
      apply('Import subtitles', (p) => ({ ...p, captions: [...p.captions, ...result.value].sort((a, b) => a.startTicks - b.startTicks) }));
      const warning = result.issues.length > 0 ? ` ${result.issues.length} block(s) skipped.` : '';
      toast(`Imported ${result.value.length} cues.${warning}`, 'success');
    } catch (error) {
      toast(`Import failed: ${(error as Error).message}`, 'error');
    }
  };

  const download = (format: 'srt' | 'vtt' | 'txt') => {
    const base = project.name.replace(/\s+/g, '-').toLowerCase();
    const contents = format === 'srt' ? serializeSrt(cues) : format === 'vtt' ? serializeVtt(cues, { wordTimings: true }) : serializeTranscript(cues);
    downloadBlob(new Blob([contents], { type: 'text/plain' }), `${base}.${format}`);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <Panel
        title="Captions"
        action={
          <Button size="sm" onClick={onOpenTranscribe}>
            Transcribe
          </Button>
        }
        bodyClassName="stack"
      >
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            Import SRT/VTT
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".srt,.vtt,text/plain"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) await importFile(file);
              event.target.value = '';
            }}
          />
          <Button
            size="sm"
            onClick={() =>
              apply('Add caption', (p) => ({
                ...p,
                captions: [
                  ...p.captions,
                  {
                    id: newId('cue'),
                    startTicks: playhead,
                    endTicks: playhead + Math.round(2 * TICKS_PER_SECOND),
                    text: 'New caption',
                  },
                ].sort((a, b) => a.startTicks - b.startTicks),
              }))
            }
          >
            Add cue
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={cues.length === 0}
            onClick={() => {
              void saveRecordingManifestFile(`${project.name.replace(/\s+/g, '-').toLowerCase()}.srt`, serializeSrt(cues));
              toast('Saved SRT into the project captions folder.', 'success');
            }}
          >
            Save to project
          </Button>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Select
            value="export"
            onChange={(value) => value !== 'export' && download(value as 'srt' | 'vtt' | 'txt')}
            options={[
              { value: 'export', label: 'Export…' },
              { value: 'srt', label: 'SRT file' },
              { value: 'vtt', label: 'WebVTT file' },
              { value: 'txt', label: 'Transcript TXT' },
            ]}
          />
          <span className="field-hint" style={{ flex: 1 }}>
            {cues.length} cues
          </span>
        </div>

        <div className="stack scroll-thin" style={{ gap: 2, maxHeight: 320, overflow: 'auto' }}>
          {cues.length === 0 && <div className="field-hint">No captions yet. Transcribe, import a subtitle file, or add cues manually.</div>}
          {cues.map((cue) => (
            <div
              key={cue.id}
              className="cue"
              data-active={selectedCueId === cue.id || activeCue?.id === cue.id}
              onClick={() => {
                selectCue(cue.id);
                setPlayhead(cue.startTicks);
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="cue-time">
                  {formatClock(cue.startTicks)} → {formatClock(cue.endTicks)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '0 5px', height: 18 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    apply('Delete caption', (p) => ({ ...p, captions: p.captions.filter((c) => c.id !== cue.id) }));
                  }}
                  aria-label="Delete cue"
                >
                  ✕
                </button>
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 38, padding: 4, fontSize: 'var(--token-font-base)', background: 'transparent', border: '1px solid transparent' }}
                defaultValue={cue.text}
                onClick={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  if (event.target.value !== cue.text) updateCue(cue.id, event.target.value);
                }}
                onFocus={() => selectCue(cue.id)}
                aria-label={`Caption at ${formatClock(cue.startTicks)}`}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Text tools" bodyClassName="stack">
        <div className="row" style={{ gap: 6 }}>
          <input className="input" placeholder="Find" value={findText} onChange={(event) => setFindText(event.target.value)} />
          <input className="input" placeholder="Replace" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} />
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            disabled={!findText}
            onClick={() => {
              const result = findAndReplace(project.captions, findText, replaceText);
              apply('Find and replace', (p) => ({ ...p, captions: result.cues }));
              toast(`${result.count} replacement(s).`, 'success');
            }}
          >
            Replace all
          </Button>
          <Button
            size="sm"
            onClick={() => apply('Normalise punctuation', (p) => ({ ...p, captions: normalizePunctuation(p.captions) }))}
          >
            Fix punctuation
          </Button>
          <Button
            size="sm"
            onClick={() =>
              apply('Rebalance captions', (p) => ({ ...p, captions: rebalanceCues(p.captions, p.captionStyle.maxLineChars) }))
            }
          >
            Rebalance lines
          </Button>
          <Button size="sm" onClick={() => apply('Merge adjacent cues', (p) => ({ ...p, captions: mergeAdjacentCues(p.captions) }))}>
            Merge cues
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const result = project.captions.map((cue) => ({ ...cue, text: applyGlossary(cue.text, project.settings.glossary).text }));
              apply('Apply glossary', (p) => ({ ...p, captions: result }));
              toast('Glossary spellings applied.', 'success');
            }}
          >
            Apply glossary
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSuggestions(showSuggestions === 'glossary' ? null : 'glossary')}>
            Suggestions ({glossarySuggestions.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSuggestions(showSuggestions === 'fillers' ? null : 'fillers')}>
            Fillers ({fillerSuggestions.length})
          </Button>
        </div>
        {showSuggestions === 'glossary' && (
          <div className="stack" style={{ gap: 4 }}>
            {glossarySuggestions.length === 0 && <div className="field-hint">Every glossary term already matches its canonical spelling.</div>}
            {glossarySuggestions.map((suggestion, index) => (
              <div key={`${suggestion.cueId}-${index}`} className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--token-font-sm)' }}>
                <span className="mono">
                  {suggestion.original} → {suggestion.canonical}
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    const cue = project.captions.find((c) => c.id === suggestion.cueId);
                    if (!cue) return;
                    updateCue(cue.id, cue.text.replace(suggestion.original, suggestion.canonical), 'Apply glossary suggestion');
                  }}
                >
                  Accept
                </Button>
              </div>
            ))}
          </div>
        )}
        {showSuggestions === 'fillers' && (
          <div className="stack" style={{ gap: 4 }}>
            {fillerSuggestions.length === 0 && <div className="field-hint">No filler words found. Removal is always a suggestion — speech is never deleted silently.</div>}
            {fillerSuggestions.slice(0, 40).map((suggestion, index) => (
              <div key={`${suggestion.cueId}-${index}`} className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--token-font-sm)' }}>
                <span className="mono" style={{ color: 'var(--text-2)' }}>
                  “{suggestion.context}”
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    const cue = project.captions.find((c) => c.id === suggestion.cueId);
                    if (!cue) return;
                    updateCue(cue.id, removeWordAt(cue.text, suggestion.index, suggestion.word.length), 'Remove filler word');
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Style" bodyClassName="stack">
        <Field label="Preset (39 caption styles)">
          <Select
            value={project.captionStyle.preset}
            onChange={(value) =>
              apply(`Caption style: ${value}`, (p) => ops.setCaptionStyle(p, value))
            }
            options={CAPTION_STYLES.map((item) => ({ value: item.id, label: item.name }))}
          />
        </Field>
        <Slider
          label="Font size"
          min={24}
          max={110}
          step={1}
          value={project.captionStyle.fontSize}
          onChange={(value) => apply('Caption font size', (p) => ({ ...p, captionStyle: { ...p.captionStyle, fontSize: value } }))}
        />
        <Slider
          label="Max line characters"
          min={20}
          max={80}
          step={1}
          value={project.captionStyle.maxLineChars}
          onChange={(value) => apply('Caption line length', (p) => ({ ...p, captionStyle: { ...p.captionStyle, maxLineChars: value } }))}
        />
        <Slider
          label="Position from bottom"
          min={0.02}
          max={0.4}
          step={0.01}
          value={project.captionStyle.marginBottom}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => apply('Caption position', (p) => ({ ...p, captionStyle: { ...p.captionStyle, marginBottom: value } }))}
        />
        <Slider
          label="Background"
          min={0}
          max={1}
          step={0.01}
          value={project.captionStyle.backgroundOpacity}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(value) => apply('Caption background', (p) => ({ ...p, captionStyle: { ...p.captionStyle, backgroundOpacity: value } }))}
        />
        <Slider
          label="Outline"
          min={0}
          max={10}
          step={1}
          value={project.captionStyle.outlineWidth}
          onChange={(value) => apply('Caption outline', (p) => ({ ...p, captionStyle: { ...p.captionStyle, outlineWidth: value } }))}
        />
      </Panel>

      <Panel title="Silence" bodyClassName="stack">
        <div className="field-hint">
          Detect long pauses and ripple-delete them across every track. This is an undoable timeline edit, not a
          destructive audio operation.
        </div>
        <Slider label="Threshold" min={-70} max={-20} step={1} value={silenceThreshold} format={(v) => `${v} dBFS`} onChange={setSilenceThreshold} />
        <Slider label="Minimum silence" min={0.3} max={5} step={0.1} value={silenceDuration} format={(v) => `${v.toFixed(1)}s`} onChange={setSilenceDuration} />
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" onClick={removeSilences} disabled={silenceBusy || project.durationTicks === 0}>
            {silenceBusy ? 'Analysing…' : 'Jump-cut silences'}
          </Button>
          <Button size="sm" variant="ghost" onClick={speedRampSilences} disabled={silenceBusy || project.durationTicks === 0}>
            {silenceBusy ? 'Analysing…' : 'Speed-ramp idle (2.5×)'}
          </Button>
        </div>
        <div className="field-hint">
          Note: creates cuts in linked clips. Review the timeline before exporting — undo restores everything.
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Badge>{project.captions.length} cues</Badge>
          {project.captions.length > 0 && <Badge tone="ok">captions included in export</Badge>}
        </div>
      </Panel>
    </div>
  );
}
