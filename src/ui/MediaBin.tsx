import { useRef, useState } from 'react';
import { formatClock, TICKS_PER_SECOND } from '../core/time';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import * as ops from '../project/ops';
import { scanProjectTextSecrets } from '../project/secretScan';
import { createTrack } from '../project/factory';
import type { Asset, Project } from '../project/types';
import { formatChapters, formatDescription } from '../project/chapters';
import { Badge, Button, EmptyState, Panel, Select } from './components';
import { importMediaFiles, relinkAsset } from '../app/actions';
import { detectSilences, mixdownProject } from '../audio/mixdown';
import { buildProjectAudioResolver } from './TranscribeDialog';
import { newId } from '../core/ids';

type BinTab = 'uploads' | 'add' | 'markers';

const BIN_TABS: Array<{ id: BinTab; label: string }> = [
  { id: 'uploads', label: 'Uploads' },
  { id: 'add', label: 'Add' },
  { id: 'markers', label: 'Markers' },
];

export function MediaBin({ project, onOpenVoiceover }: { project: Project; onOpenVoiceover: () => void }) {
  const apply = useEditor((state) => state.apply);
  const selectedAssetId = useEditor((state) => state.selectedAssetId);
  const selectAsset = useEditor((state) => state.selectAsset);
  const playhead = useEditor((state) => state.playheadTicks);
  const editMode = useEditor((state) => state.editMode);
  const [importing, setImporting] = useState(false);
  const [tab, setTab] = useState<BinTab>('uploads');
  const [holdSeconds, setHoldSeconds] = useState(3);
  const selectedClipId = useEditor((state) => state.selectedClipIds[0] ?? null);
  const fileInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const [relinkTarget, setRelinkTarget] = useState<string | null>(null);

  const addToTimeline = (asset: Asset, mode: ops.EditMode = editMode) => {
    apply(`Add ${asset.name}`, (p) => {
      const trackKind = asset.kind === 'audio' ? 'audio' : 'video';
      let track = p.tracks.find((t) => t.kind === trackKind && !t.hidden && !t.locked);
      let working = p;
      if (!track) {
        track = createTrack(trackKind, trackKind === 'audio' ? 'Audio' : 'Video');
        working = ops.addTrack(p, track);
      }
      return ops.addAssetClip(working, track.id, asset.id, playhead, { mode }).project;
    });
  };

  // Titles and arrows go on their own "Overlays" track. Putting them on the
  // screen-recording track would overwrite the footage under them.
  const addOverlay = (label: string, build: (p: Project, trackId: string) => Project, trackName = 'Overlays') =>
    apply(label, (p) => {
      const existing = p.tracks.find((t) => t.kind === 'video' && t.name === trackName && !t.hidden && !t.locked);
      const track = existing ?? createTrack('video', trackName);
      const withTrack = existing ? p : ops.addTrack(p, track);
      return build(withTrack, track.id);
    });
  const blurBlock = ops.blurBoxBlockReason(project, selectedClipId);
  const punchBlock = selectedClipId ? ops.punchInBlockReason(project, selectedClipId) : 'Select a clip first.';
  const zoomHighlightBlock = ops.zoomHighlightBlockReason(project, selectedClipId);
  const camBlock = ops.fullCameraBlockReason(project, playhead, playhead + Math.round(holdSeconds * TICKS_PER_SECOND));
  const brollBlock = ops.brollPipBlockReason(project, selectedAssetId);
  const diagramBlock = ops.diagramRevealBlockReason(project, selectedAssetId);
  const splitBlock = ops.beforeAfterBlockReason(project);
  const selectedAsset = project.assets.find((a) => a.id === selectedAssetId) ?? null;
  const toast = useSession((state) => state.pushToast);
  const [silenceBusy, setSilenceBusy] = useState(false);

  const runSilenceAction = async (mode: 'cut' | 'ramp') => {
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
        thresholdDb: -42,
        minDurationTicks: Math.round(0.8 * TICKS_PER_SECOND),
        paddingTicks: Math.round(0.12 * TICKS_PER_SECOND),
      });
      if (ranges.length === 0) {
        toast('No silent/idle ranges matched (-42 dBFS, ≥0.8s). Adjust threshold in Captions → Silence.', 'info');
        return;
      }
      if (mode === 'cut') {
        apply(`Jump-cut ${ranges.length} silences`, (p) => ops.cutSilences(p, ranges));
        toast(`Jump-cut ${ranges.length} silent ranges.`, 'success');
      } else {
        apply(`Speed-ramp ${ranges.length} idle ranges (2.5×)`, (p) => ops.speedRampRanges(p, ranges, 2.5));
        toast(`Speed-ramped ${ranges.length} idle ranges to 2.5×.`, 'success');
      }
    } catch (error) {
      toast(`Audio analysis failed: ${(error as Error).message}`, 'error');
    } finally {
      setSilenceBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="nav-tabs" aria-label="Media bin sections" style={{ alignSelf: 'stretch', flexWrap: 'wrap' }}>
        {BIN_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-tab"
            aria-pressed={tab === item.id}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'markers' && project.markers.length > 0 ? ` (${project.markers.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'uploads' && (
      <Panel
        title="Media"
        action={
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" onClick={() => fileInput.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenVoiceover} title="Record a voiceover against the timeline">
              Voiceover
            </Button>
          </div>
        }
        bodyClassName="stack"
      >
        <input
          ref={fileInput}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          hidden
          onChange={async (event) => {
            const files = event.target.files;
            if (!files || files.length === 0) return;
            setImporting(true);
            try {
              await importMediaFiles(files);
            } finally {
              setImporting(false);
              event.target.value = '';
            }
          }}
        />
        <input
          ref={relinkInput}
          type="file"
          hidden
          accept="video/*,audio/*,image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file && relinkTarget) await relinkAsset(relinkTarget, file);
            event.target.value = '';
          }}
        />
        {project.assets.length === 0 ? (
          <EmptyState title="No media yet">
            Record a take, or import an existing 4K clip. Originals stay on your disk — nothing is uploaded.
          </EmptyState>
        ) : (
          <div className="stack scroll-thin" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
            {project.assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className="list-item"
                data-active={selectedAssetId === asset.id}
                onClick={() => selectAsset(asset.id)}
                onDoubleClick={() => addToTimeline(asset)}
                draggable={!asset.missing}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-browser-record-asset', asset.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                title={`${asset.name} · ${formatClock(asset.durationTicks)}${asset.missing ? ' · missing' : ''}`}
              >
                <div style={{ flex: '0 0 auto', width: 30, height: 30, borderRadius: 6, background: 'var(--surface-3)', display: 'grid', placeItems: 'center', fontSize: 11 }}>
                  {asset.kind === 'audio' ? '♪' : asset.kind === 'image' ? '▣' : '▶'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {asset.name}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                    {asset.width ? `${asset.width}×${asset.height} · ` : ''}
                    {formatClock(asset.durationTicks)}
                  </div>
                </div>
                {asset.missing ? <Badge tone="danger">missing</Badge> : asset.origin === 'recorded' ? <Badge tone="ok">rec</Badge> : null}
              </button>
            ))}
          </div>
        )}
        {selectedAssetId && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              onClick={() => {
                const asset = project.assets.find((a) => a.id === selectedAssetId);
                if (asset) addToTimeline(asset);
              }}
            >
              Add to timeline
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRelinkTarget(selectedAssetId);
                relinkInput.current?.click();
              }}
            >
              Relink
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                apply('Remove media from project', (p) => ({
                  ...p,
                  assets: p.assets.filter((a) => a.id !== selectedAssetId),
                  tracks: p.tracks.map((track) => ({ ...track, clips: track.clips.filter((clip) => clip.assetId !== selectedAssetId) })),
                }));
                selectAsset(null);
              }}
            >
              Remove from project
            </Button>
          </div>
        )}
        <div className="field-hint">
          Removing media from the project never deletes the file on disk.
        </div>
      </Panel>
      )}

      {tab === 'add' && (
      <Panel title="Add">
        <div className="stack" style={{ gap: 6 }}>
          <div className="field-label">Text</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => addOverlay('Add title', (p, t) => ops.addTitleClip(p, t, playhead, 'New title').project)}>
              Title
            </Button>
            <Button
              size="sm"
              onClick={() => addOverlay('Add lower third', (p, t) => ops.addTitleClip(p, t, playhead, 'Name · Role', 'lower-third').project)}
            >
              Lower third
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add callout', (p, t) => ops.addTitleClip(p, t, playhead, 'Key point', 'callout').project)}>
              Callout
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add code callout', (p, t) => ops.addTitleClip(p, t, playhead, '$ kubectl get pods', 'code').project)}>
              Code
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add section heading', (p, t) => ops.addTitleClip(p, t, playhead, 'Step 1', 'section').project)}>
              Section
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add hook', (p, t) => ops.addTitleClip(p, t, playhead, 'Stop wasting hours on deploys', 'hook').project)}>
              Hook
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add terminal line', (p, t) => ops.addTitleClip(p, t, playhead, 'kubectl get pods -n prod', 'terminal').project)}>
              Terminal
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add thumbnail text', (p, t) => ops.addTitleClip(p, t, playhead, 'NEW', 'thumbnail').project)}>
              Thumbnail
            </Button>
            <Button size="sm" onClick={() => addOverlay('Add metric', (p, t) => ops.addTitleClip(p, t, playhead, '10× faster', 'metric').project)}>
              Metric
            </Button>
            <Button
              size="sm"
              onClick={() =>
                addOverlay(
                  'Add CLI block',
                  (p, t) =>
                    ops.addTitleClip(
                      p,
                      t,
                      playhead,
                      '$ kubectl rollout status deploy/api\ndone: 3/3 replicas ready',
                      'cli',
                    ).project,
                )
              }
            >
              CLI ($ + output)
            </Button>
            <Button
              size="sm"
              onClick={() => apply('Add keystroke overlay', (p) => ops.addKeystrokeOverlay(p, playhead).project)}
            >
              Keystroke
            </Button>
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Call to action
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(['subscribe', 'like', 'bell'] as const).map((kind) => (
              <Button
                key={kind}
                size="sm"
                onClick={() => addOverlay(`Add ${kind} sticker`, (p, t) => ops.addStickerClip(p, t, playhead, kind).project, 'Stickers')}
              >
                {kind === 'subscribe' ? 'Subscribe' : kind === 'like' ? 'Like' : 'Bell'}
              </Button>
            ))}
            <Button
              size="sm"
              title="Adds a 20-second end-screen card with Subscribe + two video recommendation slots"
              onClick={() => apply('Add end screen', (p) => ops.addEndScreen(p).project)}
            >
              Auto end screen (20s)
            </Button>
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Brand
          </div>
          <Button
            size="sm"
            disabled={!project.brand?.name}
            title={project.brand?.name ? 'Adds a header and a footer from the brand kit for the whole timeline' : 'Fill in the brand kit in Project settings first'}
            onClick={() => apply('Add header and footer', (p) => (p.brand ? ops.addBrandBars(p, p.brand).project : p))}
          >
            Header and footer
          </Button>
          <Button
            size="sm"
            disabled={!project.brand?.name}
            title="Header, footer and a hook line at the start, from the brand kit"
            onClick={() => project.brand && apply('Add intro', (p) => ops.addIntroTemplate(p, project.brand!, 'Stop wasting hours on deploys').project)}
          >
            Intro
          </Button>
          <div className="field-label" style={{ marginTop: 4 }}>
            Hold
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input mono"
              type="number"
              min={0.5}
              step={0.5}
              value={holdSeconds}
              onChange={(event) => setHoldSeconds(Math.max(0.5, Number(event.target.value) || 0.5))}
              style={{ width: 70 }}
              aria-label="Hold length in seconds"
            />
            <Button
              size="sm"
              disabled={!selectedClipId}
              title="Freezes the selected clip at the playhead for this many seconds, then carries on. Put an image on the Overlays track over it to describe it."
              onClick={() => {
                if (!selectedClipId) return;
                apply('Hold frame', (p) => {
                  const track = p.tracks.find((t) => t.clips.some((c) => c.id === selectedClipId));
                  if (!track) return p;
                  return ops.holdFrame(p, track.id, selectedClipId, playhead, Math.round(holdSeconds * TICKS_PER_SECOND)).project;
                });
              }}
            >
              Hold frame here
            </Button>
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Annotate
          </div>
          <Button size="sm" onClick={() => addOverlay('Add arrow', (p, t) => ops.addArrowClip(p, t, playhead).project)}>
            Arrow at playhead
          </Button>
          <div className="field-label" style={{ marginTop: 4 }}>
            Insert media & layouts
          </div>
          <Button
            size="sm"
            disabled={!selectedAsset || selectedAsset.missing || selectedAsset.kind === 'audio'}
            onClick={() => selectedAsset && addToTimeline(selectedAsset, 'insert')}
            title="Places the selected picture or clip on the video track at the playhead. Insert mode pushes later clips right."
          >
            {selectedAsset ? `Insert “${selectedAsset.name}” at playhead` : 'Select an image or clip in Uploads'}
          </Button>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              disabled={Boolean(brollBlock)}
              title={brollBlock ?? 'Places the selected video or image as a picture-in-picture card in the upper-right'}
              onClick={() => selectedAssetId && apply('Add B-roll PiP', (p) => ops.addBrollPip(p, selectedAssetId, playhead).project)}
            >
              B-roll PiP
            </Button>
            <Button
              size="sm"
              disabled={Boolean(diagramBlock)}
              title={diagramBlock ?? 'Places an architecture diagram on a Diagram track that reveals step-by-step'}
              onClick={() => selectedAssetId && apply('Add diagram reveal', (p) => ops.addDiagramReveal(p, selectedAssetId, playhead, 4).project)}
            >
              Diagram reveal
            </Button>
            <Button
              size="sm"
              disabled={Boolean(splitBlock)}
              title={splitBlock ?? 'Places a side-by-side Before / After split layout at the playhead'}
              onClick={() => {
                const visuals = project.assets.filter((a) => a.kind === 'video' || a.kind === 'image');
                const left = selectedAsset && selectedAsset.kind !== 'audio' ? selectedAsset : visuals[0];
                const right = visuals.find((a) => a.id !== left?.id) ?? left;
                if (!left || !right) return;
                apply('Add Before/After split', (p) => ops.addBeforeAfterSplit(p, left.id, right.id, playhead).project);
              }}
            >
              Before / After split
            </Button>
          </div>
          <div className="field-hint">Image stills are placed with a default length; drag their edges to change it.</div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Tracks and markers
          </div>
          <Button size="sm" variant="ghost" onClick={onOpenVoiceover} title="Record a voiceover against the timeline">
            Voiceover
          </Button>
          <div className="field-label" style={{ marginTop: 4 }}>
            Selected clip
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              disabled={Boolean(blurBlock)}
              title={blurBlock ?? 'Adds a blur box over the upper-left, where terminals show tokens and hosts. Move it in the Inspector.'}
              onClick={() => selectedClipId && apply('Add blur box', (p) => ops.addBlurBox(p, selectedClipId))}
            >
              Blur box
            </Button>
            {blurBlock && <div className="field-hint" style={{ width: '100%' }}>{blurBlock}</div>}
            <Button
              size="sm"
              disabled={Boolean(punchBlock)}
              title={punchBlock ?? 'Zooms the selected clip in and back out over about 1.2 s'}
              onClick={() => selectedClipId && apply('Add punch-in', (p) => ops.addPunchIn(p, selectedClipId))}
            >
              Punch-in
            </Button>
            {punchBlock && <div className="field-hint" style={{ width: '100%' }}>{punchBlock}</div>}
            <Button
              size="sm"
              disabled={Boolean(zoomHighlightBlock)}
              title={zoomHighlightBlock ?? 'Zooms in on the selected media clip for the hold length and eases back out'}
              onClick={() =>
                selectedClipId &&
                apply('Add zoom highlight', (p) =>
                  ops.addZoomHighlight(p, selectedClipId, playhead, Math.round(holdSeconds * TICKS_PER_SECOND)),
                )
              }
            >
              Zoom highlight
            </Button>
            {zoomHighlightBlock && <div className="field-hint" style={{ width: '100%' }}>{zoomHighlightBlock}</div>}
            <Button
              size="sm"
              disabled={Boolean(blurBlock)}
              title={blurBlock ?? 'Heuristic scan for tokens/secrets and add candidate blur box (experimental — not a redaction guarantee)'}
              onClick={() => {
                if (!selectedClipId) return;
                const textFindings = scanProjectTextSecrets(project);
                apply('Auto-blur secret candidate (experimental)', (p) => ops.autoBlurSecretsOnClip(p, selectedClipId, []));
                toast(
                  `Added candidate blur mask (${textFindings.length} text secret pattern(s) flagged). Experimental only — verify masks manually.`,
                  'info',
                );
              }}
            >
              Scan & blur secrets (exp.)
            </Button>
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Silence & idle pacing
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              disabled={silenceBusy || project.durationTicks === 0}
              onClick={() => void runSilenceAction('cut')}
              title="Detects silent pauses across the timeline and ripple-deletes them"
            >
              {silenceBusy ? 'Analysing…' : 'Jump-cut silences'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={silenceBusy || project.durationTicks === 0}
              onClick={() => void runSilenceAction('ramp')}
              title="Speeds up silent/idle spans to 2.5× instead of cutting them"
            >
              Speed-ramp idle (2.5×)
            </Button>
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Vertical / Shorts reframe
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              onClick={() => apply('Reframe 9:16', (p) => ops.reframe9x16(p))}
              title="Switches canvas to 1080×1920 and stacks screen on top, presenter card below"
            >
              9:16 reframe
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => apply('9:16 follow presenter', (p) => ops.reframeFollowPresenter(p))}
              title="Switches to 1080×1920 and adds panX keyframes that follow the presenter"
            >
              9:16 follow presenter
            </Button>
          </div>
          <div className="field-label" style={{ marginTop: 4 }}>
            Camera
          </div>
          <Button
            size="sm"
            disabled={Boolean(camBlock)}
            title={camBlock ?? 'Shows the camera full-frame from the playhead for the hold length, to break up a long screen demo'}
            onClick={() => apply('Full camera', (p) => ops.fullCameraSpan(p, playhead, playhead + Math.round(holdSeconds * TICKS_PER_SECOND)))}
          >
            Full camera for hold length
          </Button>
          {camBlock && <div className="field-hint" style={{ width: '100%' }}>{camBlock}</div>}
          <Button
            size="sm"
            onClick={() =>
              apply('Add audio track', (p) => ops.addTrack(p, createTrack('audio', `Music ${p.tracks.filter((t) => t.kind === 'audio').length + 1}`)))
            }
          >
            Audio track
          </Button>
          <Button
            size="sm"
            onClick={() => apply('Add marker', (p) => ({ ...p, markers: [...p.markers, { id: newId('marker'), atTicks: playhead, label: `Marker ${p.markers.length + 1}`, color: '#ffd166' }] }))}
          >
            Marker at playhead
          </Button>
          <label className="field-label" style={{ marginTop: 4 }}>
            Drop mode
          </label>
          <Select
            value={editMode}
            onChange={(value) => useEditor.getState().setEditMode(value)}
            options={[
              { value: 'overwrite', label: 'Overwrite' },
              { value: 'insert', label: 'Insert (push right)' },
            ]}
          />
        </div>
      </Panel>
      )}

      {tab === 'markers' && (
        <Panel title="Markers">
          {project.markers.length === 0 ? (
            <EmptyState title="No markers">Use Add → Marker at playhead to flag a point to return to.</EmptyState>
          ) : (
          <div className="stack" style={{ gap: 6 }}>
          <Button
            size="sm"
            onClick={() => void navigator.clipboard.writeText(formatChapters(project.markers))}
            title="Copies YouTube chapter lines. YouTube needs the first chapter at 0:00."
          >
            Copy YouTube chapters
          </Button>
          <Button
            size="sm"
            onClick={() => void navigator.clipboard.writeText(formatDescription(project.markers, project.brand))}
            title="Copies chapters plus your contact lines, ready to paste into the video description."
          >
            Copy description
          </Button>
          <div className="stack scroll-thin" style={{ gap: 3, maxHeight: 180, overflow: 'auto' }}>
            {[...project.markers]
              .sort((a, b) => a.atTicks - b.atTicks)
              .map((marker) => (
                <button key={marker.id} type="button" className="list-item" onClick={() => useEditor.getState().setPlayhead(marker.atTicks)}>
                  <span className="dot" style={{ background: marker.color }} />
                  <span style={{ flex: 1, fontSize: 12 }}>{marker.label}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                    {formatClock(marker.atTicks)}
                  </span>
                </button>
              ))}
          </div>
          <div className="field-label" style={{ marginTop: 6 }}>
            Shorts segments from markers
          </div>
          <div className="stack scroll-thin" style={{ gap: 4, maxHeight: 200, overflow: 'auto' }}>
            {ops.markerSegments(project).map((seg) => (
              <div key={seg.id} className="stack" style={{ gap: 4, padding: 6, border: '1px solid var(--line)', borderRadius: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 11.5 }}>{seg.label}</strong>
                  <Badge tone={seg.withinShortsCap ? 'ok' : 'warn'}>
                    {formatClock(seg.durationTicks)} {seg.withinShortsCap ? '≤60s' : '>60s'}
                  </Badge>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      apply(`Extract segment ${seg.label}`, (p) =>
                        ops.extractSegmentProject(p, seg.startTicks, seg.endTicks, { reframeVertical: false }),
                      );
                      useEditor.getState().setPlayhead(0);
                    }}
                  >
                    Trim to segment
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      apply(`Make 9:16 Short (${seg.label})`, (p) =>
                        ops.extractSegmentProject(p, seg.startTicks, seg.endTicks, { reframeVertical: true }),
                      );
                      useEditor.getState().setPlayhead(0);
                    }}
                  >
                    Make 9:16 Short
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </div>
          )}
        </Panel>
      )}
    </div>
  );
}
