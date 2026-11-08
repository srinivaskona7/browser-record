import type { PresenterProps } from '../project/types';

export type FloatingCameraMode = 'document-pip' | 'video-pip' | 'unsupported';

export interface FloatingCameraSupport {
  mode: FloatingCameraMode;
  supported: boolean;
  label: string;
  detail: string;
}

interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
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
  stage: 'idle' | 'selecting' | 'ready' | 'countdown' | 'recording' | 'paused' | 'finishing';
  elapsedText: string;
  previewHidden?: boolean;
}

export interface FloatingCameraSession {
  mode: Exclude<FloatingCameraMode, 'unsupported'>;
  updatePresenter: (presenter: PresenterProps) => void;
  updateStream: (stream: MediaStream | null) => void;
  updateRecordingState: (state: FloatingRecordingControlState) => void;
  close: () => Promise<void>;
}

function applyPresenterStyleToDocPip(container: HTMLElement, video: HTMLVideoElement, presenter: PresenterProps) {
  container.style.borderRadius =
    presenter.shape === 'circle'
      ? '50%'
      : presenter.shape === 'rounded'
        ? '22px'
        : presenter.shape === 'portrait'
          ? '18px'
          : '6px';
  container.style.border =
    presenter.border > 0 ? `${Math.max(2, presenter.border)}px solid ${presenter.borderColor}` : 'none';
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
  onTogglePause?: () => void;
  onStop?: () => void;
  onToggleHidePreview?: () => void;
  onClose?: () => void;
}): Promise<FloatingCameraSession> {
  const support = detectFloatingCameraSupport();
  if (support.mode === 'document-pip' && window.documentPictureInPicture) {
    const pipWidth = options.presenter.shape === 'portrait' ? 250 : 280;
    const pipHeight = options.presenter.shape === 'portrait' ? 340 : 300;
    const pipWin = await window.documentPictureInPicture.requestWindow({ width: pipWidth, height: pipHeight });
    const doc = pipWin.document;
    doc.title = 'Studio Floating Camera & Controls';
    doc.body.style.margin = '0';
    doc.body.style.width = '100vw';
    doc.body.style.height = '100vh';
    doc.body.style.background = '#090d12';
    doc.body.style.color = '#f0f6fc';
    doc.body.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    doc.body.style.display = 'grid';
    doc.body.style.gridTemplateRows = '1fr auto';
    doc.body.style.gap = '6px';
    doc.body.style.padding = '8px';
    doc.body.style.boxSizing = 'border-box';
    doc.body.style.overflow = 'hidden';

    const stageWrap = doc.createElement('div');
    stageWrap.style.width = '100%';
    stageWrap.style.height = '100%';
    stageWrap.style.display = 'grid';
    stageWrap.style.placeItems = 'center';
    stageWrap.style.overflow = 'hidden';

    const frame = doc.createElement('div');
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
    applyPresenterStyleToDocPip(frame, video, options.presenter);

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

    const renderControlState = (state: FloatingRecordingControlState) => {
      const active = state.stage === 'recording' || state.stage === 'paused';
      const prefix = state.stage === 'paused' ? 'PAUSED' : state.stage === 'recording' ? 'REC' : 'READY';
      statusSpan.textContent = `${prefix} ${state.elapsedText}`;
      pauseBtn.textContent = state.stage === 'paused' ? 'Resume' : 'Pause';
      pauseBtn.disabled = !active;
      stopBtn.disabled = !active && state.stage !== 'countdown';
      hidePreviewBtn.textContent = state.previewHidden ? 'Show preview' : 'Hide preview';
      frame.style.display = state.previewHidden ? 'none' : 'block';
      hiddenNotice.style.display = state.previewHidden ? 'block' : 'none';
    };

    renderControlState(
      options.initialControlState ?? { stage: 'idle', elapsedText: '00:00:00', previewHidden: false },
    );

    let closed = false;
    const handlePageHide = () => {
      if (closed) return;
      closed = true;
      // Detach preview element only — never stop the underlying camera MediaStreamTrack
      // or recording session so closing the floating window leaves the take running!
      video.srcObject = null;
      options.onClose?.();
    };
    pipWin.addEventListener('pagehide', handlePageHide, { once: true });

    return {
      mode: 'document-pip',
      updatePresenter: (nextPresenter) => {
        if (!closed) applyPresenterStyleToDocPip(frame, video, nextPresenter);
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
      updatePresenter: () => {
        // Native Video PiP uses browser chrome; mirror is applied on the source element
      },
      updateStream: (nextStream) => {
        if (!closed && videoEl.srcObject !== nextStream) {
          videoEl.srcObject = nextStream;
          if (nextStream) void videoEl.play().catch(() => undefined);
        }
      },
      updateRecordingState: () => {
        // Video PiP only hosts the video stream; recording controls remain in Studio
      },
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
