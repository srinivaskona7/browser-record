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
  if (typeof window !== 'undefined' && window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
    return {
      mode: 'document-pip',
      supported: true,
      label: 'Document Picture-in-Picture',
      detail: 'Floats a styled presenter camera window above browser tabs and desktop windows.',
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
      label: 'Video Picture-in-Picture',
      detail: 'Floats the live camera video in a browser Picture-in-Picture window across applications.',
    };
  }
  return {
    mode: 'unsupported',
    supported: false,
    label: 'In-tab camera bubble only',
    detail: 'This browser does not support Document or Video Picture-in-Picture. The camera bubble stays inside the recorder tab; true system-wide OS overlay requires a native desktop wrapper.',
  };
}

export interface FloatingCameraSession {
  mode: Exclude<FloatingCameraMode, 'unsupported'>;
  updatePresenter: (presenter: PresenterProps) => void;
  updateStream: (stream: MediaStream | null) => void;
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
  container.style.border = presenter.border > 0 ? `${Math.max(2, presenter.border)}px solid ${presenter.borderColor}` : 'none';
  video.style.transform = presenter.mirror ? 'scaleX(-1)' : 'none';
}

/**
 * Opens an always-on-top floating camera view from a user gesture using the existing
 * camera stream (never opening a duplicate getUserMedia stream).
 */
export async function openFloatingCamera(options: {
  stream: MediaStream;
  videoElement?: HTMLVideoElement | null;
  presenter: PresenterProps;
  onClose?: () => void;
}): Promise<FloatingCameraSession> {
  const support = detectFloatingCameraSupport();
  if (support.mode === 'document-pip' && window.documentPictureInPicture) {
    const pipWidth = options.presenter.shape === 'portrait' ? 210 : 240;
    const pipHeight = options.presenter.shape === 'portrait' ? 280 : 240;
    const pipWin = await window.documentPictureInPicture.requestWindow({ width: pipWidth, height: pipHeight });
    const doc = pipWin.document;
    doc.title = 'Camera Bubble';
    doc.body.style.margin = '0';
    doc.body.style.width = '100vw';
    doc.body.style.height = '100vh';
    doc.body.style.background = '#090d12';
    doc.body.style.display = 'grid';
    doc.body.style.placeItems = 'center';
    doc.body.style.overflow = 'hidden';

    const frame = doc.createElement('div');
    frame.style.width = 'calc(100vw - 12px)';
    frame.style.height = 'calc(100vh - 12px)';
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

    frame.appendChild(video);
    doc.body.appendChild(frame);
    void video.play().catch(() => undefined);

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
        if (!closed) applyPresenterStyleToDocPip(frame, video, nextPresenter);
      },
      updateStream: (nextStream) => {
        if (!closed) {
          video.srcObject = nextStream;
          if (nextStream) void video.play().catch(() => undefined);
        }
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
