import { TICKS_PER_SECOND, type FrameRate, type Tick } from '../core/time';
import { newId } from '../core/ids';
import {
  PROJECT_SCHEMA_VERSION,
  type AudioProps,
  type CaptionStyle,
  type Clip,
  type ClipEffects,
  type PresenterProps,
  type Project,
  type TextProps,
  type Track,
  type Transform,
} from './types';

/**
 * Conservative first-run composition size. 4K stays available as an explicit
 * choice once the machine has been measured; starting every new project at
 * 3840×2160 made ordinary 1080p captures pay a 4× compositing cost and made the
 * recording panel claim 4K before any capture had happened.
 */
export const DEFAULT_CANVAS = { width: 1920, height: 1080, background: '#0b0f14', safeMargin: 0.05 } as const;

export function defaultTransform(): Transform {
  return {
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotationDeg: 0,
    opacity: 1,
    fit: 'contain',
    crop: { x: 0, y: 0, width: 1, height: 1 },
    radius: 0,
    shadow: 0,
    borderWidth: 0,
    borderColor: '#ffffff',
  };
}

export function defaultEffects(): ClipEffects {
  return { brightness: 0, contrast: 0, exposure: 0, saturation: 0, temperature: 0, vibrance: 0, zoom: 1, panX: 0, panY: 0 };
}

export function defaultAudio(): AudioProps {
  return { gain: 1, muted: false, fadeInTicks: 0, fadeOutTicks: 0, processed: false, pan: 0 };
}

export function defaultText(): TextProps {
  return {
    text: 'New title',
    fontFamily: 'Inter',
    fontWeight: 600,
    fontSize: 96,
    color: '#ffffff',
    background: '#000000',
    backgroundOpacity: 0,
    align: 'center',
    maxWidth: 0.8,
    letterSpacing: 0,
    lineHeight: 1.2,
  };
}

export function defaultPresenter(): PresenterProps {
  return {
    layout: 'bubble',
    corner: 'bottom-right',
    size: 0.28,
    margin: 0.035,
    shape: 'circle',
    mirror: true,
    chromaKey: false,
    shadow: 12,
    border: 0,
    borderColor: '#ffffff',
    effect: 'none',
  };
}

export function defaultCaptionStyle(): CaptionStyle {
  return {
    preset: 'classroom',
    fontFamily: 'Inter',
    fontSize: 54,
    color: '#ffffff',
    background: '#000000',
    backgroundOpacity: 0.62,
    outlineColor: '#000000',
    outlineWidth: 4,
    positionY: 0.86,
    maxLineChars: 42,
    align: 'center',
    marginX: 0.08,
    marginBottom: 0.06,
    uppercase: false,
    wordHighlight: false,
    wordHighlightColor: '#ffd166',
  };
}

export function createClip(partial: Partial<Clip> & { startTicks: Tick; durationTicks: Tick }): Clip {
  return {
    id: newId('clip'),
    kind: 'media',
    inTicks: 0,
    speed: 1,
    transform: defaultTransform(),
    effects: defaultEffects(),
    audio: defaultAudio(),
    masks: [],
    transitionIn: { type: 'none', durationTicks: 0 },
    transitionOut: { type: 'none', durationTicks: 0 },
    keyframes: [],
    ...partial,
  };
}

export function createTrack(kind: Track['kind'], name: string, order = 0): Track {
  return {
    id: newId('track'),
    kind,
    name,
    clips: [],
    muted: false,
    hidden: false,
    locked: false,
    volume: 1,
    height: kind === 'audio' ? 84 : kind === 'caption' ? 56 : 96,
    ...(order ? {} : {}),
  };
}

export interface CreateProjectOptions {
  name: string;
  width?: number;
  height?: number;
  fps?: FrameRate;
  id?: string;
  now?: string;
}

export function createProject(options: CreateProjectOptions): Project {
  const now = options.now ?? new Date().toISOString();
  const sceneTrack = createTrack('video', 'Screen');
  const cameraTrack = createTrack('video', 'Camera');
  const voiceTrack = createTrack('audio', 'Narration');
  const musicTrack = createTrack('audio', 'Music');
  const captionTrack = createTrack('caption', 'Captions');
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.id ?? newId('proj'),
    name: options.name,
    createdAt: now,
    updatedAt: now,
    canvas: {
      width: options.width ?? DEFAULT_CANVAS.width,
      height: options.height ?? DEFAULT_CANVAS.height,
      fps: options.fps ?? { num: 30, den: 1 },
      background: DEFAULT_CANVAS.background,
      safeMargin: DEFAULT_CANVAS.safeMargin,
    },
    // Render order matters: plate first, then camera, then overlays.
    tracks: [sceneTrack, cameraTrack, voiceTrack, musicTrack, captionTrack],
    assets: [],
    markers: [],
    captions: [],
    captionStyle: defaultCaptionStyle(),
    settings: {
      segmentSeconds: 10,
      proxyHeight: 540,
      sampleRate: 48_000,
      workspaceLayoutVersion: 1,
      autoTranscribeOnImport: false,
      glossary: defaultGlossary(),
    },
    durationTicks: 0,
    notes: '',
  };
}

export function defaultGlossary(): Record<string, string> {
  return {
    kubectl: 'kubectl',
    kubernetes: 'Kubernetes',
    systemd: 'systemd',
    terraform: 'Terraform',
    ansible: 'Ansible',
    nginx: 'nginx',
    systemctl: 'systemctl',
    journalctl: 'journalctl',
    docker: 'Docker',
    devops: 'DevOps',
    namespace: 'namespace',
    namespaces: 'namespaces',
    ssh: 'SSH',
    sudo: 'sudo',
    yaml: 'YAML',
    json: 'JSON',
    api: 'API',
    'github': 'GitHub',
    'bash': 'bash',
    'zsh': 'zsh',
    'podman': 'Podman',
    'helm': 'Helm',
    'kyma': 'Kyma',
    'xsuaa': 'XSUAA',
    'cloudfoundry': 'Cloud Foundry',
  };
}

/** Zero-based frame count derived from the project fps, for exports. */
export function frameCount(project: Project): number {
  const { num, den } = project.canvas.fps;
  return Math.ceil((project.durationTicks * num) / (TICKS_PER_SECOND * den));
}

export function projectDuration(tracks: readonly Track[]): Tick {
  let max = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const end = clip.startTicks + clip.durationTicks;
      if (end > max) max = end;
    }
  }
  return max;
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function assetById(project: Project, assetId: string | undefined) {
  if (!assetId) return undefined;
  return project.assets.find((a) => a.id === assetId);
}
