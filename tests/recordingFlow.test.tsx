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
vi.mock('../src/workspace/workspace', async (original) => ({ ...await original<object>(), listTakes: vi.fn(async () => []), checkStorageHeadroom: vi.fn(async () => ({ enough: true })) }));
vi.mock('../src/capture/devices', async (original) => ({ ...await original<object>(), enumerateDevices: vi.fn(async () => ({ cameras: [], microphones: [] })), onDeviceChange: vi.fn(() => () => undefined) }));

let host: HTMLDivElement;
let root: Root;
let result: TakeResult;
let track: { kind: string; id: string; stop: ReturnType<typeof vi.fn>; getSettings: () => MediaTrackSettings; addEventListener: ReturnType<typeof vi.fn> };
const checkbox = (text: string) => [...host.querySelectorAll('label')].find((label) => label.querySelector('span')?.textContent === text)!.querySelector('input')!;
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  vi.clearAllMocks();
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
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: vi.fn(async () => new FakeStream()) } });
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

it('appends a new take and places the editor playhead on it without overwriting the previous edit', async () => {
  const project = useEditor.getState().project!;
  const previous = createClip({ kind: 'media', assetId: 'previous', startTicks: 0, durationTicks: 8 * TICKS_PER_SECOND });
  project.tracks[0]!.clips = [previous];
  project.durationTicks = 8 * TICKS_PER_SECOND;
  await startRecording();
  await act(async () => button('Stop & edit').click());
  const updated = useEditor.getState();
  expect(updated.project!.tracks[0]!.clips).toContainEqual(previous);
  expect(updated.playheadTicks).toBe(8 * TICKS_PER_SECOND);
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

it('shows visible cross-tab & display capture controls, hides live screen monitor during Entire screen capture, and saves one take when Chrome stops sharing', async () => {
  const { displayConstraints, describeReturnedSurface } = await import('../src/capabilities/detect');
  const constraints = displayConstraints({
    width: 1920,
    height: 1080,
    frameRate: 30,
    systemAudio: true,
    surface: 'tab',
  }) as DisplayMediaStreamOptions & { surfaceSwitching?: string; selfBrowserSurface?: string };
  expect(constraints.surfaceSwitching).toBe('include');
  expect(constraints.selfBrowserSurface).toBe('exclude');

  const tabSummary = describeReturnedSurface({
    label: 'Tab: Kubernetes Dashboard',
    getSettings: () => ({ displaySurface: 'browser', width: 1920, height: 1080, frameRate: 30 }),
  } as unknown as MediaStreamTrack);
  expect(tabSummary.surface).toBe('tab');
  expect(tabSummary.summary).toContain('Share this tab instead');

  let endedListener: (() => void) | undefined;
  track.addEventListener.mockImplementation((event: string, cb: () => void) => {
    if (event === 'ended') endedListener = cb;
  });

  await startRecording();
  // Cross-tab & display capture guidance and Chrome returned source badge are visibly rendered
  expect(host.querySelector('[aria-label="Across tabs and display capture"]')).not.toBeNull();
  expect(host.textContent).toContain('Chrome returned: Entire screen (monitor)');
  // Live screen monitor is hidden during Entire screen capture to prevent hall-of-mirrors effect
  expect(host.textContent).toContain('Live screen monitor hidden during display capture');

  // Stopping sharing from Chrome's native sharing bar triggers track 'ended' and saves one playable take
  expect(endedListener).toBeTypeOf('function');
  await act(async () => endedListener!());
  expect(capture.stop).toHaveBeenCalledTimes(1);
  expect(useEditor.getState().project!.assets.some((a) => a.id === 'screen_asset')).toBe(true);
});

it('opens Document Picture-in-Picture with camera + controls, toggles Hide preview to prevent double bubble, and leaves take running when closed', async () => {
  const { openFloatingCamera } = await import('../src/capture/floatingCamera');
  const { defaultPresenter } = await import('../src/project/factory');

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

  delete window.documentPictureInPicture;
});


