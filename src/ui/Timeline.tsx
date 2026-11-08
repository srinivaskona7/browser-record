import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TICKS_PER_SECOND, type Tick } from '../core/time';
import { useEditor } from '../project/store';
import * as ops from '../project/ops';
import type { Clip, Project, Track } from '../project/types';
import { snapTargets, snapTicks } from '../render/compositorQuery';
import { formatClock, formatTimecode } from '../core/time';
import { Button } from './components';
import { ensureAssetFile } from '../app/actions';

const MIN_TICK_WIDTH = 0.00002;

interface DragState {
  mode: 'move' | 'trim-start' | 'trim-end' | 'playhead' | 'pan';
  clipId?: string;
  startX: number;
  startTicks: number;
  deltaTicks: number;
  originalStart: number;
  originalDuration: number;
  originalIn: number;
}

export function Timeline({ project }: { project: Project }) {
  const zoom = useEditor((state) => state.zoom);
  const setZoom = useEditor((state) => state.setZoom);
  const playhead = useEditor((state) => state.playheadTicks);
  const setPlayhead = useEditor((state) => state.setPlayhead);
  const playing = useEditor((state) => state.playing);
  const selected = useEditor((state) => state.selectedClipIds);
  const selection = useEditor((state) => state.selection);
  const selectClips = useEditor((state) => state.selectClips);
  const selectRange = useEditor((state) => state.selectRange);
  const apply = useEditor((state) => state.apply);
  const snapping = useEditor((state) => state.snapping);
  const editMode = useEditor((state) => state.editMode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hoverTick, setHoverTick] = useState<Tick | null>(null);
  const [rangeInTick, setRangeInTick] = useState<Tick | null>(null);

  const pxPerTick = zoom / TICKS_PER_SECOND;
  const timelineTicks = Math.max(project.durationTicks, playhead) + 10 * TICKS_PER_SECOND;
  const contentWidth = Math.max(1200, Math.round(timelineTicks * pxPerTick) + 240);

  const snapThreshold = 8 / Math.max(pxPerTick, MIN_TICK_WIDTH);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const deltaPx = event.clientX - current.startX;
      const deltaTicks = Math.round(deltaPx / pxPerTick);
      if (current.mode === 'playhead') {
        const next = Math.max(0, current.startTicks + deltaTicks);
        setPlayhead(snapping ? snapTicks(next, snapTargets(project), snapThreshold) : next);
        return;
      }
      if (current.mode === 'pan') return;
      setDrag({ ...current, deltaTicks });
    },
    [pxPerTick, project, setPlayhead, snapping, snapThreshold],
  );

  const onPointerUp = useCallback(() => {
    const current = dragRef.current;
    setDrag(null);
    dragRef.current = null;
    if (!current || current.deltaTicks === 0 || !current.clipId) return;
    const clip = ops.findClipById(project, current.clipId);
    if (!clip) return;
    if (current.mode === 'move') {
      const target = Math.max(0, current.originalStart + current.deltaTicks);
      const snapped = snapping ? snapTicks(target, snapTargets(project, ops.linkedClipIds(project, clip)), snapThreshold) : target;
      const delta = snapped - clip.startTicks;
      if (delta !== 0) apply('Move clip', (p) => ops.moveClip(p, current.clipId!, delta));
    } else if (current.mode === 'trim-start') {
      const newStart = Math.max(0, current.originalStart + current.deltaTicks);
      apply('Trim clip start', (p) => ops.trimStart(p, current.clipId!, snapTicks(newStart, snapTargets(project, [clip.id]), snapThreshold)));
    } else if (current.mode === 'trim-end') {
      const newEnd = Math.max(current.originalStart + 1, current.originalStart + current.originalDuration + current.deltaTicks);
      apply('Trim clip end', (p) => ops.trimEnd(p, current.clipId!, snapTicks(newEnd, snapTargets(project, [clip.id]), snapThreshold)));
    }
  }, [apply, project, snapping, snapThreshold]);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  useEffect(() => {
    if (playing) return;
    const container = scrollRef.current;
    if (!container) return;
    const playheadX = playhead * pxPerTick;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    if (playheadX < viewLeft + 40 || playheadX > viewRight - 80) {
      container.scrollLeft = Math.max(0, playheadX - container.clientWidth * 0.3);
    }
  }, [playhead, playing, pxPerTick]);

  const startDrag = (event: React.PointerEvent, mode: DragState['mode'], clip?: Clip) => {
    event.stopPropagation();
    const startTicks = mode === 'playhead' ? Math.round((event.clientX - (scrollRef.current?.getBoundingClientRect().left ?? 0) + (scrollRef.current?.scrollLeft ?? 0)) / pxPerTick) : playhead;
    const state: DragState = {
      mode,
      startX: event.clientX,
      startTicks,
      deltaTicks: 0,
      originalStart: clip?.startTicks ?? 0,
      originalDuration: clip?.durationTicks ?? 0,
      originalIn: clip?.inTicks ?? 0,
      ...(clip ? { clipId: clip.id } : {}),
    };
    setDrag(state);
    dragRef.current = state;
    if (mode === 'playhead') setPlayhead(startTicks);
  };

  const rulerMarks = useMemo(() => buildRulerMarks(zoom, timelineTicks), [zoom, timelineTicks]);

  return (
    <section className="timeline-shell" aria-label="Timeline">
      <div className="timeline-toolbar">
        <Button size="sm" variant={snapping ? 'primary' : 'default'} onClick={() => useEditor.getState().setSnapping(!snapping)} title="Snap to clip edges and markers">
          Snap
        </Button>
        <Button size="sm" onClick={() => apply('Split at playhead', (p) => ops.splitAllAt(p, playhead))} title="Split at playhead (S)">
          Split
        </Button>
        <Button
          size="sm"
          onClick={() => apply('Delete selection', (p) => ops.deleteClips(p, selected, 'ripple'))}
          disabled={selected.length === 0}
          title="Ripple delete (Delete)"
        >
          Ripple delete
        </Button>
        <span className="badge" title="Overwrite trims; Insert pushes later clips right">
          {editMode === 'overwrite' ? 'Overwrite' : 'Insert'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          title="Set range In at playhead (I)"
          onClick={() => {
            setRangeInTick(playhead);
            const end = selection.kind === 'range' && selection.end > playhead ? selection.end : playhead + 2 * TICKS_PER_SECOND;
            selectRange(playhead, end);
          }}
        >
          In [I]
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Set range Out at playhead (O)"
          onClick={() => {
            const start = rangeInTick !== null && rangeInTick < playhead ? rangeInTick : Math.max(0, playhead - 2 * TICKS_PER_SECOND);
            selectRange(start, playhead);
          }}
        >
          Out [O]
        </Button>
        <div style={{ flex: 1 }} />
        <span className="timecode" style={{ fontSize: 12, color: 'var(--text-2)' }} title="Playhead timecode">
          {formatTimecode(playhead, project.canvas.fps)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setZoom(zoom / 1.4)} aria-label="Zoom out">
          −
        </Button>
        <span className="mono" style={{ fontSize: 11, width: 62, textAlign: 'center', color: 'var(--text-3)' }}>
          {Math.round(zoom)} px/s
        </span>
        <Button size="sm" variant="ghost" onClick={() => setZoom(zoom * 1.4)} aria-label="Zoom in">
          +
        </Button>
      </div>
      <div className="timeline-scroll scroll-thin" ref={scrollRef}>
        <div className="timeline-grid" style={{ width: contentWidth }}>
          <div
            className="ruler"
            style={{ width: contentWidth }}
            onPointerDown={(event) => startDrag(event, 'playhead')}
            title="Click or drag to scrub"
          >
            {rulerMarks.map((mark) => (
              <div
                key={mark.ticks}
                style={{
                  position: 'absolute',
                  left: mark.ticks * pxPerTick,
                  top: 0,
                  bottom: 0,
                  borderLeft: '1px solid var(--line)',
                  paddingLeft: 4,
                  fontSize: 10,
                  color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {mark.label}
              </div>
            ))}
            {hoverTick !== null && (
              <div style={{ position: 'absolute', left: hoverTick * pxPerTick, top: 0, bottom: 0, width: 1, background: 'var(--text-3)', pointerEvents: 'none' }} />
            )}
          </div>
          <div
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setHoverTick(Math.round((event.clientX - rect.left) / pxPerTick));
            }}
            onPointerLeave={() => setHoverTick(null)}
          >
            {project.tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                project={project}
                pxPerTick={pxPerTick}
                selected={selected}
                drag={drag}
                onSelect={(clip, additive) => selectClips([clip.id], additive)}
                onStartDrag={(event, clip, mode) => {
                  onDragStartSelect(clip, event.shiftKey);
                  startDrag(event, mode, clip);
                }}
                onDropAsset={(assetId, dropX) => {
                  const targetTrack = project.tracks.find((t) => t.id === track.id);
                  if (!targetTrack || targetTrack.locked) return;
                  apply('Insert media', (p) => {
                    const result = ops.dropAssetOnTrack(
                      p,
                      targetTrack.id,
                      assetId,
                      dropX,
                      pxPerTick,
                      snapping,
                      editMode,
                    );
                    return result.project;
                  });
                }}
              />
            ))}
          </div>
          {selection.kind === 'range' && (
            <div
              className="timeline-range-band"
              data-testid="timeline-range-band"
              style={{
                position: 'absolute',
                left: 150 + selection.start * pxPerTick,
                width: Math.max(2, (selection.end - selection.start) * pxPerTick),
                top: 0,
                bottom: 0,
                background: 'rgba(59, 130, 246, 0.18)',
                borderLeft: '2px solid #3b82f6',
                borderRight: '2px solid #3b82f6',
                pointerEvents: 'none',
              }}
            />
          )}
          <div className="playhead" style={{ left: playhead * pxPerTick, height: '100%' }} />
        </div>
      </div>
    </section>
  );

  function onDragStartSelect(clip: Clip, additive: boolean) {
    if (!selected.includes(clip.id)) selectClips([clip.id], additive);
  }
}

function TrackRow({
  track,
  project,
  pxPerTick,
  selected,
  drag,
  onSelect,
  onStartDrag,
  onDropAsset,
}: {
  track: Track;
  project: Project;
  pxPerTick: number;
  selected: string[];
  drag: DragState | null;
  onSelect: (clip: Clip, additive: boolean) => void;
  onStartDrag: (event: React.PointerEvent, clip: Clip, mode: DragState['mode']) => void;
  onDropAsset: (assetId: string, atTicks: Tick) => void;
}) {
  const apply = useEditor((state) => state.apply);
  const setTrackFlag = (patch: Partial<Track>) => apply('Track setting', (p) => ops.setTrackFlag(p, track.id, patch));
  return (
    <div className="track-row" style={{ minHeight: track.height }}>
      <div className="track-head" style={{ height: track.height }}>
        <div className="track-name" title={track.name}>
          <span className="dot" style={{ background: track.kind === 'audio' ? 'var(--ok)' : track.kind === 'caption' ? 'var(--accent)' : 'var(--cyan)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.name}</span>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 5px', fontSize: 10, height: 18 }}
            onClick={() => setTrackFlag({ muted: !track.muted })}
            aria-pressed={track.muted}
            title={track.kind === 'audio' ? 'Mute track' : 'Mute'}
          >
            {track.muted ? 'Muted' : 'M'}
          </button>
          {track.kind === 'video' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '0 5px', fontSize: 10, height: 18 }}
              onClick={() => setTrackFlag({ hidden: !track.hidden })}
              aria-pressed={track.hidden}
              title="Hide track"
            >
              {track.hidden ? 'Hidden' : 'H'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '0 5px', fontSize: 10, height: 18 }}
            onClick={() => setTrackFlag({ locked: !track.locked })}
            aria-pressed={track.locked}
            title="Lock track"
          >
            {track.locked ? 'Locked' : 'L'}
          </button>
        </div>
      </div>
      <div
        className="track-lane"
        style={{ height: track.height, cursor: track.locked ? 'not-allowed' : 'default' }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = track.locked ? 'none' : 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (track.locked) return;
          const assetId = event.dataTransfer.getData('application/x-browser-record-asset');
          if (!assetId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onDropAsset(assetId, Math.max(0, event.clientX - rect.left));
        }}
      >
        {track.clips.map((clip) => {
          const dragging = drag?.clipId === clip.id ? drag : null;
          const offset = dragging?.mode === 'move' ? dragging.deltaTicks : 0;
          const startOffset = dragging?.mode === 'trim-start' ? Math.max(0, dragging.deltaTicks) : 0;
          const endOffset = dragging?.mode === 'trim-end' ? dragging.deltaTicks : 0;
          const left = (clip.startTicks + offset + startOffset) * pxPerTick;
          const width = Math.max(2, (clip.durationTicks - startOffset + endOffset) * pxPerTick);
          const isSelected = selected.includes(clip.id);
          const keyframes = clip.keyframes.flatMap((g) => g.keyframes);
          return (
            <div
              key={clip.id}
              className="clip"
              data-selected={isSelected}
              data-kind={clip.kind}
              data-track={track.kind}
              style={{ left, width }}
              title={`${clip.label ?? clip.kind} · ${formatClock(clip.durationTicks)}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                onSelect(clip, event.shiftKey);
                onStartDrag(event, clip, 'move');
              }}
            >
              <div className="clip-label">{clip.label ?? clip.text?.text ?? clip.kind}</div>
              {keyframes.map((kf) => (
                <span
                  key={kf.id}
                  className="clip-keyframe-diamond"
                  title={`Keyframe at ${formatClock(kf.atTicks)} (${kf.easing})`}
                  style={{
                    position: 'absolute',
                    left: Math.max(4, Math.min(width - 8, kf.atTicks * pxPerTick)),
                    bottom: 3,
                    fontSize: 9,
                    color: '#ffd166',
                    pointerEvents: 'none',
                  }}
                >
                  ◆
                </span>
              ))}
              {track.kind === 'audio' && <Waveform assetId={clip.assetId} color="rgba(255,255,255,0.65)" />}
              <div
                className="clip-handle"
                style={{ left: 0 }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(clip, false);
                  onStartDrag(event, clip, 'trim-start');
                }}
                aria-label="Trim clip start"
              />
              <div
                className="clip-handle"
                style={{ right: 0 }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(clip, false);
                  onStartDrag(event, clip, 'trim-end');
                }}
                aria-label="Trim clip end"
              />
            </div>
          );
        })}
      </div>
      {track.kind === 'caption' && (
        <div style={{ position: 'absolute', left: 150, right: 0, top: 0, bottom: 0, pointerEvents: 'none' }}>
          {project.captions.map((cue) => (
            <div
              key={cue.id}
              style={{
                position: 'absolute',
                left: cue.startTicks * pxPerTick,
                width: Math.max(1, (cue.endTicks - cue.startTicks) * pxPerTick),
                top: 8,
                bottom: 8,
                borderRadius: 5,
                background: 'color-mix(in oklab, var(--accent) 24%, transparent)',
                border: '1px solid color-mix(in oklab, var(--accent) 40%, transparent)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const waveformCache = new Map<string, number[]>();
const waveformPending = new Map<string, Promise<number[]>>();

/** Decode once per asset, cache peaks, redraw on resize. */
export function Waveform({ assetId, color = 'rgba(255,255,255,0.6)' }: { assetId?: string; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(assetId ? waveformCache.get(assetId) ?? null : null);

  useEffect(() => {
    if (!assetId || peaks) return;
    let cancelled = false;
    const load = async () => {
      const existing = waveformPending.get(assetId);
      if (existing) {
        const value = await existing;
        if (!cancelled) setPeaks(value);
        return;
      }
      const promise = decodePeaksFromAsset(assetId);
      waveformPending.set(assetId, promise);
      const value = await promise;
      waveformCache.set(assetId, value);
      if (!cancelled) setPeaks(value);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [assetId, peaks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color;
      const data = peaks ?? [];
      if (data.length === 0) {
        ctx.globalAlpha = 0.25;
        ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
        return;
      }
      const barWidth = 2 * dpr;
      const step = Math.max(1, Math.floor(data.length / Math.max(1, canvas.width / barWidth)));
      for (let x = 0; x < canvas.width; x += barWidth) {
        const index = Math.min(data.length - 1, Math.floor((x / canvas.width) * data.length));
        const value = Math.max(...data.slice(index, index + step));
        const h = Math.max(1, value * canvas.height * 0.9);
        ctx.fillRect(x, (canvas.height - h) / 2, barWidth * 0.7, h);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks, color]);

  return <canvas ref={canvasRef} className="clip-waveform" aria-hidden="true" />;
}

async function decodePeaksFromAsset(assetId: string): Promise<number[]> {
  try {
    const file = await ensureAssetFileFromProject(assetId);
    if (!file) return [];
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const buckets = 900;
    const size = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i += 1) {
      let peak = 0;
      for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j += 1) {
        const abs = Math.abs(data[j]!);
        if (abs > peak) peak = abs;
      }
      peaks.push(peak);
    }
    await context.close();
    return peaks;
  } catch {
    return [];
  }
}

async function ensureAssetFileFromProject(assetId: string): Promise<File | null> {
  const project = useEditor.getState().project;
  const asset = project?.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  return ensureAssetFile(asset.path);
}

function buildRulerMarks(pxPerSecond: number, totalTicks: Tick): Array<{ ticks: Tick; label: string }> {
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const minimumPx = 76;
  const stepSeconds = candidates.find((seconds) => seconds * pxPerSecond >= minimumPx) ?? 3600;
  const marks: Array<{ ticks: Tick; label: string }> = [];
  const stepTicks = Math.round(stepSeconds * TICKS_PER_SECOND);
  for (let ticks = 0; ticks <= totalTicks; ticks += stepTicks) {
    const seconds = ticks / TICKS_PER_SECOND;
    const label =
      stepSeconds < 1
        ? `${seconds.toFixed(2)}s`
        : seconds >= 3600
          ? `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:00`
          : seconds >= 60
            ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
            : `${Math.round(seconds)}s`;
    marks.push({ ticks, label });
  }
  return marks;
}
