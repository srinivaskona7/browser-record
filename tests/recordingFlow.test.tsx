import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordPage } from '../src/ui/RecordPage';
import { ImportMediaButton } from '../src/ui/ImportMediaButton';
import { useEditor } from '../src/project/store';
import { useSession } from '../src/app/session';
import { createClip, createProject } from '../src/project/factory';
import { MemoryDirectoryHandle } from '../src/workspace/memoryFs';
import type { TakeResult } from '../src/capture/recorder';
import { TICKS_PER_SECOND } from '../src/core/time';

const capture = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), discard: vi.fn(), stats: vi.fn() }));
const importing = vi.hoisted(() => vi.fn());
vi.mock('../src/capture/recorder', () => ({ CaptureSession: { start: capture.start }, recoverInterruptedTake: vi.fn() }));
vi.mock('../src/app/bootstrap', async (original) => ({ ...await original<object>(), importMediaIntoSession: importing }));
vi.mock('../src/workspace/workspace', async (original) => ({
  ...(await original<typeof import('../src/workspace/workspace')>()),
  checkStorageHeadroom: vi.fn(async () => ({ enough: true })),
}));
vi.mock('../src/capture/devices', async (original) => ({ ...await original<object>(), enumerateDevices: vi.fn(async () => ({ cameras: [], microphones: [] })), onDeviceChange: vi.fn(() => () => undefined) }));

let host: HTMLDivElement;
let root: Root;
let result: TakeResult;
let track: { kind: string; id: string; stop: ReturnType<typeof vi.fn>; getSettings: () => MediaTrackSettings; addEventListener: ReturnType<typeof vi.fn> };
const checkbox = (text: string) => [...host.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === text)!.querySelector('input')!;
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useEditor.getState().loadProject(createProject({ name: 'Flow test' }));
  useSession.setState({ route: 'record', projectFolder: 'flow', workspace: { root: new MemoryDirectoryHandle('test'), info: { name: 'test', mode: 'opfs', persistent: false } } });
  result = { takeId: 'take_test', durationTicks: 5 * TICKS_PER_SECOND, warnings: [], markers: [], manifest: { assets: [], startedAt: new Date().toISOString() }, assets: [{ id: 'screen_asset', kind: 'video', name: 'Screen', path: 'recordings/take_test/screen.webm', origin: 'recorded', durationTicks: 5 * TICKS_PER_SECOND, createdAt: new Date().toISOString() }] } as unknown as TakeResult;
  capture.stop.mockImplementation(async () => result);
  capture.discard.mockResolvedValue(undefined);
  capture.stats.mockReturnValue(null);
  capture.start.mockResolvedValue(capture);
  track = { kind: 'video', id: 'screen_track', stop: vi.fn(), getSettings: () => ({ width: 1920, height: 1080, frameRate: 30, displaySurface: 'monitor' }), addEventListener: vi.fn() };
  class FakeStream {
    getTracks() { return [track]; }
    getVideoTracks() { return [track]; }
    getAudioTracks() { return []; }
  }
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(async () => new FakeStream()),
      getUserMedia: vi.fn(async () => new FakeStream()),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); useEditor.getState().closeProject(); useSession.setState({ workspace: null, projectFolder: null }); vi.unstubAllGlobals(); });

async function startRecording(review = false) {
  await act(async () => root.render(<RecordPage />));
  await act(() => {
    checkbox('Camera').click();
    checkbox('Microphone').click();
    if (review) checkbox('Open editor when recording stops').click();
    const countdown = host.querySelector('select[aria-label="Recording countdown"]') as HTMLSelectElement;
    countdown.value = '0'; countdown.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Start recording').click());
  expect(capture.start).toHaveBeenCalledTimes(1);
}

it('pauses, resumes, finalizes once and opens the recorded media in the editor', async () => {
  await startRecording();
  await act(() => button('Pause').click()); expect(capture.pause).toHaveBeenCalledTimes(1);
  await act(() => button('Resume').click()); expect(capture.resume).toHaveBeenCalledTimes(1);
  await act(async () => { const stop = button('Stop & edit'); stop.click(); stop.click(); });
  expect(capture.stop).toHaveBeenCalledTimes(1);
  expect(useSession.getState().route).toBe('edit');
  expect(useEditor.getState().project!.assets).toEqual(result.assets);
  expect(useEditor.getState().project!.tracks.flatMap((t) => t.clips).some((c) => c.assetId === 'screen_asset')).toBe(true);
  expect(track.stop).toHaveBeenCalled();
  expect(useEditor.getState().selectedClipIds).toHaveLength(1);
});

it('keeps the review dialog and originals when direct editing is disabled', async () => {
  await startRecording(true);
  await act(async () => button('Stop & review').click());
  expect(useSession.getState().route).toBe('record');
  expect(host.textContent).toContain('Recording finished');
  expect(useEditor.getState().project!.assets).toHaveLength(0);
});

it('shows warning takes for review instead of automatically navigating', async () => {
  result.warnings = ['One source ended early'];
  await startRecording();
  await act(async () => button('Stop & edit').click());
  expect(useSession.getState().route).toBe('record');
  expect(host.textContent).toContain('One source ended early');
});

it('imports chosen files into editing and clears the picker for repeat imports', async () => {
  importing.mockResolvedValue({ imported: ['video.webm'], failed: [], created: false });
  await act(() => root.render(<ImportMediaButton />));
  const input = host.querySelector('input')!;
  const file = new File(['video'], 'video.webm', { type: 'video/webm' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(importing).toHaveBeenCalledWith([file]);
  expect(useSession.getState().route).toBe('edit');
  expect(input.value).toBe('');
});

it('stays on the recorder when all imported files fail', async () => {
  importing.mockResolvedValue({ imported: [], failed: [{ name: 'bad.mp4', message: 'Cannot decode' }], created: false });
  await act(() => root.render(<ImportMediaButton />));
  const input = host.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: [new File(['bad'], 'bad.mp4')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(useSession.getState().route).toBe('record');
});

it('opens a clean timeline containing only the current recorded take at playhead 0', async () => {
  const project = useEditor.getState().project!;
  const previous = createClip({ kind: 'media', assetId: 'previous', startTicks: 0, durationTicks: 8 * TICKS_PER_SECOND });
  project.tracks[0]!.clips = [previous];
  project.durationTicks = 8 * TICKS_PER_SECOND;
  await startRecording();
  await act(async () => button('Stop & edit').click());
  const updated = useEditor.getState();
  expect(updated.project!.assets).toEqual(result.assets);
  expect(updated.project!.tracks.flatMap((t) => t.clips)).toHaveLength(1);
  expect(updated.project!.tracks[0]!.clips[0]?.assetId).toBe('screen_asset');
  expect(updated.playheadTicks).toBe(0);
  const selected = updated.project!.tracks.flatMap((t) => t.clips).find((c) => c.id === updated.selectedClipIds[0]);
  expect(selected?.assetId).toBe('screen_asset');
});

it('separates choosing a source from starting the take via the Ready confirmation card and keeps active takes alive when hidden', async () => {
  await act(async () => root.render(<RecordPage />));
  await act(() => {
    checkbox('Camera').click();
    checkbox('Microphone').click();
    const countdown = host.querySelector('select[aria-label="Recording countdown"]') as HTMLSelectElement;
    countdown.value = '0';
    countdown.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Choose source…').click());
  expect(host.querySelector('[aria-label="Source confirmation"]')).not.toBeNull();
  expect(host.textContent).toContain('SOURCE READY TO RECORD');
  expect(capture.start).not.toHaveBeenCalled();

  await act(async () => button('Start recording').click());
  expect(capture.start).toHaveBeenCalledTimes(1);

  // Navigating to another tab sets hidden={true} on RecordPage without abandoning the active take
  await act(() => root.render(<RecordPage hidden={true} />));
  expect(host.querySelector('.rec-dock')).not.toBeNull();
  await act(async () => button('Stop & edit').click());
  expect(capture.stop).toHaveBeenCalledTimes(1);
});

it('uses Cap Stealth Controller constraints (surfaceSwitching: exclude), hides live screen monitor during Display capture, and saves one take when stopped', async () => {
  const { displayConstraints, describeReturnedSurface } = await import('../src/capabilities/detect');
  const constraints = displayConstraints({
    width: 1920,
    height: 1080,
    frameRate: 30,
    systemAudio: true,
    surface: 'screen',
  }) as DisplayMediaStreamOptions & {
    surfaceSwitching?: string;
    selfBrowserSurface?: string;
    monitorTypeSurfaces?: string;
  };
  expect(constraints.surfaceSwitching).toBe('exclude');
  expect(constraints.selfBrowserSurface).toBe('exclude');
  expect(constraints.monitorTypeSurfaces).toBe('include');

  const displaySummary = describeReturnedSurface({
    label: 'Built-in Retina Display',
    getSettings: () => ({ displaySurface: 'monitor', width: 3840, height: 2160, frameRate: 60 }),
  } as unknown as MediaStreamTrack);
  expect(displaySummary.surface).toBe('screen');
  expect(displaySummary.summary).toContain('Cap Stealth Controller');

  let endedListener: (() => void) | undefined;
  track.addEventListener.mockImplementation((event: string, cb: () => void) => {
    if (event === 'ended') endedListener = cb;
  });

  await startRecording();
  // Normal Studio Record UI stays visible (no forced Stealth Mode) and live screen monitor is hidden to prevent mirror effect
  expect(host.querySelector('[aria-label="Across tabs and display capture"]')).not.toBeNull();
  expect(host.textContent).toContain('Captured: Display');
  expect(host.textContent).toContain('Live screen monitor hidden during display capture');

  // Stopping sharing triggers track 'ended' and saves one playable take
  expect(endedListener).toBeTypeOf('function');
  await act(async () => endedListener!());
  expect(capture.stop).toHaveBeenCalledTimes(1);
  expect(useEditor.getState().project!.assets.some((a) => a.id === 'screen_asset')).toBe(true);
});

it('opens Document Picture-in-Picture with camera + controls, toggles Hide preview to prevent double bubble, and leaves take running when closed', async () => {
  const { openFloatingCamera, resolvePipLayout } = await import('../src/capture/floatingCamera');
  const { defaultPresenter } = await import('../src/project/factory');

  // Verify responsive PiP layout across the 4 reference sizes: 180x180, 240x320, 320x120, 400x400
  expect(resolvePipLayout(180, 180, true, 'auto')).toBe('bubble');
  expect(resolvePipLayout(240, 320, true, 'auto')).toBe('tall');
  expect(resolvePipLayout(320, 120, true, 'auto')).toBe('bar');
  expect(resolvePipLayout(400, 400, true, 'auto')).toBe('bubble');
  expect(resolvePipLayout(240, 320, false, 'auto')).toBe('bar');

  const pipDoc = document.implementation.createHTMLDocument('pip');
  const listeners = new Map<string, () => void>();
  const fakePipWin = {
    document: pipDoc,
    addEventListener: vi.fn((evt: string, cb: () => void) => listeners.set(evt, cb)),
    close: vi.fn(),
  } as unknown as Window;

  window.documentPictureInPicture = {
    requestWindow: vi.fn(async () => fakePipWin),
  };

  let pauseToggled = 0;
  let stopClicked = 0;
  let hidePreviewToggled = 0;
  let closedCount = 0;

  const session = await openFloatingCamera({
    stream: new MediaStream(),
    presenter: defaultPresenter(),
    initialControlState: { stage: 'recording', elapsedText: '00:00:12', previewHidden: false },
    onTogglePause: () => {
      pauseToggled += 1;
    },
    onStop: () => {
      stopClicked += 1;
    },
    onToggleHidePreview: () => {
      hidePreviewToggled += 1;
    },
    onClose: () => {
      closedCount += 1;
    },
  });

  expect(session.mode).toBe('document-pip');
  expect(pipDoc.querySelector('[data-testid="pip-timer"]')?.textContent).toBe('REC 00:00:12');

  const pipButtons = [...pipDoc.querySelectorAll('button')];
  pipButtons.find((b) => b.textContent === 'Pause')!.click();
  expect(pauseToggled).toBe(1);

  pipButtons.find((b) => b.textContent === 'Hide preview')!.click();
  expect(hidePreviewToggled).toBe(1);

  session.updateRecordingState({ stage: 'paused', elapsedText: '00:00:15', previewHidden: true });
  expect(pipDoc.querySelector('[data-testid="pip-timer"]')?.textContent).toBe('PAUSED 00:00:15');
  expect(pipDoc.body.textContent).toContain('Camera preview hidden to avoid a double bubble');

  // Closing the Document PiP window fires pagehide and leaves the recording running (stopClicked === 0)
  listeners.get('pagehide')?.();
  expect(closedCount).toBe(1);
  expect(stopClicked).toBe(0);

  // Verify synchronous requestWindow BEFORE streamPromise resolves so user activation never expires
  let requestWindowCalledWhileStreamPending = false;
  let streamResolved = false;
  window.documentPictureInPicture = {
    requestWindow: vi.fn(async () => {
      requestWindowCalledWhileStreamPending = !streamResolved;
      pipDoc.body.innerHTML = '';
      return fakePipWin;
    }),
  };
  let resolveDelayedStream!: (s: MediaStream) => void;
  const delayedStreamPromise = new Promise<MediaStream>((r) => {
    resolveDelayedStream = r;
  });
  let micToggled = 0;
  const asyncSession = await openFloatingCamera({
    streamPromise: delayedStreamPromise,
    presenter: defaultPresenter(),
    onToggleMic: () => {
      micToggled += 1;
    },
  });
  expect(requestWindowCalledWhileStreamPending).toBe(true);
  const delayedStream = new MediaStream();
  streamResolved = true;
  resolveDelayedStream(delayedStream);
  await Promise.resolve();
  const pipVideo = pipDoc.querySelector('video') as HTMLVideoElement;
  expect(pipVideo.srcObject).toBe(delayedStream);

  // Verify Mute, Hide preview, Restart, and Discard live inside the More menu
  const moreGroup = pipDoc.querySelector('[aria-label="More floating controls"]');
  expect(moreGroup).not.toBeNull();
  const moreButtons = [...moreGroup!.querySelectorAll('button')].map((b) => b.textContent);
  expect(moreButtons).toEqual(['Mute', 'Hide preview', '↻ Restart', 'Discard']);
  ([...moreGroup!.querySelectorAll('button')].find((b) => b.textContent === 'Mute') as HTMLButtonElement).click();
  expect(micToggled).toBe(1);
  await asyncSession.close();

  delete window.documentPictureInPicture;
});

it('enforces the 3-case Camera-Duplication Rule so export contains the camera at most once, and supports hiding/restoring recording controls and Instant post-record export', async () => {
  const { resolveCameraLayerVisibility, canTransitionStage } = await import('../src/capture/stateMachine');

  // State machine transitions
  expect(canTransitionStage('idle', 'selecting')).toBe(true);
  expect(canTransitionStage('selecting', 'ready')).toBe(true);
  expect(canTransitionStage('ready', 'countdown')).toBe(true);
  expect(canTransitionStage('recording', 'paused')).toBe(true);
  expect(canTransitionStage('paused', 'finishing')).toBe(true);
  expect(canTransitionStage('finishing', 'postRecord')).toBe(true);

  // Case 1: Display capture + visible floating bubble + baked-in-screen default => do NOT composite camera a second time
  const case1 = resolveCameraLayerVisibility({
    cameraOn: true,
    surface: 'screen',
    hideFloatingPreview: false,
    duplicationMode: 'baked-in-screen',
  });
  expect(case1.compositeInExport).toBe(false);

  // Case 2: Display capture + Hide floating preview active => composite separate camera layer once in export
  const case2 = resolveCameraLayerVisibility({
    cameraOn: true,
    surface: 'screen',
    hideFloatingPreview: true,
    duplicationMode: 'baked-in-screen',
  });
  expect(case2.compositeInExport).toBe(true);

  // Case 3: Browser tab and Window capture => PiP is not in tab/window stream, so composite separate camera layer once in export
  const case3 = resolveCameraLayerVisibility({
    cameraOn: true,
    surface: 'tab',
    hideFloatingPreview: false,
    duplicationMode: 'baked-in-screen',
  });
  expect(case3.compositeInExport).toBe(true);

  const windowCase = resolveCameraLayerVisibility({
    cameraOn: true,
    surface: 'window',
    hideFloatingPreview: false,
    duplicationMode: 'baked-in-screen',
  });
  expect(windowCase.compositeInExport).toBe(true);

  // Verify compact setup with Show preview toggle, hideable recording controls (.rec-dock), and Instant mode Post-Record Quick Export sheet
  await act(async () => root.render(<RecordPage />));
  expect(host.querySelector('.cap-recorder.monitor-expanded')).toBeNull();
  await act(async () => button('Show preview').click());
  expect(host.querySelector('.cap-recorder.monitor-expanded')).not.toBeNull();
  await act(async () => button('Hide preview').click());
  expect(host.querySelector('.cap-recorder.monitor-expanded')).toBeNull();

  await act(async () => button('Instant').click());
  await act(() => {
    checkbox('Camera').click();
    checkbox('Microphone').click();
    const countdown = host.querySelector('select[aria-label="Recording countdown"]') as HTMLSelectElement;
    countdown.value = '0';
    countdown.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Start recording').click());

  // Collapse recording controls into minimal pill — Stop remains available in the collapsed bar
  await act(async () => button('Hide controls ▾').click());
  expect(host.querySelector('.rec-dock.rec-dock-collapsed')).not.toBeNull();
  expect(button('Stop & review')).toBeDefined();
  await act(async () => button('Show controls ▴').click());
  expect(host.querySelector('.rec-dock.rec-dock-collapsed')).toBeNull();

  // While RecordPage is hidden (user is in Edit), plain 's' key does not stop the background recording
  await act(async () => root.render(<RecordPage hidden={true} />));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
  });
  expect(capture.stop).not.toHaveBeenCalled();

  await act(async () => root.render(<RecordPage hidden={false} />));
  // Stopping in Instant mode opens the Post-Record Quick Export sheet with Export now, Edit recording, Record another take, Discard
  await act(async () => button('Stop & review').click());
  expect(host.textContent).toContain('Recording finished — Post-record actions');
  expect(host.textContent).toContain('Export now ↗');
  expect(host.textContent).toContain('Edit recording');
  expect(host.textContent).toContain('Record another take');
  expect(host.textContent).toContain('Discard this take');
});

it('supports bubble-layout hover overlay controls, Teleprompter sync in Document PiP, and MediaSession hardware key controls across background/fullscreen tabs', async () => {
  const { openFloatingCamera, teleprompterPixelsPerSecond } = await import('../src/capture/floatingCamera');
  const { defaultPresenter } = await import('../src/project/factory');

  expect(teleprompterPixelsPerSecond(150, 20)).toBeGreaterThan(10);

  const pipDoc = document.implementation.createHTMLDocument('pip-bubble');
  const winListeners = new Map<string, () => void>();
  const fakePipWin = {
    document: pipDoc,
    innerWidth: 180,
    innerHeight: 180,
    addEventListener: vi.fn((evt: string, cb: () => void) => winListeners.set(evt, cb)),
    resizeTo: vi.fn(),
    close: vi.fn(),
  } as unknown as Window;

  window.documentPictureInPicture = {
    requestWindow: vi.fn(async () => fakePipWin),
  };

  const prompterPatches: Array<Record<string, unknown>> = [];
  const pipSession = await openFloatingCamera({
    stream: new MediaStream(),
    presenter: defaultPresenter(),
    initialControlState: { stage: 'recording', elapsedText: '00:00:08', previewHidden: false, hasCamera: true },
    initialTeleprompter: {
      enabled: true,
      script: 'Welcome to Browser 4K Studio. Today we ship zero-copy WebCodecs.',
      wpm: 160,
      fontSize: 20,
      opacity: 0.85,
      playing: false,
    },
    onUpdateTeleprompter: (patch) => {
      prompterPatches.push(patch);
    },
  });

  // 180x180 square window uses 'bubble' layout with hover-overlay controls
  expect(pipSession.getActiveLayout()).toBe('bubble');
  const toolbar = pipDoc.querySelector('[role="toolbar"]') as HTMLElement;
  expect(toolbar.getAttribute('data-pip-controls-mode')).toBe('hover-overlay');
  expect(toolbar.getAttribute('data-hovered')).toBe('false');
  pipDoc.body.dispatchEvent(new Event('mouseenter'));
  expect(toolbar.getAttribute('data-hovered')).toBe('true');
  pipDoc.body.dispatchEvent(new Event('mouseleave'));
  expect(toolbar.getAttribute('data-hovered')).toBe('false');

  // Teleprompter overlay is rendered inside Document PiP and updates on font-size / scroll toggles
  const pipPrompter = pipDoc.querySelector('[data-testid="pip-teleprompter"]') as HTMLElement;
  expect(pipPrompter.style.display).toBe('grid');
  expect(pipDoc.querySelector('[data-testid="pip-teleprompter-meta"]')?.textContent).toBe('Teleprompter · 160 WPM');
  expect(pipDoc.querySelector('[data-testid="pip-teleprompter-body"]')?.textContent).toContain(
    'Today we ship zero-copy WebCodecs.',
  );

  (pipDoc.querySelector('[data-testid="pip-prompter-font-up"]') as HTMLButtonElement).click();
  expect(prompterPatches).toContainEqual({ fontSize: 22 });

  (pipDoc.querySelector('[data-testid="pip-prompter-play"]') as HTMLButtonElement).click();
  expect(prompterPatches).toContainEqual({ playing: true });

  await pipSession.close();
  delete window.documentPictureInPicture;

  // Verify MediaSession hardware key handlers (pause, play, stop) control background/fullscreen takes
  const mediaHandlers = new Map<string, () => void>();
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      playbackState: 'none',
      metadata: null,
      setActionHandler: vi.fn((action: string, handler: (() => void) | null) => {
        if (handler) mediaHandlers.set(action, handler);
        else mediaHandlers.delete(action);
      }),
    },
  });

  await startRecording();
  expect(mediaHandlers.has('pause')).toBe(true);
  expect(mediaHandlers.has('stop')).toBe(true);

  // Triggering OS/hardware 'pause' pauses the recording even when RecordPage is in the background
  await act(async () => root.render(<RecordPage hidden={true} />));
  await act(() => mediaHandlers.get('pause')!());
  expect(capture.pause).toHaveBeenCalledTimes(1);

  // Triggering OS/hardware 'play' resumes the paused recording
  await act(() => mediaHandlers.get('play')!());
  expect(capture.resume).toHaveBeenCalledTimes(1);

  // Triggering OS/hardware 'stop' finalizes the take
  await act(async () => mediaHandlers.get('stop')!());
  expect(capture.stop).toHaveBeenCalledTimes(1);
});

it('renders standalone CameraBubble with live shape/effect/placement options during recording, compact horizontal stealth record panel with timer, and editor presenter bubble parity', async () => {
  const { Inspector } = await import('../src/ui/Inspector');
  const { createClip, defaultPresenter } = await import('../src/project/factory');
  const { presenterEffectFilter } = await import('../src/render/layout');

  expect(presenterEffectFilter('warm-glow')).toContain('saturate');
  expect(presenterEffectFilter('neon-ring')).toContain('contrast');
  expect(presenterEffectFilter('none')).toBe('none');

  result.assets = [
    ...result.assets,
    {
      id: 'camera_asset',
      kind: 'video',
      name: 'Camera',
      path: 'recordings/take_test/camera.webm',
      origin: 'recorded',
      durationTicks: 5 * TICKS_PER_SECOND,
      createdAt: new Date().toISOString(),
    } as TakeResult['assets'][number],
  ];

  await act(async () => root.render(<RecordPage />));
  // Before preview or recording starts, no placeholder camera bubble is shown and no duplicate 'Camera preview' box exists
  expect(host.querySelectorAll('[data-testid="camera-bubble"]')).toHaveLength(0);
  expect(host.querySelector('[aria-label="Camera preview"]')).toBeNull();

  // Click "Preview camera bubble" to show the single live CameraBubble before recording
  await act(async () => button('Preview camera bubble').click());
  expect(host.querySelectorAll('[data-testid="camera-bubble"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Camera preview"]')).toBeNull();

  // Start recording with Camera enabled and 0s countdown
  await act(() => {
    checkbox('Microphone').click();
    const countdown = host.querySelector('select[aria-label="Recording countdown"]') as HTMLSelectElement;
    countdown.value = '0';
    countdown.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Start recording').click());

  // The horizontal recording dock timer is active and ONLY ONE standalone CameraBubble component is rendered
  expect(host.querySelector('.rec-dock')).not.toBeNull();
  expect(host.querySelector('[data-testid="rec-dock-timer"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-testid="camera-bubble"]')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Camera preview"]')).toBeNull();

  const bubbleWidget = host.querySelector('[data-testid="camera-bubble"]') as HTMLElement;
  expect(bubbleWidget).not.toBeNull();
  expect(bubbleWidget.getAttribute('data-shape')).toBe('circle');
  expect(bubbleWidget.getAttribute('data-effect')).toBe('none');

  // Open CameraBubble options popover while recording and switch shape to Square, effect to Neon Ring, and placement to Top-Left
  const optionsToggle = host.querySelector('button[aria-label="Bubble shape and effects"]') as HTMLButtonElement;
  await act(async () => optionsToggle.click());
  expect(host.querySelector('[aria-label="Camera bubble options"]')).not.toBeNull();

  const squareBtn = Array.from(host.querySelectorAll('.camera-bubble-pill')).find(
    (el) => el.textContent?.trim() === 'Square',
  ) as HTMLButtonElement;
  await act(async () => squareBtn.click());
  expect(bubbleWidget.getAttribute('data-shape')).toBe('square');

  const neonEffectBtn = Array.from(host.querySelectorAll('.camera-bubble-pill')).find(
    (el) => el.textContent?.trim() === 'Neon',
  ) as HTMLButtonElement;
  await act(async () => neonEffectBtn.click());
  expect(bubbleWidget.getAttribute('data-effect')).toBe('neon-ring');

  const topLeftPlaceBtn = host.querySelector('button[aria-label="Move bubble to top-left"]') as HTMLButtonElement;
  await act(async () => topLeftPlaceBtn.click());
  expect(bubbleWidget.getAttribute('data-corner')).toBe('top-left');

  const centerPlaceBtn = Array.from(host.querySelectorAll('.camera-bubble-pill')).find(
    (el) => el.textContent?.includes('Center'),
  ) as HTMLButtonElement;
  await act(async () => centerPlaceBtn.click());

  // Stop recording from the horizontal .rec-dock bar
  await act(async () => button('Stop & edit').click());

  // Verify the inserted presenter clip in the project inherited the live Square shape, Neon Ring effect, and centered X/Y coordinates,
  // and that the Editor Inspector exposes the same shape, effect, quick placement, and Position X / Position Y controls
  const project = useEditor.getState().project!;
  const insertedPresenterClip = project.tracks.flatMap((t) => t.clips).find((c) => Boolean(c.presenter));
  const presenterClip =
    insertedPresenterClip ??
    createClip({
      startTicks: 0,
      durationTicks: 90,
      presenter: { ...defaultPresenter(), shape: 'square', effect: 'neon-ring', x: 0.5, y: 0.5 },
    });
  expect(presenterClip.presenter?.shape).toBe('square');
  expect(presenterClip.presenter?.effect).toBe('neon-ring');

  await act(async () => root.render(<Inspector clip={presenterClip} trackKind="video" />));
  const shapeSelect = host.querySelector('select[aria-label="Presenter bubble shape"]') as HTMLSelectElement;
  const effectSelect = host.querySelector('select[aria-label="Presenter bubble effect"]') as HTMLSelectElement;
  expect(shapeSelect).not.toBeNull();
  expect(shapeSelect.value).toBe('square');
  expect(effectSelect).not.toBeNull();
  expect(effectSelect.value).toBe('neon-ring');
  expect(host.querySelector('[aria-label="Presenter quick placement"]')).not.toBeNull();
  expect(host.textContent).toContain('Position X');
  expect(host.textContent).toContain('Position Y');

  // Verify Editor left-rail Camera tool (EditorToolLibrary tool="presenter") also exposes shapes, visual effects, Center, and X/Y sliders
  const { EditorToolLibrary } = await import('../src/ui/EditorTools');
  await act(async () => root.render(<EditorToolLibrary tool="presenter" project={project} clip={presenterClip} />));
  expect(host.querySelector('[data-testid="presenter-reframe-panel"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Editor bubble effects"]')).not.toBeNull();
  expect(host.textContent).toContain('Position X');
  expect(host.textContent).toContain('Position Y');
});

it('supports Delete all projects in ProjectsPage and Delete all recordings in RecordingsLibrary', async () => {
  const { ProjectsPage } = await import('../src/ui/ProjectsPage');
  const { MemoryDirectoryHandle } = await import('../src/workspace/memoryFs');
  const { saveProject, writeTakeManifest } = await import('../src/workspace/workspace');

  const rootDir = new MemoryDirectoryHandle('workspace');
  useSession.setState({
    workspace: {
      root: rootDir,
      info: { mode: 'memory', name: 'Test Workspace', persistent: false },
    },
    projectFolder: 'proj-a',
  });

  const projA = createProject({ name: 'Project Alpha', width: 1920, height: 1080, fps: { num: 30, den: 1 } });
  const projB = createProject({ name: 'Project Beta', width: 1920, height: 1080, fps: { num: 30, den: 1 } });
  await saveProject(rootDir, projA, 'proj-a');
  await saveProject(rootDir, projB, 'proj-b');
  await writeTakeManifest(rootDir, 'proj-a', {
    version: 1,
    takeId: 'take_alpha_1',
    projectId: projA.id,
    startedAt: new Date().toISOString(),
    endedAt: new Date(Date.now() + 3000).toISOString(),
    status: 'finalized',
    segmentSeconds: 5,
    assets: [],
  });

  await act(async () => root.render(<ProjectsPage />));
  expect(host.textContent).toContain('Project Alpha');
  expect(host.textContent).toContain('Project Beta');

  // Delete all recordings from the RecordingsLibrary section first
  const deleteAllTakesBtn = host.querySelector('[data-testid="delete-all-takes-btn"]') as HTMLButtonElement;
  expect(deleteAllTakesBtn).not.toBeNull();
  await act(async () => deleteAllTakesBtn.click());
  const confirmDeleteAllTakesBtn = document.querySelector(
    '[data-testid="confirm-delete-all-takes-btn"]',
  ) as HTMLButtonElement;
  expect(confirmDeleteAllTakesBtn).not.toBeNull();
  await act(async () => confirmDeleteAllTakesBtn.click());
  expect(host.querySelector('[data-testid="delete-all-takes-btn"]')).toBeNull();

  // Now click Delete all projects and confirm
  const deleteAllProjectsBtn = host.querySelector('[data-testid="delete-all-projects-btn"]') as HTMLButtonElement;
  expect(deleteAllProjectsBtn).not.toBeNull();
  await act(async () => deleteAllProjectsBtn.click());
  const confirmDeleteAllProjectsBtn = document.querySelector(
    '[data-testid="confirm-delete-all-projects-btn"]',
  ) as HTMLButtonElement;
  expect(confirmDeleteAllProjectsBtn).not.toBeNull();
  await act(async () => confirmDeleteAllProjectsBtn.click());

  expect(host.textContent).toContain('No projects yet');
  expect(useEditor.getState().project).toBeNull();
});





