import { useEffect, useMemo, useRef, useState } from 'react';
import { ImportMediaButton } from './ImportMediaButton';
import { RecordingActions } from './RecordingActions';
import { SvgIcon, type IconName } from './icons';
import { useSession } from '../app/session';
import { useEditor } from '../project/store';
import { Badge, Button, Dialog, Field, Panel, Select, Slider, Stat, Toggle } from './components';
import {
  compareSettings,
  enumerateDevices,
  onDeviceChange,
  openCamera,
  openMicrophone,
  stopStream,
  type DeviceChoice,
} from '../capture/devices';
import { InputMeter, meterPosition, type MeterReading } from '../capture/audioMeter';
import { chooseRecorderMime } from '../capabilities/codecs';
import {
  displayConstraints,
  describeCaptureFidelity,
  describeReturnedSurface,
  reportTrackSettings,
  reportedSurface,
} from '../capabilities/detect';
import { CaptureSession, recoverInterruptedTake, type CaptureStats, type CaptureAssetSpec, type TakeResult } from '../capture/recorder';
import { checkStorageHeadroom, cleanRecordingsFolder, deleteTake, listTakes } from '../workspace/workspace';
import { WORKSPACE_LAYOUT } from '../workspace/types';
import { chooseFolderWorkspace, ensureDraftProject, saveSessionToFolder } from '../app/bootstrap';
import { downloadBlob, ensureAssetFile } from '../app/actions';
import {
  captureDimensions,
  frameRateForCanvas,
  recordingBitrate,
  resolutionForCanvas,
  type CaptureResolution,
} from '../capture/quality';
import { newId } from '../core/ids';
import { takeIdsOf } from '../workspace/takeRefs';
import type { TakeSummary } from '../workspace/types';
import * as ops from '../project/ops';
import { nextFreeStart } from '../project/ops';
import { createTrack, defaultPresenter } from '../project/factory';
import { formatBytes } from '../export/presets';
import { TICKS_PER_SECOND } from '../core/time';
import { clamp, presenterBubble } from '../render/layout';
import {
  detectFloatingCameraSupport,
  openFloatingCamera,
  type FloatingCameraSession,
} from '../capture/floatingCamera';
import type { PresenterProps, Project } from '../project/types';

type Stage = 'idle' | 'selecting' | 'ready' | 'countdown' | 'recording' | 'paused' | 'finishing';

interface PreparedSourceSummary {
  sourceName: string;
  surfaceType: string;
  dimensions: string;
  cameraStatus: string;
  micStatus: string;
  systemAudioStatus: string;
}

export function RecordPage({ hidden = false }: { hidden?: boolean } = {}) {
  const project = useEditor((state) => state.project);
  const session = useSession();
  const [openEditorAfterStop, setOpenEditorAfterStop] = useState(true);
  const [showMonitor, setShowMonitor] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [hideFloatingPreview, setHideFloatingPreview] = useState(false);
  const [hideMonitorDuringDisplay, setHideMonitorDuringDisplay] = useState(true);
  const stoppingRef = useRef(false);
  const [stage, setStage] = useState<Stage>('idle');
  const preparedSpecsRef = useRef<CaptureAssetSpec[] | null>(null);
  const [preparedSummary, setPreparedSummary] = useState<PreparedSourceSummary | null>(null);
  const floatingCameraRef = useRef<FloatingCameraSession | null>(null);
  const [floatingCameraOpen, setFloatingCameraOpen] = useState(false);
  const floatingSupport = useMemo(() => detectFloatingCameraSupport(), []);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenOn, setScreenOn] = useState(true);
  const [systemAudio, setSystemAudio] = useState(false);
  const [surface, setSurface] = useState<'screen' | 'window' | 'tab'>('screen');
  const [presenter, setPresenter] = useState<PresenterProps>(() => defaultPresenter());
  // Start from the project's own canvas. A fresh project is 1080p/30 until the
  // machine has been measured; nothing claims 4K before a track is opened.
  const [resolution, setResolution] = useState<CaptureResolution>(() =>
    project ? resolutionForCanvas(project.canvas) : '1080',
  );
  const [fps, setFps] = useState<'30' | '60'>(() =>
    project && frameRateForCanvas(project.canvas) === 60 ? '60' : '30',
  );
  const [preparing, setPreparing] = useState(!project);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [downloadingOriginals, setDownloadingOriginals] = useState(false);
  /** Guards a double click on Start before the async setup reaches the picker. */
  const startingRef = useRef(false);
  const initialisedFor = useRef<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [countdown, setCountdown] = useState(0);
  const [devices, setDevices] = useState<{ mic: DeviceChoice[]; camera: DeviceChoice[] }>({ mic: [], camera: [] });
  const [micId, setMicId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [micLevel, setMicLevel] = useState<MeterReading | null>(null);
  const [micTesting, setMicTesting] = useState(false);
  const [settingsReport, setSettingsReport] = useState<Array<{ label: string; message: string; native: boolean; scaled: boolean }>>([]);
  const [stats, setStats] = useState<CaptureStats | null>(null);
  // Warnings are a list: a surface mismatch, a missing system-audio track and a
  // recorder warning can all be true at once, and one slot made the last win.
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [takeResult, setTakeResult] = useState<TakeResult | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [takes, setTakes] = useState<TakeSummary[]>([]);
  const [recoveryReport, setRecoveryReport] = useState<string | null>(null);
  const [cleanBusy, setCleanBusy] = useState(false);
  /** The live sentinel. Unmount needs the real one, not the value captured at mount. */
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  /**
   * Bumped whenever the current lock is released. A wake-lock request can
   * resolve after the take it belonged to has already stopped; without this the
   * late sentinel was adopted by the next take (or held until the page closed).
   */
  const wakeLockGen = useRef(0);
  /** False once the page unmounts, so async work cannot set state afterwards. */
  const mountedRef = useRef(true);

  const screenStream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  // Mirrors of the streams' tracks for rendering. Reading `screenStream.current`
  // while rendering the settings table means the table only refreshes when
  // something else happens to re-render the page.
  const [screenTracks, setScreenTracks] = useState<MediaStreamTrack[]>([]);
  const [cameraTracks, setCameraTracks] = useState<MediaStreamTrack[]>([]);
  const micStream = useRef<MediaStream | null>(null);
  /** Muted by the small control bar; the track is kept alive so resume is instant. */
  const [micMuted, setMicMuted] = useState(false);
  const micMeter = useRef<InputMeter | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  /** Floating self-view shown during a take, so the bubble stays on screen when the monitor scrolls away. */
  const selfViewRef = useRef<HTMLVideoElement>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const captureRef = useRef<CaptureSession | null>(null);
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const sessionStats = useRef<CaptureStats | null>(null);
  /** Camera stream owned by the live preview; handed to the take when recording starts. */
  const cameraPreviewStream = useRef<MediaStream | null>(null);
  const [cameraPreviewOn, setCameraPreviewOn] = useState(false);
  const previewStarting = useRef(false);
  /** Latest camera-source toggle, so an in-flight permission prompt can bail out. */
  const cameraOnRef = useRef(cameraOn);

  const addWarning = (message: string) => {
    if (!mountedRef.current) return;
    setWarnings((current) => (current.includes(message) ? current : [...current, message]));
  };

  const dimensions = captureDimensions(resolution);
  const frameRate = fps === '60' ? 60 : 30;

  // Opening Record without a project prepares a temporary local session. This
  // never asks for camera, microphone or screen permission: devices are only
  // opened by an explicit control below.
  useEffect(() => {
    if (hidden) return;
    if (project) {
      setPreparing(false);
      return;
    }
    let cancelled = false;
    setPreparing(true);
    setSetupError(null);
    void ensureDraftProject({ width: 1920, height: 1080, fps: { num: 30, den: 1 }, segmentSeconds: 10 })
      .then(() => {
        if (!cancelled) setPreparing(false);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setPreparing(false);
        setSetupError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [project, hidden]);

  // Follow the project's canvas once per project. Re-running on every canvas
  // change would overwrite a quality choice the user just made.
  useEffect(() => {
    if (!project || initialisedFor.current === project.id) return;
    initialisedFor.current = project.id;
    setResolution(resolutionForCanvas(project.canvas));
    setFps(frameRateForCanvas(project.canvas) === 60 ? '60' : '30');
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const onDeviceChangeListener = () => {
      void enumerateDevices().then((next) => {
        if (!cancelled) setDevices({ mic: next.microphones, camera: next.cameras });
      });
    };
    const off = onDeviceChange(onDeviceChangeListener);
    void (async () => {
      const list = await enumerateDevices();
      if (cancelled) return;
      setDevices({ mic: list.microphones, camera: list.cameras });
      if (list.microphones[0] && !micId) setMicId(list.microphones[0].deviceId);
      if (list.cameras[0] && !cameraId) setCameraId(list.cameras[0].deviceId);
    })();
    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshTakes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, session.workspace]);

  useEffect(() => {
    // Re-arm on every mount. StrictMode runs mount → cleanup → mount in
    // development; without this the ref stayed false after the first cleanup,
    // and every later start() aborted silently after acquiring the sources.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A take that is still open when the page unmounts must not keep writing:
      // mark it aborted so it is reported as recoverable, not as still recording.
      void captureRef.current?.discard().catch(() => undefined);
      captureRef.current = null;
      stopStream(cameraPreviewStream.current);
      releaseSources();
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (lock) void lock.release().catch(() => undefined);
    };
  }, []);

  /**
   * CaptureSession only publishes stats when a segment commits (every 5–30 s),
   * so a short take would show REC 00:00:00 the whole time and a long one
   * would jump in ten-second steps. Poll the already-public stats() instead.
   */
  useEffect(() => {
    if (stage !== 'recording' && stage !== 'paused') return;
    const timer = window.setInterval(() => {
      const next = captureRef.current?.stats();
      if (!next || !mountedRef.current) return;
      sessionStats.current = next;
      setStats(next);
    }, 250);
    return () => window.clearInterval(timer);
  }, [stage]);

  /**
   * Every take on disk, finished or interrupted. The finished ones are what
   * makes Exit reversible: a take kept without inserting can still be added
   * later, including after a reload.
   */
  const refreshTakes = async () => {
    if (!session.workspace || !session.projectFolder) return;
    try {
      setTakes(await listTakes(session.workspace.root, session.projectFolder));
    } catch (err) {
      setError(`Could not list the project's takes: ${(err as Error).message}`);
    }
  };

  /**
   * Drop every stream and preview the page owns. Used by every exit path so a
   * failed start cannot leave a dead mic track behind for the next attempt.
   */
  const releaseSources = () => {
    void floatingCameraRef.current?.close().catch(() => undefined);
    floatingCameraRef.current = null;
    setFloatingCameraOpen(false);
    preparedSpecsRef.current = null;
    setPreparedSummary(null);
    stopStream(screenStream.current);
    stopStream(cameraStream.current);
    stopStream(micStream.current);
    screenStream.current = null;
    cameraStream.current = null;
    micStream.current = null;
    setScreenTracks([]);
    setCameraTracks([]);
    setCameraReady(false);
    setMicTesting(false);
    setMicMuted(false);
    micMeter.current?.stop();
    micMeter.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
    if (selfViewRef.current) selfViewRef.current.srcObject = null;
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    wakeLockGen.current += 1;
    if (lock) void lock.release().catch(() => undefined);
  };

  const testMic = async () => {
    setError(null);
    try {
      stopStream(micStream.current);
      micMeter.current?.stop();
      const stream = await openMicrophone({
        ...(micId ? { deviceId: micId } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48_000,
        channelCount: 1,
      });
      micStream.current = stream;
      const meter = new InputMeter(stream);
      micMeter.current = meter;
      meter.start(setMicLevel);
      setMicTesting(true);
    } catch (err) {
      setError(`Microphone unavailable: ${(err as Error).message}`);
    }
  };

  /**
   * Live camera preview so the bubble shape, position and effects can be
   * judged before recording. Local only: nothing from this stream is written.
   */
  const startCameraPreview = async () => {
    if (cameraPreviewStream.current || previewStarting.current) return;
    previewStarting.current = true;
    setError(null);
    try {
      const stream = await openCamera(cameraId || undefined, dimensions.width, dimensions.height, frameRate);
      // The permission prompt can outlive the page or the camera source being
      // switched off; a stream nobody owns would keep the camera light on.
      if (!mountedRef.current || !cameraOnRef.current) {
        stopStream(stream);
        return;
      }
      cameraPreviewStream.current = stream;
      setCameraPreviewOn(true);
      const element = cameraPreviewRef.current;
      if (!element) {
        addWarning('The camera preview element is not mounted; the stream is live but not shown.');
        return;
      }
      element.srcObject = stream;
      if (selfViewRef.current) selfViewRef.current.srcObject = stream;
      try {
        // Ready only after the frame actually plays: a dead camera must not
        // render as a frozen "live" picture.
        await element.play();
        if (mountedRef.current) setCameraReady(true);
      } catch (err) {
        setCameraReady(false);
        addWarning(`Camera preview could not start playing: ${(err as Error).message}`);
      }
    } catch (err) {
      setError(`Camera preview unavailable: ${(err as Error).message}`);
    } finally {
      previewStarting.current = false;
    }
  };

  const stopCameraPreview = () => {
    if (!cameraStream.current) {
      void floatingCameraRef.current?.close().catch(() => undefined);
      floatingCameraRef.current = null;
      setFloatingCameraOpen(false);
    }
    stopStream(cameraPreviewStream.current);
    cameraPreviewStream.current = null;
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
    if (selfViewRef.current) selfViewRef.current.srcObject = null;
    setCameraPreviewOn(false);
    setCameraReady(false);
  };

  useEffect(() => {
    floatingCameraRef.current?.updatePresenter(presenter);
  }, [presenter]);

  const toggleFloatingCamera = async () => {
    setError(null);
    if (floatingCameraRef.current) {
      await floatingCameraRef.current.close();
      floatingCameraRef.current = null;
      setFloatingCameraOpen(false);
      return;
    }
    if (!cameraOn) {
      setError('Turn Camera on first to open the floating camera bubble.');
      return;
    }
    try {
      let stream = cameraStream.current ?? cameraPreviewStream.current;
      if (!stream) {
        await startCameraPreview();
        stream = cameraPreviewStream.current;
      }
      if (!stream) {
        setError('Camera stream is not available.');
        return;
      }
      const pipSession = await openFloatingCamera({
        stream,
        videoElement: selfViewRef.current ?? cameraPreviewRef.current,
        presenter,
        initialControlState: {
          stage,
          elapsedText: formatElapsed(((stats?.elapsedMs ?? 0) / 1000)),
          previewHidden: hideFloatingPreview,
        },
        onTogglePause: () => togglePause(),
        onStop: () => void stopTake(),
        onToggleHidePreview: () => setHideFloatingPreview((prev) => !prev),
        onClose: () => {
          floatingCameraRef.current = null;
          if (mountedRef.current) setFloatingCameraOpen(false);
        },
      });
      floatingCameraRef.current = pipSession;
      setFloatingCameraOpen(true);
    } catch (err) {
      setError(`Floating camera unavailable: ${(err as Error).message}`);
    }
  };

  // Turning the camera source off must not leave the device light on.
  useEffect(() => {
    cameraOnRef.current = cameraOn;
    if (!cameraOn && cameraPreviewStream.current) stopCameraPreview();
  }, [cameraOn]);

  // The floating self-view mounts when a take starts, after the camera stream
  // already exists, so hand it the live stream on the first render it exists.
  useEffect(() => {
    const element = selfViewRef.current;
    if (!element) return;
    const stream = cameraStream.current ?? cameraPreviewStream.current;
    if (!stream || element.srcObject === stream) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stage]);

  const acquireSources = async (): Promise<CaptureAssetSpec[]> => {
    const specs: CaptureAssetSpec[] = [];
    if (screenOn) {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(
          displayConstraints({ width: dimensions.width, height: dimensions.height, frameRate, systemAudio, surface }),
        );
      } catch (error) {
        // Chrome reports a closed picker as NotAllowedError; name the surface so
        // the message says "sharing was cancelled", not "microphone denied".
        throw new Error(`Screen sharing was cancelled or blocked: ${(error as Error).message}`, { cause: error });
      }
      screenStream.current = stream;
      setScreenTracks([...stream.getVideoTracks(), ...stream.getAudioTracks()]);
      const video = stream.getVideoTracks()[0];
      if (!video) throw new Error('The screen picker returned no video track.');
      const report = reportTrackSettings(video, 'Screen');
      const actualSurface = reportedSurface(video.getSettings());
      const surfaceLabel = actualSurface === 'screen' ? 'entire screen' : actualSurface === 'window' ? 'a window' : actualSurface === 'tab' ? 'a browser tab' : 'unknown surface';
      const fidelity = describeCaptureFidelity(report.width, report.height, dimensions.width, dimensions.height);
      setSettingsReport((current) => [
        ...current,
        { label: 'Screen', message: `${fidelity.message} Captured ${surfaceLabel}.`, native: fidelity.native, scaled: fidelity.scaled },
      ]);
      if (actualSurface && actualSurface !== surface) {
        addWarning(`You picked ${surface === 'screen' ? 'the entire screen' : surface === 'window' ? 'a window' : 'a browser tab'} but the browser shared ${surfaceLabel}. The recording uses what was actually shared.`);
      }
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(() => undefined);
      }
      const videoStream = new MediaStream([video]);
      specs.push({
        key: 'screen',
        kind: 'screen',
        name: 'Screen',
        stream: videoStream,
        mimeType: chooseRecorderMime('video', false) || 'video/webm',
        width: report.width,
        height: report.height,
      });
      const audio = stream.getAudioTracks()[0];
      if (audio) {
        specs.push({
          key: 'system-audio',
          kind: 'system-audio',
          name: 'System audio',
          stream: new MediaStream([audio]),
          mimeType: chooseRecorderMime('audio', false) || 'audio/webm',
          sampleRate: report.sampleRate,
        });
      } else if (systemAudio) {
        addWarning('The browser did not return a system-audio track for this surface. Recording continues without it.');
      }
      video.addEventListener('ended', () => {
        setScreenTracks([]);
        addWarning('Screen sharing was stopped from the browser bar.');
        void stopTake();
      });
    }
    if (cameraOn) {
      // Reuse the live preview's stream when there is one: opening a second
      // stream for the same device can fail or take the camera over.
      const stream = cameraPreviewStream.current ?? (await openCamera(cameraId || undefined, dimensions.width, dimensions.height, frameRate));
      if (cameraPreviewStream.current) {
        cameraPreviewStream.current = null;
        setCameraPreviewOn(false);
      }
      cameraStream.current = stream;
      setCameraTracks([...stream.getVideoTracks()]);
      const cameraElement = cameraPreviewRef.current;
      if (cameraElement) {
        cameraElement.srcObject = stream;
        if (selfViewRef.current) selfViewRef.current.srcObject = stream;
        try {
          await cameraElement.play();
          if (mountedRef.current) setCameraReady(true);
        } catch (err) {
          setCameraReady(false);
          addWarning(`Camera preview could not start playing: ${(err as Error).message}`);
        }
      }
      const video = stream.getVideoTracks()[0];
      if (!video) throw new Error('The camera returned no video track.');
      const report = reportTrackSettings(video, 'Camera');
      setSettingsReport((current) => [
        ...current,
        {
          label: 'Camera',
          ...describeCaptureFidelity(report.width, report.height, dimensions.width, dimensions.height),
        },
      ]);
      specs.push({
        key: 'camera',
        kind: 'camera',
        name: 'Camera',
        stream: new MediaStream([video]),
        mimeType: chooseRecorderMime('video', false) || 'video/webm',
        width: report.width,
        height: report.height,
      });
    }
    if (micOn) {
      if (!micStream.current) {
        micStream.current = await openMicrophone({
          ...(micId ? { deviceId: micId } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48_000,
          channelCount: 1,
        });
      }
      const audio = micStream.current.getAudioTracks()[0];
      if (!audio) throw new Error('The microphone returned no audio track.');
      specs.push({
        key: 'microphone',
        kind: 'microphone',
        name: 'Microphone',
        stream: new MediaStream([audio]),
        mimeType: chooseRecorderMime('audio', false) || 'audio/webm',
        sampleRate: audio.getSettings().sampleRate,
      });
    }
    return specs;
  };

  const buildPreparedSummary = (specs: CaptureAssetSpec[]): PreparedSourceSummary => {
    const screenSpec = specs.find((s) => s.key === 'screen');
    const camSpec = specs.find((s) => s.key === 'camera');
    const micSpec = specs.find((s) => s.key === 'microphone');
    const sysSpec = specs.find((s) => s.key === 'system-audio');
    const screenTrack = screenStream.current?.getVideoTracks()[0];
    const actualSurf = screenTrack ? reportedSurface(screenTrack.getSettings()) : undefined;
    const surfWord =
      actualSurf === 'screen'
        ? 'Display (entire screen)'
        : actualSurf === 'window'
          ? 'Application window'
          : actualSurf === 'tab'
            ? 'Browser tab'
            : screenSpec
              ? 'Shared screen surface'
              : camSpec
                ? 'Camera only'
                : 'Audio only';
    const primaryVideo = screenSpec ?? camSpec;
    const trackRate = screenTrack?.getSettings().frameRate ?? frameRate;
    return {
      sourceName: screenTrack?.label || surfWord,
      surfaceType: surfWord,
      dimensions: primaryVideo
        ? `${primaryVideo.width ?? dimensions.width}×${primaryVideo.height ?? dimensions.height} · ${Math.round(trackRate)} fps`
        : 'Audio only (48 kHz mono)',
      cameraStatus: camSpec ? `On (${camSpec.width ?? dimensions.width}×${camSpec.height ?? dimensions.height})` : 'Off',
      micStatus: micSpec ? `On (${micSpec.sampleRate ?? 48000} Hz)` : 'Off',
      systemAudioStatus: sysSpec ? 'On (capturing)' : systemAudio && screenOn ? 'Unavailable on this surface' : 'Off',
    };
  };

  /**
   * Separate source selection from starting the take: acquires sources and
   * enters the Cap-style Ready confirmation state without starting MediaRecorder yet.
   */
  const chooseSource = async () => {
    if (startingRef.current || (stage !== 'idle' && stage !== 'ready')) return;
    startingRef.current = true;
    setError(null);
    setWarnings([]);
    setSettingsReport([]);
    if (stage === 'ready') {
      releaseSources();
    }
    if (!project || !session.workspace || !session.projectFolder) {
      setError('The recording session is still being prepared. Try again in a moment.');
      startingRef.current = false;
      return;
    }
    if (!screenOn && !cameraOn && !micOn) {
      setError('Choose at least one source: screen, camera or microphone.');
      startingRef.current = false;
      return;
    }
    setStage('selecting');
    try {
      const oneMinuteBytes = (recordingBitrate(dimensions.width, dimensions.height, frameRate) / 8) * 60;
      const headroom = await checkStorageHeadroom(oneMinuteBytes);
      if (!headroom.enough) addWarning(headroom.message);
      const specs = await acquireSources();
      if (!mountedRef.current) {
        for (const spec of specs) stopStream(spec.stream);
        return;
      }
      if (specs.length === 0) throw new Error('No capture tracks were returned.');
      if (micOn && micStream.current && !micMeter.current) {
        const meter = new InputMeter(micStream.current);
        micMeter.current = meter;
        meter.start(setMicLevel);
      }
      preparedSpecsRef.current = specs;
      setPreparedSummary(buildPreparedSummary(specs));
      setStage('ready');
    } catch (err) {
      const message = (err as Error).message;
      setError(describeCaptureError(message));
      setStage('idle');
      releaseSources();
    } finally {
      startingRef.current = false;
    }
  };

  const cancelReadyState = () => {
    if (stage !== 'ready' && stage !== 'selecting') return;
    releaseSources();
    setStage('idle');
    setCountdown(0);
  };

  useEffect(() => {
    if (stage !== 'ready') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelReadyState();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const start = async () => {
    if (startingRef.current || (stage !== 'idle' && stage !== 'ready')) return;
    startingRef.current = true;
    setError(null);
    if (stage === 'idle') {
      setWarnings([]);
      setSettingsReport([]);
    }
    if (!project || !session.workspace || !session.projectFolder) {
      setError('The recording session is still being prepared. Try again in a moment.');
      startingRef.current = false;
      return;
    }
    if (!screenOn && !cameraOn && !micOn) {
      setError('Choose at least one source: screen, camera or microphone.');
      startingRef.current = false;
      return;
    }
    // Take one's numbers must never show on take two's bar before the first commit.
    setStats(null);
    sessionStats.current = null;
    setCountdown(0);
    try {
      let specs = preparedSpecsRef.current;
      if (!specs) {
        setStage('selecting');
        const oneMinuteBytes = (recordingBitrate(dimensions.width, dimensions.height, frameRate) / 8) * 60;
        const headroom = await checkStorageHeadroom(oneMinuteBytes);
        if (!headroom.enough) addWarning(headroom.message);
        specs = await acquireSources();
        if (!mountedRef.current) {
          for (const spec of specs) stopStream(spec.stream);
          return;
        }
        if (specs.length === 0) throw new Error('No capture tracks were returned.');
        if (micOn && micStream.current && !micMeter.current) {
          const meter = new InputMeter(micStream.current);
          micMeter.current = meter;
          meter.start(setMicLevel);
        }
        preparedSpecsRef.current = specs;
        setPreparedSummary(buildPreparedSummary(specs));
        setStage('ready');
      }
      if (navigator.wakeLock && !wakeLockRef.current) {
        try {
          // Best effort only. The request can stay pending indefinitely (some
          // automation and kiosk environments never settle it), and awaiting it
          // without a deadline left the take stuck after the picker closed:
          // sources acquired, no countdown, no error.
          const request = navigator.wakeLock.request('screen');
          const generation = wakeLockGen.current;
          // If the timeout wins, the request can still resolve later. Take the
          // late sentinel if the take is still running, otherwise release it —
          // dropping the reference left the screen awake for the page's lifetime.
          void request.then(
            (sentinel) => {
              if (wakeLockGen.current !== generation || !mountedRef.current || wakeLockRef.current) {
                void sentinel.release().catch(() => undefined);
              } else {
                wakeLockRef.current = sentinel;
              }
            },
            () => undefined,
          );
          const sentinel = await Promise.race([
            request,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
          ]);
          if (sentinel && !wakeLockRef.current) wakeLockRef.current = sentinel;
        } catch {
          // Wake lock is a nicety; never a requirement.
        }
      }
      setStage('countdown');
      for (let i = countdownSeconds; i > 0; i -= 1) {
        setCountdown(i);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setCountdown(0);
      preparedSpecsRef.current = null;
      if (!mountedRef.current) {
        for (const spec of specs) stopStream(spec.stream);
        return;
      }
      const capture = await CaptureSession.start({
        root: session.workspace.root,
        projectFolder: session.projectFolder,
        projectId: project.id,
        assets: specs,
        segmentSeconds: project.settings.segmentSeconds,
        videoBitsPerSecond: recordingBitrate(dimensions.width, dimensions.height, frameRate),
        onStats: (next) => {
          sessionStats.current = next;
          if (mountedRef.current) setStats(next);
        },
        onWarning: (next) => {
          if (mountedRef.current) addWarning(next);
        },
        onFatal: (fatal) => {
          if (mountedRef.current) setError(`Capture failed: ${fatal.message}`);
        },
        onSourceEnded: (key) => {
          if (mountedRef.current && key === 'screen') {
            addWarning('Screen sharing stopped. The take keeps everything committed so far.');
          }
        },
      });
      captureRef.current = capture;
      setActiveTakeId(capture.takeId ?? null);
      if (!mountedRef.current) {
        // Navigating away during the countdown: abandon cleanly instead of
        // leaving a take that still claims to be recording.
        void capture.discard().catch(() => undefined);
        captureRef.current = null;
        setActiveTakeId(null);
        return;
      }
      setStage('recording');
    } catch (err) {
      const message = (err as Error).message;
      setError(describeCaptureError(message));
      setStage('idle');
      setCountdown(0);
      // Null the refs as well as stopping the tracks: a retry that reused an
      // ended mic track failed with a misleading "no track" error.
      releaseSources();
    } finally {
      startingRef.current = false;
    }
  };

  const stopTake = async () => {
    const capture = captureRef.current;
    if (!capture || stoppingRef.current) return;
    stoppingRef.current = true;
    setStage('finishing');
    try {
      const result = await capture.stop();
      captureRef.current = null;
      setTakeResult(result);
      // The live stats belong to a take that no longer exists; leaving them up
      // showed "recording" and 0 B committed after the take had finished.
      setStats(null);
      sessionStats.current = null;
      setStage('idle');
      void refreshTakes();
      // Preserve the review dialog for warnings or an insertion failure.
      // insertTake only navigates after the take has been placed successfully.
      if (openEditorAfterStop && result.warnings.length === 0) insertTake(result);
    } catch (err) {
      setError(`Could not finalise the take: ${(err as Error).message}`);
      setStage('idle');
    } finally {
      releaseSources();
      stoppingRef.current = false;
    }
  };

  const togglePause = () => {
    const capture = captureRef.current;
    if (!capture) return;
    if (stage === 'recording') {
      capture.pause();
      setStage('paused');
    } else {
      capture.resume();
      setStage('recording');
    }
  };

  const addMarker = () => {
    captureRef.current?.addMarker(`Marker ${(stats?.markers.length ?? 0) + 1}`);
  };

  /**
   * Mute the microphone without stopping its track: MediaRecorder keeps
   * writing silence, so the take's audio timeline stays aligned.
   */
  const toggleMicMute = () => {
    const track = micStream.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicMuted(!track.enabled);
  };

  // Keyboard control while a take runs: P pause/resume, S stop & keep, M marker,
  // U mute. Ignored while typing, with modifiers held, or when no take is live.
  useEffect(() => {
    if (stage !== 'recording' && stage !== 'paused') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      switch (event.key.toLowerCase()) {
        case 'p':
          togglePause();
          break;
        case 's':
          void stopTake();
          break;
        case 'm':
          addMarker();
          break;
        case 'u':
          if (micOn) toggleMicMute();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The handlers read refs and the current stage; re-binding on stage is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, micOn]);

  /** Self-view position after the user drags it; null keeps the default corner. Remembered across reloads. */
  const SELF_VIEW_KEY = 'browser-record.self-view-position';
  const [selfViewPos, setSelfViewPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SELF_VIEW_KEY) ?? 'null') as { x?: unknown; y?: unknown } | null;
      return saved && typeof saved.x === 'number' && typeof saved.y === 'number' ? { x: saved.x, y: saved.y } : null;
    } catch {
      return null;
    }
  });
  const selfViewBox = useRef<HTMLDivElement>(null);
  const selfViewDrag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (selfViewPos) localStorage.setItem(SELF_VIEW_KEY, JSON.stringify(selfViewPos));
  }, [selfViewPos]);

  // A window that shrinks must not leave the bubble off-screen.
  useEffect(() => {
    const onResize = () => {
      const box = selfViewBox.current?.getBoundingClientRect();
      if (!box) return;
      setSelfViewPos((current) =>
        current
          ? {
              x: clamp(current.x, 0, window.innerWidth - box.width),
              y: clamp(current.y, 0, window.innerHeight - box.height),
            }
          : current,
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Double-click the bubble to return it to its default corner. */
  const resetSelfView = () => {
    localStorage.removeItem(SELF_VIEW_KEY);
    setSelfViewPos(null);
  };

  const onSelfViewPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    selfViewDrag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onSelfViewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = selfViewDrag.current;
    if (!drag) return;
    const { width, height } = event.currentTarget.getBoundingClientRect();
    setSelfViewPos({
      x: clamp(event.clientX - drag.dx, 0, window.innerWidth - width),
      y: clamp(event.clientY - drag.dy, 0, window.innerHeight - height),
    });
  };

  const onSelfViewPointerUp = () => {
    selfViewDrag.current = null;
  };

  /** Restart = confirmed discard, then a fresh countdown once the discard has returned the stage to idle. */
  const [restartOpen, setRestartOpen] = useState(false);
  const restartPending = useRef(false);
  useEffect(() => {
    if (restartPending.current && stage === 'idle') {
      restartPending.current = false;
      void start();
    }
    // start() reads the latest render's state; re-running on stage change is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const confirmRestart = async () => {
    setRestartOpen(false);
    restartPending.current = true;
    await discard();
  };

  const discard = async () => {
    const capture = captureRef.current;
    const takeId = capture?.takeId ?? null;
    let discardError: string | null = null;
    try {
      await capture?.discard();
    } catch (err) {
      // A failed abort must not trap the user in the dialog with live streams.
      discardError = (err as Error).message;
    }
    captureRef.current = null;
    // Abandoned means abandoned: without this the folder keeps every byte the
    // take wrote, which for a long camera recording is gigabytes.
    if (takeId && session.workspace && session.projectFolder) {
      const removed = await deleteTake(session.workspace.root, session.projectFolder, takeId);
      if (!removed) {
        useSession
          .getState()
          .pushToast(`The abandoned take ${takeId} is still in the project's recordings folder.`, 'error');
      }
    }
    setDiscardOpen(false);
    setStage('idle');
    setCountdown(0);
    releaseSources();
    setStats(null);
    setError(null);
    setWarnings([]);
    if (discardError) {
      addWarning(
        `The recorder could not shut down cleanly (${discardError}). The take was still removed from the project.`,
      );
    } else {
      addWarning('Take discarded. Nothing was added to the project.');
    }
    void refreshTakes();
  };

  /** Delete one take folder and report the outcome. Shared by the dialog and the takes list. */
  const deleteTakeFiles = async (takeId: string): Promise<boolean> => {
    const workspace = session.workspace;
    const folder = session.projectFolder;
    if (!workspace || !folder) {
      // Keep the dialog open: closing it would imply the files were handled.
      useSession
        .getState()
        .pushToast('No workspace is open, so the take files were not deleted. They remain on disk.', 'error');
      return false;
    }
    const deleted = await deleteTake(workspace.root, folder, takeId);
    if (!deleted) {
      useSession
        .getState()
        .pushToast(`Could not delete take ${takeId}; it is still in the project's recordings folder.`, 'error');
      return false;
    }
    useSession.getState().pushToast('Take files deleted; nothing was added to the project.', 'info');
    await refreshTakes();
    return true;
  };

  /** Discard a finished take: delete only that take's folder, never other media. */
  const discardFinishedTake = async (result: TakeResult) => {
    if (await deleteTakeFiles(result.takeId)) setTakeResult(null);
  };

  /** One original source, downloaded on its own. Throws so callers decide how to report it. */
  const downloadOriginal = async (asset: TakeResult['assets'][number]) => {
    const file = await ensureAssetFile(asset.path);
    const extension = asset.path.includes('.') ? asset.path.slice(asset.path.lastIndexOf('.')) : '';
    const safeName = asset.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
    downloadBlob(file, `original-${safeName}${safeName.endsWith(extension) ? '' : extension}`);
  };

  /** Original sources, downloaded individually and labelled by role. */
  const downloadOriginals = async (result: TakeResult) => {
    setDownloadingOriginals(true);
    try {
      for (const asset of result.assets) {
        try {
          await downloadOriginal(asset);
        } catch (err) {
          useSession
            .getState()
            .pushToast(`Could not download ${asset.name}: ${(err as Error).message}`, 'error');
        }
      }
      useSession.getState().pushToast('Original sources downloaded separately from any composited export.', 'success');
    } finally {
      setDownloadingOriginals(false);
    }
  };

  function insertTake(result: TakeResult) {
    if (result.assets.length === 0) {
      useSession.getState().pushToast('This take has no media files, so nothing was added to the timeline.', 'error');
      return;
    }
    let insertedAt = 0;
    let firstClipId: string | undefined;
    try {
      useEditor.getState().apply('Add recorded take', (p) => {
        // Append after the existing edit instead of overwriting it: a second take
        // used to cut away the opening of the first one.
        const startTicks = nextFreeStart(p);
        insertedAt = startTicks;
        let working = placeTake({ ...p, assets: [...p.assets, ...result.assets] }, result.assets, startTicks, presenter);
        const assetIds = new Set(result.assets.map((asset) => asset.id));
        firstClipId = working.tracks.flatMap((track) => track.clips).find((clip) => clip.assetId && assetIds.has(clip.assetId) && clip.startTicks === startTicks)?.id;
        if (result.markers.length > 0) {
          working = {
            ...working,
            markers: [
              ...working.markers,
              ...result.markers.map((marker) => ({ ...marker, atTicks: marker.atTicks + startTicks })),
            ],
          };
        }
        return working;
      });
    } catch (err) {
      useSession
        .getState()
        .pushToast(`Could not add the take to the timeline: ${(err as Error).message}`, 'error');
      return;
    }
    useEditor.getState().setPlayhead(insertedAt);
    if (firstClipId) useEditor.getState().selectClips([firstClipId]);
    setTakeResult(null);
    useSession.getState().pushToast('Recording added to the timeline.', 'success');
    useSession.getState().setRoute('edit');
  }

  const recoverTake = async (take: TakeSummary) => {
    if (!session.workspace || !session.projectFolder) return;
    try {
      const report = await recoverInterruptedTake(session.workspace.root, session.projectFolder, take.takeId);
      if (!report) {
        useSession.getState().pushToast(`Take ${take.takeId} has no readable manifest.`, 'error');
        return;
      }
      const lines = [
        `Committed data: ${formatBytes(report.committedBytes)}`,
        `Uncommitted tail: ${formatBytes(report.uncommittedBytes)}`,
        `Worst-case loss window: ${report.lossWindowSeconds}s`,
        ...report.warnings,
      ];
      setRecoveryReport(lines.join('\n'));
      if (report.assets.length === 0) {
        useSession.getState().pushToast('This take has no committed media to add.', 'error');
        return;
      }
      useEditor.getState().apply('Recover take', (p) => {
        // Same placement as a live take: one track per source, camera gets a
        // presenter bubble, everything appended after the existing edit.
        const startTicks = nextFreeStart(p);
        return placeTake(
          { ...p, assets: [...p.assets, ...report.assets] },
          report.assets,
          startTicks,
          defaultPresenter(),
        );
      });
      useSession.getState().pushToast('Take added to the timeline.', 'success');
      void refreshTakes();
    } catch (err) {
      useSession.getState().pushToast(`Could not recover the take: ${(err as Error).message}`, 'error');
    }
  };

  /** Delete every take folder the current project does not reference. */
  const cleanRecordings = async () => {
    if (!project || !session.workspace || !session.projectFolder) return;
    setCleanBusy(true);
    try {
      const referenced = new Set(takeIdsOf(project));
      const result = await cleanRecordingsFolder(session.workspace.root, session.projectFolder, referenced);
      setCleanOpen(false);
      setTakes([]);
      await refreshTakes();
      useSession
        .getState()
        .pushToast(
          `Removed ${result.deleted.length} take${result.deleted.length === 1 ? '' : 's'}${
            result.failed.length > 0 ? `; ${result.failed.length} could not be deleted` : ''
          }. Kept ${result.kept.length} take${result.kept.length === 1 ? '' : 's'} used by the timeline.`,
          result.failed.length > 0 ? 'error' : 'info',
        );
    } catch (err) {
      useSession.getState().pushToast(`Could not clean recordings: ${(err as Error).message}`, 'error');
    } finally {
      setCleanBusy(false);
    }
  };

  const elapsedSeconds = (stats?.elapsedMs ?? 0) / 1000;
  const assetsByKey = useMemo(() => stats?.assets ?? [], [stats]);
  const activeScreenVideoTrack = useMemo(
    () => screenTracks.find((t) => t.kind === 'video') ?? null,
    [screenTracks],
  );
  const actualReturnedSurface = useMemo(
    () => describeReturnedSurface(activeScreenVideoTrack),
    [activeScreenVideoTrack],
  );
  const isRecordingDisplaySurface =
    (stage === 'countdown' || stage === 'recording' || stage === 'paused') &&
    screenOn &&
    (actualReturnedSurface.surface === 'screen' || (!actualReturnedSurface.surface && surface === 'screen'));

  useEffect(() => {
    floatingCameraRef.current?.updateRecordingState({
      stage,
      elapsedText: stage === 'countdown' ? `${countdown}s` : formatElapsed(elapsedSeconds),
      previewHidden: hideFloatingPreview,
    });
  }, [stage, countdown, elapsedSeconds, hideFloatingPreview]);

  /** Take folders sitting under recordings/ that no clip points at. */
  const unreferencedTakes = useMemo(() => {
    if (!project) return [];
    const referenced = new Set(takeIdsOf(project));
    return takes.filter((take) => !referenced.has(take.takeId));
  }, [project, takes]);

  if (!project) {
    if (hidden) return null;
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Record</h1>
            <p className="page-subtitle">Setting up a temporary local session. Nothing is uploaded.</p>
          </div>
        </header>
        <div className="stack" style={{ gap: 12, maxWidth: 760 }}>
          {preparing && !setupError && (
            <div className="hint-card" role="status">
              Preparing local storage and project metadata…
            </div>
          )}
          {setupError && (
            <>
              <div className="danger-card" role="alert">
                {setupError}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  onClick={() => {
                    setSetupError(null);
                    setPreparing(true);
                    void ensureDraftProject({ width: 1920, height: 1080, fps: { num: 30, den: 1 } })
                      .then(() => setPreparing(false))
                      .catch((error: Error) => {
                        setSetupError(error.message);
                        setPreparing(false);
                      });
                  }}
                >
                  Try again
                </Button>
                <Button
                  variant="ghost"
                  disabled={preparing}
                  onClick={async () => {
                    // Saving a session presupposes a project; on this branch
                    // there is none yet, so pick a folder and prepare one.
                    setSetupError(null);
                    setPreparing(true);
                    try {
                      if (!(await chooseFolderWorkspace())) {
                        setPreparing(false);
                        return;
                      }
                      await ensureDraftProject({ width: 1920, height: 1080, fps: { num: 30, den: 1 } });
                      setPreparing(false);
                    } catch (error) {
                      setSetupError((error as Error).message);
                      setPreparing(false);
                    }
                  }}
                >
                  Choose a folder instead
                </Button>
                <Button variant="ghost" onClick={() => useSession.getState().setRoute('projects')}>
                  Back to Projects
                </Button>
              </div>
              <div className="field-hint">
                Recording needs somewhere to write. Browser storage can be blocked in private windows; a folder on this
                computer always works in Chrome or Edge.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // A fixed virtual canvas is enough: every value below is converted to a
  // percentage, so the preview matches presenterBubble at any display size.
  const previewCanvas = {
    width: 1000,
    height: Math.max(1, Math.round((1000 * project.canvas.height) / project.canvas.width)),
  };
  const bubble = presenterBubble({ canvas: previewCanvas, presenter });

  return (
    <div
      className={`page recorder-page cap-recorder${showMonitor ? ' monitor-expanded' : ''}`}
      data-route-hidden={hidden ? 'true' : undefined}
    >
      <header className="page-head">
        <div>
          <span className="eyebrow">LOCAL CREATOR STUDIO</span>
          <h1 className="page-title">Ready when you are.</h1>
          <p className="page-subtitle">Record a take or jump straight into your next edit.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {stage === 'recording' && <Badge tone="danger">Recording</Badge>}
          {stage === 'paused' && <Badge tone="warn">Paused</Badge>}
          {stage === 'selecting' && <Badge>Selecting source…</Badge>}
          {stage === 'ready' && <Badge tone="ok">Source ready</Badge>}
          <Badge>{project.name}</Badge>
        </div>
      </header>

      <div className="recorder-entry-actions" role="group" aria-label="Record and edit entry points">
        <span className="recorder-mode-label"><span className="rec-dot still" aria-hidden /> Record</span>
        <Button disabled={stage !== 'idle'} onClick={() => useSession.getState().setRoute('edit')}>Open editor ↗</Button>
        <ImportMediaButton disabled={stage !== 'idle'} />
        <Button disabled={stage !== 'idle'} variant="ghost" onClick={() => useSession.getState().setRoute('projects')}>
          Open project…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          ⚙ Settings
        </Button>
      </div>

      {stage === 'ready' && preparedSummary && (
        <section className="cap-ready-card" role="region" aria-label="Source confirmation">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <span className="eyebrow">SOURCE READY TO RECORD</span>
              <h2 style={{ margin: '4px 0 2px', fontSize: 16 }}>{preparedSummary.sourceName}</h2>
              <div className="field-hint">
                {preparedSummary.surfaceType} · <span className="mono">{preparedSummary.dimensions}</span>
              </div>
            </div>
            <Badge tone="ok">Ready</Badge>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={cameraOn ? 'ok' : 'neutral'}>Camera: {preparedSummary.cameraStatus}</Badge>
            <Badge tone={micOn ? 'ok' : 'neutral'}>Mic: {preparedSummary.micStatus}</Badge>
            <Badge tone={systemAudio ? 'ok' : 'neutral'}>System audio: {preparedSummary.systemAudioStatus}</Badge>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Select
              label="Recording countdown"
              value={String(countdownSeconds)}
              onChange={(value) => setCountdownSeconds(Number(value))}
              options={[
                { value: '0', label: 'No countdown' },
                { value: '3', label: '3s countdown' },
                { value: '5', label: '5s countdown' },
                { value: '10', label: '10s countdown' },
              ]}
            />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={cancelReadyState}>
                Cancel
              </Button>
              <Button variant="ghost" onClick={() => void chooseSource()}>
                Change source
              </Button>
              <Button variant="primary" onClick={() => void start()}>
                <span aria-hidden>●</span> Start recording
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* The page is taller than the viewport, so the primary action cannot sit
          at the bottom of the form: a user who has just picked devices should
          not have to scroll 700 px to start. */}
      {stage === 'idle' && (
        <div className="start-dock">
          <Button variant="primary" onClick={start}>
            <span aria-hidden>●</span> Start recording
          </Button>
          <span className="field-hint">{openEditorAfterStop ? 'Stop → Edit' : 'Stop → Review take'} · {countdownSeconds ? `${countdownSeconds}s countdown` : 'No countdown'}</span>
        </div>
      )}

      <details className="record-storage" open><summary>{session.storageMode === 'opfs' ? 'Temporary browser session · Save to a folder for a durable copy' : 'Recording locally to your folder'}<span>Storage options</span></summary>
      <div className={session.storageMode === 'opfs' ? 'warn-card' : 'hint-card'} style={{ marginBottom: 12 }} role="status">
        {session.storageMode === 'opfs' ? (
          <>
            This session lives in <strong>browser storage</strong> ({session.workspace?.info.name ?? 'OPFS'}). The browser
            can evict it when space is low. Use <strong>Save to a folder…</strong> after recording for a durable copy.
          </>
        ) : (
          <>
            Recording to <strong>{session.workspace?.info.name}</strong> on this computer
            {session.projectFolder ? <> · project folder <span className="mono">{session.projectFolder}</span></> : null}. Files
            stay on your disk.
          </>
        )}
        <div className="field-hint" style={{ marginTop: 6 }}>
          Raw footage location:{' '}
          <span className="mono">
            {session.workspace?.info.name ?? 'workspace'}/projects/{session.projectFolder ?? '<project>'}/
            {WORKSPACE_LAYOUT.recordings}/&lt;take&gt;/
          </span>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {project.assets.length === 0 && takes.length === 0 && takeResult === null && (
            <Button size="sm" variant="ghost" disabled={stage !== 'idle'} onClick={() => void chooseFolderWorkspace()}>
              Choose a folder for this session…
            </Button>
          )}
          {session.storageMode === 'opfs' && (
            <Button size="sm" variant="ghost" disabled={stage !== 'idle'} onClick={() => void saveSessionToFolder()}>
              Save recordings to a folder…
            </Button>
          )}
        </div>
      </div>

      </details>
      {/* The same camera stream the monitor shows, pinned to the viewport for
          the whole take: the monitor can scroll away, this cannot. Hidden when
          hideFloatingPreview is enabled so Entire screen capture never records a double bubble. */}
      {cameraOn && !hideFloatingPreview && (stage === 'countdown' || stage === 'recording' || stage === 'paused' || stage === 'finishing') && (
        <div
          ref={selfViewBox}
          className="rec-selfview"
          aria-label="Live camera self-view"
          title="Drag to move. Double-click to reset."
          onDoubleClick={resetSelfView}
          onPointerDown={onSelfViewPointerDown}
          onPointerMove={onSelfViewPointerMove}
          onPointerUp={onSelfViewPointerUp}
          onPointerCancel={onSelfViewPointerUp}
          style={{
            ...(selfViewPos ? { left: selfViewPos.x, top: selfViewPos.y, right: 'auto', bottom: 'auto' } : {}),
            borderRadius:
              presenter.shape === 'circle'
                ? '50%'
                : `${(bubble.radius / bubble.width) * 100}% / ${(bubble.radius / bubble.height) * 100}%`,
            outline: presenter.border > 0 ? `2px solid ${presenter.borderColor}` : 'none',
          }}
        >
          <video
            ref={selfViewRef}
            muted
            playsInline
            autoPlay
            style={{ transform: presenter.mirror ? 'scaleX(-1)' : 'none' }}
          />
        </div>
      )}

      {/* Loom/Cap-style floating control pill. It stays out of the settings
          table's way and keeps Stop reachable at any scroll position; live
          per-source figures stay in the Take panel below. */}
      {(stage === 'countdown' || stage === 'recording' || stage === 'paused' || stage === 'finishing') && (
        <div
          className={`rec-bar rec-dock${stage === 'paused' ? ' paused' : ''}`}
          role="group"
          aria-label="Recording controls"
        >
          <span className="rec-dock-status">
            <span className={stage === 'recording' || stage === 'countdown' ? 'rec-dot' : 'rec-dot still'} aria-hidden />
            <strong className="rec-state" role="status" aria-live="polite">
              {stage === 'countdown' ? 'STARTING' : stage === 'paused' ? 'PAUSED' : stage === 'finishing' ? 'SAVING' : 'REC'}
            </strong>
            <span className="rec-timer" aria-hidden="true">{stage === 'countdown' ? countdown : formatElapsed(elapsedSeconds)}</span>
            {(stats?.markers.length ?? 0) > 0 && (
              <span className="rec-markers">
                {stats?.markers.length} marker{stats?.markers.length === 1 ? '' : 's'}
              </span>
            )}
            {(error || warnings[0]) && (
              <Badge tone={error ? 'danger' : 'warn'}>{error ?? warnings[0]}</Badge>
            )}
          </span>

          {stage === 'finishing' && <span className="field-hint">Flushing segments to disk…</span>}
          {stage === 'countdown' && <span className="field-hint">Waiting for the countdown</span>}
          {(stage === 'recording' || stage === 'paused') && (
            <div className="rec-dock-actions">
              <RecordingActions paused={stage === 'paused'} openEditor={openEditorAfterStop} onPause={togglePause} onStop={() => void stopTake()} />
              <Button size="sm" variant="ghost" onClick={addMarker} title="Shortcut: M">
                Marker
              </Button>
              {cameraOn && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={hideFloatingPreview}
                  onClick={() => setHideFloatingPreview((prev) => !prev)}
                  title="Hide floating camera preview on display while continuing to record camera separately for the editor"
                >
                  {hideFloatingPreview ? 'Show floating preview' : 'Hide floating preview'}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="rec-restart"
                onClick={() => setRestartOpen(true)}
                aria-label="Restart take"
                title="Restart: discards this take, then counts down again"
              >
                ↻
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDiscardOpen(true)}
                title="Abandon this take without keeping it"
              >
                Discard
              </Button>
              {micOn && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={toggleMicMute}
                  aria-label={micMuted ? 'Unmute the microphone' : 'Mute the microphone'}
                  title={micMuted ? 'Microphone is muted in the recording' : 'Mute the microphone'}
                >
                  {micMuted ? 'Unmute' : 'Mute'}
                </Button>
              )}

            </div>
          )}
        </div>
      )}

      <div className="split-grid">
        <div className="stack" style={{ gap: 14 }}>
          <Panel title="Sources" bodyClassName="stack">
            <div className="capture-mode-grid" role="group" aria-label="Recording source">
              {([
                { id: 'screen', iconName: 'screen' as IconName, label: 'Display' },
                { id: 'window', iconName: 'window' as IconName, label: 'Window' },
                { id: 'tab', iconName: 'tab' as IconName, label: 'Browser tab' },
                { id: 'camera', iconName: 'camera' as IconName, label: 'Camera only' },
                { id: 'audio', iconName: 'mic' as IconName, label: 'Audio only' },
              ] as const).map((mode) => (
                <button
                  type="button"
                  key={mode.id}
                  disabled={stage !== 'idle'}
                  aria-pressed={
                    mode.id === 'audio'
                      ? !screenOn && !cameraOn && micOn
                      : mode.id === 'camera'
                        ? !screenOn && cameraOn
                        : screenOn && surface === mode.id
                  }
                  onClick={() => {
                    if (mode.id === 'audio') {
                      setScreenOn(false);
                      setCameraOn(false);
                      setMicOn(true);
                    } else if (mode.id === 'camera') {
                      setScreenOn(false);
                      setCameraOn(true);
                    } else {
                      setScreenOn(true);
                      setSurface(mode.id);
                    }
                  }}
                >
                  <SvgIcon name={mode.iconName} size={20} />
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <p className="field-hint" style={{ margin: 0, flex: 1 }}>
                {preparedSummary
                  ? `Selected: ${preparedSummary.sourceName} (${preparedSummary.dimensions})`
                  : screenOn
                    ? 'No display/window selected yet. Click Choose source or Start recording to open the browser picker.'
                    : cameraOn
                      ? 'Camera-only mode — records your camera without screen sharing.'
                      : 'Audio-only mode — records narration from your microphone.'}
              </p>
              {stage === 'idle' && (
                <Button size="sm" variant="ghost" onClick={() => void chooseSource()}>
                  Choose source…
                </Button>
              )}
            </div>

            <div className="hint-card stack" style={{ gap: 8 }} role="region" aria-label="Across tabs and display capture">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12.5 }}>What makes capture work across tabs &amp; apps</strong>
                <Badge tone={actualReturnedSurface.surface ? 'ok' : 'neutral'}>
                  {actualReturnedSurface.surface ? `Chrome returned: ${actualReturnedSurface.label}` : 'Source: waiting for Chrome picker'}
                </Badge>
              </div>
              <div className="field-hint" style={{ lineHeight: 1.5 }}>
                • <strong>Entire screen (Display)</strong> is the right mode for DevOps lessons when moving between Chrome tabs, your terminal, and diagrams on the same display.
                <br />
                • <strong>Window</strong> follows the selected application window.
                <br />
                • <strong>Browser tab</strong> captures the selected tab — use Chrome&apos;s <strong>&ldquo;Share this tab instead&rdquo;</strong> bar when switching tabs.
                <br />
                • <strong>Floating PiP &amp; controls</strong>: Open the floating camera via Document PiP from an explicit click. Closing the floating window leaves the take running. Chrome lets you move the PiP window, while the editor controls the separate presenter layer in the export.
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <Toggle
                  label="Hide floating preview (keep recording camera separately for editor to avoid double bubble)"
                  checked={hideFloatingPreview}
                  onChange={setHideFloatingPreview}
                />
                <Toggle
                  label="Hide live screen monitor while recording display (reduce mirror effect)"
                  checked={hideMonitorDuringDisplay}
                  onChange={setHideMonitorDuringDisplay}
                />
              </div>
            </div>

            <div className="cap-device-rows">
              <div className="cap-device-row">
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <Toggle label="Camera" checked={cameraOn} onChange={setCameraOn} disabled={stage !== 'idle'} />
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {cameraOn && (
                      <Select
                        label="Select camera"
                        value={cameraId}
                        onChange={(id) => {
                          setCameraId(id);
                          if (cameraPreviewOn) stopCameraPreview();
                        }}
                        disabled={stage !== 'idle'}
                        options={
                          devices.camera.length > 0
                            ? devices.camera.map((d) => ({ value: d.deviceId, label: d.label }))
                            : [{ value: '', label: 'Default camera' }]
                        }
                      />
                    )}
                    {cameraOn && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggleFloatingCamera()}
                        title={floatingSupport.detail}
                      >
                        {floatingCameraOpen ? 'Close floating camera' : 'Open floating camera'}
                      </Button>
                    )}
                    <Badge tone={cameraOn ? 'ok' : 'neutral'}>{cameraOn ? 'On' : 'Off'}</Badge>
                  </div>
                </div>
                {cameraOn && (
                  <div className="field-hint">
                    {devices.camera.find((d) => d.deviceId === cameraId)?.label ?? devices.camera[0]?.label ?? 'Default camera'} · {floatingSupport.label}
                  </div>
                )}
              </div>

              <div className="cap-device-row">
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <Toggle label="Microphone" checked={micOn} onChange={setMicOn} disabled={stage !== 'idle'} />
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {micOn && (
                      <Select
                        label="Select microphone"
                        value={micId}
                        onChange={setMicId}
                        disabled={stage !== 'idle'}
                        options={
                          devices.mic.length > 0
                            ? devices.mic.map((d) => ({ value: d.deviceId, label: d.label }))
                            : [{ value: '', label: 'Default microphone' }]
                        }
                      />
                    )}
                    <Badge tone={micOn ? 'ok' : 'neutral'}>{micOn ? 'On' : 'Off'}</Badge>
                  </div>
                </div>
                {micOn && (
                  <div className="meter" aria-label="Live microphone input level" style={{ height: 5 }}>
                    <div
                      className="meter-fill"
                      style={{ width: `${Math.round(meterPosition(micLevel?.peakDb ?? -Infinity) * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="cap-device-row">
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <Toggle
                    label="System / tab audio"
                    checked={systemAudio}
                    onChange={setSystemAudio}
                    disabled={stage !== 'idle'}
                  />
                  <Badge tone={systemAudio ? 'ok' : 'neutral'}>{systemAudio ? 'On' : 'Off'}</Badge>
                </div>
              </div>
            </div>

            <div className="recorder-options-row">
              <Button size="sm" aria-pressed={showMonitor} onClick={() => setShowMonitor(!showMonitor)}>{showMonitor ? 'Hide preview & takes' : 'Preview & takes'}</Button>
              <Select label="Recording countdown" value={String(countdownSeconds)} disabled={stage !== 'idle' && stage !== 'ready'} onChange={(value) => setCountdownSeconds(Number(value))} options={[{value: '0', label: 'No countdown'}, {value: '3', label: '3s countdown'}, {value: '5', label: '5s countdown'}, {value: '10', label: '10s countdown'}]} />
            </div>
            <Toggle label="Open editor when recording stops" checked={openEditorAfterStop} onChange={setOpenEditorAfterStop} disabled={stage !== 'idle' && stage !== 'ready'} />
            <details className="record-details recorder-advanced" open={settingsOpen} onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>Recording options<span>Devices, camera appearance, audio test & quality</span></summary>
            <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
            <Toggle label="Screen / window" checked={screenOn} onChange={setScreenOn} disabled={stage !== 'idle'} />
            <Field label="Camera device">
              <Select
                label="Camera device"
                value={cameraId}
                onChange={(id) => {
                  setCameraId(id);
                  if (cameraPreviewOn) stopCameraPreview();
                }}
                disabled={stage !== 'idle' || !cameraOn}
                options={devices.camera.length > 0 ? devices.camera.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: '', label: 'No camera found' }]}
              />
            </Field>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <Button
                variant="ghost"
                onClick={() => (cameraPreviewOn ? stopCameraPreview() : void startCameraPreview())}
                disabled={stage !== 'idle' || !cameraOn}
              >
                {cameraPreviewOn ? 'Stop camera preview' : 'Preview camera'}
              </Button>
              <span className="field-hint" style={{ flex: 1 }}>
                Shows the live camera in the shape and corner below. The preview stays on this machine and is not recorded.
              </span>
            </div>
            <details className="record-details"><summary>Camera appearance<span>Shape, position & background</span></summary>
            <div className="stack" style={{ gap: 10, paddingTop: 10 }}>
              <div className="panel-title">Camera style (applied as a presenter layer)</div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Field label="Shape">
                    <Select
                      label="Bubble shape"
                      value={presenter.shape}
                      onChange={(value) => setPresenter((current) => ({ ...current, shape: value as PresenterProps['shape'] }))}
                      disabled={stage !== 'idle' || !cameraOn}
                      options={[
                        { value: 'circle', label: 'Round bubble' },
                        { value: 'rounded', label: 'Rounded square' },
                        { value: 'square', label: 'Square' },
                        { value: 'portrait', label: 'Portrait card (3:4)' },
                      ]}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Position">
                    <Select
                      label="Bubble position"
                      value={presenter.corner}
                      onChange={(value) => setPresenter((current) => ({ ...current, corner: value as PresenterProps['corner'] }))}
                      disabled={stage !== 'idle' || !cameraOn}
                      options={[
                        { value: 'bottom-right', label: 'Bottom right' },
                        { value: 'bottom-left', label: 'Bottom left' },
                        { value: 'top-right', label: 'Top right' },
                        { value: 'top-left', label: 'Top left' },
                      ]}
                    />
                  </Field>
                </div>
              </div>
              <Slider
                label="Size"
                min={0.08}
                max={0.6}
                step={0.01}
                value={presenter.size}
                format={(value) => `${Math.round(value * 100)}% of height`}
                onChange={(value) => setPresenter((current) => ({ ...current, size: value }))}
              />
              <Slider
                label="Shadow"
                min={0}
                max={60}
                step={1}
                value={presenter.shadow}
                format={(value) => (value === 0 ? 'none' : `${value} px`)}
                onChange={(value) => setPresenter((current) => ({ ...current, shadow: value }))}
              />
              <Slider
                label="Outline"
                min={0}
                max={24}
                step={1}
                value={presenter.border}
                format={(value) => (value === 0 ? 'none' : `${value} px`)}
                onChange={(value) => setPresenter((current) => ({ ...current, border: value }))}
              />
              {presenter.border > 0 && (
                <Field label="Outline colour">
                  <input
                    className="input"
                    type="color"
                    value={presenter.borderColor}
                    onChange={(event) => setPresenter((current) => ({ ...current, borderColor: event.target.value }))}
                    aria-label="Presenter outline colour"
                  />
                </Field>
              )}
              <Toggle
                label="Mirror camera (meeting-style)"
                checked={presenter.mirror}
                onChange={(value) => setPresenter((current) => ({ ...current, mirror: value }))}
                disabled={stage !== 'idle'}
              />
              <Toggle
                label="Visible in preview & export"
                checked={presenter.visible !== false}
                onChange={(value) => setPresenter((current) => ({ ...current, visible: value }))}
                disabled={stage !== 'idle'}
              />
              <Toggle
                label="Chroma key (experimental — green background)"
                checked={presenter.chromaKey}
                onChange={(value) => setPresenter((current) => ({ ...current, chromaKey: value }))}
                disabled={stage !== 'idle'}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetSelfView();
                  setPresenter(defaultPresenter());
                }}
              >
                Reset camera position
              </Button>
              <div className="field-hint">
                The camera is always recorded as its own full-size track. This style shapes the presenter layer on the
                timeline and can be changed later without re-recording.
              </div>
            </div>
            </details>
            <Field label="Microphone device">              <Select
                label="Microphone device"
                value={micId}
                onChange={setMicId}
                disabled={stage !== 'idle' || !micOn}
                options={devices.mic.length > 0 ? devices.mic.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: '', label: 'No microphone found' }]}
              />
            </Field>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" onClick={testMic} disabled={stage !== 'idle'}>
                {micTesting ? 'Re-test microphone' : 'Test microphone'}
              </Button>
              <span className="field-hint">Speech processing in the mix is applied later and is non-destructive.</span>
            </div>
            <div className="meter" aria-label="Microphone level">
              <div className="meter-fill" style={{ width: `${Math.round(meterPosition(micLevel?.peakDb ?? -Infinity) * 100)}%` }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)' }}>
              <span className="mono">{micLevel ? `${micLevel.peakDb.toFixed(1)} dBFS peak` : 'no signal'}</span>
              {micLevel?.clipping ? <Badge tone="danger">clipping — lower input gain</Badge> : null}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Field label="Quality target">
                  <Select
                    label="Quality target"
                    value={resolution}
                    disabled={stage !== 'idle'}
                    onChange={setResolution}
                    options={[
                      { value: '4k', label: '3840×2160 @ 30 — 4K' },
                      { value: '1440', label: '2560×1440' },
                      { value: '1080', label: '1920×1080' },
                    ]}
                  />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Frame rate">
                  <Select
                    label="Frame rate"
                    value={fps}
                    disabled={stage !== 'idle'}
                    onChange={setFps}
                    options={[
                      { value: '30', label: '30 fps' },
                      { value: '60', label: '60 fps (verify with benchmark)' },
                    ]}
                  />
                </Field>
              </div>
            </div>
            <div className="field-hint">
              Quality targets request capture size; the browser may deliver less. The actual track settings are shown
              below, and no 1080p source is ever labelled 4K.
            </div>
            </div></details>
          </Panel>

          <details className="record-details" open={stage !== 'idle' || Boolean(error) || warnings.length > 0}><summary>Take status & recording details</summary>
          <Panel title="Take" bodyClassName="stack">
            {stats ? (
              <div className="stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
                  <Stat label="Elapsed" value={formatElapsed(elapsedSeconds)} />
                  <Stat label="Written" value={formatBytes(stats.bytes)} />
                  <Stat label="Uncommitted" value={formatBytes(stats.uncommittedBytes)} hint="lost on a crash" />
                  <Stat label="Write latency" value={`${stats.writeLatencyMs.toFixed(1)} ms`} />
                </div>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>State</th>
                        <th>Chunks</th>
                        <th>Bytes</th>
                        <th>Committed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assetsByKey.map((asset) => (
                        <tr key={asset.key}>
                          <td>{asset.key}</td>
                          <td>{asset.state}</td>
                          <td className="mono">{asset.chunks}</td>
                          <td className="mono">{formatBytes(asset.bytes)}</td>
                          <td className="mono">{formatBytes(asset.committedBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="field-hint">
                  Commit interval {project.settings.segmentSeconds}s — a crash can lose at most that window; everything
                  before the last commit stays recoverable.
                </div>
              </div>
            ) : (
              <div className="field-hint">No take in progress. Start recording; stats appear here.</div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {(stage === 'countdown' || stage === 'recording' || stage === 'paused' || stage === 'finishing') && (
                <span className="field-hint">
                  Recording controls float at the bottom of the screen while a take is running; the live
                  mic meter is under "Microphone" above.
                </span>
              )}
            </div>
            {warnings.length > 0 && (
              <div className="warn-card" role="status" aria-live="polite">
                {warnings.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
            {error && (
              <div className="danger-card" role="alert">
                {error}
              </div>
            )}
          </Panel></details>
        </div>

        <div className="stack record-monitor-column" style={{ gap: 14 }}>
          <Panel title="Preview">
            <div
              style={{
                position: 'relative',
                background: '#05070a',
                borderRadius: 10,
                overflow: 'hidden',
                // The monitor is the project's canvas, not a fixed 16:9: a vertical
                // Instagram project must preview as vertical here too.
                aspectRatio: `${project.canvas.width} / ${project.canvas.height}`,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <video
                ref={previewRef}
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: isRecordingDisplaySurface && hideMonitorDuringDisplay ? 'none' : 'block',
                }}
                aria-label="Screen capture preview"
              />
              {isRecordingDisplaySurface && hideMonitorDuringDisplay && (
                <div
                  role="status"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--text-2)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    background: '#05070a',
                  }}
                >
                  <div className="stack" style={{ gap: 8, alignItems: 'center', maxWidth: 420 }}>
                    <strong>Live screen monitor hidden during display capture</strong>
                    <span>
                      Hiding the live screen mirror prevents the infinite hall-of-mirrors effect when recording your
                      entire screen. Your screen and camera tracks are recording normally.
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setHideMonitorDuringDisplay(false)}>
                      Show live monitor anyway
                    </Button>
                  </div>
                </div>
              )}
              {stage === 'idle' && !cameraReady && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--text-2)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    pointerEvents: 'none',
                  }}
                >
                  The screen preview appears when recording starts. Use Preview camera to check the bubble first.
                </div>
              )}
              {cameraOn && (
                <div
                  aria-label="Camera preview"
                  style={{
                    position: 'absolute',
                    // Same geometry the exporter uses; size is a fraction of the
                    // frame height and the corner margin is presenter.margin.
                    left: `${(bubble.x / previewCanvas.width) * 100}%`,
                    top: `${(bubble.y / previewCanvas.height) * 100}%`,
                    width: `${(bubble.width / previewCanvas.width) * 100}%`,
                    height: `${(bubble.height / previewCanvas.height) * 100}%`,
                    borderRadius:
                      presenter.shape === 'circle'
                        ? '50%'
                        : `${(bubble.radius / bubble.width) * 100}% / ${(bubble.radius / bubble.height) * 100}%`,
                    overflow: 'hidden',
                    boxShadow:
                      presenter.shadow > 0
                        ? `0 ${Math.max(2, bubble.height * 0.012)}px ${Math.max(4, bubble.height * 0.04)}px rgba(0,0,0,${Math.min(0.7, presenter.shadow / 30)})`
                        : 'none',
                    outline: presenter.border > 0 ? `2px solid ${presenter.borderColor}` : 'none',
                    background: '#11161a',
                  }}
                >
                  <video
                    ref={cameraPreviewRef}
                    muted
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      transform: presenter.mirror ? 'scaleX(-1)' : 'none',
                      display: cameraReady ? 'block' : 'none',
                    }}
                  />
                  {!cameraReady && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 8,
                        lineHeight: 1.1,
                        color: 'var(--text-3)',
                        textAlign: 'center',
                        padding: 2,
                        overflow: 'hidden',
                      }}
                    >
                      camera
                    </div>
                  )}
                </div>
              )}
              {stage === 'recording' && (
                <div className="rec-monitor-tag" aria-hidden>
                  <span className="rec-dot small" />
                  REC <span className="mono">{formatElapsed(elapsedSeconds)}</span>
                </div>
              )}
              {stage === 'paused' && <div className="rec-monitor-tag paused">PAUSED</div>}
              {stage === 'countdown' && (
                <div className="rec-countdown" aria-hidden>
                  {countdown}
                </div>
              )}
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {settingsReport.map((report) => (
                <div key={report.label} className="row" style={{ gap: 8, fontSize: 12 }}>
                  <Badge tone={report.native ? 'ok' : 'warn'}>{report.label}</Badge>
                  <span style={{ color: 'var(--text-2)' }}>{report.message}</span>
                </div>
              ))}
            </div>
          </Panel>

          <details className="record-details" open><summary>Capture quality report<span>Actual track settings</span></summary>
          <Panel title="Applied track settings">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Size</th>
                    <th>Rate</th>
                    <th>Audio</th>
                  </tr>
                </thead>
              <tbody>
                {screenTracks.filter((track) => track.kind === 'video').map((track) => {
                  const report = reportTrackSettings(track, 'Screen');
                  return (
                    <tr key={track.id}>
                      <td>Screen</td>
                      <td className="mono">{report.width}×{report.height}</td>
                      <td className="mono">{report.frameRate} fps</td>
                      <td>{screenTracks.some((t) => t.kind === 'audio') ? 'yes' : 'no'}</td>
                    </tr>
                  );
                })}
                {cameraTracks.filter((track) => track.kind === 'video').map((track) => {
                  const report = reportTrackSettings(track, 'Camera');
                  const compared = compareSettings({ width: dimensions.width, height: dimensions.height, frameRate }, track.getSettings());
                  return (
                    <tr key={track.id}>
                      <td>Camera</td>
                      <td className="mono">{report.width}×{report.height}</td>
                      <td className="mono">
                        {report.frameRate} fps
                        {compared.mismatches.some((m) => m.field === 'frameRate') ? ` (asked ${frameRate})` : ''}
                      </td>
                      <td>—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>
              Compare requested and applied values; browsers silently clamp capture sizes on some machines.
            </div>
          </Panel>

          </details>
          {takes.length > 0 && (
            <Panel title={`Takes in this project (${takes.length})`}>
              <div className="stack" style={{ gap: 8 }}>
                {takes.map((take) => {
                  const used = project ? takeIdsOf(project).includes(take.takeId) : false;
                  return (
                    <div key={take.takeId} className="stack" style={{ gap: 4, border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="mono" style={{ fontSize: 11.5 }}>{take.takeId}</span>
                        <span className="row" style={{ gap: 6 }}>
                          {take.interrupted ? <Badge tone="warn">interrupted</Badge> : <Badge tone="ok">finished</Badge>}
                          {used && <Badge>on timeline</Badge>}
                        </span>
                      </div>
                      <div className="field-hint">
                        Started {new Date(take.manifest.startedAt).toLocaleString()} · committed{' '}
                        {formatBytes(take.manifest.assets.reduce((sum, asset) => sum + asset.committedBytes, 0))}
                      </div>
                      {!used && (
                        <div className="row" style={{ gap: 8 }}>
                          <Button size="sm" onClick={() => void recoverTake(take)}>
                            Add to timeline
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void deleteTakeFiles(take.takeId)}>
                            Delete files
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {recoveryReport && <pre className="danger-card mono" style={{ whiteSpace: 'pre-wrap', fontSize: 11.5 }}>{recoveryReport}</pre>}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="danger" onClick={() => setCleanOpen(true)}>
                    Clean all unused recordings…
                  </Button>
                  <span className="field-hint">
                    Deletes take folders this timeline does not use. Takes referenced by clips are always kept.
                  </span>
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Dialog
        open={restartOpen}
        onClose={() => setRestartOpen(false)}
        title="Restart this take?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestartOpen(false)}>
              Keep recording
            </Button>
            <Button variant="danger" onClick={() => void confirmRestart()}>
              Discard and restart
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.6 }}>
          This abandons the current take{activeTakeId ? <> (<span className="mono">{activeTakeId}</span>)</> : null}&apos;s files and starts a new countdown. Existing media in the project is never
          deleted by this action.
        </p>
      </Dialog>

      <Dialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard this take?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
              Keep recording
            </Button>
            <Button variant="danger" onClick={() => void discard()}>
              Discard take
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.6 }}>
          The recorded files for this take{activeTakeId ? <> (<span className="mono">{activeTakeId}</span>)</> : null} will be abandoned and not added to the project. Existing media is never
          deleted by this action.
        </p>
      </Dialog>

      <Dialog
        open={cleanOpen}
        onClose={() => (cleanBusy ? undefined : setCleanOpen(false))}
        title="Delete unused recordings?"
        footer={
          <>
            <Button variant="ghost" disabled={cleanBusy} onClick={() => setCleanOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={cleanBusy || unreferencedTakes.length === 0} onClick={() => void cleanRecordings()}>
              {cleanBusy
                ? 'Deleting…'
                : unreferencedTakes.length === 0
                  ? 'Nothing to delete'
                  : `Delete ${unreferencedTakes.length} unused take${unreferencedTakes.length === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.6 }}>
          This deletes every take folder under this project&apos;s{' '}
          <span className="mono">recordings/</span> that no clip on the timeline references. Imported media, exports
          and captions are never touched. Takes currently in use are kept.
        </p>
        <p style={{ margin: '10px 0 0', color: 'var(--text-2)', lineHeight: 1.6 }}>
          {unreferencedTakes.length === 0
            ? 'Every take under recordings/ is used by the current timeline.'
            : `${unreferencedTakes.length} of ${takes.length} take${takes.length === 1 ? '' : 's'} under recordings/ ${unreferencedTakes.length === 1 ? 'is' : 'are'} unused and will be deleted.`}
        </p>
      </Dialog>

      <Dialog
        open={takeResult !== null}
        onClose={() => {
          setTakeResult(null);
          void refreshTakes();
        }}
        title="Recording finished"
        footer={
          <>
            <Button
              variant="danger"
              disabled={downloadingOriginals}
              onClick={() => void discardFinishedTake(takeResult!)}
            >
              Discard this take
            </Button>
            <Button
              variant="ghost"
              disabled={downloadingOriginals}
              onClick={() => {
                // Keep the files, but make them re-addable from the takes panel.
                setTakeResult(null);
                useSession
                  .getState()
                  .pushToast("Take kept on disk. Use 'Add to timeline' in the takes panel to insert it.", 'info');
                void refreshTakes();
              }}
            >
              Record another take
            </Button>
            <Button
              variant="ghost"
              disabled={downloadingOriginals}
              onClick={() => void downloadOriginals(takeResult!)}
            >
              {downloadingOriginals ? 'Preparing…' : 'Download originals'}
            </Button>
            <Button variant="ghost" onClick={() => void saveSessionToFolder()}>
              {session.storageMode === 'fsa' ? 'Save a copy…' : 'Save to a folder…'}
            </Button>
            <Button variant="primary" onClick={() => insertTake(takeResult!)}>
              Edit recording
            </Button>
          </>
        }
      >
        {takeResult && (
          <div className="stack">
            <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
              <Stat label="Duration" value={formatElapsed(takeResult.durationTicks / TICKS_PER_SECOND)} />
              <Stat label="Assets" value={takeResult.assets.length} />
              <Stat
                label="Data"
                value={formatBytes(takeResult.manifest.assets.reduce((sum: number, asset) => sum + asset.committedBytes, 0))}
              />
            </div>
            {takeResult.warnings.length > 0 && (
              <div className="warn-card">
                {takeResult.warnings.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            )}
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Size</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {takeResult.assets.map((asset) => (
                    <tr key={asset.path}>
                      <td>{asset.name}</td>
                      <td className="mono">
                        {formatBytes(takeResult.manifest.assets.find((entry) => entry.path === asset.path)?.committedBytes ?? 0)}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={downloadingOriginals}
                          onClick={() =>
                            void downloadOriginal(asset).catch((err: unknown) =>
                              useSession
                                .getState()
                                .pushToast(`Could not download ${asset.name}: ${(err as Error).message}`, 'error'),
                            )
                          }
                        >
                          Download
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="field-hint">
              <strong>Edit recording</strong> adds the take to the timeline and opens editing. <strong>Download
              originals</strong> saves each source file (screen, camera, microphone) separately — this is not a
              composited export. <strong>Record another take</strong> keeps these files on disk without adding them yet;
              the takes panel can add them later, even after a reload. <strong>Discard this take</strong> deletes this
              take's files and nothing else.
            </div>
            <div className="field-hint">
              Original sources stay in the project's <span className="mono">recordings/</span> folder and are never
              overwritten by editing.
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

type TakeRole = 'screen' | 'camera' | 'mic' | 'system';

/**
 * Which track a take asset belongs on. System audio is checked first: it used
 * to match the microphone regex and overwrite the narrator on the same track.
 */
export function takeRole(asset: { name: string; kind: string }): TakeRole {
  if (/system|tab audio|desktop audio|game audio/i.test(asset.name)) return 'system';
  if (/camera|webcam/i.test(asset.name)) return 'camera';
  if (/mic|narration|voice/i.test(asset.name)) return 'mic';
  return asset.kind === 'audio' ? 'mic' : 'screen';
}

const TRACK_FOR_ROLE: Record<TakeRole, { kind: 'video' | 'audio'; name: string; alias: RegExp }> = {
  screen: { kind: 'video', name: 'Screen', alias: /screen|display/i },
  camera: { kind: 'video', name: 'Camera', alias: /camera|webcam/i },
  mic: { kind: 'audio', name: 'Narration', alias: /narration|voice|mic/i },
  system: { kind: 'audio', name: 'System audio', alias: /system/i },
};

/** Old takes leave audio-only assets on whichever audio track exists. */
function trackForRole(project: Project, role: TakeRole) {
  const want = TRACK_FOR_ROLE[role];
  return (
    project.tracks.find((track) => track.kind === want.kind && track.name === want.name) ??
    project.tracks.find((track) => track.kind === want.kind && want.alias.test(track.name))
  );
}

/** Re-exported for callers that only need the append point. */
export { nextFreeStart } from '../project/ops';

/**
 * Place every asset of a take (live, recovered or kept on disk) on its own
 * track at `startTicks`, with the camera carrying the presenter bubble and all
 * clips clamped to the take duration.
 */
export function placeTake(
  project: Project,
  assets: Project['assets'],
  startTicks: number,
  presenter: PresenterProps,
): Project {
  let working = project;
  // One link id for the whole take: moving or splitting any source keeps the
  // screen, camera and microphone on the same cut. Pause/resume is already
  // reflected in the shared clock; the link preserves it during editing.
  const linkId = newId('link');
  for (const asset of assets) {
    const role = takeRole(asset);
    let track = trackForRole(working, role);
    if (!track) {
      track = createTrack(TRACK_FOR_ROLE[role].kind, TRACK_FOR_ROLE[role].name);
      working = ops.addTrack(working, track);
    }
    const placed = ops.addAssetClip(working, track.id, asset.id, startTicks, { mode: 'overwrite' });
    working = placed.project;
    working = ops.updateClip(working, placed.clipId, { linkId, ...(role === 'camera' ? { presenter } : {}) });
    const clip = ops.findClipById(working, placed.clipId);
    if (clip) {
      working = ops.trimEnd(
        working,
        placed.clipId,
        Math.min(clip.startTicks + asset.durationTicks, clip.startTicks + clip.durationTicks),
      );
    }
  }
  return working;
}

/** Take ids referenced by any asset of this project, including segment paths. */
export { takeIdsOf } from '../workspace/takeRefs';
/**
 * Translate the browser's permission phrases into something actionable. Chrome
 * reports a cancelled screen picker as "Permission denied", which used to read
 * like a revoked permission instead of "you closed the picker".
 */
export function describeCaptureError(raw: string): string {
  if (/NotAllowedError|Permission denied|permission|denied/i.test(raw)) {
    if (/getDisplayMedia|display|share|screen/i.test(raw)) {
      return 'Screen sharing was cancelled or blocked. Nothing is recording. Choose a screen and try again.';
    }
    return 'Camera or microphone permission was denied. Allow access in the browser’s site settings and try again.';
  }
  if (/NotFoundError|Requested device not found|no .*track|returned no/i.test(raw)) {
    return `A selected device is unavailable (${raw}). Pick another device or turn that source off, then try again.`;
  }
  if (/NotReadableError|TrackStartError/i.test(raw)) {
    return 'The camera or microphone is in use by another application. Close it and try again.';
  }
  return raw;
}

function formatElapsed(seconds: number): string {  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
