export interface BrowserInfo {
  name: 'chrome' | 'edge' | 'safari' | 'firefox' | 'other';
  version: string;
  os: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown';
  mobile: boolean;
}

export function detectBrowser(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): BrowserInfo {
  const ua = userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  let name: BrowserInfo['name'] = 'other';
  let version = 'unknown';
  const edge = /Edg\/([\d.]+)/.exec(ua);
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  const firefox = /Firefox\/([\d.]+)/.exec(ua);
  const safari = /Version\/([\d.]+).*Safari/.exec(ua);
  if (edge) {
    name = 'edge';
    version = edge[1] ?? version;
  } else if (chrome) {
    name = 'chrome';
    version = chrome[1] ?? version;
  } else if (firefox) {
    name = 'firefox';
    version = firefox[1] ?? version;
  } else if (safari) {
    name = 'safari';
    version = safari[1] ?? version;
  }
  let os: BrowserInfo['os'] = 'unknown';
  if (/Macintosh|Mac OS X/.test(ua)) os = 'macos';
  else if (/Windows/.test(ua)) os = 'windows';
  else if (/Android/.test(ua)) os = 'android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'ios';
  else if (/Linux/.test(ua)) os = 'linux';
  return { name, version, os, mobile };
}

export interface FeatureFlags {
  screenCapture: boolean;
  camera: boolean;
  microphone: boolean;
  mediaRecorder: boolean;
  webCodecsEncode: boolean;
  webCodecsDecode: boolean;
  fileSystemAccess: boolean;
  opfs: boolean;
  offscreenCanvas: boolean;
  audioWorklet: boolean;
  audioContext: boolean;
  sharedArrayBuffer: boolean;
  webGl2: boolean;
  webGpu: boolean;
  wakeLock: boolean;
  persistentStorageQuery: boolean;
  showSaveFilePicker: boolean;
  showOpenFilePicker: boolean;
}

const has = (target: object | undefined, key: string): boolean =>
  typeof target === 'object' && target !== null && key in target;

export function detectFeatures(globalThisLike: typeof globalThis = globalThis): FeatureFlags {
  const nav = (globalThisLike as { navigator?: Navigator }).navigator;
  const win = globalThisLike as unknown as Record<string, unknown>;
  const mediaDevices = nav?.mediaDevices as MediaDevices | undefined;
  return {
    screenCapture: Boolean(mediaDevices && 'getDisplayMedia' in mediaDevices),
    camera: Boolean(mediaDevices && 'getUserMedia' in mediaDevices),
    microphone: Boolean(mediaDevices && 'getUserMedia' in mediaDevices),
    mediaRecorder: has(win, 'MediaRecorder'),
    webCodecsEncode: has(win, 'VideoEncoder'),
    webCodecsDecode: has(win, 'VideoDecoder'),
    fileSystemAccess: has(win, 'showDirectoryPicker'),
    opfs: Boolean(nav?.storage && 'getDirectory' in nav.storage),
    offscreenCanvas: has(win, 'OffscreenCanvas'),
    audioWorklet: Boolean((win.AudioContext as unknown) && 'audioWorklet' in AudioContext.prototype),
    audioContext: has(win, 'AudioContext') || has(win, 'webkitAudioContext'),
    sharedArrayBuffer: has(win, 'SharedArrayBuffer'),
    webGl2: Boolean(offscreenCanvasSupport() && hasWebGL2()),
    webGpu: Boolean((nav as unknown as { gpu?: unknown })?.gpu),
    wakeLock: Boolean(nav && 'wakeLock' in nav),
    persistentStorageQuery: Boolean(nav?.storage && 'persist' in nav.storage),
    showSaveFilePicker: has(win, 'showSaveFilePicker'),
    showOpenFilePicker: has(win, 'showOpenFilePicker'),
  };
}

let cachedWebGl2: boolean | null = null;
function hasWebGL2(): boolean {
  if (cachedWebGl2 !== null) return cachedWebGl2;
  try {
    if (typeof document === 'undefined') return (cachedWebGl2 = false);
    const canvas = document.createElement('canvas');
    cachedWebGl2 = Boolean(canvas.getContext('webgl2'));
  } catch {
    cachedWebGl2 = false;
  }
  return cachedWebGl2;
}

function offscreenCanvasSupport(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** Display capture constraints. `systemAudio` is requested only when asked. */
export function displayConstraints(options: {
  width: number;
  height: number;
  frameRate: number;
  systemAudio: boolean;
  preferCurrentTab?: boolean;
  /**
   * Meeting-style surface choice. Chrome treats this as a preference for the
   * picker, not a guarantee: the user still chooses, and the applied surface is
   * read back from track settings.
   */
  surface?: 'screen' | 'window' | 'tab';
}): DisplayMediaStreamOptions {
  const video: MediaTrackConstraints = {
    width: { ideal: options.width, max: options.width },
    height: { ideal: options.height, max: options.height },
    frameRate: { ideal: options.frameRate, max: options.frameRate },
  };
  if (options.surface) {
    const displaySurface = options.surface === 'screen' ? 'monitor' : options.surface === 'window' ? 'window' : 'browser';
    (video as MediaTrackConstraints & { displaySurface?: string }).displaySurface = displaySurface;
  }
  const constraints: DisplayMediaStreamOptions & { preferCurrentTab?: boolean; selfBrowserSurface?: string } = {
    video,
    audio: options.systemAudio
      ? ({
          // Chrome supports tab/system audio on some surfaces; the loopback flag
          // is ignored where unsupported.
          ...(options.preferCurrentTab ? {} : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints)
      : false,
    preferCurrentTab: options.preferCurrentTab ?? false,
    selfBrowserSurface: 'exclude',
  };
  return constraints;
}

/** The surface the browser actually handed over, when it reports one. */
export function reportedSurface(settings: MediaTrackSettings): 'screen' | 'window' | 'tab' | null {
  const value = (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  if (value === 'monitor') return 'screen';
  if (value === 'window') return 'window';
  if (value === 'browser') return 'tab';
  return null;
}

/**
 * Translate requested constraint values into what the track actually reports.
 * This is what keeps the UI from calling a resized 1080p source "4K".
 */
export interface TrackSettingsReport {
  label: string;
  displaySurface?: string;
  width: number;
  height: number;
  frameRate: number;
  sampleRate?: number;
  channelCount?: number;
  deviceId?: string;
  muted: boolean;
  readyState: MediaStreamTrackState;
}

export function reportTrackSettings(track: MediaStreamTrack, label: string): TrackSettingsReport {
  const settings = track.getSettings?.() ?? {};
  return {
    label: label || track.label,
    displaySurface: settings.displaySurface,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? 0,
    sampleRate: settings.sampleRate,
    channelCount: settings.channelCount,
    deviceId: settings.deviceId,
    muted: track.muted,
    readyState: track.readyState,
  };
}

/** Infer whether capture is native at the requested size, scaled, or unknown. */
export function describeCaptureFidelity(
  actualWidth: number,
  actualHeight: number,
  targetWidth: number,
  targetHeight: number,
): { native: boolean; scaled: boolean; message: string } {
  if (!actualWidth || !actualHeight) {
    return { native: false, scaled: false, message: 'The browser did not report capture dimensions.' };
  }
  const native = actualWidth >= targetWidth && actualHeight >= targetHeight;
  if (native) {
    return {
      native: true,
      scaled: false,
      message: `Capturing ${actualWidth}×${actualHeight} natively.`,
    };
  }
  return {
    native: false,
    scaled: true,
    message: `Source is ${actualWidth}×${actualHeight}; a ${targetWidth}×${targetHeight} canvas will upscale it, so detail will not exceed the source resolution.`,
  };
}
