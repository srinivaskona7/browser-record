import type { PresenterProps } from '../project/types';

export type FloatingCameraMode = 'document-pip' | 'video-pip' | 'unsupported';

export type PipLayoutMode = 'auto' | 'bubble' | 'bar' | 'tall';
export type PipSizePreset = 'S' | 'M' | 'L' | 'XL';

export interface FloatingBubblePrefs {
  sizePreset: PipSizePreset;
  layoutMode: PipLayoutMode;
  showTimer: boolean;
  showControls: boolean;
}

const PIP_PREFS_KEY = 'browser-record.pip-prefs.v1';

export function loadFloatingBubblePrefs(): FloatingBubblePrefs {
  try {
    const raw = localStorage.getItem(PIP_PREFS_KEY);
    if (!raw) return { sizePreset: 'M', layoutMode: 'auto', showTimer: true, showControls: true };
    const parsed = JSON.parse(raw) as Partial<FloatingBubblePrefs>;
    return {
      sizePreset: parsed.sizePreset ?? 'M',
      layoutMode: parsed.layoutMode ?? 'auto',
      showTimer: parsed.showTimer ?? true,
      showControls: parsed.showControls ?? true,
    };
  } catch {
    return { sizePreset: 'M', layoutMode: 'auto', showTimer: true, showControls: true };
  }
}

export function saveFloatingBubblePrefs(prefs: FloatingBubblePrefs): void {
  try {
    localStorage.setItem(PIP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

export function dimensionsForPipSize(size: PipSizePreset, shape: PresenterProps['shape']): { width: number; height: number } {
  if (shape === 'portrait') {
    switch (size) {
      case 'S':
        return { width: 180, height: 240 };
      case 'M':
        return { width: 240, height: 320 };
      case 'L':
        return { width: 300, height: 390 };
      case 'XL':
        return { width: 360, height: 460 };
    }
  }
  switch (size) {
    case 'S':
      return { width: 180, height: 180 };
    case 'M':
      return { width: 240, height: 320 };
    case 'L':
      return { width: 320, height: 360 };
    case 'XL':
      return { width: 400, height: 400 };
  }
}

/**
 * Computes the effective Document PiP layout from window dimensions and user preference:
 * - wide (e.g. 320×120) or cameraOff -> 'bar' (controls bar only)
 * - square (e.g. 180×180, 400×400) -> 'bubble' (bubble fills frame, controls overlay on hover/focus, elapsed badge always visible)
 * - tall (e.g. 240×320) -> 'tall' (bubble above, control bar below)
 */
export function resolvePipLayout(
  width: number,
  height: number,
  cameraOn: boolean,
  preferred: PipLayoutMode = 'auto',
): 'bubble' | 'tall' | 'bar' {
  if (!cameraOn) return 'bar';
  if (preferred !== 'auto') return preferred;
  if (width >= height * 1.45 || height <= 140) return 'bar';
  if (height >= width * 1.18) return 'tall';
  return 'bubble';
}

export interface FloatingCameraSupport {
  mode: FloatingCameraMode;
  supported: boolean;
  label: string;
  detail: string;
}

interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number; preferInitialWindowPlacement?: boolean }) => Promise<Window>;
  window?: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function detectFloatingCameraSupport(): FloatingCameraSupport {
  if (
    typeof window !== 'undefined' &&
    window.documentPictureInPicture &&
    typeof window.documentPictureInPicture.requestWindow === 'function'
  ) {
    return {
      mode: 'document-pip',
      supported: true,
      label: 'Document Picture-in-Picture (camera + controls)',
      detail:
        'Floats the live camera bubble and recording controls (timer, Pause/Resume, Stop, Hide preview) above browser tabs and desktop windows. Closing the window leaves the take running.',
    };
  }
  if (
    typeof document !== 'undefined' &&
    document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function'
  ) {
    return {
      mode: 'video-pip',
      supported: true,
      label: 'Video Picture-in-Picture (camera only; controls stay in Studio)',
      detail:
        'Document PiP is unavailable; floats the live camera video in a browser Picture-in-Picture window while recording controls remain in Studio.',
    };
  }
  return {
    mode: 'unsupported',
    supported: false,
    label: 'In-tab camera bubble only',
    detail:
      'This browser does not support Document or Video Picture-in-Picture. The camera bubble stays inside the recorder tab; true system-wide OS overlay requires a native desktop wrapper.',
  };
}

export interface FloatingRecordingControlState {
  stage: 'idle' | 'selecting' | 'ready' | 'countdown' | 'recording' | 'paused' | 'finishing' | 'postRecord';
  elapsedText: string;
  previewHidden?: boolean;
}

export interface FloatingCameraSession {
  mode: Exclude<FloatingCameraMode, 'unsupported'>;
  updatePresenter: (presenter: PresenterProps) => void;
  updateStream: (stream: MediaStream | null) => void;
  updateRecordingState: (state: FloatingRecordingControlState) => void;
  resizeToPreset: (size: PipSizePreset) => { resized: boolean; hint?: string };
  getActiveLayout: () => 'bubble' | 'tall' | 'bar';
  close: () => Promise<void>;
}

function copyStylesToPipDocument(sourceDoc: Document, targetDoc: Document): void {
  const theme = sourceDoc.documentElement.getAttribute('data-theme');
  if (theme) targetDoc.documentElement.setAttribute('data-theme', theme);
  for (const sheet of Array.from(sourceDoc.querySelectorAll('style, link[rel="stylesheet"]'))) {
    targetDoc.head.appendChild(sheet.cloneNode(true));
  }
}

function stateRingColor(stage: FloatingRecordingControlState['stage']): string {
  if (stage === 'recording' || stage === 'countdown') return '#ef4444';
  if (stage === 'paused') return '#f59e0b';
  return '#687385';
}

function applyPresenterStyleToDocPip(
  container: HTMLElement,
  video: HTMLVideoElement,
  presenter: PresenterProps,
  stage: FloatingRecordingControlState['stage'],
) {
  container.style.borderRadius =
    presenter.shape === 'circle'
      ? '50%'
      : presenter.shape === 'rounded'
        ? '22px'
        : presenter.shape === 'portrait'
          ? '18px'
          : '8px';
  const ringColor = stateRingColor(stage);
  const borderWidth = Math.max(3, presenter.border || 3);
  container.style.border = `${borderWidth}px solid ${ringColor}`;
  container.style.boxShadow = `0 0 0 2px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.5)`;
  video.style.transform = presenter.mirror ? 'scaleX(-1)' : 'none';
}

/**
 * Opens an always-on-top floating camera & controls window from an explicit user click,
 * reusing the active camera stream (never opening a duplicate getUserMedia stream) and
 * keeping its lifecycle separate from the recording session so closing it leaves the take running.
 */
export async function openFloatingCamera(options: {
  stream: MediaStream;
  videoElement?: HTMLVideoElement | null;
  presenter: PresenterProps;
  initialControlState?: FloatingRecordingControlState;
  preferInitialWindowPlacement?: boolean;
  onTogglePause?: () => void;
  onStop?: () => void;
  onToggleHidePreview?: () => void;
  onClose?: () => void;
}): Promise<FloatingCameraSession> {
  const support = detectFloatingCameraSupport();
  const prefs = loadFloatingBubblePrefs();

  if (support.mode === 'document-pip' && window.documentPictureInPicture) {
    const initialDims = dimensionsForPipSize(prefs.sizePreset, options.presenter.shape);
    const pipWin = await window.documentPictureInPicture.requestWindow({
      width: initialDims.width,
      height: initialDims.height,
      preferInitialWindowPlacement: options.preferInitialWindowPlacement ?? false,
    });
    const doc = pipWin.document;
    if (typeof document !== 'undefined') {
      copyStylesToPipDocument(document, doc);
    }
    doc.title = 'Studio Floating Camera & Controls';
    doc.body.style.margin = '0';
    doc.body.style.width = '100vw';
    doc.body.style.height = '100vh';
    doc.body.style.background = 'var(--token-bg-app, #090d12)';
    doc.body.style.color = 'var(--token-text-primary, #f0f6fc)';
    doc.body.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    doc.body.style.display = 'grid';
    doc.body.style.gap = '6px';
    doc.body.style.padding = '8px';
    doc.body.style.boxSizing = 'border-box';
    doc.body.style.overflow = 'hidden';
    doc.body.style.position = 'relative';

    const stageWrap = doc.createElement('div');
    stageWrap.style.width = '100%';
    stageWrap.style.height = '100%';
    stageWrap.style.display = 'grid';
    stageWrap.style.placeItems = 'center';
    stageWrap.style.overflow = 'hidden';
    stageWrap.style.position = 'relative';

    const frame = doc.createElement('div');
    frame.setAttribute('data-testid', 'pip-camera-frame');
    frame.style.width = 'min(100%, 210px)';
    frame.style.height = 'min(100%, 210px)';
    frame.style.overflow = 'hidden';
    frame.style.position = 'relative';
    frame.style.background = '#11161a';

    const video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.srcObject = options.stream;

    // Always-visible elapsed-time badge overlaid on top-left of the bubble
    const badge = doc.createElement('div');
    badge.setAttribute('data-testid', 'pip-elapsed-badge');
    badge.style.position = 'absolute';
    badge.style.top = '8px';
    badge.style.left = '8px';
    badge.style.padding = '3px 7px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(9, 13, 18, 0.82)';
    badge.style.border = '1px solid rgba(255,255,255,0.16)';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '700';
    badge.style.fontVariantNumeric = 'tabular-nums';
    badge.style.pointerEvents = 'none';

    const hiddenNotice = doc.createElement('div');
    hiddenNotice.style.display = 'none';
    hiddenNotice.style.padding = '12px';
    hiddenNotice.style.fontSize = '11.5px';
    hiddenNotice.style.lineHeight = '1.45';
    hiddenNotice.style.textAlign = 'center';
    hiddenNotice.style.color = '#8b949e';
    hiddenNotice.textContent =
      'Camera preview hidden to avoid a double bubble on Entire screen capture. Camera track continues recording separately for the editor.';

    frame.appendChild(video);
    stageWrap.appendChild(frame);
    stageWrap.appendChild(badge);
    stageWrap.appendChild(hiddenNotice);

    // Floating control bar inside Document PiP (timer + Pause/Resume + Stop + Hide preview)
    const bar = doc.createElement('div');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Floating recording controls');
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'space-between';
    bar.style.gap = '6px';
    bar.style.padding = '6px 8px';
    bar.style.borderRadius = '8px';
    bar.style.background = '#161b22';
    bar.style.border = '1px solid #30363d';
    bar.style.fontSize = '11.5px';

    const statusSpan = doc.createElement('span');
    statusSpan.setAttribute('data-testid', 'pip-timer');
    statusSpan.style.fontVariantNumeric = 'tabular-nums';
    statusSpan.style.fontWeight = '700';

    const btnWrap = doc.createElement('div');
    btnWrap.style.display = 'flex';
    btnWrap.style.gap = '4px';

    const styleBtn = (btn: HTMLButtonElement, danger = false) => {
      btn.type = 'button';
      btn.style.minHeight = '28px';
      btn.style.padding = '4px 8px';
      btn.style.borderRadius = '6px';
      btn.style.border = '1px solid ' + (danger ? '#f85149' : '#30363d');
      btn.style.background = danger ? '#da3633' : '#21262d';
      btn.style.color = '#f0f6fc';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '600';
      btn.style.cursor = 'pointer';
    };

    const pauseBtn = doc.createElement('button');
    styleBtn(pauseBtn, false);
    pauseBtn.addEventListener('click', () => options.onTogglePause?.());

    const stopBtn = doc.createElement('button');
    styleBtn(stopBtn, true);
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', () => options.onStop?.());

    const hidePreviewBtn = doc.createElement('button');
    styleBtn(hidePreviewBtn, false);
    hidePreviewBtn.textContent = 'Hide preview';
    hidePreviewBtn.title = 'Hide floating camera preview while continuing to record the camera separately for the editor';
    hidePreviewBtn.addEventListener('click', () => options.onToggleHidePreview?.());

    btnWrap.appendChild(pauseBtn);
    btnWrap.appendChild(stopBtn);
    btnWrap.appendChild(hidePreviewBtn);
    bar.appendChild(statusSpan);
    bar.appendChild(btnWrap);

    doc.body.appendChild(stageWrap);
    doc.body.appendChild(bar);
    void video.play().catch(() => undefined);

    let currentPresenter = options.presenter;
    let currentState: FloatingRecordingControlState = options.initialControlState ?? {
      stage: 'idle',
      elapsedText: '00:00:00',
      previewHidden: false,
    };
    let activeLayout: 'bubble' | 'tall' | 'bar' = 'tall';

    const applyLayout = () => {
      const w = pipWin.innerWidth || initialDims.width;
      const h = pipWin.innerHeight || initialDims.height;
      const hasCam = !currentState.previewHidden;
      activeLayout = resolvePipLayout(w, h, hasCam, prefs.layoutMode);
      doc.body.setAttribute('data-pip-layout', activeLayout);

      if (activeLayout === 'bar') {
        doc.body.style.gridTemplateRows = '1fr';
        stageWrap.style.display = currentState.previewHidden ? 'grid' : 'none';
        bar.style.display = 'flex';
      } else if (activeLayout === 'bubble') {
        doc.body.style.gridTemplateRows = '1fr auto';
        stageWrap.style.display = 'grid';
        const side = Math.max(96, Math.min(w - 16, h - 48));
        frame.style.width = `${side}px`;
        frame.style.height = `${side}px`;
        bar.style.display = prefs.showControls ? 'flex' : 'none';
      } else {
        doc.body.style.gridTemplateRows = '1fr auto';
        stageWrap.style.display = 'grid';
        const side = Math.max(110, Math.min(w - 16, h - 56));
        frame.style.width = `${side}px`;
        frame.style.height = `${side}px`;
        bar.style.display = prefs.showControls ? 'flex' : 'none';
      }
    };

    const renderControlState = (state: FloatingRecordingControlState) => {
      currentState = state;
      const active = state.stage === 'recording' || state.stage === 'paused';
      const prefix = state.stage === 'paused' ? 'PAUSED' : state.stage === 'recording' ? 'REC' : 'READY';
      const labelText = `${prefix} ${state.elapsedText}`;
      statusSpan.textContent = labelText;
      badge.textContent = `● ${labelText}`;
      badge.style.display = prefs.showTimer ? 'block' : 'none';
      pauseBtn.textContent = state.stage === 'paused' ? 'Resume' : 'Pause';
      pauseBtn.disabled = !active;
      stopBtn.disabled = !active && state.stage !== 'countdown';
      hidePreviewBtn.textContent = state.previewHidden ? 'Show preview' : 'Hide preview';
      frame.style.display = state.previewHidden ? 'none' : 'block';
      hiddenNotice.style.display = state.previewHidden ? 'block' : 'none';
      applyPresenterStyleToDocPip(frame, video, currentPresenter, state.stage);
      applyLayout();
    };

    renderControlState(currentState);
    pipWin.addEventListener('resize', applyLayout);

    let closed = false;
    const handlePageHide = () => {
      if (closed) return;
      closed = true;
      video.srcObject = null;
      options.onClose?.();
    };
    pipWin.addEventListener('pagehide', handlePageHide, { once: true });

    return {
      mode: 'document-pip',
      updatePresenter: (nextPresenter) => {
        currentPresenter = nextPresenter;
        if (!closed) applyPresenterStyleToDocPip(frame, video, nextPresenter, currentState.stage);
      },
      updateStream: (nextStream) => {
        if (!closed) {
          video.srcObject = nextStream;
          if (nextStream) void video.play().catch(() => undefined);
        }
      },
      updateRecordingState: (nextState) => {
        if (!closed) renderControlState(nextState);
      },
      resizeToPreset: (size) => {
        const nextDims = dimensionsForPipSize(size, currentPresenter.shape);
        saveFloatingBubblePrefs({ ...prefs, sizePreset: size });
        if (typeof pipWin.resizeTo === 'function') {
          try {
            pipWin.resizeTo(nextDims.width, nextDims.height);
            applyLayout();
            return { resized: true };
          } catch {
            return { resized: false, hint: 'Drag the window edge to resize' };
          }
        }
        return { resized: false, hint: 'Drag the window edge to resize' };
      },
      getActiveLayout: () => activeLayout,
      close: async () => {
        if (closed) return;
        closed = true;
        video.srcObject = null;
        try {
          pipWin.close();
        } catch {
          // Ignore close errors if window already closed
        }
        options.onClose?.();
      },
    };
  }

  if (support.mode === 'video-pip' && options.videoElement) {
    const videoEl = options.videoElement;
    if (videoEl.srcObject !== options.stream) {
      videoEl.srcObject = options.stream;
    }
    await videoEl.play().catch(() => undefined);
    await videoEl.requestPictureInPicture();

    let closed = false;
    const handleLeave = () => {
      if (closed) return;
      closed = true;
      videoEl.removeEventListener('leavepictureinpicture', handleLeave);
      options.onClose?.();
    };
    videoEl.addEventListener('leavepictureinpicture', handleLeave);

    return {
      mode: 'video-pip',
      updatePresenter: () => {},
      updateStream: (nextStream) => {
        if (!closed && videoEl.srcObject !== nextStream) {
          videoEl.srcObject = nextStream;
          if (nextStream) void videoEl.play().catch(() => undefined);
        }
      },
      updateRecordingState: () => {},
      resizeToPreset: () => ({ resized: false, hint: 'Drag the window edge to resize' }),
      getActiveLayout: () => 'bubble',
      close: async () => {
        if (closed) return;
        closed = true;
        videoEl.removeEventListener('leavepictureinpicture', handleLeave);
        if (typeof document !== 'undefined' && document.pictureInPictureElement === videoEl) {
          await document.exitPictureInPicture().catch(() => undefined);
        }
        options.onClose?.();
      },
    };
  }

  throw new Error(support.detail);
}
