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

export interface TeleprompterState {
  enabled: boolean;
  script: string;
  wpm: number;
  fontSize: number;
  opacity: number;
  playing: boolean;
}

const PIP_PREFS_KEY = 'browser-record.pip-prefs.v1';
const TELEPROMPTER_PREFS_KEY = 'browser-record.teleprompter.v1';

export function loadTeleprompterPrefs(): TeleprompterState {
  try {
    const raw = localStorage.getItem(TELEPROMPTER_PREFS_KEY);
    if (!raw) {
      return {
        enabled: false,
        script: '',
        wpm: 150,
        fontSize: 20,
        opacity: 0.86,
        playing: false,
      };
    }
    const parsed = JSON.parse(raw) as Partial<TeleprompterState>;
    return {
      enabled: parsed.enabled ?? false,
      script: typeof parsed.script === 'string' ? parsed.script : '',
      wpm: typeof parsed.wpm === 'number' ? Math.max(60, Math.min(300, parsed.wpm)) : 150,
      fontSize: typeof parsed.fontSize === 'number' ? Math.max(14, Math.min(36, parsed.fontSize)) : 20,
      opacity: typeof parsed.opacity === 'number' ? Math.max(0.35, Math.min(0.98, parsed.opacity)) : 0.86,
      playing: false,
    };
  } catch {
    return {
      enabled: false,
      script: '',
      wpm: 150,
      fontSize: 20,
      opacity: 0.86,
      playing: false,
    };
  }
}

export function saveTeleprompterPrefs(state: TeleprompterState): void {
  try {
    localStorage.setItem(
      TELEPROMPTER_PREFS_KEY,
      JSON.stringify({
        enabled: state.enabled,
        script: state.script,
        wpm: state.wpm,
        fontSize: state.fontSize,
        opacity: state.opacity,
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function teleprompterPixelsPerSecond(wpm: number, fontSize: number): number {
  const safeWpm = Math.max(60, Math.min(300, wpm));
  const safeFont = Math.max(14, Math.min(36, fontSize));
  const linesPerSec = safeWpm / 60 / 5;
  return Math.max(8, Math.round(linesPerSec * safeFont * 1.55));
}

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
  micMuted?: boolean;
  hasCamera?: boolean;
}

export interface FloatingCameraSession {
  mode: Exclude<FloatingCameraMode, 'unsupported'>;
  updatePresenter: (presenter: PresenterProps) => void;
  updateStream: (stream: MediaStream | null) => void;
  updateRecordingState: (state: FloatingRecordingControlState) => void;
  updateTeleprompter: (teleprompter: TeleprompterState) => void;
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
  const pipStyle = targetDoc.createElement('style');
  pipStyle.textContent = `
    body[data-pip-layout="bubble"] [data-pip-controls-mode="hover-overlay"] {
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 150ms ease, transform 150ms ease;
    }
    body[data-pip-layout="bubble"]:hover [data-pip-controls-mode="hover-overlay"],
    body[data-pip-layout="bubble"]:focus-within [data-pip-controls-mode="hover-overlay"],
    body[data-pip-layout="bubble"] [data-pip-controls-mode="hover-overlay"][data-hovered="true"] {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  targetDoc.head.appendChild(pipStyle);
}

function applyPresenterStyleToDocPip(
  container: HTMLElement,
  video: HTMLVideoElement,
  presenter: PresenterProps,
  stage: FloatingRecordingControlState['stage'],
) {
  container.style.clipPath =
    presenter.shape === 'hexagon'
      ? 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'
      : 'none';
  container.style.borderRadius =
    presenter.shape === 'circle'
      ? '50%'
      : presenter.shape === 'pill'
        ? '999px'
        : presenter.shape === 'rounded'
          ? '24px'
          : presenter.shape === 'portrait'
            ? '20px'
            : '10px';
  const ringColor =
    stage === 'recording' || stage === 'countdown'
      ? '#ff5c7c'
      : stage === 'paused'
        ? '#f59e0b'
        : presenter.borderColor || '#c3adff';
  const borderWidth = Math.max(3, presenter.border || 3);
  container.style.border = presenter.shape === 'hexagon' ? 'none' : `${borderWidth}px solid ${ringColor}`;
  container.style.boxShadow = `0 0 0 2px rgba(17, 16, 24, 0.85), 0 14px 34px rgba(0, 0, 0, 0.65)`;
  video.style.transform = presenter.mirror ? 'scaleX(-1)' : 'none';
}

/**
 * Opens an always-on-top Cap Stealth Controller & Camera window from an explicit user click,
 * requesting the PiP window synchronously on the user gesture before awaiting any
 * pending camera stream so Chrome never drops transient user activation.
 */
export async function openFloatingCamera(options: {
  stream?: MediaStream | null;
  streamPromise?: Promise<MediaStream | null>;
  videoElement?: HTMLVideoElement | null;
  presenter: PresenterProps;
  initialControlState?: FloatingRecordingControlState;
  initialTeleprompter?: TeleprompterState;
  preferInitialWindowPlacement?: boolean;
  onStartRecord?: () => void;
  onTogglePause?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  onDiscard?: () => void;
  onToggleMic?: () => void;
  onToggleHidePreview?: () => void;
  onUpdatePresenter?: (patch: Partial<PresenterProps>) => void;
  onUpdateTeleprompter?: (patch: Partial<TeleprompterState>) => void;
  onClose?: () => void;
}): Promise<FloatingCameraSession> {
  const support = detectFloatingCameraSupport();
  const prefs = loadFloatingBubblePrefs();

  if (support.mode === 'document-pip' && window.documentPictureInPicture) {
    const initialDims = dimensionsForPipSize(prefs.sizePreset, options.presenter.shape);
    // CRITICAL: Call requestWindow synchronously on the user click BEFORE awaiting any streamPromise
    // so transient user activation is guaranteed to be active in Chrome/Edge.
    const pipWin = await window.documentPictureInPicture.requestWindow({
      width: initialDims.width,
      height: initialDims.height,
      preferInitialWindowPlacement: options.preferInitialWindowPlacement ?? false,
    });
    const doc = pipWin.document;
    if (typeof document !== 'undefined') {
      copyStylesToPipDocument(document, doc);
    }
    doc.title = 'Floating controls — Browser 4K Studio';
    doc.body.style.margin = '0';
    doc.body.style.width = '100vw';
    doc.body.style.height = '100vh';
    doc.body.style.background = '#111018';
    doc.body.style.color = '#f5f2ff';
    doc.body.style.fontFamily = 'Plus Jakarta Sans, Inter, -apple-system, BlinkMacSystemFont, sans-serif';
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
    frame.style.width = 'min(100%, 220px)';
    frame.style.height = 'min(100%, 220px)';
    frame.style.overflow = 'hidden';
    frame.style.position = 'relative';
    frame.style.background = '#16141e';

    const video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    if (options.stream) {
      video.srcObject = options.stream;
    }

    // Always-visible elapsed-time badge overlaid on top-left of the bubble
    const badge = doc.createElement('div');
    badge.setAttribute('data-testid', 'pip-elapsed-badge');
    badge.style.position = 'absolute';
    badge.style.top = '8px';
    badge.style.left = '8px';
    badge.style.zIndex = '6';
    badge.style.padding = '3px 8px';
    badge.style.borderRadius = '999px';
    badge.style.background = 'rgba(17, 16, 24, 0.86)';
    badge.style.border = '1px solid rgba(195, 173, 255, 0.28)';
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
    hiddenNotice.style.color = '#b2abc4';
    hiddenNotice.textContent =
      'Camera preview hidden to avoid a double bubble on Entire screen capture. Camera track continues recording separately for the editor.';

    // Teleprompter overlay inside Document PiP (excluded from Window/Tab captures)
    let currentTeleprompter: TeleprompterState = options.initialTeleprompter ?? loadTeleprompterPrefs();
    const prompterOverlay = doc.createElement('div');
    prompterOverlay.setAttribute('data-testid', 'pip-teleprompter');
    prompterOverlay.setAttribute('role', 'region');
    prompterOverlay.setAttribute('aria-label', 'Floating teleprompter');
    prompterOverlay.style.position = 'absolute';
    prompterOverlay.style.inset = '0';
    prompterOverlay.style.zIndex = '8';
    prompterOverlay.style.display = 'none';
    prompterOverlay.style.gridTemplateRows = 'auto auto 1fr';
    prompterOverlay.style.gap = '4px';
    prompterOverlay.style.padding = '6px 8px';
    prompterOverlay.style.borderRadius = '12px';
    prompterOverlay.style.border = '1px solid rgba(195, 173, 255, 0.28)';
    prompterOverlay.style.backdropFilter = 'blur(8px)';
    prompterOverlay.style.boxSizing = 'border-box';

    const prompterHead = doc.createElement('div');
    prompterHead.style.display = 'flex';
    prompterHead.style.alignItems = 'center';
    prompterHead.style.justifyContent = 'space-between';
    prompterHead.style.gap = '4px';
    prompterHead.style.flexWrap = 'wrap';

    const prompterMeta = doc.createElement('span');
    prompterMeta.setAttribute('data-testid', 'pip-teleprompter-meta');
    prompterMeta.style.fontSize = '10.5px';
    prompterMeta.style.fontWeight = '700';
    prompterMeta.style.color = '#c3adff';

    const prompterActions = doc.createElement('div');
    prompterActions.style.display = 'flex';
    prompterActions.style.alignItems = 'center';
    prompterActions.style.gap = '3px';

    const prompterBanner = doc.createElement('div');
    prompterBanner.style.fontSize = '10px';
    prompterBanner.style.color = '#9ca3af';
    prompterBanner.textContent = 'Hidden from Window & Tab recordings';

    const prompterReadingWrap = doc.createElement('div');
    prompterReadingWrap.style.position = 'relative';
    prompterReadingWrap.style.overflow = 'hidden';
    prompterReadingWrap.style.display = 'grid';
    prompterReadingWrap.style.gridTemplateColumns = '12px 1fr 12px';
    prompterReadingWrap.style.alignItems = 'center';
    prompterReadingWrap.style.height = '100%';

    const leftGuide = doc.createElement('span');
    leftGuide.setAttribute('aria-hidden', 'true');
    leftGuide.style.color = '#60a5fa';
    leftGuide.style.fontSize = '12px';
    leftGuide.style.fontWeight = '700';
    leftGuide.textContent = '▸';

    const rightGuide = doc.createElement('span');
    rightGuide.setAttribute('aria-hidden', 'true');
    rightGuide.style.color = '#60a5fa';
    rightGuide.style.fontSize = '12px';
    rightGuide.style.fontWeight = '700';
    rightGuide.style.textAlign = 'right';
    rightGuide.textContent = '◂';

    const prompterBody = doc.createElement('div');
    prompterBody.setAttribute('data-testid', 'pip-teleprompter-body');
    prompterBody.style.height = '100%';
    prompterBody.style.overflowY = 'auto';
    prompterBody.style.padding = '4px 6px';
    prompterBody.style.lineHeight = '1.5';
    prompterBody.style.whiteSpace = 'pre-wrap';
    prompterBody.style.color = '#f5f2ff';
    prompterBody.style.fontWeight = '600';

    frame.appendChild(video);
    stageWrap.appendChild(frame);
    stageWrap.appendChild(badge);
    stageWrap.appendChild(hiddenNotice);
    stageWrap.appendChild(prompterOverlay);

    // Floating controls bar inside Document PiP: Timer · Pause/Resume · Stop + More (Mute, Hide preview, Restart, Discard)
    const bar = doc.createElement('div');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Floating controls');
    bar.setAttribute('data-pip-controls-mode', 'docked');
    bar.setAttribute('data-hovered', 'false');
    bar.style.display = 'flex';
    bar.style.alignItems = 'center';
    bar.style.justifyContent = 'space-between';
    bar.style.flexWrap = 'wrap';
    bar.style.gap = '6px';
    bar.style.padding = '6px 8px';
    bar.style.borderRadius = '12px';
    bar.style.background = '#16141e';
    bar.style.border = '1px solid #322d41';
    bar.style.fontSize = '11.5px';
    bar.style.boxSizing = 'border-box';

    const statusSpan = doc.createElement('span');
    statusSpan.setAttribute('data-testid', 'pip-timer');
    statusSpan.style.fontVariantNumeric = 'tabular-nums';
    statusSpan.style.fontWeight = '700';

    const btnWrap = doc.createElement('div');
    btnWrap.style.display = 'flex';
    btnWrap.style.alignItems = 'center';
    btnWrap.style.flexWrap = 'wrap';
    btnWrap.style.gap = '4px';

    const styleBtn = (btn: HTMLButtonElement, tone: 'default' | 'danger' | 'primary' = 'default') => {
      btn.type = 'button';
      btn.style.minHeight = '26px';
      btn.style.padding = '3px 7px';
      btn.style.borderRadius = '7px';
      btn.style.border =
        '1px solid ' + (tone === 'danger' ? '#ff5c7c' : tone === 'primary' ? '#c3adff' : '#322d41');
      btn.style.background =
        tone === 'danger' ? '#da3633' : tone === 'primary' ? '#2c2247' : '#1c1927';
      btn.style.color = '#f5f2ff';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '600';
      btn.style.cursor = 'pointer';
    };

    const emitTeleprompterPatch = (patch: Partial<TeleprompterState>) => {
      currentTeleprompter = { ...currentTeleprompter, ...patch };
      saveTeleprompterPrefs(currentTeleprompter);
      renderTeleprompter(currentTeleprompter);
      options.onUpdateTeleprompter?.(patch);
    };

    const prompterPlayBtn = doc.createElement('button');
    styleBtn(prompterPlayBtn, 'primary');
    prompterPlayBtn.setAttribute('data-testid', 'pip-prompter-play');
    prompterPlayBtn.addEventListener('click', () => {
      emitTeleprompterPatch({ playing: !currentTeleprompter.playing });
    });

    const prompterResetBtn = doc.createElement('button');
    styleBtn(prompterResetBtn, 'default');
    prompterResetBtn.setAttribute('data-testid', 'pip-prompter-reset');
    prompterResetBtn.textContent = '↺';
    prompterResetBtn.title = 'Reset teleprompter scroll to top';
    prompterResetBtn.addEventListener('click', () => {
      prompterBody.scrollTop = 0;
    });

    const prompterFontDownBtn = doc.createElement('button');
    styleBtn(prompterFontDownBtn, 'default');
    prompterFontDownBtn.setAttribute('data-testid', 'pip-prompter-font-down');
    prompterFontDownBtn.textContent = 'A-';
    prompterFontDownBtn.title = 'Decrease teleprompter text size';
    prompterFontDownBtn.addEventListener('click', () => {
      emitTeleprompterPatch({ fontSize: Math.max(14, currentTeleprompter.fontSize - 2) });
    });

    const prompterFontUpBtn = doc.createElement('button');
    styleBtn(prompterFontUpBtn, 'default');
    prompterFontUpBtn.setAttribute('data-testid', 'pip-prompter-font-up');
    prompterFontUpBtn.textContent = 'A+';
    prompterFontUpBtn.title = 'Increase teleprompter text size';
    prompterFontUpBtn.addEventListener('click', () => {
      emitTeleprompterPatch({ fontSize: Math.min(36, currentTeleprompter.fontSize + 2) });
    });

    const prompterCloseBtn = doc.createElement('button');
    styleBtn(prompterCloseBtn, 'default');
    prompterCloseBtn.setAttribute('data-testid', 'pip-prompter-close');
    prompterCloseBtn.textContent = 'Hide notes';
    prompterCloseBtn.addEventListener('click', () => {
      emitTeleprompterPatch({ enabled: false, playing: false });
    });

    prompterActions.appendChild(prompterPlayBtn);
    prompterActions.appendChild(prompterResetBtn);
    prompterActions.appendChild(prompterFontDownBtn);
    prompterActions.appendChild(prompterFontUpBtn);
    prompterActions.appendChild(prompterCloseBtn);
    prompterHead.appendChild(prompterMeta);
    prompterHead.appendChild(prompterActions);
    prompterReadingWrap.appendChild(leftGuide);
    prompterReadingWrap.appendChild(prompterBody);
    prompterReadingWrap.appendChild(rightGuide);
    prompterOverlay.appendChild(prompterHead);
    prompterOverlay.appendChild(prompterBanner);
    prompterOverlay.appendChild(prompterReadingWrap);

    const recordBtn = doc.createElement('button');
    styleBtn(recordBtn, 'danger');
    recordBtn.textContent = '● Record';
    recordBtn.title = 'Start recording from Floating controls';
    recordBtn.addEventListener('click', () => options.onStartRecord?.());

    const pauseBtn = doc.createElement('button');
    styleBtn(pauseBtn, 'default');
    pauseBtn.addEventListener('click', () => options.onTogglePause?.());

    const stopBtn = doc.createElement('button');
    styleBtn(stopBtn, 'danger');
    stopBtn.textContent = 'Stop';
    stopBtn.title = 'Stop recording and open take in Studio';
    stopBtn.addEventListener('click', () => options.onStop?.());

    const prompterToggleBtn = doc.createElement('button');
    styleBtn(prompterToggleBtn, 'default');
    prompterToggleBtn.setAttribute('data-testid', 'pip-prompter-toggle');
    prompterToggleBtn.textContent = 'Notes';
    prompterToggleBtn.title = 'Toggle teleprompter notes in Floating controls';
    prompterToggleBtn.style.display = options.onUpdateTeleprompter || options.initialTeleprompter ? 'inline-block' : 'none';
    prompterToggleBtn.addEventListener('click', () => {
      emitTeleprompterPatch({ enabled: !currentTeleprompter.enabled });
    });

    const moreDetails = doc.createElement('details');
    moreDetails.style.position = 'relative';
    const moreSummary = doc.createElement('summary');
    moreSummary.textContent = 'More';
    moreSummary.style.listStyle = 'none';
    moreSummary.style.minHeight = '26px';
    moreSummary.style.padding = '3px 7px';
    moreSummary.style.borderRadius = '7px';
    moreSummary.style.border = '1px solid #322d41';
    moreSummary.style.background = '#1c1927';
    moreSummary.style.color = '#f5f2ff';
    moreSummary.style.fontSize = '11px';
    moreSummary.style.fontWeight = '600';
    moreSummary.style.cursor = 'pointer';
    moreSummary.style.display = 'inline-flex';
    moreSummary.style.alignItems = 'center';

    const moreMenu = doc.createElement('div');
    moreMenu.setAttribute('role', 'group');
    moreMenu.setAttribute('aria-label', 'More floating controls');
    moreMenu.style.display = 'flex';
    moreMenu.style.flexWrap = 'wrap';
    moreMenu.style.gap = '4px';
    moreMenu.style.marginTop = '4px';

    const micBtn = doc.createElement('button');
    styleBtn(micBtn, 'default');
    micBtn.textContent = 'Mute';
    micBtn.title = 'Mute or unmute microphone';
    micBtn.addEventListener('click', () => options.onToggleMic?.());

    const hidePreviewBtn = doc.createElement('button');
    styleBtn(hidePreviewBtn, 'default');
    hidePreviewBtn.textContent = 'Hide preview';
    hidePreviewBtn.title = 'Hide floating camera preview while continuing to record the camera separately for the editor';
    hidePreviewBtn.addEventListener('click', () => options.onToggleHidePreview?.());

    const restartBtn = doc.createElement('button');
    styleBtn(restartBtn, 'default');
    restartBtn.textContent = '↻ Restart';
    restartBtn.title = 'Restart take from 00:00';
    restartBtn.addEventListener('click', () => options.onRestart?.());

    const discardBtn = doc.createElement('button');
    styleBtn(discardBtn, 'default');
    discardBtn.textContent = 'Discard';
    discardBtn.title = 'Cancel and discard this take';
    discardBtn.addEventListener('click', () => options.onDiscard?.());

    let currentPresenter = options.presenter;
    let currentState: FloatingRecordingControlState = options.initialControlState ?? {
      stage: 'idle',
      elapsedText: '00:00:00',
      previewHidden: false,
      micMuted: false,
      hasCamera: true,
    };

    moreMenu.appendChild(micBtn);
    moreMenu.appendChild(hidePreviewBtn);
    moreMenu.appendChild(restartBtn);
    moreMenu.appendChild(discardBtn);
    moreDetails.appendChild(moreSummary);
    moreDetails.appendChild(moreMenu);

    btnWrap.appendChild(recordBtn);
    btnWrap.appendChild(pauseBtn);
    btnWrap.appendChild(stopBtn);
    btnWrap.appendChild(prompterToggleBtn);
    btnWrap.appendChild(moreDetails);
    bar.appendChild(statusSpan);
    bar.appendChild(btnWrap);

    doc.body.appendChild(stageWrap);
    doc.body.appendChild(bar);
    if (options.stream) {
      void video.play().catch(() => undefined);
    } else if (options.streamPromise) {
      void options.streamPromise.then((resolved) => {
        if (resolved && !closed) {
          video.srcObject = resolved;
          void video.play().catch(() => undefined);
        }
      });
    }

    let activeLayout: 'bubble' | 'tall' | 'bar' = 'tall';

    const setHovered = (hovered: boolean) => {
      bar.setAttribute('data-hovered', hovered ? 'true' : 'false');
    };
    doc.body.addEventListener('mouseenter', () => setHovered(true));
    doc.body.addEventListener('mouseleave', () => setHovered(false));
    doc.body.addEventListener('focusin', () => setHovered(true));
    doc.body.addEventListener('focusout', () => setHovered(false));

    const applyLayout = () => {
      const w = pipWin.innerWidth || initialDims.width;
      const h = pipWin.innerHeight || initialDims.height;
      const hasCam = !currentState.previewHidden && currentState.hasCamera !== false;
      activeLayout = resolvePipLayout(w, h, hasCam, prefs.layoutMode);
      doc.body.setAttribute('data-pip-layout', activeLayout);

      if (activeLayout === 'bar') {
        doc.body.style.gridTemplateRows = '1fr';
        stageWrap.style.display = currentState.previewHidden || currentTeleprompter.enabled ? 'grid' : 'none';
        bar.setAttribute('data-pip-controls-mode', 'docked');
        bar.style.position = 'static';
        bar.style.left = '';
        bar.style.right = '';
        bar.style.bottom = '';
        bar.style.zIndex = '';
        bar.style.background = '#16141e';
        bar.style.backdropFilter = '';
        bar.style.display = 'flex';
      } else if (activeLayout === 'bubble') {
        // Square bubble mode: camera fills the frame and controls float as a hover/focus overlay at the bottom
        doc.body.style.gridTemplateRows = '1fr';
        stageWrap.style.display = 'grid';
        const side = Math.max(96, Math.min(w - 16, h - 16));
        if (currentPresenter.shape === 'pill') {
          frame.style.width = `${Math.min(w - 16, Math.round(side * 1.35))}px`;
          frame.style.height = `${Math.round(side * 0.85)}px`;
        } else if (currentPresenter.shape === 'portrait') {
          frame.style.width = `${Math.round(side * 0.82)}px`;
          frame.style.height = `${side}px`;
        } else {
          frame.style.width = `${side}px`;
          frame.style.height = `${side}px`;
        }
        bar.setAttribute('data-pip-controls-mode', 'hover-overlay');
        bar.style.position = 'absolute';
        bar.style.left = '8px';
        bar.style.right = '8px';
        bar.style.bottom = '8px';
        bar.style.zIndex = '12';
        bar.style.background = 'rgba(22, 20, 30, 0.92)';
        bar.style.backdropFilter = 'blur(8px)';
        bar.style.display = prefs.showControls ? 'flex' : 'none';
      } else {
        doc.body.style.gridTemplateRows = '1fr auto';
        stageWrap.style.display = 'grid';
        const side = Math.max(104, Math.min(w - 16, h - 56));
        if (currentPresenter.shape === 'pill') {
          frame.style.width = `${Math.min(w - 16, Math.round(side * 1.35))}px`;
          frame.style.height = `${Math.round(side * 0.85)}px`;
        } else if (currentPresenter.shape === 'portrait') {
          frame.style.width = `${Math.round(side * 0.82)}px`;
          frame.style.height = `${side}px`;
        } else {
          frame.style.width = `${side}px`;
          frame.style.height = `${side}px`;
        }
        bar.setAttribute('data-pip-controls-mode', 'docked');
        bar.style.position = 'static';
        bar.style.left = '';
        bar.style.right = '';
        bar.style.bottom = '';
        bar.style.zIndex = '';
        bar.style.background = '#16141e';
        bar.style.backdropFilter = '';
        bar.style.display = prefs.showControls ? 'flex' : 'none';
      }
    };

    const renderTeleprompter = (tp: TeleprompterState) => {
      currentTeleprompter = tp;
      prompterOverlay.style.display = tp.enabled ? 'grid' : 'none';
      prompterOverlay.style.background = `rgba(17, 16, 24, ${tp.opacity})`;
      prompterMeta.textContent = `Teleprompter · ${tp.wpm} WPM`;
      prompterPlayBtn.textContent = tp.playing ? '⏸ Pause scroll' : '▶ Scroll';
      prompterBody.style.fontSize = `${tp.fontSize}px`;
      prompterBody.textContent =
        tp.script.trim() ||
        'Add presenter notes in the Studio Teleprompter panel to scroll them beside your camera.';
      prompterToggleBtn.setAttribute('aria-pressed', tp.enabled ? 'true' : 'false');
      styleBtn(prompterToggleBtn, tp.enabled ? 'primary' : 'default');
      applyLayout();
    };

    const prompterTimer = window.setInterval(() => {
      if (!currentTeleprompter.enabled || !currentTeleprompter.playing) return;
      const pxPerSec = teleprompterPixelsPerSecond(currentTeleprompter.wpm, currentTeleprompter.fontSize);
      prompterBody.scrollTop += Math.max(1, Math.round((pxPerSec * 50) / 1000));
    }, 50);

    const renderControlState = (state: FloatingRecordingControlState) => {
      currentState = state;
      const active = state.stage === 'recording' || state.stage === 'paused';
      const canStart = state.stage === 'idle' || state.stage === 'ready';
      const prefix = state.stage === 'paused' ? 'PAUSED' : state.stage === 'recording' ? 'REC' : 'CAP READY';
      const labelText = `${prefix} ${state.elapsedText}`;
      statusSpan.textContent = labelText;
      badge.textContent = `● ${labelText}`;
      badge.style.display = prefs.showTimer ? 'block' : 'none';
      recordBtn.style.display = canStart && options.onStartRecord ? 'inline-block' : 'none';
      pauseBtn.textContent = state.stage === 'paused' ? 'Resume' : 'Pause';
      pauseBtn.disabled = !active;
      stopBtn.disabled = !active && state.stage !== 'countdown';
      restartBtn.disabled = !active;
      discardBtn.disabled = !active && state.stage !== 'countdown';
      micBtn.textContent = state.micMuted ? 'Unmute' : 'Mute';
      hidePreviewBtn.textContent = state.previewHidden ? 'Show preview' : 'Hide preview';
      frame.style.display = state.previewHidden || state.hasCamera === false ? 'none' : 'block';
      hiddenNotice.style.display = state.previewHidden ? 'block' : 'none';
      applyPresenterStyleToDocPip(frame, video, currentPresenter, state.stage);
      applyLayout();
    };

    renderTeleprompter(currentTeleprompter);
    renderControlState(currentState);
    pipWin.addEventListener('resize', applyLayout);

    let closed = false;
    const handlePageHide = () => {
      if (closed) return;
      closed = true;
      window.clearInterval(prompterTimer);
      video.srcObject = null;
      options.onClose?.();
    };
    pipWin.addEventListener('pagehide', handlePageHide, { once: true });

    return {
      mode: 'document-pip',
      updatePresenter: (nextPresenter) => {
        currentPresenter = nextPresenter;
        if (!closed) {
          applyPresenterStyleToDocPip(frame, video, nextPresenter, currentState.stage);
          applyLayout();
        }
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
      updateTeleprompter: (nextTeleprompter) => {
        if (!closed) renderTeleprompter(nextTeleprompter);
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
        window.clearInterval(prompterTimer);
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
    const resolvedStream = options.stream ?? (options.streamPromise ? await options.streamPromise : null);
    if (!resolvedStream) throw new Error('Camera stream is not available.');
    if (videoEl.srcObject !== resolvedStream) {
      videoEl.srcObject = resolvedStream;
    }
    if (videoEl.readyState < 1) {
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          videoEl.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        videoEl.addEventListener('loadedmetadata', onLoaded, { once: true });
        setTimeout(resolve, 600);
      });
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
      updateTeleprompter: () => {},
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
