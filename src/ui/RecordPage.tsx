import { useEffect, useMemo, useRef, useState } from 'react';
import { RecordingActions } from './RecordingActions';
import { SvgIcon, type IconName } from './icons';
import { useSession } from '../app/session';
import { useEditor } from '../project/store';
import {
  Badge,
  Button,
  Dialog,
  Field,
  Panel,
  Select,
  Slider,
  Stat,
  Toggle,
} from './components';
import {
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
  describeReturnedSurface,
  reportTrackSettings,
  reportedSurface,
} from '../capabilities/detect';
import { CaptureSession, type CaptureStats, type CaptureAssetSpec, type TakeResult } from '../capture/recorder';
import { checkStorageHeadroom, deleteTake, listTakes } from '../workspace/workspace';
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
import type { TakeSummary } from '../workspace/types';
import * as ops from '../project/ops';
import { createTrack, defaultPresenter } from '../project/factory';
import { formatBytes } from '../export/presets';
import { TICKS_PER_SECOND } from '../core/time';
import {
  PRESENTER_BUBBLE_EFFECTS,
  PRESENTER_BUBBLE_SHAPES,
  clamp,
} from '../render/layout';
import { CameraBubble } from './CameraBubble';
import {
  detectFloatingCameraSupport,
  loadTeleprompterPrefs,
  openFloatingCamera,
  saveTeleprompterPrefs,
  teleprompterPixelsPerSecond,
  type FloatingCameraSession,
  type TeleprompterState,
} from '../capture/floatingCamera';
import {
  describeCapMode,
  QUIET_MODES,
  resolveCameraLayerVisibility,
  type CameraDuplicationMode,
  type CapMode,
  type QuietMode,
} from '../capture/stateMachine';
import { RecordingsLibrary } from './RecordingsLibrary';
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
  const [capMode, setCapMode] = useState<CapMode>('studio');
  /** What happens after a take stops: open editor, review/download, or just save to library. */
  const [afterStopAction, setAfterStopAction] = useState<'edit' | 'review' | 'none'>('edit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showMonitor, setShowMonitor] = useState(false);
  const [teleprompter, setTeleprompter] = useState<TeleprompterState>(() => loadTeleprompterPrefs());
  const teleprompterScrollRef = useRef<HTMLDivElement>(null);
  const updateTeleprompter = (patch: Partial<TeleprompterState>) => {
    setTeleprompter((prev) => {
      const next = { ...prev, ...patch };
      saveTeleprompterPrefs(next);
      return next;
    });
  };
  const [quietMode, setQuietMode] = useState<QuietMode>('full');
  const [controlsHidden, setControlsHidden] = useState(false);
  const [reviewTrimIn, setReviewTrimIn] = useState(0);
  const [reviewTrimOut, setReviewTrimOut] = useState(0);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState<string | null>(null);
  const [cameraDuplicationMode, setCameraDuplicationMode] = useState<CameraDuplicationMode>('baked-in-screen');
  /** Quality preset: balanced (default), smaller files, or maximum detail. */
  const [qualityPreset, setQualityPreset] = useState<'balanced' | 'smaller' | 'maximum'>('balanced');
  /** Configurable recording shortcuts. Stored in localStorage, defaults match Cap-style keys. */
  const [shortcuts, setShortcuts] = useState<Record<'pause' | 'stop' | 'marker' | 'mute' | 'hide', string>>(JSON.parse(localStorage.getItem('browser-record.shortcuts') ?? '{}') || {
    pause: 'p',
    stop: 's',
    marker: 'm',
    mute: 'u',
    hide: 'h',
  });
  const [postRecordTitle, setPostRecordTitle] = useState('');
  const [hideFloatingPreview, setHideFloatingPreview] = useState(false);
  const [hideMonitorDuringDisplay, setHideMonitorDuringDisplay] = useState(true);
  const stoppingRef = useRef(false);
  const [stage, setStage] = useState<Stage>('idle');
  const preparedSpecsRef = useRef<CaptureAssetSpec[] | null>(null);
  const [preparedSummary, setPreparedSummary] = useState<PreparedSourceSummary | null>(null);
  const floatingCameraRef = useRef<FloatingCameraSession | null>(null);
  const pipHandlersRef = useRef<{
    start: () => void;
    togglePause: () => void;
    stopTake: () => void;
    restart: () => void;
    discard: () => void;
    toggleMicMute: () => void;
  }>({
    start: () => undefined,
    togglePause: () => undefined,
    stopTake: () => undefined,
    restart: () => undefined,
    discard: () => undefined,
    toggleMicMute: () => undefined,
  });
  const [floatingCameraOpen, setFloatingCameraOpen] = useState(false);
  const floatingSupport = useMemo(() => detectFloatingCameraSupport(), []);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenOn, setScreenOn] = useState(true);
  const [systemAudio, setSystemAudio] = useState(false);
  const [surface, setSurface] = useState<'screen' | 'window' | 'tab'>('screen');
  const [presenter, setPresenter] = useState<PresenterProps>(() => defaultPresenter());
  // Default to 4K (3840×2160 @ 30) with 4× smaller Ultra-Compact VBR so screen and
  // terminal captures start at full 4K clarity while using ~3.6 Mbps.
  const [resolution, setResolution] = useState<CaptureResolution>(() =>
    project && Math.max(project.canvas.width, project.canvas.height) >= 2560
      ? resolutionForCanvas(project.canvas)
      : '4k',
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
  /** Area capture: full-screen region selector overlay state. */
  const [areaMode, setAreaMode] = useState(false);
  const [areaSelection, setAreaSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [areaAspectRatio, setAreaAspectRatio] = useState<'free' | '16:9' | '4:3' | '1:1' | '9:16'>('free');
  /** Cropped stream produced from the full-screen capture for area recording. */
  const areaCroppedStreamRef = useRef<MediaStream | null>(null);
  /** Video element used to play the full-screen capture so we can crop it to canvas. */
  const areaSourceVideoRef = useRef<HTMLVideoElement | null>(null);
  /** Canvas used to crop the full-screen capture to the selected region. */
  const areaCropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Animation frame loop for cropping full-screen → region stream. */
  const areaCropLoopRef = useRef<number | null>(null);
  const [devices, setDevices] = useState<{ mic: DeviceChoice[]; camera: DeviceChoice[] }>({ mic: [], camera: [] });
  const [micId, setMicId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [micLevel, setMicLevel] = useState<MeterReading | null>(null);
  const [stats, setStats] = useState<CaptureStats | null>(null);
  /** Device info reported after opening camera/mic streams (resolution, fps, sample rate). */
  const [cameraDeviceInfo, setCameraDeviceInfo] = useState<string | null>(null);
  const [micDeviceInfo, setMicDeviceInfo] = useState<string | null>(null);
  // Warnings are a list: a surface mismatch, a missing system-audio track and a
  // recorder warning can all be true at once, and one slot made the last win.
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [takeResult, setTakeResult] = useState<TakeResult | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [takes, setTakes] = useState<TakeSummary[]>([]);
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
  const micStream = useRef<MediaStream | null>(null);
  /** Muted by the small control bar; the track is kept alive so resume is instant. */
  const [micMuted, setMicMuted] = useState(false);
  const micMeter = useRef<InputMeter | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  /** Floating self-view shown during a take, so the bubble stays on screen when the monitor scrolls away. */
  const selfViewRef = useRef<HTMLVideoElement>(null);
  const [cameraPreviewOn, setCameraPreviewOn] = useState(false);
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const sessionStats = useRef<CaptureStats | null>(null);
  /** Camera stream owned by the live preview; handed to the take when recording starts. */
  const cameraPreviewStream = useRef<MediaStream | null>(null);
  const previewStarting = useRef(false);
  const captureRef = useRef<CaptureSession | null>(null);
  /** Latest camera-source toggle, so an in-flight permission prompt can bail out. */
  const cameraOnRef = useRef(cameraOn);

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

  useEffect(() => {
    try {
      if (selfViewPos) localStorage.setItem(SELF_VIEW_KEY, JSON.stringify(selfViewPos));
      else localStorage.removeItem(SELF_VIEW_KEY);
    } catch {
      // Ignore storage quota errors
    }
  }, [selfViewPos]);

  useEffect(() => {
    try {
      localStorage.setItem('browser-record.shortcuts', JSON.stringify(shortcuts));
    } catch {
      // Ignore storage quota errors
    }
  }, [shortcuts]);

  // A window that shrinks must not leave the bubble off-screen.
  useEffect(() => {
    const onResize = () => {
      setSelfViewPos((current) =>
        current
          ? {
              x: clamp(current.x, 8, Math.max(8, window.innerWidth - 196)),
              y: clamp(current.y, 8, Math.max(8, window.innerHeight - 196)),
            }
          : current,
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Double-click the bubble or click reset to return it to its default corner. */
  const resetSelfView = () => {
    try {
      localStorage.removeItem(SELF_VIEW_KEY);
    } catch {
      // Ignore
    }
    setSelfViewPos(null);
  };

  const addWarning = (message: string) => {
    if (!mountedRef.current) return;
    setWarnings((current) => (current.includes(message) ? current : [...current, message]));
  };

  const dimensions = captureDimensions(resolution);
  const frameRate = fps === '60' ? 60 : 30;
  const isRecording =
    stage === 'countdown' || stage === 'recording' || stage === 'paused' || stage === 'finishing';
  const isRecordingDisplaySurface =
    isRecording && screenOn && (surface === 'screen' || surface === 'window' || surface === 'tab');

  // Opening Record without a project prepares a temporary local session. This
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

  // Follow the project's canvas once per project if it was explicitly set to 1440p/4K;
  // otherwise keep 4K capture target as the default.
  useEffect(() => {
    if (!project || initialisedFor.current === project.id) return;
    initialisedFor.current = project.id;
    if (Math.max(project.canvas.width, project.canvas.height) >= 2560) {
      setResolution(resolutionForCanvas(project.canvas));
    }
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
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      const next = captureRef.current?.stats();
      if (!next || !mountedRef.current) return;
      sessionStats.current = next;
      setStats(next);
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

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
    setMicMuted(false);
    micMeter.current?.stop();
    micMeter.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = null;
    if (selfViewRef.current) selfViewRef.current.srcObject = null;
    stopAreaCropLoop();
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    wakeLockGen.current += 1;
    if (lock) void lock.release().catch(() => undefined);
  };

  /**
   * Live camera preview so the bubble shape, position and effects can be
   * judged before recording. Local only: nothing from this stream is written.
   */
  const startCameraPreview = async (): Promise<MediaStream | null> => {
    if (cameraPreviewStream.current) return cameraPreviewStream.current;
    if (cameraStream.current) return cameraStream.current;
    if (previewStarting.current) return null;
    previewStarting.current = true;
    setError(null);
    try {
      const stream = await openCamera(cameraId || undefined, dimensions.width, dimensions.height, frameRate);
      // The permission prompt can outlive the page or the camera source being
      // switched off; a stream nobody owns would keep the camera light on.
      if (!mountedRef.current || !cameraOnRef.current) {
        stopStream(stream);
        return null;
      }
      cameraPreviewStream.current = stream;
      setCameraPreviewOn(true);
      const track = stream.getVideoTracks()[0];
      if (track) {
        const s = track.getSettings?.() ?? {};
        const w = s.width ?? 0;
        const h = s.height ?? 0;
        const fps = Math.round(s.frameRate ?? 0);
        setCameraDeviceInfo(`${w}×${h} @ ${fps}fps${s.deviceId ? ` · ${s.deviceId.slice(0, 8)}…` : ''}`);
      }
      floatingCameraRef.current?.updateStream(stream);
      if (selfViewRef.current) {
        selfViewRef.current.srcObject = stream;
        void selfViewRef.current.play().catch(() => undefined);
      }
      const element = cameraPreviewRef.current;
      if (!element) {
        return stream;
      }
      element.srcObject = stream;
      try {
        // Ready only after the frame actually plays: a dead camera must not
        // render as a frozen "live" picture.
        await element.play();
      } catch (err) {
        addWarning(`Camera preview could not start playing: ${(err as Error).message}`);
      }
      return stream;
    } catch (err) {
      setError(`Camera preview unavailable: ${(err as Error).message}`);
      return null;
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
    try {
      const existingStream = cameraOn ? (cameraStream.current ?? cameraPreviewStream.current) : null;
      // CRITICAL: Call openFloatingCamera synchronously on the click gesture BEFORE awaiting
      // getUserMedia so Chrome's transient user activation is still active for requestWindow().
      const streamPromise = cameraOn && !existingStream ? startCameraPreview() : undefined;
      const pipSession = await openFloatingCamera({
        stream: existingStream,
        streamPromise,
        videoElement: selfViewRef.current ?? cameraPreviewRef.current,
        presenter,
        initialControlState: {
          stage,
          elapsedText: formatElapsed(((stats?.elapsedMs ?? 0) / 1000)),
          previewHidden: hideFloatingPreview || !cameraOn,
          micMuted,
          hasCamera: cameraOn,
        },
        initialTeleprompter: teleprompter,
        onStartRecord: () => pipHandlersRef.current.start(),
        onTogglePause: () => pipHandlersRef.current.togglePause(),
        onStop: () => pipHandlersRef.current.stopTake(),
        onRestart: () => pipHandlersRef.current.restart(),
        onDiscard: () => pipHandlersRef.current.discard(),
        onToggleMic: () => pipHandlersRef.current.toggleMicMute(),
        onToggleHidePreview: () => setHideFloatingPreview((prev) => !prev),
        onUpdatePresenter: (patch) => setPresenter((prev) => ({ ...prev, ...patch })),
        onUpdateTeleprompter: (patch) => updateTeleprompter(patch),
        onClose: () => {
          floatingCameraRef.current = null;
          if (mountedRef.current) {
            setFloatingCameraOpen(false);
          }
        },
      });
      floatingCameraRef.current = pipSession;
      setFloatingCameraOpen(true);
    } catch (err) {
      setError(`Floating camera unavailable: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    floatingCameraRef.current?.updateTeleprompter(teleprompter);
  }, [teleprompter]);

  useEffect(() => {
    if (!teleprompter.playing) return;
    const timer = window.setInterval(() => {
      const box = teleprompterScrollRef.current;
      if (!box) return;
      const pxPerSec = teleprompterPixelsPerSecond(teleprompter.wpm, teleprompter.fontSize);
      box.scrollTop += Math.max(1, Math.round((pxPerSec * 50) / 1000));
    }, 50);
    return () => window.clearInterval(timer);
  }, [teleprompter.playing, teleprompter.wpm, teleprompter.fontSize]);

  // Turning the camera source off must not leave the device light on.
  useEffect(() => {
    cameraOnRef.current = cameraOn;
    if (!cameraOn && cameraPreviewStream.current) stopCameraPreview();
  }, [cameraOn]);

  // Register MediaSession enterpictureinpicture + hardware media key handlers (pause/play/stop)
  // so OS media keys and background/fullscreen tabs can control an active take.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession?.setActionHandler) {
      return;
    }
    const ms = navigator.mediaSession;
    const trySetHandler = (action: string, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        // Action not supported in this browser version
      }
    };
    trySetHandler('enterpictureinpicture', () => {
      if (!floatingCameraRef.current && cameraOnRef.current) {
        void toggleFloatingCamera();
      }
    });
    if (stage === 'recording' || stage === 'paused') {
      try {
        ms.playbackState = stage === 'recording' ? 'playing' : 'paused';
        if (typeof MediaMetadata !== 'undefined') {
          ms.metadata = new MediaMetadata({
            title: stage === 'paused' ? 'Paused recording' : 'Recording take',
            artist: project?.name ?? 'Browser 4K Studio',
            album: 'Browser 4K Studio',
          });
        }
      } catch {
        // Ignore MediaMetadata errors in headless/stub environments
      }
      trySetHandler('pause', () => {
        if (stage === 'recording') pipHandlersRef.current.togglePause();
      });
      trySetHandler('play', () => {
        if (stage === 'paused') pipHandlersRef.current.togglePause();
      });
      trySetHandler('stop', () => {
        pipHandlersRef.current.stopTake();
      });
    } else {
      try {
        ms.playbackState = 'none';
      } catch {
        // Ignore
      }
      trySetHandler('pause', null);
      trySetHandler('play', null);
      trySetHandler('stop', null);
    }
    return () => {
      trySetHandler('enterpictureinpicture', null);
      trySetHandler('pause', null);
      trySetHandler('play', null);
      trySetHandler('stop', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, project?.name]);

  // The floating self-view mounts when camera preview or a take starts, so hand it the live stream.
  useEffect(() => {
    const element = selfViewRef.current;
    if (!element) return;
    const stream = cameraStream.current ?? cameraPreviewStream.current;
    if (!stream || element.srcObject === stream) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
  }, [stage, cameraPreviewOn, floatingCameraOpen]);

  const acquireSources = async (): Promise<CaptureAssetSpec[]> => {
    const specs: CaptureAssetSpec[] = [];
    if (screenOn) {
      let stream: MediaStream;
      let actualWidth = dimensions.width;
      let actualHeight = dimensions.height;
      try {
        if (areaMode) {
          // Area capture: capture the full screen, then crop to the selected region
          // via a canvas captureStream so MediaRecorder only records the region.
          if (!areaSelection) throw new Error('No area selected. Draw a capture region before starting.');
          const cropped = await startAreaCropLoop();
          if (!cropped) throw new Error('Area capture could not start.');
          stream = cropped;
          const croppedTrack = stream.getVideoTracks()[0];
          if (!croppedTrack) throw new Error('Area capture returned no video track.');
          const report = reportTrackSettings(croppedTrack, 'Screen (area)');
          actualWidth = report.width || dimensions.width;
          actualHeight = report.height || dimensions.height;
          screenStream.current = stream;
          setScreenTracks([...stream.getVideoTracks(), ...stream.getAudioTracks()]);
          const videoTrack = stream.getVideoTracks()[0];
          if (!videoTrack) throw new Error('Area capture returned no video track.');
          videoTrack.addEventListener('ended', () => {
            setScreenTracks([]);
            addWarning('Screen sharing was stopped from the browser bar.');
            void stopTake();
          });
          specs.push({
            key: 'screen',
            kind: 'screen',
            name: 'Screen (area)',
            stream,
            mimeType: chooseRecorderMime('video', false) || 'video/webm',
            width: actualWidth,
            height: actualHeight,
          });
        } else {
          stream = await navigator.mediaDevices.getDisplayMedia(
            displayConstraints({ width: dimensions.width, height: dimensions.height, frameRate, systemAudio, surface }),
          );
        }
      } catch (error) {
        // Chrome reports a closed picker as NotAllowedError; name the surface so
        // the message says "sharing was cancelled", not "microphone denied".
        throw new Error(`Screen sharing was cancelled or blocked: ${(error as Error).message}`, { cause: error });
      }
      if (!areaMode) {
        screenStream.current = stream;
        setScreenTracks([...stream.getVideoTracks(), ...stream.getAudioTracks()]);
        const video = stream.getVideoTracks()[0];
        if (!video) throw new Error('The screen picker returned no video track.');
        const report = reportTrackSettings(video, 'Screen');
        const actualSurface = reportedSurface(video.getSettings());
        const surfaceLabel = actualSurface === 'screen' ? 'entire screen' : actualSurface === 'window' ? 'a window' : actualSurface === 'tab' ? 'a browser tab' : 'unknown surface';
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
          width: actualWidth,
          height: actualHeight,
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
      const camTrack = stream.getVideoTracks()[0];
      if (camTrack) {
        const s = camTrack.getSettings?.() ?? {};
        const w = s.width ?? 0;
        const h = s.height ?? 0;
        const fps = Math.round(s.frameRate ?? 0);
        setCameraDeviceInfo(`${w}×${h} @ ${fps}fps${s.deviceId ? ` · ${s.deviceId.slice(0, 8)}…` : ''}`);
      }
      floatingCameraRef.current?.updateStream(stream);
      if (selfViewRef.current) {
        selfViewRef.current.srcObject = stream;
        void selfViewRef.current.play().catch(() => undefined);
      }
      const cameraElement = cameraPreviewRef.current;
      if (cameraElement) {
        cameraElement.srcObject = stream;
        try {
          await cameraElement.play();
        } catch (err) {
          addWarning(`Camera preview could not start playing: ${(err as Error).message}`);
        }
      }
      const video = stream.getVideoTracks()[0];
      if (!video) throw new Error('The camera returned no video track.');
      const report = reportTrackSettings(video, 'Camera');
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
      const micTrackSettings = audio.getSettings?.() ?? {};
      setMicDeviceInfo(`${Math.round(micTrackSettings.sampleRate ?? 0)} Hz${micTrackSettings.channelCount ? ` · ${micTrackSettings.channelCount} ch` : ''}${micTrackSettings.deviceId ? ` · ${micTrackSettings.deviceId.slice(0, 8)}…` : ''}`);
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

  /** Aspect-ratio target dimensions for a given region box. */
  const areaAspectRatioDimensions = (box: { width: number; height: number }, ratio: typeof areaAspectRatio): { width: number; height: number } => {
    if (ratio === 'free') return box;
    const [rw, rh] = ratio === '16:9' ? [16, 9] : ratio === '4:3' ? [4, 3] : ratio === '1:1' ? [1, 1] : [9, 16];
    const targetW = Math.round(box.width * (rw / rh));
    const targetH = Math.round(box.height * (rh / rw));
    // Fit within the box, keeping the requested aspect ratio.
    if (targetW <= box.width && targetH <= box.height) {
      return targetH * (rw / rh) <= box.width ? { width: Math.round(targetH * (rw / rh)), height: targetH } : { width: targetW, height: Math.round(targetW * (rh / rw)) };
    }
    const scale = Math.min(box.width / targetW, box.height / targetH);
    return { width: Math.round(targetW * scale), height: Math.round(targetH * scale) };
  };

  /** Quality preset multiplier applied to the recording bitrate. */
  const qualityMultiplier = (): number => qualityPreset === 'smaller' ? 0.5 : qualityPreset === 'maximum' ? 2 : 1;

  /** Start capturing the full screen and cropping to the selected region via canvas. */
  const startAreaCropLoop = async (): Promise<MediaStream | null> => {
    if (!areaSelection) return null;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(
        displayConstraints({ width: dimensions.width, height: dimensions.height, frameRate, systemAudio: false, surface: 'screen' }),
      );
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error('Area capture returned no video track.');
      const videoEl = document.createElement('video');
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => undefined);
      areaSourceVideoRef.current = videoEl;

      const canvas = document.createElement('canvas');
      const dims = areaAspectRatioDimensions(areaSelection, areaAspectRatio);
      canvas.width = dims.width;
      canvas.height = dims.height;
      areaCropCanvasRef.current = canvas;

      const cropped = canvas.captureStream(frameRate);
      areaCroppedStreamRef.current = cropped;

      const draw = () => {
        if (!areaSourceVideoRef.current || !areaCropCanvasRef.current || !areaCroppedStreamRef.current) return;
        const ctx = areaCropCanvasRef.current.getContext('2d');
        if (!ctx) return;
        const vw = areaSourceVideoRef.current.videoWidth || dimensions.width;
        const vh = areaSourceVideoRef.current.videoHeight || dimensions.height;
        const sel = areaSelection;
        const sx = Math.max(0, Math.min(vw, sel.x / window.innerWidth * vw));
        const sy = Math.max(0, Math.min(vh, sel.y / window.innerHeight * vh));
        const sw = Math.max(1, Math.min(vw - sx, sel.width / window.innerWidth * vw));
        const sh = Math.max(1, Math.min(vh - sy, sel.height / window.innerHeight * vh));
        ctx.drawImage(areaSourceVideoRef.current, sx, sy, sw, sh, 0, 0, dims.width, dims.height);
        areaCropLoopRef.current = requestAnimationFrame(draw);
      };
      draw();
      return cropped;
    } catch (err) {
      setError(`Area capture failed: ${(err as Error).message}`);
      stopAreaCropLoop();
      return null;
    }
  };

  /** Stop the area crop loop and release the full-screen capture. */
  const stopAreaCropLoop = (): void => {
    if (areaCropLoopRef.current !== null) {
      cancelAnimationFrame(areaCropLoopRef.current);
      areaCropLoopRef.current = null;
    }
    if (areaSourceVideoRef.current) {
      stopStream(areaSourceVideoRef.current.srcObject as MediaStream);
      areaSourceVideoRef.current.srcObject = null;
      areaSourceVideoRef.current = null;
    }
    areaCropCanvasRef.current = null;
    if (areaCroppedStreamRef.current) {
      stopStream(areaCroppedStreamRef.current);
      areaCroppedStreamRef.current = null;
    }
  };

  /** Area selection drag/resize state. */
  const areaDragRef = useRef<{ mode: 'move' | 'resize'; edge: string; startX: number; startY: number; startSel: { x: number; y: number; width: number; height: number } } | null>(null);

  const clampAreaSelection = (sel: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } => {
    const x = Math.max(0, Math.min(sel.x, window.innerWidth - 20));
    const y = Math.max(0, Math.min(sel.y, window.innerHeight - 20));
    const width = Math.max(40, Math.min(sel.width, window.innerWidth - x));
    const height = Math.max(40, Math.min(sel.height, window.innerHeight - y));
    return { x, y, width, height };
  };

  const onAreaPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const box = event.currentTarget;
    const rect = box.getBoundingClientRect();
    const hit = (event.target as HTMLElement).dataset.edge;
    if (hit) {
      areaDragRef.current = {
        mode: 'resize',
        edge: hit,
        startX: event.clientX,
        startY: event.clientY,
        startSel: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      };
      box.setPointerCapture(event.pointerId);
    } else {
      areaDragRef.current = {
        mode: 'move',
        edge: '',
        startX: event.clientX,
        startY: event.clientY,
        startSel: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      };
      box.setPointerCapture(event.pointerId);
    }
  };

  const onAreaPointerMove = (event: React.PointerEvent) => {
    const drag = areaDragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let next = { ...drag.startSel };
    if (drag.mode === 'move') {
      next = { x: drag.startSel.x + dx, y: drag.startSel.y + dy, width: drag.startSel.width, height: drag.startSel.height };
    } else {
      const { edge } = drag;
      if (edge.includes('n')) { next.y = drag.startSel.y + dy; next.height = drag.startSel.height - dy; }
      if (edge.includes('s')) { next.height = drag.startSel.height + dy; }
      if (edge.includes('w')) { next.x = drag.startSel.x + dx; next.width = drag.startSel.width - dx; }
      if (edge.includes('e')) { next.width = drag.startSel.width + dx; }
    }
    setAreaSelection(clampAreaSelection(next));
  };

  const onAreaPointerUp = () => {
    if (areaDragRef.current?.mode === 'resize') {
      // Snap to aspect ratio if not free.
      if (areaAspectRatio !== 'free' && areaSelection) {
        const box = { width: areaSelection.width, height: areaSelection.height };
        const snapped = areaAspectRatioDimensions(box, areaAspectRatio);
        setAreaSelection({ ...areaSelection, width: snapped.width, height: snapped.height });
      }
    }
    areaDragRef.current = null;
  };

  const onAreaConfirm = () => {
    if (!areaSelection) return;
    setAreaMode(false);
    // Proceed directly to acquiring sources with the area surface selected.
    void chooseSource();
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
      const specs = await acquireSources();
      const oneMinuteBytes = (recordingBitrate(dimensions.width, dimensions.height, frameRate) * qualityMultiplier() / 8) * 60;
      const headroom = await checkStorageHeadroom(oneMinuteBytes);
      if (!headroom.enough) addWarning(headroom.message);
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

  // Global area-drag pointers: move/resize the selection box across the whole overlay.
  useEffect(() => {
    if (!areaMode) return;
    const onMove = (event: PointerEvent) => onAreaPointerMove(event as unknown as React.PointerEvent);
    const onUp = () => onAreaPointerUp();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [areaMode]);

  // Escape cancels area selection and returns to the source picker.
  useEffect(() => {
    if (!areaMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAreaMode(false);
        setAreaSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [areaMode]);

  const start = async () => {
    if (startingRef.current || !isRecording && stage !== 'idle' && stage !== 'ready') return;
    startingRef.current = true;
    setError(null);
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
        specs = await acquireSources();
        const oneMinuteBytes = (recordingBitrate(dimensions.width, dimensions.height, frameRate) * qualityMultiplier() / 8) * 60;
        const headroom = await checkStorageHeadroom(oneMinuteBytes);
        if (!headroom.enough) addWarning(headroom.message);
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
        videoBitsPerSecond: recordingBitrate(dimensions.width, dimensions.height, frameRate) * qualityMultiplier(),
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
      if (teleprompter.enabled && teleprompter.script.trim().length > 0) {
        updateTeleprompter({ playing: true });
      }
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

  const stopTake = async (forcePostRecordSheet = false) => {
    const capture = captureRef.current;
    if (!capture || stoppingRef.current) return;
    stoppingRef.current = true;
    setStage('finishing');
    if (teleprompter.playing) updateTeleprompter({ playing: false });
    try {
      const result = await capture.stop();
      captureRef.current = null;
      setActiveTakeId(null);
      setControlsHidden(false);
      setPostRecordTitle(project?.name ?? `Take ${result.takeId}`);
      setTakeResult(result);
      // The live stats belong to a take that no longer exists; leaving them up
      // showed "recording" and 0 B committed after the take had finished.
      setStats(null);
      sessionStats.current = null;
      setStage('idle');
      void refreshTakes();
      // Preserve the review / post-record sheet when in Instant mode, when
      // forcePostRecordSheet is requested ("Stop & export"), or when warnings occurred.
      const shouldOpenEditorImmediately =
        !forcePostRecordSheet && capMode !== 'instant' && afterStopAction === 'edit' && result.warnings.length === 0;
      if (shouldOpenEditorImmediately) insertTake(result);
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
      if (teleprompter.playing) updateTeleprompter({ playing: false });
    } else {
      capture.resume();
      setStage('recording');
      if (teleprompter.enabled && teleprompter.script.trim().length > 0) {
        updateTeleprompter({ playing: true });
      }
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

  // Keyboard control while a take runs: shortcuts are configurable in Settings > Shortcuts.
  // Defaults: P pause/resume, S stop, M/K marker, U mute, H hide controls, Esc restore.
  useEffect(() => {
    if (!isRecording) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void stopTake();
        return;
      }
      // Plain single-key shortcuts stay with Edit (or other tabs) when recording runs in the background.
      if (hidden) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === ' ' || key === shortcuts.pause) {
        togglePause();
      } else if (key === shortcuts.stop) {
        void stopTake();
      } else if (key === shortcuts.marker) {
        addMarker();
      } else if (key === shortcuts.mute && micOn) {
        toggleMicMute();
      } else if (key === shortcuts.hide) {
        setControlsHidden((prev) => !prev);
      } else if (key === 'escape') {
        if (controlsHidden) setControlsHidden(false);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The handlers read refs and the current stage; re-binding on stage is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, micOn, controlsHidden, hidden]);

  /** Restart = confirmed discard, then a fresh countdown once the discard has returned the stage to idle. */
  const [restartOpen, setRestartOpen] = useState(false);
  useEffect(() => {
    pipHandlersRef.current = {
      start: () => void start(),
      togglePause: () => togglePause(),
      stopTake: () => void stopTake(),
      restart: () => setRestartOpen(true),
      discard: () => setDiscardOpen(true),
      toggleMicMute: () => toggleMicMute(),
    };
  });
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

  useEffect(() => {
    if (!takeResult) {
      setReviewPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const durSec = Math.max(0.1, takeResult.durationTicks / TICKS_PER_SECOND);
    setReviewTrimIn(0);
    setReviewTrimOut(Number(durSec.toFixed(2)));
    let cancelled = false;
    const primary = takeResult.assets[0];
    if (primary && session.workspace && session.projectFolder) {
      void ensureAssetFile(primary.path)
        .then((file) => {
          if (cancelled || !file || file.size === 0) return;
          const url = URL.createObjectURL(file);
          setReviewPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [takeResult, session.workspace, session.projectFolder]);

  function insertTake(
    result: TakeResult,
    trimRange?: { inTicks?: number; outTicks?: number },
  ) {
    if (result.assets.length === 0) {
      useSession.getState().pushToast('This take has no media files, so nothing was added to the timeline.', 'error');
      return;
    }
    let firstClipId: string | undefined;
    try {
      useEditor.getState().apply('Open recorded take', (p) => {
        // If a screen/window/tab video was recorded AND the live CameraBubble was visible on screen
        // (!hideFloatingPreview) in 'baked-in-screen' mode, the bubble is ALREADY visible in screen.webm
        // for Entire Screen / current-Window / current-Tab captures unless the browser explicitly
        // reported a separate 'tab' surface that was not this page. Default to compositeInExport=false
        // when screen + visible bubble were captured so the Editor never shows two bubbles at once!
        const screenAsset = result.assets.find((a) => a.kind === 'video' && !/camera|webcam/i.test(a.name));
        const hasScreenAsset = Boolean(screenAsset);
        // `cameraLayerRule.compositeInExport` encodes the capture-surface rule:
        // Window/Tab captures never include the floating bubble in the shared surface stream,
        // so the camera is composited as a separate layer there; only Entire Screen
        // with a visible bubble in baked-in-screen mode skips the second composite.
        const shouldCompositeCameraLayer =
          !hasScreenAsset ||
          hideFloatingPreview ||
          cameraDuplicationMode === 'separate-layer';
        const effectivePresenter: PresenterProps = {
          ...presenter,
          visible: presenter.visible !== false && shouldCompositeCameraLayer && cameraLayerRule.compositeInExport,
        };
        const targetWidth =
          screenAsset?.width && screenAsset.width >= 2560
            ? screenAsset.width
            : resolution === '4k'
              ? 3840
              : resolution === '1440'
                ? 2560
                : p.canvas.width;
        const targetHeight =
          screenAsset?.height && screenAsset.height >= 1440
            ? screenAsset.height
            : resolution === '4k'
              ? 2160
              : resolution === '1440'
                ? 1440
                : p.canvas.height;
        const cleanBase: Project = {
          ...p,
          canvas: {
            ...p.canvas,
            width: targetWidth,
            height: targetHeight,
          },
          tracks: [],
          assets: [...result.assets],
          markers: [...result.markers],
          captions: [],
          durationTicks: 0,
        };
        const working = placeTake(
          cleanBase,
          result.assets,
          0,
          effectivePresenter,
          trimRange,
        );
        const assetIds = new Set(result.assets.map((asset) => asset.id));
        firstClipId = working.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.assetId && assetIds.has(clip.assetId))?.id;
        return working;
      });
    } catch (err) {
      useSession
        .getState()
        .pushToast(`Could not add the take to the timeline: ${(err as Error).message}`, 'error');
      return;
    }
    useEditor.getState().setPlayhead(0);
    if (firstClipId) useEditor.getState().selectClips([firstClipId]);
    setTakeResult(null);
    useSession.getState().pushToast('Recording opened in the editor.', 'success');
    useSession.getState().setRoute('edit');
  }

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
  const cameraLayerRule = useMemo(
    () =>
      resolveCameraLayerVisibility({
        cameraOn,
        surface: screenOn ? (actualReturnedSurface.surface ?? surface) : null,
        hideFloatingPreview,
        duplicationMode: cameraDuplicationMode,
      }),
    [cameraOn, screenOn, actualReturnedSurface.surface, surface, hideFloatingPreview, cameraDuplicationMode],
  );

  useEffect(() => {
    floatingCameraRef.current?.updateRecordingState({
      stage,
      elapsedText: stage === 'countdown' ? `${countdown}s` : formatElapsed(elapsedSeconds),
      previewHidden: hideFloatingPreview || !cameraOn,
      micMuted,
      hasCamera: cameraOn,
    });
    if (typeof document !== 'undefined') {
      if (stage === 'recording') {
        document.title = `● ${formatElapsed(elapsedSeconds)} Recording`;
      } else if (stage === 'paused') {
        document.title = `⏸ ${formatElapsed(elapsedSeconds)} Paused`;
      } else {
        document.title = 'Browser 4K Studio';
      }
    }
  }, [stage, countdown, elapsedSeconds, hideFloatingPreview, micMuted, cameraOn]);

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

  // ------------------------------------------------------------------
  // Compact recorder card (setup UI): shown when idle and not hidden.
  // ------------------------------------------------------------------
  const sourceModes = [
    { id: 'screen' as const, iconName: 'screen' as IconName, label: 'Entire screen' },
    { id: 'window', iconName: 'window' as IconName, label: 'Window' },
    { id: 'area', iconName: 'crop' as IconName, label: 'Area' },
    { id: 'camera', iconName: 'camera' as IconName, label: 'Camera only' },
    { id: 'audio', iconName: 'mic' as IconName, label: 'Audio only' },
  ];

  return (
    <div
      className={`page recorder-page cap-recorder${showMonitor ? ' monitor-expanded' : ''}`}
      data-route-hidden={hidden ? 'true' : undefined}
    >
      {/* Compact recorder card: header / body / footer. Shown only while idle and visible. */}
      {!hidden && !isRecording && (
        <>
          <header className="page-head">
            <div>
              <span className="eyebrow">LOCAL CREATOR STUDIO</span>
              <h1 className="page-title">Record</h1>
              <p className="page-subtitle">Record a take or jump straight into your next edit.</p>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={settingsOpen ? 'primary' : 'ghost'}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((prev) => !prev)}
              >
                ⚙ Settings
              </Button>
              <div className="cap-mode-switcher" role="group" aria-label="Recording mode">
                {(['instant', 'studio', 'screenshot'] as const).map((m) => {
                  const info = describeCapMode(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={stage !== 'idle'}
                      aria-pressed={capMode === m}
                      onClick={() => {
                        setCapMode(m);
                        if (m === 'instant') setAfterStopAction('review');
                        else if (m === 'studio') setAfterStopAction('edit');
                      }}
                    >
                      <span>{info.label}</span>
                      <span className="mode-sub">{info.subLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </header>

          <div className="recorder-body" role="group" aria-label="Capture sources">
            <div className="capture-mode-grid" role="group" aria-label="Recording source">
              {sourceModes.map((mode) => {
                const pressed =
                  mode.id === 'audio'
                    ? !screenOn && !cameraOn && micOn
                    : mode.id === 'camera'
                      ? !screenOn && cameraOn
                      : screenOn && surface === mode.id;
                return (
                  <button
                    type="button"
                    key={mode.id}
                    disabled={stage !== 'idle'}
                    aria-pressed={pressed}
                    onClick={() => {
                      if (mode.id === 'audio') {
                        setScreenOn(false);
                        setCameraOn(false);
                        setMicOn(true);
                        setAreaMode(false);
                        setSurface('screen');
                      } else if (mode.id === 'camera') {
                        setScreenOn(false);
                        setCameraOn(true);
                        setAreaMode(false);
                        setSurface('screen');
                      } else if (mode.id === 'area') {
                        setScreenOn(true);
                        setCameraOn(false);
                        setMicOn(false);
                        setAreaMode(true);
                      } else {
                        setScreenOn(true);
                        setSurface(mode.id as 'screen' | 'window' | 'tab');
                        setAreaMode(false);
                      }
                    }}
                  >
                    <SvgIcon name={mode.iconName} size={20} />
                    {mode.label}
                  </button>
                );
              })}
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
                    <Badge tone={cameraOn ? 'ok' : 'neutral'}>{cameraOn ? 'On' : 'Off'}</Badge>
                  </div>
                </div>
                {cameraOn && (
                  <>
                    <div className="field-hint">
                      {devices.camera.find((d) => d.deviceId === cameraId)?.label ?? devices.camera[0]?.label ?? 'Default camera'} · {floatingSupport.label}
                    </div>
                    {cameraDeviceInfo && (
                      <div className="cap-device-detail">
                        <span className="mono" style={{ fontSize: 11 }}>{cameraDeviceInfo}</span>
                      </div>
                    )}
                  </>
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
                  <>
                    <div className="meter" aria-label="Live microphone input level" style={{ height: 5 }}>
                      <div
                        className="meter-fill"
                        style={{ width: `${Math.round(meterPosition(micLevel?.peakDb ?? -Infinity) * 100)}%` }}
                      />
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-3)' }}>
                      <span className="mono">{micLevel ? `${micLevel.peakDb.toFixed(1)} dBFS peak` : 'no signal'}</span>
                      {micLevel?.clipping ? <Badge tone="danger">clipping — lower input gain</Badge> : null}
                    </div>
                    {micDeviceInfo && (
                      <div className="cap-device-detail">
                        <span className="mono" style={{ fontSize: 11 }}>{micDeviceInfo}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {screenOn && (
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
              )}
            </div>

            {/* Area capture overlay: full-screen dimmed region selector (Cap-style area preflight). */}
            {areaMode && stage === 'idle' && (
              <section className="area-capture-overlay" role="region" aria-label="Area capture region selector">
                <div className="area-overlay-dim" />
                <div className="area-overlay-header">
                  <span className="eyebrow">AREA CAPTURE</span>
                  <h2 style={{ margin: '4px 0 2px', fontSize: 18 }}>Select capture region</h2>
                  <div className="field-hint">Drag the rectangle to choose the area to record. Aspect-ratio presets snap the selection.</div>
                </div>
                <div className="area-overlay-canvas">
                  <div
                    className="area-selection-box"
                    style={{
                      left: areaSelection?.x ?? 200,
                      top: areaSelection?.y ?? 120,
                      width: areaSelection?.width ?? 480,
                      height: areaSelection?.height ?? 270,
                    }}
                    onPointerDown={onAreaPointerDown}
                  >
                    <div className="area-selection-handle nw" data-edge="nw" />
                    <div className="area-selection-handle ne" data-edge="ne" />
                    <div className="area-selection-handle sw" data-edge="sw" />
                    <div className="area-selection-handle se" data-edge="se" />
                    <div className="area-selection-label">
                      {Math.round(areaSelection?.width ?? 0)}×{Math.round(areaSelection?.height ?? 0)}
                    </div>
                  </div>
                </div>
                <div className="area-overlay-controls">
                  <div className="area-aspect-ratio-row" role="group" aria-label="Aspect ratio">
                    {[
                      { id: 'free', label: 'Free' },
                      { id: '16:9', label: '16:9' },
                      { id: '4:3', label: '4:3' },
                      { id: '1:1', label: '1:1' },
                      { id: '9:16', label: '9:16' },
                    ].map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={areaAspectRatio === r.id}
                        onClick={() => setAreaAspectRatio(r.id as typeof areaAspectRatio)}
                        className={`area-aspect-btn${areaAspectRatio === r.id ? ' area-aspect-btn-active' : ''}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button variant="ghost" size="sm" onClick={() => setAreaMode(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" disabled={!areaSelection} onClick={onAreaConfirm}>
                      Confirm area
                    </Button>
                  </div>
                </div>
              </section>
            )}

            {/* Footer: one primary action + optional "Show preview" */}
            <div
              className="recorder-footer"
              style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', gap: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Button
                variant="primary"
                disabled={isRecording || stage === 'selecting'}
                onClick={stage === 'ready' ? () => void start() : () => void chooseSource()}
              >
                <span aria-hidden>●</span>{' '}
                {stage === 'ready' ? 'Start recording' : 'Choose source'}
              </Button>
              {cameraOn && (
                <Button
                  size="sm"
                  variant={showMonitor ? 'primary' : 'ghost'}
                  aria-pressed={showMonitor}
                  onClick={() => setShowMonitor((prev) => !prev)}
                  title="Show preview of the captured source"
                >
                  {showMonitor ? 'Hide preview' : 'Show preview'}
                </Button>
              )}
              <span className="field-hint">
                {afterStopAction === 'edit' ? 'Stop → Edit' : afterStopAction === 'review' ? 'Stop → Review take' : 'Stop → Save to library'} ·{' '}
                {countdownSeconds ? `${countdownSeconds}s countdown` : 'No countdown'} · Chrome may still show its own sharing indicator
              </span>
            </div>
          </div>
        </>
      )}

      {/* Source confirmation: shown after Chrome returns the chosen source. */}
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
            <span className="field-hint">Source confirmed. Click Start recording when ready.</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={cancelReadyState}>Cancel</Button>
              <Button variant="ghost" onClick={() => void chooseSource()}>Change source</Button>
              <Button variant="primary" onClick={() => void start()}>
                <span aria-hidden>●</span> Start recording
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Settings panel: one panel with General / Capture quality / Camera appearance / Shortcuts. */}
      {settingsOpen && (
        <section className="settings-panel" role="region" aria-label="Recording settings" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </div>

          <details open>
            <summary>General</summary>
            <div className="stack" style={{ gap: 10, paddingTop: 10 }}>
              <div className="field-hint">
                Remembered devices, countdown length, and what happens after a take stops.
              </div>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
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
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Microphone device">
                    <Select
                      label="Microphone device"
                      value={micId}
                      onChange={setMicId}
                      disabled={stage !== 'idle' || !micOn}
                      options={devices.mic.length > 0 ? devices.mic.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: '', label: 'No microphone found' }]}
                    />
                  </Field>
                </div>
              </div>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <Field label="Countdown">
                    <Select
                      label="Recording countdown"
                      value={String(countdownSeconds)}
                      disabled={!isRecording && stage !== 'idle'}
                      onChange={(value) => setCountdownSeconds(Number(value))}
                      options={[
                        { value: '0', label: 'No countdown' },
                        { value: '3', label: '3s countdown' },
                        { value: '5', label: '5s countdown' },
                        { value: '10', label: '10s countdown' },
                      ]}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="After recording">
                    <Select
                      label="After recording stops"
                      value={afterStopAction}
                      disabled={!isRecording && stage !== 'idle'}
                      onChange={setAfterStopAction}
                      options={[
                        { value: 'edit', label: 'Open editor' },
                        { value: 'review', label: 'Review and download' },
                        { value: 'none', label: 'Save to library only' },
                      ]}
                    />
                    <div className="field-hint">
                      Choose what happens when a take stops: open it in the editor, review and download it, or just save it to the Recordings library.
                    </div>
                  </Field>
                </div>
              </div>
              <div className="field-hint">
                Screen sources use Chrome's display picker. If a remembered device is missing, the fallback is shown and you can reselect it.
              </div>
            </div>
          </details>

          <details open>
            <summary>Capture quality</summary>
            <div className="stack" style={{ gap: 10, paddingTop: 10 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
                    <div className="field-hint">
                      Requested size. The browser may deliver less; actual track settings appear in the Applied track settings report.
                    </div>
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
                <div style={{ flex: 1 }}>
                  <Field label="Quality preset">
                    <Select
                      label="Recording quality"
                      value={qualityPreset}
                      disabled={stage !== 'idle'}
                      onChange={setQualityPreset}
                      options={[
                        { value: 'balanced', label: 'Balanced (recommended)' },
                        { value: 'smaller', label: 'Smaller files' },
                        { value: 'maximum', label: 'Maximum detail' },
                      ]}
                    />
                    <div className="field-hint">
                      Balanced = 4× smaller VBR · Smaller = 0.5× bitrate · Maximum = 2× bitrate
                    </div>
                  </Field>
                </div>
              </div>
              <div className="field-hint">
                Resolution, frame rate, and storage details live under Advanced. Compare requested and applied values; browsers silently clamp capture sizes on some machines.
              </div>
            </div>
          </details>

          <details open>
            <summary>Camera appearance</summary>
            <div className="stack" style={{ gap: 10, paddingTop: 10 }}>
              <div className="panel-title">Camera style (applied as a presenter layer)</div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Field label="Shape">
                    <Select
                      label="Bubble shape"
                      value={presenter.shape}
                      onChange={(value) => setPresenter((current) => ({ ...current, shape: value as PresenterProps['shape'] }))}
                      disabled={!cameraOn}
                      options={PRESENTER_BUBBLE_SHAPES.map((s) => ({ value: s.id, label: s.label }))}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Position">
                    <Select
                      label="Bubble position"
                      value={presenter.corner}
                      onChange={(value) => {
                        resetSelfView();
                        setPresenter((current) => {
                          const { x: _x, y: _y, ...rest } = current;
                          void _x;
                          void _y;
                          return { ...rest, corner: value as PresenterProps['corner'] };
                        });
                      }}
                      disabled={!cameraOn}
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
              <Field label="Bubble effect">
                <Select
                  label="Bubble effect"
                  value={presenter.effect ?? 'none'}
                  onChange={(value) =>
                    setPresenter((current) => ({
                      ...current,
                      effect: value as NonNullable<PresenterProps['effect']>,
                    }))
                  }
                  disabled={!cameraOn}
                  options={PRESENTER_BUBBLE_EFFECTS.map((fx) => ({ value: fx.id, label: fx.label }))}
                />
              </Field>
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
                label="Border"
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
              />
              <Toggle
                label="Visible in preview & export"
                checked={presenter.visible !== false}
                onChange={(value) => setPresenter((current) => ({ ...current, visible: value }))}
              />
              <div className="field-hint">
                Changes preview immediately. Position presets apply to the bubble. The camera is always recorded as its own full-size track; this style shapes the presenter layer and can be changed later without re-recording.
              </div>
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
            </div>
          </details>

          <details open>
            <summary>Shortcuts</summary>
            <div className="stack" style={{ gap: 8, paddingTop: 10 }}>
              <div className="field-hint">Shortcuts are scoped to this app. Click a key to change it. Editing shortcuts never control a background recording.</div>
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Pause / Resume">
                    <input
                      className="input"
                      value={shortcuts.pause}
                      maxLength={1}
                      onChange={(e) => {
                        const k = e.target.value.toLowerCase();
                        if (/^[a-z0-9]$/.test(k)) setShortcuts({ ...shortcuts, pause: k });
                      }}
                      placeholder={shortcuts.pause}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Stop recording">
                    <input
                      className="input"
                      value={shortcuts.stop}
                      maxLength={1}
                      onChange={(e) => {
                        const k = e.target.value.toLowerCase();
                        if (/^[a-z0-9]$/.test(k)) setShortcuts({ ...shortcuts, stop: k });
                      }}
                      placeholder={shortcuts.stop}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Add marker">
                    <input
                      className="input"
                      value={shortcuts.marker}
                      maxLength={1}
                      onChange={(e) => {
                        const k = e.target.value.toLowerCase();
                        if (/^[a-z0-9]$/.test(k)) setShortcuts({ ...shortcuts, marker: k });
                      }}
                      placeholder={shortcuts.marker}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Mute / Unmute mic">
                    <input
                      className="input"
                      value={shortcuts.mute}
                      maxLength={1}
                      onChange={(e) => {
                        const k = e.target.value.toLowerCase();
                        if (/^[a-z0-9]$/.test(k)) setShortcuts({ ...shortcuts, mute: k });
                      }}
                      placeholder={shortcuts.mute}
                    />
                  </Field>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Hide / Show controls">
                    <input
                      className="input"
                      value={shortcuts.hide}
                      maxLength={1}
                      onChange={(e) => {
                        const k = e.target.value.toLowerCase();
                        if (/^[a-z0-9]$/.test(k)) setShortcuts({ ...shortcuts, hide: k });
                      }}
                      placeholder={shortcuts.hide}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </details>
        </section>
      )}

      {/* Advanced settings (requested vs actual capture details). */}
      <details className="record-details recorder-advanced" open={settingsOpen} onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Advanced<span>Capture modes, Browser tab, quality, countdown, storage &amp; camera appearance</span></summary>
        <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
          <div className="cap-mode-switcher" role="group" aria-label="Capture mode">
            {(['instant', 'studio', 'screenshot'] as const).map((m) => {
              const info = describeCapMode(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={stage !== 'idle' && stage !== 'ready'}
                  aria-pressed={capMode === m}
                  onClick={() => {
                    setCapMode(m);
                    if (m === 'instant') setAfterStopAction('review');
                    else if (m === 'studio') setAfterStopAction('edit');
                  }}
                >
                  <span>{info.label}</span>
                  <span className="mode-sub">{info.subLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={screenOn && surface === 'tab' ? 'primary' : 'ghost'}
                disabled={stage !== 'idle'}
                aria-pressed={screenOn && surface === 'tab'}
                onClick={() => {
                  setScreenOn(true);
                  setSurface('tab');
                }}
              >
                Browser tab source
              </Button>
              {stage === 'idle' && (
                <Button size="sm" variant="ghost" onClick={() => void chooseSource()}>
                  Choose source…
                </Button>
              )}
            </div>
            <Select
              label="Recording countdown"
              value={String(countdownSeconds)}
              disabled={stage !== 'idle' && stage !== 'ready'}
              onChange={(value) => setCountdownSeconds(Number(value))}
              options={[
                { value: '0', label: 'No countdown' },
                { value: '3', label: '3s countdown' },
                { value: '5', label: '5s countdown' },
                { value: '10', label: '10s countdown' },
              ]}
            />
          </div>

          <Field label="Open editor when recording stops">
            <Select
              label="After recording"
              value={afterStopAction}
              disabled={stage !== 'idle' && stage !== 'ready'}
              onChange={setAfterStopAction}
              options={[
                { value: 'edit', label: 'Open editor' },
                { value: 'review', label: 'Review and download' },
                { value: 'none', label: 'Save to library only' },
              ]}
            />
          </Field>

          <div className="hint-card stack" style={{ gap: 8 }} role="region" aria-label="Across tabs and display capture">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>Floating controls &amp; capture rules</strong>
              <Badge tone={actualReturnedSurface.surface ? 'ok' : 'neutral'}>
                {actualReturnedSurface.surface ? `Captured: ${actualReturnedSurface.label}` : 'Cap Stealth Ready'}
              </Badge>
            </div>
            <div className="field-hint" style={{ lineHeight: 1.5 }}>
              • <strong>Entire screen</strong> captures across terminals, browsers, and desktop apps. Chrome may still show its own native sharing indicator.<br />
              • <strong>Window</strong> captures a single application window with a separate movable camera layer in the Studio editor.<br />
              • <strong>Floating controls</strong>: Keep timer, Pause/Resume, and Stop floating above tabs via Document PiP. Closing the floating window leaves the take running.
            </div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Select
                label="Quiet mode"
                value={quietMode}
                onChange={(v) => {
                  const next = v as QuietMode;
                  setQuietMode(next);
                  setControlsHidden(next === 'controls-only');
                }}
                options={QUIET_MODES.map((m) => ({ value: m.id, label: m.label }))}
              />
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
              {cameraOn && screenOn && surface === 'screen' && (
                <Select
                  label="Camera export mode on Display"
                  value={cameraDuplicationMode}
                  onChange={(v) => setCameraDuplicationMode(v as CameraDuplicationMode)}
                  options={[
                    { value: 'baked-in-screen', label: 'Bubble baked into screen (no duplicate layer in export)' },
                    { value: 'separate-layer', label: 'Separate camera layer in editor/export' },
                  ]}
                />
              )}
              {cameraOn && (
                <div className="field-hint">
                  Camera export rule: <strong>{cameraLayerRule.summary}</strong>
                </div>
              )}
            </div>
          </div>

          <div className={session.storageMode === 'opfs' ? 'warn-card' : 'hint-card'} role="status">
            {session.storageMode === 'opfs' ? (
              <>
                This session lives in <strong>browser storage</strong> ({session.workspace?.info.name ?? 'OPFS'}). Use{' '}
                <strong>Save to a folder…</strong> after recording for a durable copy.
              </>
            ) : (
              <>
                Recording to <strong>{session.workspace?.info.name}</strong> on this computer.
              </>
            )}
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

          <div className="field-hint">
            Quality targets request capture size; the browser may deliver less. The actual track settings are shown below, and no 1080p source is ever labelled 4K.
          </div>
        </div>
      </details>

      <details className="record-details" open={stage !== 'idle' || Boolean(error) || warnings.length > 0}><summary>Take status &amp; recording details</summary>
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
          {isRecording && (
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

      {/* Compact control bar during recording: visible even when hidden (switching to Edit). */}
      {isRecording && (
        <div
          className={`rec-bar rec-dock${stage === 'paused' ? ' paused' : ''}${controlsHidden ? ' rec-dock-collapsed' : ''}`}
          role="group"
          aria-label="Recording controls"
        >
          <span className="rec-dock-status">
            <span className={stage === 'recording' || stage === 'countdown' ? 'rec-dot' : 'rec-dot still'} aria-hidden />
            <strong className="rec-state" role="status" aria-live="polite">
              {stage === 'countdown' ? 'STARTING' : stage === 'paused' ? 'PAUSED' : stage === 'finishing' ? 'SAVING' : 'REC'}
            </strong>
            <span className="rec-timer" data-testid="rec-dock-timer">
              {stage === 'countdown' ? countdown : formatElapsed(elapsedSeconds)}
            </span>
            {!controlsHidden && (stats?.markers.length ?? 0) > 0 && (
              <span className="rec-markers">
                {stats?.markers.length} marker{stats?.markers.length === 1 ? '' : 's'}
              </span>
            )}
            {!controlsHidden && (error || warnings[0]) && (
              <Badge tone={error ? 'danger' : 'warn'}>{error ?? warnings[0]}</Badge>
            )}
          </span>

          {stage === 'finishing' && <span className="field-hint">Flushing segments to disk…</span>}
          {stage === 'countdown' && <span className="field-hint">Waiting for the countdown</span>}
          {(stage === 'recording' || stage === 'paused') &&
            (controlsHidden ? (
              <div className="rec-dock-actions">
                <RecordingActions
                  paused={stage === 'paused'}
                  openEditor={afterStopAction === 'edit' && capMode !== 'instant'}
                  onPause={togglePause}
                  onStop={() => void stopTake()}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Show recording controls"
                  title="Restore full recording controls (Shortcut: H)"
                  onClick={() => setControlsHidden(false)}
                >
                  Show controls ▴
                </Button>
              </div>
            ) : (
              <div className="rec-dock-actions">
                <RecordingActions
                  paused={stage === 'paused'}
                  openEditor={afterStopAction === 'edit' && capMode !== 'instant'}
                  onPause={togglePause}
                  onStop={() => void stopTake()}
                />
                <details className="rec-more-menu">
                  <summary className="btn btn-ghost btn-sm" aria-label="More recording controls">
                    More
                  </summary>
                  <div className="rec-more-popover" role="group" aria-label="Secondary recording actions">
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
                    {cameraOn && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-pressed={hideFloatingPreview}
                        onClick={() => setHideFloatingPreview((prev) => !prev)}
                        title="Hide floating camera preview on display while continuing to record camera separately for the editor"
                      >
                        {hideFloatingPreview ? 'Show camera preview' : 'Hide camera preview'}
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
                      ↻ Restart
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDiscardOpen(true)}
                      title="Abandon this take without keeping it"
                    >
                      Discard
                    </Button>
                    <Button size="sm" variant="ghost" onClick={addMarker} title="Shortcut: M or K">
                      Marker
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void stopTake(true)}
                      title="Stop and open Quick Export / Post-record sheet"
                    >
                      Stop &amp; export
                    </Button>
                    {floatingSupport.supported && (
                      <Button
                        size="sm"
                        variant={floatingCameraOpen ? 'primary' : 'ghost'}
                        aria-pressed={floatingCameraOpen}
                        onClick={() => void toggleFloatingCamera()}
                        title={floatingSupport.detail}
                      >
                        {floatingCameraOpen ? 'Close floating controls' : 'Floating controls'}
                      </Button>
                    )}
                  </div>
                </details>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Hide recording controls"
                  title="Collapse recording controls into a minimal pill (Shortcut: H)"
                  onClick={() => setControlsHidden(true)}
                >
                  Hide controls ▾
                </Button>
              </div>
            ))}
        </div>
      )}

      {/* Live monitor panel during recording: shown when capturing a screen surface. */}
      {isRecordingDisplaySurface && (
        <section className="record-monitor-column" role="region" aria-label="Live monitor" style={{ marginTop: 14 }}>
          <Panel title="Preview">
            <div
              style={{
                position: 'relative',
                background: '#05070a',
                borderRadius: 10,
                overflow: 'hidden',
                aspectRatio: `${project.canvas.width} / ${project.canvas.height}`,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <video
                ref={previewRef}
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                aria-label="Screen capture preview"
              />
              {hideMonitorDuringDisplay && (
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
              {stage === 'recording' && (
                <div className="rec-monitor-tag" aria-hidden>
                  <span className="rec-dot small" />
                  REC <span className="mono">{formatElapsed(elapsedSeconds)}</span>
                </div>
              )}
              {stage === 'paused' && <div className="rec-monitor-tag paused">PAUSED</div>}
              {stage === 'countdown' && <div className="rec-countdown" aria-hidden>{countdown}</div>}
            </div>
          </Panel>
        </section>
      )}

      {/* Standalone CameraBubble component: image only — no timer, buttons, labels, or toolbar over the camera image.
          Draggable; position presets live in Camera appearance settings. Hidden when Document/Video PiP (floatingCameraOpen)
          is open so the user never sees two camera bubbles. */}
      {cameraOn &&
        !hideFloatingPreview &&
        !floatingCameraOpen &&
        (cameraPreviewOn || isRecording) && (
          <CameraBubble
            videoRef={selfViewRef}
            presenter={presenter}
            stage={stage}
            position={selfViewPos}
            cameraLive={cameraPreviewOn || isRecording}
            onStartPreview={() => void startCameraPreview()}
            onPositionChange={setSelfViewPos}
            onUpdatePresenter={(patch) =>
              setPresenter((current) => {
                const next = { ...current, ...patch };
                if ('x' in patch && patch.x === undefined) delete next.x;
                if ('y' in patch && patch.y === undefined) delete next.y;
                return next;
              })
            }
          />
        )}

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

      {/* Shared Recordings Library with project filter and preview-first Clear unused recordings */}
      {!hidden && (quietMode === 'full' || !isRecording) && (
        <RecordingsLibrary
          activeTakeId={activeTakeId}
          defaultProjectFolder={session.projectFolder ?? 'all'}
          compact
          onChanged={() => void refreshTakes()}
        />
      )}

      <Dialog
        open={takeResult !== null}
        onClose={() => {
          setTakeResult(null);
          void refreshTakes();
        }}
        title="Recording finished — Post-record actions (04 Review take)"
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
                // Keep take on disk in the Recordings library without inserting on the timeline yet
                setTakeResult(null);
                useSession.getState().pushToast('Take kept safely in Recordings library.', 'success');
                void refreshTakes();
              }}
            >
              Keep take
            </Button>
            <Button
              variant="ghost"
              disabled={downloadingOriginals}
              onClick={() => {
                // Retake preserves the previous take on disk until the user explicitly discards it
                setTakeResult(null);
                useSession
                  .getState()
                  .pushToast('Previous take preserved in Recordings library. Ready to record another take.', 'info');
                void refreshTakes();
              }}
            >
              Retake · Record another take
            </Button>
            <Button
              variant="ghost"
              disabled={downloadingOriginals}
              onClick={() => void downloadOriginals(takeResult!)}
            >
              {downloadingOriginals ? 'Preparing…' : 'Save raw · Download originals'}
            </Button>
            <Button
              variant={capMode === 'instant' ? 'ghost' : 'primary'}
              onClick={() =>
                insertTake(takeResult!, {
                  inTicks: Math.round(reviewTrimIn * TICKS_PER_SECOND),
                  outTicks: Math.round(reviewTrimOut * TICKS_PER_SECOND),
                })
              }
            >
              Open in editor · Edit recording
            </Button>
            <Button
              variant={capMode === 'instant' ? 'primary' : 'ghost'}
              onClick={() => {
                if (!takeResult) return;
                insertTake(takeResult, {
                  inTicks: Math.round(reviewTrimIn * TICKS_PER_SECOND),
                  outTicks: Math.round(reviewTrimOut * TICKS_PER_SECOND),
                });
                useSession.getState().setRoute('export');
              }}
            >
              Export now ↗
            </Button>
          </>
        }
      >
        {takeResult && (
          <div className="stack">
            {reviewPreviewUrl && (
              <video
                src={reviewPreviewUrl}
                controls
                playsInline
                aria-label="Review recorded take preview"
                style={{ width: '100%', maxHeight: 240, background: '#111018', borderRadius: 8 }}
              />
            )}
            <Field label="Take title">
              <input
                className="input"
                aria-label="Take title"
                value={postRecordTitle}
                onChange={(event) => {
                  setPostRecordTitle(event.target.value);
                  useEditor.getState().apply('Rename project', (p) => ops.renameProject(p, event.target.value));
                }}
              />
            </Field>
            <div className="grid-2">
              <Slider
                label="Trim In (non-destructive)"
                min={0}
                max={Math.max(0.1, reviewTrimOut - 0.1)}
                step={0.1}
                value={reviewTrimIn}
                format={(v) => `${v.toFixed(1)}s`}
                onChange={(val) => setReviewTrimIn(Math.min(val, Math.max(0, reviewTrimOut - 0.1)))}
              />
              <Slider
                label="Trim Out (non-destructive)"
                min={Math.min(reviewTrimIn + 0.1, Math.max(0.2, takeResult.durationTicks / TICKS_PER_SECOND))}
                max={Math.max(0.2, takeResult.durationTicks / TICKS_PER_SECOND)}
                step={0.1}
                value={reviewTrimOut}
                format={(v) => `${v.toFixed(1)}s`}
                onChange={(val) => setReviewTrimOut(Math.max(val, reviewTrimIn + 0.1))}
              />
            </div>
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
              <strong>Open in editor</strong> adds the take (with your non-destructive Trim In/Out range) to the timeline.{' '}
              <strong>Keep take</strong> leaves the take safely in the Recordings library.{' '}
              <strong>Retake</strong> preserves this take on disk until you explicitly discard it.{' '}
              <strong>Save raw</strong> downloads each original source track separately.
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
 * clips clamped to the take duration (or optional non-destructive `trimRange`).
 * Idempotent: if an asset is already placed on a track, it will not be duplicated.
 */
export function placeTake(
  project: Project,
  assets: Project['assets'],
  startTicks: number,
  presenter: PresenterProps,
  trimRange?: { inTicks?: number; outTicks?: number },
): Project {
  let working = project;
  const linkId = newId('link');
  for (const asset of assets) {
    // Idempotent guard: never place the same recorded asset twice if already on a track
    const alreadyOnTrack = working.tracks.some((t) => t.clips.some((c) => c.assetId === asset.id));
    if (alreadyOnTrack) continue;

    const role = takeRole(asset);
    let track = trackForRole(working, role);
    if (!track) {
      track = createTrack(TRACK_FOR_ROLE[role].kind, TRACK_FOR_ROLE[role].name);
      working = ops.addTrack(working, track);
    }
    const placed = ops.addAssetClip(working, track.id, asset.id, startTicks, { mode: 'overwrite' });
    working = placed.project;
    const inTicks = Math.max(0, Math.min(asset.durationTicks - 1, Math.round(trimRange?.inTicks ?? 0)));
    const outTicks =
      typeof trimRange?.outTicks === 'number' && trimRange.outTicks > inTicks
        ? Math.min(asset.durationTicks, Math.round(trimRange.outTicks))
        : asset.durationTicks;
    const trimmedDuration = Math.max(1, outTicks - inTicks);
    working = ops.updateClip(working, placed.clipId, {
      linkId,
      inTicks,
      durationTicks: trimmedDuration,
      ...(role === 'camera' ? { presenter } : {}),
    });
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

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
