import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import { downloadBlob, ensureAssetFile } from '../app/actions';
import { importMediaIntoSession, prepareSession, saveSessionToFolder } from '../app/bootstrap';
import { Badge, Button, Dialog, EmptyState, Field, Panel, Select, Stat, Toggle } from './components';
import {
  PRESETS,
  defaultPresetId,
  formatBytes,
  planBitrate,
  planQualitySamples,
  presetById,
  type ExportPreset as Preset,
  type PresetId,
} from '../export/presets';
import { ExportCancelled, describeExport, exportProject, type ExportProgress, type ExportResult } from '../export/exporter';
import { AUDIO_CODECS, VIDEO_CODECS, probeAudioEncoder, probeVideoEncoder, type CodecCandidate, type CodecSupport } from '../capabilities/codecs';
import { runEncodeBenchmark, type BenchmarkResult } from '../capabilities/benchmark';
import { cloneProjectWithRange, extractSegmentProject, markerSegments } from '../project/ops';
import { checkStorageHeadroom, fileExists, readBlob } from '../workspace/workspace';
import { WORKSPACE_LAYOUT } from '../workspace/types';
import { formatClock, TICKS_PER_SECOND } from '../core/time';
import { snapshotThumbnail } from './Preview';

const CUSTOM_ID: PresetId = 'custom';

/** "1.8× real time": how fast the encoder runs against the project's frame rate. */
function formatSpeed(fps: number, projectFps?: { num: number; den: number }): string {
  if (!projectFps || fps <= 0) return '—';
  return `${(fps / (projectFps.num / projectFps.den)).toFixed(1)}× real time`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return minutes > 0 ? `${minutes}:${rest}` : `${total}s`;
}

export function ExportPage() {
  const project = useEditor((state) => state.project);
  const session = useSession();
  // Start at the composition's own size. Picking a bigger preset is allowed,
  // but it is never the default: an upscaled 1080p export is not 4K.
  const [presetId, setPresetId] = useState<PresetId>(() => (project ? defaultPresetId(project.canvas) : '4k-balanced'));
  const [width, setWidth] = useState(project?.canvas.width ?? 1920);
  const [height, setHeight] = useState(project?.canvas.height ?? 1080);
  const [videoMbps, setVideoMbps] = useState(10);
  const [audioKbps, setAudioKbps] = useState(128);
  const [targetGb, setTargetGb] = useState('');
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [segmentId, setSegmentId] = useState<string>('all');
  const [cancelRef, setCancelRef] = useState<AbortController | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<CodecSupport[]>([]);
  const [supportBusy, setSupportBusy] = useState(false);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleInfo, setSampleInfo] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(session.benchmark);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [storageBlock, setStorageBlock] = useState<{ message: string; estimatedBytes: number } | null>(null);
  const lastUrl = useRef<string | null>(null);
  const quickImport = useRef<HTMLInputElement>(null);
  const timelineImport = useRef<HTMLInputElement>(null);

  const preset: Preset = useMemo(() => {
    const base = presetById(presetId) ?? PRESETS[1]!;
    return presetId === CUSTOM_ID
      ? { ...base, id: CUSTOM_ID, label: 'Custom', width, height, videoBitrate: Math.round(videoMbps * 1_000_000), audioBitrate: Math.round(audioKbps * 1000) }
      : base;
  }, [presetId, width, height, videoMbps, audioKbps]);

  const segments = useMemo(() => (project ? markerSegments(project) : []), [project]);
  const activeSegment = useMemo(
    () => (segmentId === 'all' ? null : segments.find((s) => s.id === segmentId) ?? null),
    [segmentId, segments],
  );
  const exportTargetProject = useMemo(() => {
    if (!project) return null;
    if (!activeSegment) return project;
    return extractSegmentProject(project, activeSegment.startTicks, activeSegment.endTicks, {
      reframeVertical: preset.width < preset.height,
      targetWidth: preset.width,
      targetHeight: preset.height,
    });
  }, [project, activeSegment, preset.width, preset.height]);

  const durationSeconds = exportTargetProject ? exportTargetProject.durationTicks / TICKS_PER_SECOND : 0;
  const budget = useMemo(() => {
    if (!exportTargetProject) return null;
    return planBitrate({
      durationSeconds,
      width: preset.width,
      height: preset.height,
      fps: exportTargetProject.canvas.fps.num / exportTargetProject.canvas.fps.den,
      audioBitrate: preset.audioBitrate,
      maxDurationSeconds: preset.maxDurationSeconds,
      maxBytes: preset.maxBytes,
      ...(targetGb && Number(targetGb) > 0 ? { targetBytes: Number(targetGb) * 1_000_000_000 } : { videoBitrate: preset.videoBitrate }),
    });
  }, [exportTargetProject, preset, durationSeconds, targetGb]);

  const effectiveVideoBitrate = targetGb && Number(targetGb) > 0 ? Math.round((budget?.videoMbps ?? 0) * 1_000_000) : preset.videoBitrate;

  useEffect(() => {
    if (!project) return;
    // A project loaded after this page mounted must not inherit the previous
    // project's preset. Restart from this composition's own size.
    const target = defaultPresetId(project.canvas);
    setPresetId(target);
    if (target === CUSTOM_ID) {
      setWidth(project.canvas.width);
      setHeight(project.canvas.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    setWidth((current) => (presetId === CUSTOM_ID ? current : presetById(presetId)?.width ?? current));
    setHeight((current) => (presetId === CUSTOM_ID ? current : presetById(presetId)?.height ?? current));
    const next = presetById(presetId);
    if (next) {
      setVideoMbps(next.videoBitrate / 1_000_000);
      setAudioKbps(next.audioBitrate / 1000);
    }
  }, [presetId, project]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setSupportBusy(true);
    void (async () => {
      const list: CodecSupport[] = [];
      for (const codec of VIDEO_CODECS) {
        list.push(await probeVideoEncoder(codec, preset.width, preset.height, project.canvas.fps.num / project.canvas.fps.den, effectiveVideoBitrate));
      }
      for (const codec of AUDIO_CODECS) {
        list.push(await probeAudioEncoder(codec, project.settings.sampleRate, 2, preset.audioBitrate));
      }
      if (!cancelled) {
        setSupport(list);
        session.setCodecSupport(list);
      }
      if (!cancelled) setSupportBusy(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, preset.width, preset.height, effectiveVideoBitrate]);

  useEffect(
    () => () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    },
    [],
  );

  if (!project) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Export</h1>
            <p className="page-subtitle">Turn a recording or an imported clip into a playable file on your computer.</p>
          </div>
        </header>
        <div style={{ maxWidth: 760 }}>
          <Panel>
            <EmptyState
              title="Nothing to export yet"
              action={
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Button variant="primary" onClick={() => void startRecordingFromExport()}>
                    Start recording
                  </Button>
                  <Button onClick={() => quickImport.current?.click()}>Import a video</Button>
                  <Button variant="ghost" onClick={() => session.setRoute('edit')}>
                    Open a project
                  </Button>
                </div>
              }
            >
              Add a recording or import a video before exporting. Everything stays on this computer.
            </EmptyState>
            <input
              ref={quickImport}
              type="file"
              accept="video/*,audio/*,image/*"
              multiple
              hidden
              onChange={async (event) => {
                // Copy before resetting the input: clearing `value` empties the
                // live FileList too, which made this handler silently do nothing.
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length === 0) return;
                try {
                  await importMediaIntoSession(files);
                  session.setRoute('edit');
                } catch (error) {
                  session.pushToast(`Could not import: ${(error as Error).message}`, 'error');
                }
              }}
            />
            <div className="field-hint" style={{ marginTop: 12 }}>
              An export needs at least one clip on the timeline. Importing creates the project and places the clip for
              you; recording opens a temporary session first.
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  async function startRecordingFromExport() {
    try {
      await prepareSession();
      session.setRoute('record');
    } catch (error) {
      session.pushToast(`Could not prepare a session: ${(error as Error).message}`, 'error');
    }
  }

  const destinationPath = (() => {
    const base = project.name.replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lesson';
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `${WORKSPACE_LAYOUT.exports}/${base}-${preset.width}x${preset.height}-${stamp}.${preset.container}`;
  })();

  const runExport = async (overwrite = false, ignoreStorage = false) => {
    if (!session.workspace) {
      setError('No storage is ready yet. Open Export again after a session has been created.');
      return;
    }
    setError(null);
    setResult(null);
    const controller = new AbortController();
    setCancelRef(controller);
    setProgress(null);
    try {
      if (!ignoreStorage && budget) {
        // Estimates, not reservations: the browser cannot promise the write,
        // but a known-too-small quota is worth stopping before a long encode.
        const headroom = await checkStorageHeadroom(Math.round(budget.estimatedBytes * 1.1));
        if (!headroom.enough) {
          setStorageBlock({ message: headroom.message, estimatedBytes: budget.estimatedBytes });
          setCancelRef(null);
          return;
        }
      }
      if (!overwrite && (await fileExists(session.workspace.root, destinationPath))) {
        setConfirmOverwrite(true);
        setCancelRef(null);
        return;
      }
      const out = await exportProject({
        project: exportTargetProject ?? project,
        preset,
        videoBitrate: effectiveVideoBitrate,
        audioBitrate: preset.audioBitrate,
        width: preset.width,
        height: preset.height,
        destination: { root: session.workspace.root, path: destinationPath },
        getAssetFile: (path) => ensureAssetFile(path),
        signal: controller.signal,
        includeCaptions,
        onProgress: setProgress,
      });
      setResult(out);
      if (out.warnings.length > 0) {
        session.pushToast(
          `Export written to ${out.path ?? 'the project'} with ${out.warnings.length} warning(s). Check the result panel before publishing.`,
          'error',
        );
      } else {
        session.pushToast(`Export written to ${out.path ?? 'the project'}.`, 'success');
      }
    } catch (err) {
      if (err instanceof ExportCancelled) {
        // The exporter already attempted the delete; trust its result rather
        // than calling removeEntry with a path it cannot accept.
        session.pushToast(
          err.partialFileMayRemain
            ? 'Export cancelled. A partial file could not be removed and is still in exports/.'
            : 'Export cancelled; the partial file was removed.',
          err.partialFileMayRemain ? 'error' : 'info',
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setCancelRef(null);
      setProgress(null);
      setConfirmOverwrite(false);
    }
  };

  const runSample = async () => {
    setSampleBusy(true);
    setError(null);
    try {
      const plan = planQualitySamples(project, 6);
      const sample = cloneProjectWithRange(project, plan.busy.startTicks, plan.busy.durationTicks);
      if (sample.durationTicks === 0) throw new Error('Nothing to sample in this range.');
      const out = await exportProject({
        project: sample,
        preset,
        videoBitrate: effectiveVideoBitrate,
        audioBitrate: preset.audioBitrate,
        width: preset.width,
        height: preset.height,
        getAssetFile: (path) => ensureAssetFile(path),
        includeCaptions,
      });
      if (!out.buffer) throw new Error('The sample could not be buffered in memory.');
      const blob = new Blob([out.buffer], { type: out.container === 'mp4' ? 'video/mp4' : 'video/webm' });
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      const url = URL.createObjectURL(blob);
      lastUrl.current = url;
      setSampleUrl(url);
      setSampleInfo(
        out.warnings.length > 0
          ? `${describeExport(out)} — ${out.warnings.length} warning(s): ${out.warnings.join(' ')}`
          : describeExport(out),
      );
    } catch (err) {
      setError(`Sample encode failed: ${(err as Error).message}`);
    } finally {
      setSampleBusy(false);
    }
  };

  const runBenchmark = async () => {
    setBenchmarkBusy(true);
    try {
      const codec = (VIDEO_CODECS.find((item) => item.family === 'h264') ?? VIDEO_CODECS[0]) as CodecCandidate;
      const outcome = await runEncodeBenchmark({
        width: preset.width,
        height: preset.height,
        fps: project.canvas.fps.num / project.canvas.fps.den,
        frames: 45,
        codec,
        bitrate: effectiveVideoBitrate,
      });
      setBenchmark(outcome);
      session.setBenchmark(outcome);
    } catch (err) {
      setError(`Benchmark failed: ${(err as Error).message}`);
    } finally {
      setBenchmarkBusy(false);
    }
  };

  const downloadResult = async (payload: ExportResult) => {
    const filename = payload.path?.split('/').pop() ?? destinationPath.split('/').pop() ?? 'lesson.mp4';
    if (payload.buffer) {
      const blob = new Blob([payload.buffer], { type: payload.container === 'mp4' ? 'video/mp4' : 'video/webm' });
      downloadBlob(blob, filename);
      return;
    }
    if (!session.workspace || !payload.path) return;
    try {
      // The path is project-relative (exports/<file>); opening just the basename
      // at the workspace root never found it.
      const file = await readBlob(session.workspace.root, payload.path);
      downloadBlob(file, filename);
    } catch (err) {
      setError(`Could not open the exported file: ${(err as Error).message}`);
    }
  };

  const cancel = () => cancelRef?.abort();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Export</h1>
          <p className="page-subtitle">
            Delivery settings are separate from capture. Originals on disk are never modified or overwritten; each
            export gets a new timestamped file under <span className="mono">{WORKSPACE_LAYOUT.exports}/</span>.
          </p>
        </div>
        <Badge>{project.name}</Badge>
      </header>

      <div className="split-grid">
        <div className="stack" style={{ gap: 14 }}>
          <Panel title="Delivery preset" bodyClassName="stack">
            <div className="stack" style={{ gap: 6 }}>
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="panel"
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    cursor: 'pointer',
                    borderColor: presetId === item.id ? 'var(--accent)' : 'var(--line)',
                  }}
                  onClick={() => setPresetId(item.id)}
                >
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: 13 }}>{item.label}</strong>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {item.width}×{item.height} · {(item.videoBitrate / 1e6).toFixed(0)} Mbps
                    </span>
                  </div>
                  <div className="field-hint" style={{ marginTop: 4 }}>
                    {item.description}
                  </div>
                </button>
              ))}
              <button
                type="button"
                className="panel"
                style={{ textAlign: 'left', padding: 12, cursor: 'pointer', borderColor: presetId === CUSTOM_ID ? 'var(--accent)' : 'var(--line)' }}
                onClick={() => setPresetId(CUSTOM_ID)}
              >
                <strong style={{ fontSize: 13 }}>Custom</strong>
                <div className="field-hint" style={{ marginTop: 4 }}>
                  Set size, bitrate or a target file size. The budget calculator explains what that actually buys.
                </div>
              </button>
            </div>

            {presetId === CUSTOM_ID && (
              <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="row" style={{ gap: 8 }}>
                  <NumberField label="Width" value={width} min={320} max={7680} step={2} onChange={setWidth} />
                  <NumberField label="Height" value={height} min={180} max={4320} step={2} onChange={setHeight} />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <NumberField label="Video Mbps" value={videoMbps} min={0.5} max={100} step={0.5} onChange={setVideoMbps} />
                  <NumberField label="Audio kbps" value={audioKbps} min={64} max={320} step={16} onChange={setAudioKbps} />
                </div>
                <Field label="Or target file size (decimal GB)" hint="Leave blank to use the bitrate above.">
                  <input
                    className="input"
                    value={targetGb}
                    onChange={(event) => setTargetGb(event.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="e.g. 1.8"
                    inputMode="decimal"
                  />
                </Field>
              </div>
            )}

            <Toggle label="Include captions in the picture" checked={includeCaptions} onChange={setIncludeCaptions} />
            {segments.length > 0 && (
              <Field label="Timeline range / Shorts segment from markers" hint="Pick a marker-to-marker chapter to export as a standalone Short/Reel.">
                <Select
                  value={segmentId}
                  onChange={setSegmentId}
                  options={[
                    { value: 'all', label: `Full timeline (${formatClock(project.durationTicks)})` },
                    ...segments.map((seg) => ({
                      value: seg.id,
                      label: `${seg.label} (${formatClock(seg.durationTicks)}${seg.withinShortsCap ? ' · ≤60s' : ' · >60s'})`,
                    })),
                  ]}
                />
              </Field>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const blob = await snapshotThumbnail(
                    exportTargetProject ?? project,
                    null,
                    useEditor.getState().playheadTicks,
                    includeCaptions,
                  );
                  if (blob) {
                    downloadBlob(blob, `${project.name.replace(/[^\w-]+/g, '-') || 'thumbnail'}-1280x720.png`);
                  }
                }}
              >
                Export thumbnail PNG (1280×720)
              </Button>
            </div>
            <div className="field-hint">
              Burned-in captions are part of the frame; the separate SRT/VTT stays editable and can be exported from the
              Captions panel instead.
            </div>
          </Panel>

          <Panel title="Budget" bodyClassName="stack">
            {budget ? (
              <>
                <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
                  <Stat label="Duration" value={`${durationSeconds.toFixed(1)}s`} />
                  <Stat label="Video" value={`${budget.videoMbps.toFixed(2)} Mbps`} />
                  <Stat label="Audio" value={`${budget.audioMbps.toFixed(2)} Mbps`} />
                  <Stat label="Estimated size" value={formatBytes(budget.estimatedBytes)} hint="VBR lands near, not on, the target" />
                  <Stat label="Bits/pixel" value={budget.bitsPerPixel.toFixed(3)} />
                </div>
                <div className="field-hint mono">
                  {budget.totalMbps.toFixed(2)} Mbps × {durationSeconds.toFixed(0)}s ÷ 8 ÷ 1000 ≈ {formatBytes(budget.estimatedBytes)} (decimal GB = Mbps × s / 8000)
                </div>
                {budget.warnings.map((warning, index) => (
                  <div key={index} className="warn-card">
                    {warning}
                  </div>
                ))}
                {budget.plausible && <Badge tone="ok">No budget warnings</Badge>}
              </>
            ) : null}
            <div className="field-hint">
              The 4–12 Mbps range is a starting point for 4K talking-head/terminal content, not a guarantee. Check a
              sample before exporting a long lesson.
            </div>
          </Panel>

          <Panel title="Quality check" bodyClassName="stack">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => void runSample()} disabled={sampleBusy}>
                {sampleBusy ? 'Encoding 6s sample…' : 'Encode a 6s sample'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void runBenchmark()} disabled={benchmarkBusy}>
                {benchmarkBusy ? 'Benchmarking…' : 'Run encoder benchmark'}
              </Button>
            </div>
            {sampleUrl && (
              <div className="stack" style={{ gap: 8 }}>
                <video src={sampleUrl} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="field-hint mono" style={{ whiteSpace: 'pre-line' }}>
                    {sampleInfo}
                  </span>
                  <a className="btn btn-ghost btn-sm" href={sampleUrl} download={`sample-${preset.width}x${preset.height}.${preset.container}`}>
                    Download sample
                  </a>
                </div>
                <div className="field-hint">
                  Compare against the editor preview at 100%. A sample proves the encoder ran; it does not prove a whole
                  lesson at this bitrate will look the same.
                </div>
              </div>
            )}
            {benchmark && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <Badge tone={benchmark.sustainedFps >= 30 ? 'ok' : 'warn'}>
                    {benchmark.sustainedFps.toFixed(1)} fps sustained
                  </Badge>
                  <span className="field-hint mono">
                    {benchmark.encodedFrames} encoded / {benchmark.decodedFrames} decoded · {benchmark.elapsedMs.toFixed(0)} ms
                    · {benchmark.avgEncodeMs.toFixed(1)} ms/frame · round trip {benchmark.decoderRoundTrip ? 'ok' : 'failed'}
                  </span>
                </div>
                {benchmark.reason && <div className="warn-card">{benchmark.reason}</div>}
              </div>
            )}
          </Panel>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <Panel title="Export" bodyClassName="stack">
            <div className="field-hint mono" style={{ wordBreak: 'break-all' }}>
              {destinationPath}
            </div>
            {progress ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12.5 }}>{progress.phase}</span>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {(progress.progress * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="meter">
                  <div className="meter-fill" style={{ width: `${Math.min(100, progress.progress * 100)}%` }} />
                </div>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)' }}>
                  <span className="mono">
                    frame {progress.frame}/{progress.totalFrames}
                  </span>
                  <span className="mono" title="Encode speed in frames per second">
                    {progress.fps.toFixed(1)} fps · {formatSpeed(progress.fps, project?.canvas.fps)}
                  </span>
                  <span className="mono">{formatBytes(progress.bytesWritten)}</span>
                  <span className="mono">{progress.etaSeconds > 0 ? `${formatDuration(progress.etaSeconds)} left` : 'finishing'}</span>
                </div>
                {progress.detail && <div className="field-hint">{progress.detail}</div>}
                <Button variant="danger" onClick={cancel}>
                  Cancel export
                </Button>
                <div className="field-hint">
                  Cancelling tries to delete the partially written file; originals are untouched. If that fails you are told where it is.
                </div>
              </div>
            ) : project.durationTicks === 0 ? (
              <div className="hint-card">
                <strong>Nothing on the timeline yet.</strong> An export needs at least one clip. Record a take, import a
                video, or open the editor to place a clip — the export settings on this page are kept.
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <Button size="sm" variant="primary" onClick={() => void startRecordingFromExport()}>
                    Start recording
                  </Button>
                  <Button size="sm" onClick={() => timelineImport.current?.click()}>
                    Import a video
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => session.setRoute('edit')}>
                    Open the editor
                  </Button>
                </div>
                <input
                  ref={timelineImport}
                  type="file"
                  accept="video/*,audio/*,image/*"
                  multiple
                  hidden
                  onChange={async (event) => {
                    // Copy before resetting the input: clearing `value` empties
                    // the live FileList too, which made this a silent no-op.
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    if (files.length === 0) return;
                    try {
                      await importMediaIntoSession(files);
                      session.setRoute('edit');
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                />
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={() => void runExport()}
                disabled={!session.workspace}
              >
                Export {preset.width}×{preset.height} · {preset.container.toUpperCase()}
              </Button>
            )}
            {session.workspace?.info.mode === 'opfs' && (
              <div className="warn-card">
                This export is written into <strong>browser storage</strong>, which the browser can evict.{' '}
                <Button size="sm" variant="ghost" onClick={() => void saveSessionToFolder()}>
                  Save the project and media to a folder…
                </Button>{' '}
                or use “Save a copy to Downloads” after exporting.
              </div>
            )}
            {error && <div className="danger-card">{error}</div>}
            {result && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                  <Badge tone="ok">exported</Badge>
                  <span className="field-hint mono" style={{ whiteSpace: 'pre-line' }}>
                    {describeExport(result)}
                  </span>
                </div>
                <div className="field-hint">{result.path}</div>
                {result.warnings.map((warning, index) => (
                  <div key={index} className="warn-card">
                    {warning}
                  </div>
                ))}
                <Button size="sm" onClick={() => void downloadResult(result)}>
                  Save a copy to Downloads
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                  Dismiss
                </Button>
              </div>
            )}
          </Panel>

          <Panel
            title="Encoder support"
            action={
              <Button size="sm" variant="ghost" onClick={() => void runBenchmark()} disabled={supportBusy || benchmarkBusy}>
                {supportBusy ? 'Probing…' : 'Re-probe'}
              </Button>
            }
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Codec</th>
                  <th>Type</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {support.map((item) => (
                  <tr key={item.codec.codec}>
                    <td className="mono">{item.codec.label}</td>
                    <td>{AUDIO_CODECS.includes(item.codec) ? 'audio' : 'video'}</td>
                    <td>
                      {item.encoderSupported ? (
                        <Badge tone="ok">supported</Badge>
                      ) : (
                        <span className="field-hint">{item.reason ?? 'unsupported'}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {support.length === 0 && (
                  <tr>
                    <td colSpan={3} className="field-hint">
                      Probing…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Support is probed in this browser. When H.264 is missing the export falls back to VP9/WebM and says so.
            </div>
          </Panel>

          <Panel title="Capture vs delivery">
            <table className="table">
              <tbody>
                <tr>
                  <td>Capture</td>
                  <td className="mono">
                    {project.canvas.width}×{project.canvas.height} · {project.canvas.fps.num}/{project.canvas.fps.den} fps
                  </td>
                </tr>
                <tr>
                  <td>Delivery</td>
                  <td className="mono">
                    {preset.width}×{preset.height} · {effectiveVideoBitrate / 1e6} Mbps video
                  </td>
                </tr>
                <tr>
                  <td>Originals</td>
                  <td>Untouched in <span className="mono">media/originals/</span></td>
                </tr>
              </tbody>
            </table>
            {preset.width > project.canvas.width || preset.height > project.canvas.height ? (
              <div className="warn-card" style={{ marginTop: 10 }}>
                This delivery size is larger than the composition. It upscales; it cannot add detail.
              </div>
            ) : null}
            {Math.abs(preset.width / preset.height - project.canvas.width / project.canvas.height) > 0.01 ? (
              <div className="warn-card" style={{ marginTop: 10 }}>
                This preset&apos;s aspect ratio differs from the composition ({project.canvas.width}×{project.canvas.height}). The
                picture is letterboxed with bars, not stretched. Pick Custom at the composition size to fill the frame.
              </div>
            ) : null}
          </Panel>
        </div>
      </div>

      <Dialog
        open={storageBlock !== null}
        onClose={() => setStorageBlock(null)}
        title="Not enough storage for this export"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStorageBlock(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setStorageBlock(null);
                void runExport(false, true);
              }}
            >
              Export anyway
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.6 }}>
          {storageBlock?.message} The estimate is {formatBytes(storageBlock?.estimatedBytes ?? 0)}. Exporting anyway may
          fail part-way; a partial file is deleted when that happens.
        </p>
      </Dialog>

      <Dialog
        open={confirmOverwrite}
        onClose={() => setConfirmOverwrite(false)}
        title="A file with this name already exists"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOverwrite(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmOverwrite(false);
                void runExport(true);
              }}
            >
              Overwrite that export
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.6 }}>
          Exports are timestamped to the second. Re-exporting within the same second would replace the earlier file.
          Originals are never at risk. Choose a different moment or confirm the overwrite.
        </p>
      </Dialog>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div style={{ flex: 1 }}>
      <Field label={label}>
        <input
          className="input"
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
      </Field>
    </div>
  );
}
