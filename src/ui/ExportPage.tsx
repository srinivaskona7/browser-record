import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import { downloadBlob, ensureAssetFile, serializeProject } from '../app/actions';
import { importMediaIntoSession, prepareSession, saveSessionToFolder } from '../app/bootstrap';
import { Badge, Button, Dialog, EmptyState, Field, Panel, Select, Stat, Toggle } from './components';
import { toSrt, toVtt } from '../captions/subtitles';
import { encodeWav, mixdownTimeline } from '../audio/mixdown';
import { decodeAudioForExport } from '../audio/prepare';
import { PlanningPanel } from './PlanningPanel';
import {
  PRESETS,
  applyCompactBitrateBudget,
  defaultPresetId,
  formatBytes,
  planBitrate,
  planQualitySamples,
  presetById,
  type ExportPreset as Preset,
  type PresetId,
} from '../export/presets';
import {
  ExportCancelled,
  describeExport,
  exportProject,
  verifyDecodedVideoBlob,
  type ExportProgress,
  type ExportResult,
} from '../export/exporter';
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
  const [outputFps, setOutputFps] = useState<number>(() =>
    project ? Math.round(project.canvas.fps.num / project.canvas.fps.den) : 30,
  );
  const [videoMbps, setVideoMbps] = useState(10);
  const [audioKbps, setAudioKbps] = useState(128);
  const [targetGb, setTargetGb] = useState('');
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [turboMode, setTurboMode] = useState(true);
  const [compactSizeMode, setCompactSizeMode] = useState(true);
  const [sidecarFormat, setSidecarFormat] = useState<'none' | 'srt' | 'vtt' | 'both'>('none');
  const [wavExportBusy, setWavExportBusy] = useState(false);
  const [resultPreviewUrl, setResultPreviewUrl] = useState<string | null>(null);
  const [playbackVerified, setPlaybackVerified] = useState<boolean | null>(null);
  const [verificationReason, setVerificationReason] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null);
  const [exportSection, setExportSection] = useState<'video' | 'downloads' | 'planning'>('video');
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
      ? {
          ...base,
          id: CUSTOM_ID,
          label: 'Custom',
          width,
          height,
          fps: outputFps,
          videoBitrate: Math.round(videoMbps * 1_000_000),
          audioBitrate: Math.round(audioKbps * 1000),
        }
      : { ...base, fps: outputFps };
  }, [presetId, width, height, outputFps, videoMbps, audioKbps]);

  const segments = useMemo(() => (project ? markerSegments(project) : []), [project]);
  const activeSegment = useMemo(
    () => (segmentId === 'all' ? null : segments.find((s) => s.id === segmentId) ?? null),
    [segmentId, segments],
  );
  const exportTargetProject = useMemo(() => {
    if (!project) return null;
    if (!activeSegment) {
      if (preset.width < preset.height && project.canvas.width >= project.canvas.height) {
        return extractSegmentProject(project, 0, project.durationTicks, {
          reframeVertical: true,
          targetWidth: preset.width,
          targetHeight: preset.height,
        });
      }
      return project;
    }
    return extractSegmentProject(project, activeSegment.startTicks, activeSegment.endTicks, {
      reframeVertical: preset.width < preset.height,
      targetWidth: preset.width,
      targetHeight: preset.height,
    });
  }, [project, activeSegment, preset.width, preset.height]);

  const durationSeconds = exportTargetProject ? exportTargetProject.durationTicks / TICKS_PER_SECOND : 0;
  // Custom target file size only applies when Custom preset is active; never leaks into standard presets.
  const useCustomTargetSize = presetId === CUSTOM_ID && Boolean(targetGb && Number(targetGb) > 0);
  const compactRates = useMemo(
    () => applyCompactBitrateBudget(preset.videoBitrate, preset.audioBitrate, compactSizeMode && !useCustomTargetSize),
    [preset.videoBitrate, preset.audioBitrate, compactSizeMode, useCustomTargetSize],
  );
  const budget = useMemo(() => {
    if (!exportTargetProject) return null;
    return planBitrate({
      durationSeconds,
      width: preset.width,
      height: preset.height,
      fps: outputFps,
      audioBitrate: compactRates.audioBitrate,
      maxDurationSeconds: preset.maxDurationSeconds,
      maxBytes: preset.maxBytes,
      compactSizeMode,
      ...(useCustomTargetSize
        ? { targetBytes: Number(targetGb) * 1_000_000_000 }
        : { videoBitrate: compactRates.videoBitrate }),
    });
  }, [exportTargetProject, preset, durationSeconds, outputFps, useCustomTargetSize, targetGb, compactRates, compactSizeMode]);

  const effectiveVideoBitrate = useCustomTargetSize
    ? Math.round((budget?.videoMbps ?? 0) * 1_000_000)
    : compactRates.videoBitrate;

  const resolvedOutput = useMemo(
    () => ({
      width: preset.width,
      height: preset.height,
      fps: outputFps,
      container: preset.container,
      videoBitrate: effectiveVideoBitrate,
      audioBitrate: compactRates.audioBitrate,
      sampleRate: project?.settings.sampleRate ?? 48_000,
    }),
    [preset.width, preset.height, outputFps, preset.container, effectiveVideoBitrate, compactRates.audioBitrate, project?.settings.sampleRate],
  );

  useEffect(() => {
    if (!project) return;
    // A project loaded after this page mounted must not inherit the previous
    // project's preset. Restart from this composition's own size.
    const target = defaultPresetId(project.canvas);
    setPresetId(target);
    const defaultFps = presetById(target)?.fps ?? Math.round(project.canvas.fps.num / project.canvas.fps.den);
    setOutputFps(defaultFps);
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
      if (next.fps) {
        setOutputFps(next.fps);
      } else {
        setOutputFps(Math.round(project.canvas.fps.num / project.canvas.fps.den));
      }
    }
  }, [presetId, project]);

  const probeCodecs = async () => {
    if (!project) return;
    setSupportBusy(true);
    try {
      const list: CodecSupport[] = [];
      for (const codec of VIDEO_CODECS) {
        list.push(
          await probeVideoEncoder(
            codec,
            resolvedOutput.width,
            resolvedOutput.height,
            resolvedOutput.fps,
            resolvedOutput.videoBitrate,
          ),
        );
      }
      for (const codec of AUDIO_CODECS) {
        list.push(
          await probeAudioEncoder(codec, resolvedOutput.sampleRate, 2, resolvedOutput.audioBitrate),
        );
      }
      setSupport(list);
      session.setCodecSupport(list);
    } finally {
      setSupportBusy(false);
    }
  };

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setSupportBusy(true);
    void (async () => {
      const list: CodecSupport[] = [];
      for (const codec of VIDEO_CODECS) {
        list.push(
          await probeVideoEncoder(
            codec,
            resolvedOutput.width,
            resolvedOutput.height,
            resolvedOutput.fps,
            resolvedOutput.videoBitrate,
          ),
        );
      }
      for (const codec of AUDIO_CODECS) {
        list.push(
          await probeAudioEncoder(codec, resolvedOutput.sampleRate, 2, resolvedOutput.audioBitrate),
        );
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
  }, [
    project?.id,
    resolvedOutput.width,
    resolvedOutput.height,
    resolvedOutput.fps,
    resolvedOutput.videoBitrate,
    resolvedOutput.audioBitrate,
    resolvedOutput.sampleRate,
  ]);

  useEffect(() => {
    if (!exportTargetProject) return;
    let cancelled = false;
    const isReframedOrSegment =
      Boolean(activeSegment) ||
      resolvedOutput.width < resolvedOutput.height ||
      Math.abs(resolvedOutput.width / resolvedOutput.height - exportTargetProject.canvas.width / exportTargetProject.canvas.height) > 0.01;
    if (!isReframedOrSegment) {
      setCropPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const previewW = resolvedOutput.width < resolvedOutput.height ? 360 : 640;
    const previewH = Math.round((previewW * resolvedOutput.height) / resolvedOutput.width);
    void snapshotThumbnail(exportTargetProject, null, 0, includeCaptions, previewW, previewH)
      .then((blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        setCropPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [exportTargetProject, activeSegment, resolvedOutput.width, resolvedOutput.height, includeCaptions]);

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
    return `${WORKSPACE_LAYOUT.exports}/${base}-${resolvedOutput.width}x${resolvedOutput.height}-${resolvedOutput.fps}fps-${stamp}.${resolvedOutput.container}`;
  })();

  const runExport = async (overwrite = false, ignoreStorage = false) => {
    if (!session.workspace) {
      setError('No storage is ready yet. Open Export again after a session has been created.');
      return;
    }
    setError(null);
    setResult(null);
    setVerificationReason(null);
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
        videoBitrate: resolvedOutput.videoBitrate,
        audioBitrate: resolvedOutput.audioBitrate,
        width: resolvedOutput.width,
        height: resolvedOutput.height,
        fps: resolvedOutput.fps,
        destination: { root: session.workspace.root, path: destinationPath },
        getAssetFile: (path) => ensureAssetFile(path),
        signal: controller.signal,
        includeCaptions,
        turboMode,
        compactSizeMode,
        onProgress: setProgress,
      });
      setPlaybackVerified(null);
      setVerifying(true);
      const activeProj = exportTargetProject ?? project;
      const slug = activeProj.name.replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lesson';
      if (sidecarFormat === 'srt' || sidecarFormat === 'both') {
        downloadBlob(new Blob([toSrt(activeProj.captions)], { type: 'application/x-subrip' }), `${slug}.srt`);
      }
      if (sidecarFormat === 'vtt' || sidecarFormat === 'both') {
        downloadBlob(new Blob([toVtt(activeProj.captions)], { type: 'text/vtt' }), `${slug}.vtt`);
      }
      if (out.buffer) {
        const blob = new Blob([out.buffer], { type: out.container === 'mp4' ? 'video/mp4' : 'video/webm' });
        const url = URL.createObjectURL(blob);
        setResultPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        const check = await verifyDecodedVideoBlob(blob);
        setPlaybackVerified(check.verified);
        setVerificationReason(check.reason ?? null);
      } else if (out.path && session.workspace) {
        try {
          const file = await readBlob(session.workspace.root, out.path);
          const url = URL.createObjectURL(file);
          setResultPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          const check = await verifyDecodedVideoBlob(file);
          setPlaybackVerified(check.verified);
          setVerificationReason(check.reason ?? null);
        } catch (verifyErr) {
          setPlaybackVerified(false);
          setVerificationReason((verifyErr as Error).message);
        }
      }
      setVerifying(false);
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
      setVerifying(false);
      setCancelRef(null);
      setProgress(null);
      setConfirmOverwrite(false);
    }
  };

  const runSample = async () => {
    setSampleBusy(true);
    setError(null);
    try {
      const targetProj = exportTargetProject ?? project;
      const plan = planQualitySamples(targetProj, 6);
      const sample = cloneProjectWithRange(targetProj, plan.busy.startTicks, plan.busy.durationTicks);
      if (sample.durationTicks === 0) throw new Error('Nothing to sample in this range.');
      const out = await exportProject({
        project: sample,
        preset,
        videoBitrate: resolvedOutput.videoBitrate,
        audioBitrate: resolvedOutput.audioBitrate,
        width: resolvedOutput.width,
        height: resolvedOutput.height,
        fps: resolvedOutput.fps,
        getAssetFile: (path) => ensureAssetFile(path),
        includeCaptions,
        turboMode,
        compactSizeMode,
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
        width: resolvedOutput.width,
        height: resolvedOutput.height,
        fps: resolvedOutput.fps,
        frames: 45,
        codec,
        bitrate: resolvedOutput.videoBitrate,
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
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="row" role="tablist" aria-label="Export sections" style={{ gap: 6 }}>
            <Button
              size="sm"
              variant={exportSection === 'video' ? 'primary' : 'ghost'}
              aria-pressed={exportSection === 'video'}
              onClick={() => setExportSection('video')}
            >
              Video export
            </Button>
            <Button
              size="sm"
              variant={exportSection === 'downloads' ? 'primary' : 'ghost'}
              aria-pressed={exportSection === 'downloads'}
              onClick={() => setExportSection('downloads')}
            >
              Standalone downloads
            </Button>
            <Button
              size="sm"
              variant={exportSection === 'planning' ? 'primary' : 'ghost'}
              aria-pressed={exportSection === 'planning'}
              onClick={() => setExportSection('planning')}
            >
              Planning &amp; Share
            </Button>
          </div>
          <Badge>{project.name}</Badge>
        </div>
      </header>

      {exportSection === 'planning' && <PlanningPanel project={project} />}
      {exportSection === 'downloads' && (
        <Panel
          title="Standalone downloads"
          subtitle="Download cover PNG frames, 16-bit PCM WAV audio mixdown, editable SRT/VTT subtitles, or project settings & edits (.json) without encoding video."
        >
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const blob = await snapshotThumbnail(
                    exportTargetProject ?? project,
                    null,
                    project.coverTimeTicks ?? useEditor.getState().playheadTicks,
                    includeCaptions,
                  );
                  if (blob) {
                    downloadBlob(blob, `${project.name.replace(/[^\w-]+/g, '-') || 'thumbnail'}-1280x720.png`);
                  }
                }}
              >
                Download PNG cover (1280×720)
              </Button>
              <Button
                size="sm"
                disabled={wavExportBusy}
                onClick={async () => {
                  setWavExportBusy(true);
                  try {
                    const target = exportTargetProject ?? project;
                    const decoded = await decodeAudioForExport(target, (path) => ensureAssetFile(path));
                    const mix = await mixdownTimeline({
                      project: target,
                      decoded,
                      sampleRate: target.settings.sampleRate || 48_000,
                    });
                    const wavBytes = encodeWav(mix.channels, mix.sampleRate);
                    const copy = new Uint8Array(wavBytes.byteLength);
                    copy.set(wavBytes);
                    downloadBlob(
                      new Blob([copy.buffer], { type: 'audio/wav' }),
                      `${project.name.replace(/[^\w-]+/g, '-') || 'lesson'}-audio.wav`,
                    );
                    session.pushToast('Exported WAV audio mixdown.', 'success');
                  } catch (err) {
                    setError(`WAV export failed: ${(err as Error).message}`);
                  } finally {
                    setWavExportBusy(false);
                  }
                }}
              >
                {wavExportBusy ? 'Exporting WAV…' : 'Download WAV audio'}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const slug = project.name.replace(/[^\w-]+/g, '-') || 'lesson';
                  downloadBlob(
                    new Blob([toSrt((exportTargetProject ?? project).captions)], { type: 'application/x-subrip' }),
                    `${slug}.srt`,
                  );
                }}
              >
                Download .SRT
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const slug = project.name.replace(/[^\w-]+/g, '-') || 'lesson';
                  downloadBlob(
                    new Blob([toVtt((exportTargetProject ?? project).captions)], { type: 'text/vtt' }),
                    `${slug}.vtt`,
                  );
                }}
              >
                Download .VTT
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const slug = project.name.replace(/[^\w-]+/g, '-') || 'lesson';
                  downloadBlob(
                    new Blob([serializeProject(project)], { type: 'application/json' }),
                    `${slug}-settings-and-edits.json`,
                  );
                }}
              >
                Project settings and edits (.json)
              </Button>
            </div>
            <div className="field-hint">
              <strong>Note on .json files:</strong> <code>Project settings and edits (.json)</code> saves your timeline
              cuts, tracks, keyframes, color grade, captions, and storyboard metadata. Raw recorded takes (
              <code>recordings/&lt;take&gt;/</code>) and imported media (<code>media/originals/</code>) must be retained
              in your workspace folder (or downloaded via <em>Download raw</em> in the Recordings Library) when moving
              between machines.
            </div>
          </div>
        </Panel>
      )}

      {exportSection === 'video' && (
      <div className="split-grid">
        <div className="stack" style={{ gap: 14 }}>
          <Panel title="Delivery preset" bodyClassName="stack">
            <div className="stack" style={{ gap: 6 }} role="group" aria-label="Recommended delivery presets">
              {(['youtube-1080p30', '4k-balanced', 'shorts-vertical'] as const)
                .map((id) => PRESETS.find((p) => p.id === id))
                .filter((item): item is NonNullable<typeof item> => Boolean(item))
                .map((item) => (
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
                        {item.width}×{item.height}
                        {item.fps ? ` · ${item.fps} fps` : ''} · {Number((item.videoBitrate / 1e6).toFixed(1))} Mbps
                      </span>
                    </div>
                    <div className="field-hint" style={{ marginTop: 4 }}>
                      {item.description}
                    </div>
                  </button>
                ))}
            </div>

            <div className="grid-2" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <Field label="Timeline range (Full lesson / Chapter)" hint="Export the full lesson or a marker chapter.">
                <Select
                  aria-label="Timeline export range"
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
              <Field label="Burned-in captions" hint="Render subtitle cues directly into the video frames.">
                <Toggle label="Include captions in the picture" checked={includeCaptions} onChange={setIncludeCaptions} />
              </Field>
              <Field
                label="Export speed (4× Turbo Pipeline)"
                hint="Uses single-pass sequential packet decoding, GPU hardware encoder acceleration, and 4-frame async pipelining."
              >
                <Toggle
                  label="⚡ 4× Faster Turbo Export (Hardware Accelerated)"
                  checked={turboMode}
                  onChange={setTurboMode}
                />
              </Field>
              <Field
                label="File size (4× Smaller Ultra-Compact VBR)"
                hint="Uses HEVC/AV1/H.264 High VBR, 8s long-GOP keyframe spacing, and screen-detail hints for 4× smaller files."
              >
                <Toggle
                  label="📦 4× Smaller File Size (Ultra-Compact VBR)"
                  checked={compactSizeMode}
                  onChange={setCompactSizeMode}
                />
              </Field>
            </div>

            <details className="record-details">
              <summary>
                More presets &amp; advanced settings
                <span>1080p60, 4K Ultra-Compact, Custom FPS/bitrate, sidecar captions &amp; budget</span>
              </summary>
              <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
                <div className="stack" style={{ gap: 6 }} role="group" aria-label="Additional delivery presets">
                  {PRESETS.filter(
                    (item) => !(['youtube-1080p30', '4k-balanced', 'shorts-vertical'] as readonly string[]).includes(item.id),
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="panel"
                      style={{
                        textAlign: 'left',
                        padding: 10,
                        cursor: 'pointer',
                        borderColor: presetId === item.id ? 'var(--accent)' : 'var(--line)',
                      }}
                      onClick={() => setPresetId(item.id)}
                    >
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong style={{ fontSize: 12.5 }}>{item.label}</strong>
                        <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                          {item.width}×{item.height}
                          {item.fps ? ` · ${item.fps} fps` : ''} · {Number((item.videoBitrate / 1e6).toFixed(1))} Mbps
                        </span>
                      </div>
                      <div className="field-hint" style={{ marginTop: 3 }}>
                        {item.description}
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="panel"
                    style={{
                      textAlign: 'left',
                      padding: 10,
                      cursor: 'pointer',
                      borderColor: presetId === CUSTOM_ID ? 'var(--accent)' : 'var(--line)',
                    }}
                    onClick={() => setPresetId(CUSTOM_ID)}
                  >
                    <strong style={{ fontSize: 12.5 }}>Custom</strong>
                    <div className="field-hint" style={{ marginTop: 3 }}>
                      Set size, frame rate, bitrate or a target file size. The budget calculator explains what that actually buys.
                    </div>
                  </button>
                </div>

                <Field label="Output frame rate (FPS)" hint="Applied to codec probing, 6s test encode, and final file.">
                  <Select
                    aria-label="Output frame rate"
                    value={String(outputFps)}
                    onChange={(v) => setOutputFps(Number(v))}
                    options={[
                      { value: '24', label: '24 fps · Cinematic' },
                      { value: '30', label: '30 fps · Standard' },
                      { value: '60', label: '60 fps · Smooth terminal & UI motion' },
                    ]}
                  />
                </Field>

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

                <Field
                  label="Subtitle sidecar file (independent of burned-in captions)"
                  hint="Choose whether to also download an editable .SRT or .VTT sidecar alongside the video."
                >
                  <Select
                    aria-label="Subtitle sidecar format"
                    value={sidecarFormat}
                    onChange={(v) => setSidecarFormat(v)}
                    options={[
                      { value: 'none', label: 'No sidecar file' },
                      { value: 'srt', label: 'Download .SRT sidecar' },
                      { value: 'vtt', label: 'Download .VTT sidecar' },
                      { value: 'both', label: 'Download both .SRT and .VTT' },
                    ]}
                  />
                </Field>

                {budget ? (
                  <div className="hint-card stack" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                      <Stat label="Duration" value={`${durationSeconds.toFixed(1)}s`} />
                      <Stat label="Frame rate" value={`${resolvedOutput.fps} fps`} />
                      <Stat label="Video" value={`${Number(budget.videoMbps.toFixed(2))} Mbps`} />
                      <Stat label="Audio" value={`${Number(budget.audioMbps.toFixed(2))} Mbps`} />
                      <Stat label="Estimated size" value={`~${formatBytes(budget.estimatedBytes)}`} hint="VBR estimate" />
                      <Stat label="Bits/pixel" value={budget.bitsPerPixel.toFixed(3)} />
                    </div>
                    <div className="field-hint mono">
                      {budget.totalMbps.toFixed(2)} Mbps × {durationSeconds.toFixed(0)}s ÷ 8 ÷ 1000 ≈ {formatBytes(budget.estimatedBytes)} (estimated size)
                    </div>
                    {budget.warnings.map((warning, index) => (
                      <div key={index} className="warn-card">
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </details>
          </Panel>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <Panel title="Export" bodyClassName="stack">
            <div
              className="hint-card mono"
              style={{ fontSize: 12.5, fontWeight: 600 }}
              data-testid="export-output-summary"
            >
              {resolvedOutput.height}p ({resolvedOutput.width}×{resolvedOutput.height}) · {resolvedOutput.fps} fps ·{' '}
              {Number((resolvedOutput.videoBitrate / 1e6).toFixed(2))} Mbps · {resolvedOutput.container.toUpperCase()} ·{' '}
              {formatDuration(durationSeconds)} · Estimated size: ~{formatBytes(budget?.estimatedBytes ?? 0)}
              {activeSegment ? ` · Chapter: ${activeSegment.label}` : ' · Full timeline'}
              {resolvedOutput.width < resolvedOutput.height ? ' · Vertical 9:16' : ' · Landscape'}
              {turboMode ? ' · ⚡ 4× Faster' : ''}
              {compactSizeMode ? ' · 📦 4× Smaller' : ''}
            </div>
            <div className="field-hint mono" style={{ wordBreak: 'break-all' }}>
              {destinationPath}
            </div>
            {cropPreviewUrl && (
              <div className="stack" style={{ gap: 4 }}>
                <span className="field-hint">
                  Intended delivery framing preview ({resolvedOutput.width}×{resolvedOutput.height}
                  {activeSegment ? ` · ${activeSegment.label}` : ''}):
                </span>
                <img
                  src={cropPreviewUrl}
                  alt="Intended export framing preview"
                  style={{
                    width: '100%',
                    maxHeight: 220,
                    objectFit: 'contain',
                    background: '#111018',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                  }}
                />
              </div>
            )}
            {(progress || verifying) ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
                  <Badge tone={progress?.phase === 'prepare' || progress?.phase === 'audio' ? 'ok' : 'default'}>
                    1 · Preparing
                  </Badge>
                  <Badge tone={progress?.phase === 'video' ? 'ok' : 'default'}>2 · Encoding</Badge>
                  <Badge tone={progress?.phase === 'finalize' ? 'ok' : 'default'}>3 · Saving</Badge>
                  <Badge tone={verifying ? 'ok' : 'default'}>4 · Verifying</Badge>
                </div>
                {progress && (
                  <>
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
                        {progress.fps.toFixed(1)} fps · {formatSpeed(progress.fps, { num: resolvedOutput.fps, den: 1 })}
                      </span>
                      <span className="mono">{formatBytes(progress.bytesWritten)}</span>
                      <span className="mono">{progress.etaSeconds > 0 ? `${formatDuration(progress.etaSeconds)} left` : 'finishing'}</span>
                    </div>
                    {progress.detail && <div className="field-hint">{progress.detail}</div>}
                    <Button variant="danger" onClick={cancel}>
                      Cancel export
                    </Button>
                  </>
                )}
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
                  <Button size="sm" variant="ghost" disabled title="Add a clip first to encode a 6-second test sample">
                    Test 6 seconds
                  </Button>
                </div>
                <input
                  ref={timelineImport}
                  type="file"
                  accept="video/*,audio/*,image/*"
                  multiple
                  hidden
                  onChange={async (event) => {
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
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  onClick={() => void runExport()}
                  disabled={!session.workspace}
                >
                  Export video ({resolvedOutput.width}×{resolvedOutput.height} · {resolvedOutput.fps} fps)
                </Button>
                <Button
                  size="sm"
                  onClick={() => void runSample()}
                  disabled={sampleBusy}
                  title="Encode a 6-second sample at the selected resolution and bitrate to inspect terminal text sharpness"
                >
                  {sampleBusy ? 'Encoding 6s test…' : 'Test 6 seconds'}
                </Button>
              </div>
            )}
            {sampleUrl && (
              <div className="stack" style={{ gap: 8 }}>
                <video src={sampleUrl} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="field-hint mono" style={{ whiteSpace: 'pre-line' }}>
                    {sampleInfo}
                  </span>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={sampleUrl}
                    download={`sample-${resolvedOutput.width}x${resolvedOutput.height}-${resolvedOutput.fps}fps.${resolvedOutput.container}`}
                  >
                    Download sample
                  </a>
                </div>
              </div>
            )}
            {session.workspace?.info.mode === 'opfs' && (
              <div className="warn-card">
                This export is written into <strong>browser storage</strong>, which the browser can evict.{' '}
                <Button size="sm" variant="ghost" onClick={() => void saveSessionToFolder()}>
                  Save the project and media to a folder…
                </Button>{' '}
                or use “Download video” after exporting.
              </div>
            )}
            {error && <div className="danger-card">{error}</div>}
            {result && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <Badge tone="ok">exported</Badge>
                  {playbackVerified === true && <Badge tone="ok">Playback verified</Badge>}
                  {playbackVerified === false && <Badge tone="warn">Saved · unverified</Badge>}
                  <span className="field-hint mono" style={{ whiteSpace: 'pre-line' }}>
                    {describeExport(result)}
                  </span>
                </div>
                {playbackVerified === false && verificationReason && (
                  <div className="warn-card">
                    Playback verification note: {verificationReason} The exported file is saved and downloadable below.
                  </div>
                )}
                {resultPreviewUrl && (
                  <video
                    src={resultPreviewUrl}
                    controls
                    playsInline
                    aria-label="Exported video result preview"
                    style={{ width: '100%', maxHeight: 280, background: '#111018', borderRadius: 8 }}
                  />
                )}
                <div className="field-hint">{result.path}</div>
                {result.warnings.map((warning, index) => (
                  <div key={index} className="warn-card">
                    {warning}
                  </div>
                ))}
                <div className="row" style={{ gap: 8 }}>
                  <Button size="sm" variant="primary" onClick={() => void downloadResult(result)}>
                    Download video
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </Panel>

          <details className="record-details">
            <summary>
              Encoder diagnostics<span>Codec support, benchmark &amp; capture comparison</span>
            </summary>
            <div className="stack" style={{ gap: 12, marginTop: 8 }}>
              <Panel
                title="Encoder support"
                action={
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="ghost" onClick={() => void probeCodecs()} disabled={supportBusy}>
                      {supportBusy ? 'Probing…' : 'Re-probe codecs'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void runBenchmark()} disabled={benchmarkBusy}>
                      {benchmarkBusy ? 'Benchmarking…' : 'Run encoder benchmark'}
                    </Button>
                  </div>
                }
              >
                {benchmark && (
                  <div className="stack" style={{ gap: 4, marginBottom: 10 }}>
                    <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                      <Badge tone={benchmark.sustainedFps >= 30 ? 'ok' : 'warn'}>
                        {benchmark.sustainedFps.toFixed(1)} fps sustained
                      </Badge>
                      <span className="field-hint mono">
                        {benchmark.encodedFrames} encoded / {benchmark.decodedFrames} decoded ·{' '}
                        {benchmark.elapsedMs.toFixed(0)} ms · {benchmark.avgEncodeMs.toFixed(1)} ms/frame · round trip{' '}
                        {benchmark.decoderRoundTrip ? 'ok' : 'failed'}
                      </span>
                    </div>
                    {benchmark.reason && <div className="warn-card">{benchmark.reason}</div>}
                  </div>
                )}
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
                  Support is probed at {resolvedOutput.width}×{resolvedOutput.height} · {resolvedOutput.fps} fps ·{' '}
                  {(resolvedOutput.videoBitrate / 1e6).toFixed(1)} Mbps video and{' '}
                  {Math.round(resolvedOutput.audioBitrate / 1000)} kbps audio. When H.264 is missing the export falls
                  back to VP9/WebM and says so.
                </div>
              </Panel>

              <Panel title="Capture vs delivery">
                <table className="table">
                  <tbody>
                    <tr>
                      <td>Capture</td>
                      <td className="mono">
                        {project.canvas.width}×{project.canvas.height} · {project.canvas.fps.num}/{project.canvas.fps.den}{' '}
                        fps
                      </td>
                    </tr>
                    <tr>
                      <td>Delivery</td>
                      <td className="mono">
                        {resolvedOutput.width}×{resolvedOutput.height} · {resolvedOutput.fps} fps ·{' '}
                        {resolvedOutput.videoBitrate / 1e6} Mbps video
                      </td>
                    </tr>
                    <tr>
                      <td>Originals</td>
                      <td>
                        Untouched in <span className="mono">media/originals/</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {resolvedOutput.width > project.canvas.width || resolvedOutput.height > project.canvas.height ? (
                  <div className="warn-card" style={{ marginTop: 10 }}>
                    This delivery size is larger than the composition. It upscales; it cannot add detail.
                  </div>
                ) : null}
                {Math.abs(
                  resolvedOutput.width / resolvedOutput.height - project.canvas.width / project.canvas.height,
                ) > 0.01 ? (
                  <div className="warn-card" style={{ marginTop: 10 }}>
                    This preset&apos;s aspect ratio differs from the composition ({project.canvas.width}×
                    {project.canvas.height}).
                  </div>
                ) : null}
              </Panel>
            </div>
          </details>
        </div>
      </div>
      )}

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
