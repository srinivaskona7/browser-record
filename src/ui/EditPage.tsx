import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import * as ops from '../project/ops';
import { formatTimecode, parseTimecode, TICKS_PER_SECOND } from '../core/time';
import { Badge, Button, Dialog, Panel, Select, Toggle } from './components';
import { Preview, snapshotFrame, snapshotThumbnail } from './Preview';
import { Timeline } from './Timeline';
import { MediaBin } from './MediaBin';
import { CaptionsPanel } from './CaptionsPanel';
import { Inspector, NoSelection, ProjectSettingsPanel } from './Inspector';
import { TranscribeDialog } from './TranscribeDialog';
import { VoiceoverDialog } from './VoiceoverDialog';
import { PreviewPlayer } from './player';
import { downloadBlob, ensureAssetFile, saveNow } from '../app/actions';
import { EditStart } from './EditStart';

export function EditPage() {
  const project = useEditor((state) => state.project);
  const playhead = useEditor((state) => state.playheadTicks);
  const playing = useEditor((state) => state.playing);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const previewScale = useEditor((state) => state.previewScale);
  const showSafeAreas = useEditor((state) => state.showSafeAreas);
  const panel = useEditor((state) => state.panel);
  const setPanel = useEditor((state) => state.setPanel);
  const setPlayhead = useEditor((state) => state.setPlayhead);
  const setPlaying = useEditor((state) => state.setPlaying);
  const setToast = useSession((state) => state.pushToast);
  const [player, setPlayer] = useState<PreviewPlayer | null>(null);
  const [playerRevision, setPlayerRevision] = useState(0);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [voiceoverOpen, setVoiceoverOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [showEndScreenGuide, setShowEndScreenGuide] = useState(false);
  const [muted, setMuted] = useState(true);
  const timecodeRef = useRef<HTMLInputElement>(null);

  const assetSignature = project?.assets.map((asset) => `${asset.id}:${asset.path}`).join('|') ?? '';

  useEffect(() => {
    if (!project) return;
    const instance = new PreviewPlayer({
      project,
      provider: { getFile: (path) => ensureAssetFile(path) },
      onTick: (ticks) => useEditor.getState().setPlayhead(ticks),
      onEnded: () => useEditor.getState().setPlaying(false),
      onReady: () => setPlayerRevision((value) => value + 1),
    });
    setPlayer(instance);
    void instance.load();
    instance.seek(useEditor.getState().playheadTicks);
    instance.setMuted(true);
    return () => {
      instance.dispose();
      setPlayer(null);
    };
  }, [project?.id, assetSignature]);

  useEffect(() => {
    if (!player || !project) return;
    // Same player instance, current timeline: trims, splits, mutes and volume
    // changes take effect in playback immediately.
    player.updateProject(project);
  }, [player, project]);

  useEffect(() => {
    if (!player) return;
    if (playing) {
      // The playhead can sit exactly on the end (the preview holds the last
      // frame there). Starting a play from that point would end on the first
      // tick, so rewind instead.
      const state = useEditor.getState();
      const end = state.project?.durationTicks ?? 0;
      player.play(state.playheadTicks >= end ? 0 : state.playheadTicks);
    } else {
      player.pause();
    }
  }, [playing, player]);

  /**
   * Scrubbing while paused. Without this the canvas repaints from a media
   * element still parked at its last seek, so dragging the playhead or
   * frame-stepping showed the wrong picture until Play resynced it.
   */
  useEffect(() => {
    if (!player || playing) return;
    player.seek(playhead);
  }, [player, playhead, playing]);

  useEffect(() => {
    player?.setMuted(muted);
  }, [muted, player]);

  const selectedClip = useMemo(() => {
    if (!project || selectedClipIds.length === 0) return null;
    const id = selectedClipIds[0]!;
    for (const track of project.tracks) {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return { clip, track };
    }
    return null;
  }, [project, selectedClipIds]);

  const frameTicks = Math.round(TICKS_PER_SECOND / (project ? project.canvas.fps.num / project.canvas.fps.den : 30));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const project = useEditor.getState().project;
      if (!project) return;
      const state = useEditor.getState();
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        state.apply('Duplicate clips', (p) => ops.duplicateClips(p, state.selectedClipIds, Math.round(1 * TICKS_PER_SECOND)));
        return;
      }
      switch (event.key) {
        case ' ':
          event.preventDefault();
          setPlaying(!state.playing);
          break;
        case 'ArrowLeft': {
          event.preventDefault();
          const delta = event.shiftKey ? TICKS_PER_SECOND : frameTicks;
          setPlaying(false);
          setPlayhead(Math.max(0, state.playheadTicks - delta));
          break;
        }
        case 'ArrowRight': {
          event.preventDefault();
          const delta = event.shiftKey ? TICKS_PER_SECOND : frameTicks;
          setPlaying(false);
          setPlayhead(Math.min(project.durationTicks, state.playheadTicks + delta));
          break;
        }
        case 'Home':
          setPlayhead(0);
          break;
        case 'End':
          setPlayhead(project.durationTicks);
          break;
        case 's':
        case 'S':
          state.apply('Split at playhead', (p) => ops.splitAllAt(p, state.playheadTicks));
          break;
        case 'Delete':
        case 'Backspace':
          if (state.selectedClipIds.length > 0) {
            event.preventDefault();
            state.apply('Ripple delete', (p) => ops.deleteClips(p, state.selectedClipIds, 'ripple'));
          }
          break;
        case 'm':
        case 'M':
          state.apply('Add marker', (p) => ({
            ...p,
            markers: [
              ...p.markers,
              { id: `marker_${Date.now()}`, atTicks: state.playheadTicks, label: `Marker ${p.markers.length + 1}`, color: '#ffd166' },
            ],
          }));
          break;
        case 'Escape':
          state.selectClips([]);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frameTicks, setPlayhead, setPlaying]);

  if (!project) {
    return <EditStart />;
  }

  const timecode = formatTimecode(playhead, project.canvas.fps);

  return (
    <div className="editor">
      <aside className="editor-side scroll-thin">
        <MediaBin project={project} onOpenVoiceover={() => setVoiceoverOpen(true)} />
      </aside>

      <div className="editor-center">
        <Preview
          project={project}
          player={player}
          ticks={playhead}
          showSafeAreas={showSafeAreas}
          previewScale={previewScale}
          showCaptionGuides={false}
          showEndScreenGuide={showEndScreenGuide}
          captionsEnabled={captionsEnabled}
          revision={playerRevision}
        />
        <div className="transport">
          <Button size="icon" variant="ghost" onClick={() => { setPlaying(false); setPlayhead(0); }} aria-label="Go to start">
            ⏮
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setPlaying(false);
              setPlayhead(Math.max(0, playhead - frameTicks));
            }}
            aria-label="Previous frame"
          >
            ◀
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause' : 'Play'}
            style={{ minWidth: 84 }}
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setPlaying(false);
              setPlayhead(Math.min(project.durationTicks, playhead + frameTicks));
            }}
            aria-label="Next frame"
          >
            ▶
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = parseTimecode(timecodeRef.current?.value ?? '', project.canvas.fps);
              if (parsed === null) {
                setToast('Use HH:MM:SS:FF or HH:MM:SS.mmm.', 'error');
                return;
              }
              setPlaying(false);
              setPlayhead(Math.min(project.durationTicks, Math.max(0, parsed)));
            }}
            className="row"
            style={{ gap: 6 }}
          >
            <input
              ref={timecodeRef}
              key={timecode}
              defaultValue={timecode}
              className="input timecode"
              style={{ width: 132, padding: '5px 8px', fontSize: 12.5 }}
              aria-label="Playhead timecode"
            />
            <Button size="sm" variant="ghost" type="submit">
              Go
            </Button>
          </form>
          <span className="badge" title="Project frame rate">
            {project.canvas.fps.num}/{project.canvas.fps.den} fps
          </span>
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => setMuted(!muted)} title="Preview audio monitoring">
            {muted ? '🔇 Preview muted' : '🔊 Preview audio'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Save the frame under the playhead as a full-resolution PNG"
            onClick={async () => {
              if (!project) return;
              const blob = await snapshotFrame(project, player, playhead, captionsEnabled);
              if (blob) downloadBlob(blob, `${project.name.replace(/[^\w-]+/g, '-') || 'frame'}-${(playhead / TICKS_PER_SECOND).toFixed(2)}s.png`);
            }}
          >
            Save frame
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="Save the current frame as a 1280×720 YouTube thumbnail PNG"
            onClick={async () => {
              if (!project) return;
              const blob = await snapshotThumbnail(project, player, playhead, captionsEnabled);
              if (blob) downloadBlob(blob, `${project.name.replace(/[^\w-]+/g, '-') || 'thumbnail'}-1280x720.png`);
            }}
          >
            Thumbnail PNG
          </Button>
          <Toggle label="Safe areas" checked={showSafeAreas} onChange={(value) => useEditor.getState().setShowSafeAreas(value)} />
          <Toggle label="End-screen 20s" checked={showEndScreenGuide} onChange={setShowEndScreenGuide} />
          <Toggle label="Captions" checked={captionsEnabled} onChange={setCaptionsEnabled} />
          <Select
            value={String(previewScale)}
            onChange={(value) => useEditor.getState().setPreviewScale(Number(value))}
            options={[
              { value: '0.25', label: 'Preview 25%' },
              { value: '0.5', label: 'Preview 50%' },
              { value: '0.75', label: 'Preview 75%' },
              { value: '1', label: 'Preview 100%' },
            ]}
          />
          <Button size="sm" variant="ghost" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
            Shortcuts
          </Button>
        </div>
      </div>

      <aside className="editor-side editor-right scroll-thin">
        <div className="nav-tabs" style={{ alignSelf: 'flex-start' }}>
          <button type="button" className="nav-tab" aria-current={panel === 'media' ? 'page' : undefined} onClick={() => setPanel('media')}>
            Settings
          </button>
          <button type="button" className="nav-tab" aria-current={panel === 'captions' ? 'page' : undefined} onClick={() => setPanel('captions')}>
            Captions
          </button>
          <button
            type="button"
            className="nav-tab"
            aria-current={panel === 'effects' ? 'page' : undefined}
            onClick={() => setPanel('effects')}
          >
            Clip
          </button>
        </div>
        {panel === 'captions' ? (
          <CaptionsPanel project={project} onOpenTranscribe={() => setTranscribeOpen(true)} />
        ) : panel === 'effects' ? (
          selectedClip ? <Inspector clip={selectedClip.clip} trackKind={selectedClip.track.kind} /> : <NoSelection project={project} />
        ) : (
          <Panel title="Project">
            <ProjectSettingsPanel project={project} />
          </Panel>
        )}
        <Panel title="History">
          <div className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="field-hint">{useEditor.getState().lastAction ?? 'No edits yet'}</span>
              <div className="row" style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" onClick={() => useEditor.getState().undo()} disabled={useEditor.getState().history.length === 0}>
                  Undo
                </Button>
                <Button size="sm" variant="ghost" onClick={() => useEditor.getState().redo()} disabled={useEditor.getState().future.length === 0}>
                  Redo
                </Button>
              </div>
            </div>
            <Badge>{useEditor.getState().history.length} steps</Badge>
          </div>
        </Panel>
      </aside>

      <Timeline project={project} />

      <TranscribeDialog open={transcribeOpen} onClose={() => setTranscribeOpen(false)} project={project} />
      <VoiceoverDialog open={voiceoverOpen} onClose={() => setVoiceoverOpen(false)} player={player} />
      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts">
        <ShortcutTable />
      </Dialog>
      <div style={{ display: 'none' }}>
        <span>{selectedClipIds.length}</span>
      </div>
    </div>
  );
}

function ShortcutTable() {
  const rows: Array<[string, string]> = [
    ['Space', 'Play / pause'],
    ['← / →', 'Step one frame'],
    ['Shift + ← / →', 'Step one second'],
    ['S', 'Split at playhead'],
    ['Delete', 'Ripple delete selection'],
    ['M', 'Marker at playhead'],
    ['⌘/Ctrl + Z', 'Undo'],
    ['⇧⌘/Ctrl + Z', 'Redo'],
    ['⌘/Ctrl + D', 'Duplicate selection'],
    ['⌘/Ctrl + S', 'Save now'],
    ['Esc', 'Clear selection'],
    ['Home / End', 'Start / end'],
  ];
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Keys</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([keys, action]) => (
          <tr key={keys}>
            <td>
              <kbd>{keys}</kbd>
            </td>
            <td>{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
