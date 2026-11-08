import { PROJECT_SCHEMA_VERSION, type Project } from './types';
import { defaultCaptionStyle, defaultGlossary, defaultPresenter, defaultTransform, defaultAudio, defaultEffects, defaultText } from './factory';
import { registerCustomLut } from '../effects/catalog';

export class ProjectParseError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

/** Serialize with stable key order for meaningful diffs and reproducible tests. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

interface RawRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and migrate a project manifest. Throws ProjectParseError with a
 * human-readable reason instead of returning a half-valid project.
 */
export function parseProject(raw: unknown): Project {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!isRecord(data)) throw new ProjectParseError('Project file is not a JSON object.');
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectParseError(
      `Project was written by a newer version (schema ${version}, this build supports ${PROJECT_SCHEMA_VERSION}).`,
    );
  }
  let migrated = data;
  if (version < 2) migrated = migrateV1toV2(migrated);
  if (version < 3) migrated = migrateV2toV3(migrated);
  const project = normalizeProject(migrated);
  validateProject(project);
  return project;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProjectParseError('Project file is not valid JSON.', error);
  }
}

/** v1 stored flat clips and no caption style or settings. */
export function migrateV1toV2(raw: RawRecord): RawRecord {
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  return {
    ...raw,
    schemaVersion: 2,
    captionStyle: raw.captionStyle ?? defaultCaptionStyle(),
    tracks: tracks.map((track) =>
      isRecord(track)
        ? {
            ...track,
            kind: track.kind ?? 'video',
            muted: track.muted ?? false,
            hidden: track.hidden ?? false,
            locked: track.locked ?? false,
            volume: track.volume ?? 1,
            height: track.height ?? 96,
          }
        : track,
    ),
    settings: raw.settings ?? {
      segmentSeconds: 10,
      proxyHeight: 540,
      sampleRate: 48000,
      workspaceLayoutVersion: 1,
      autoTranscribeOnImport: false,
      glossary: defaultGlossary(),
    },
  };
}

/** v2 clips predate camera layout and per-clip audio processing. */
export function migrateV2toV3(raw: RawRecord): RawRecord {
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  const PRESENTER_TRACK_HINT = /camera|webcam|presenter/i;
  return {
    ...raw,
    schemaVersion: 3,
    tracks: tracks.map((track) => {
      if (!isRecord(track) || !Array.isArray(track.clips)) return track;
      // v2 had no presenter properties. Defaults are only meaningful for a
      // camera track: injecting them into every clip made the renderer treat
      // screen recordings as bubbles (isPresenterClip tests clip.presenter).
      const presenterTrack = PRESENTER_TRACK_HINT.test(String(track.name ?? ''));
      return {
        ...track,
        clips: track.clips.map((clip) => {
          if (!isRecord(clip)) return clip;
          const presenter = presenterTrack
            ? { presenter: { ...defaultPresenter(), ...(isRecord(clip.presenter) ? clip.presenter : {}) } }
            : isRecord(clip.presenter)
              ? { presenter: { ...defaultPresenter(), ...clip.presenter } }
              : {};
          return {
            ...clip,
            ...presenter,
            audio: { ...defaultAudio(), ...(isRecord(clip.audio) ? clip.audio : {}) },
            effects: { ...defaultEffects(), ...(isRecord(clip.effects) ? clip.effects : {}) },
            transform: { ...defaultTransform(), ...(isRecord(clip.transform) ? clip.transform : {}) },
            masks: Array.isArray(clip.masks) ? clip.masks : [],
          };
        }),
      };
    }),
  };
}

function normalizeProject(raw: RawRecord): Project {
  const project = raw as unknown as Project;
  const tracks = Array.isArray(project.tracks) ? project.tracks : [];
  for (const track of tracks) {
    if (!Array.isArray(track.clips)) continue;
    for (const clip of track.clips) {
      if (clip?.effects?.customLutData) {
        registerCustomLut(clip.effects.customLutData);
      }
    }
  }
  return {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    assets: Array.isArray(project.assets)
      ? project.assets.map((asset) => ({ ...asset, origin: asset.origin ?? ('imported' as const) }))
      : [],
    markers: Array.isArray(project.markers) ? project.markers : [],
    captions: Array.isArray(project.captions) ? project.captions : [],
    captionStyle: { ...defaultCaptionStyle(), ...(project.captionStyle ?? {}) },
    settings: {
      segmentSeconds: project.settings?.segmentSeconds ?? 10,
      proxyHeight: project.settings?.proxyHeight ?? 540,
      sampleRate: project.settings?.sampleRate ?? 48000,
      workspaceLayoutVersion: project.settings?.workspaceLayoutVersion ?? 1,
      autoTranscribeOnImport: project.settings?.autoTranscribeOnImport ?? false,
      glossary: { ...defaultGlossary(), ...(project.settings?.glossary ?? {}) },
    },
    tracks,
  };
}

/** Structural validation that catches corrupted manifests before they hit the UI. */
export function validateProject(project: Project): void {
  const fail = (message: string): never => {
    throw new ProjectParseError(message);
  };
  if (!project.id || typeof project.id !== 'string') fail('Project is missing an id.');
  if (!project.canvas || !Number.isFinite(project.canvas.width) || !Number.isFinite(project.canvas.height)) {
    fail('Project canvas is missing or invalid.');
  }
  if (!project.canvas.fps || !project.canvas.fps.num || !project.canvas.fps.den) fail('Project frame rate is invalid.');
  if (!Array.isArray(project.tracks)) fail('Project has no tracks array.');
  for (const track of project.tracks) {
    if (!track.id || !Array.isArray(track.clips)) fail(`Track ${track.id ?? '(no id)'} is invalid.`);
    for (const clip of track.clips) {
      if (!Number.isFinite(clip.startTicks) || !Number.isFinite(clip.durationTicks)) {
        fail(`Clip ${clip.id} has a non-numeric position.`);
      }
      if (clip.startTicks < 0) fail(`Clip ${clip.id} starts before zero.`);
      if (clip.durationTicks <= 0) fail(`Clip ${clip.id} has a non-positive duration.`);
      if (clip.kind === 'title' && !clip.text) fail(`Title clip ${clip.id} has no text properties.`);
      if (clip.kind === 'arrow' && !clip.arrow) fail(`Arrow clip ${clip.id} has no arrow properties.`);
      if (clip.kind === 'sticker' && !clip.sticker) fail(`Sticker clip ${clip.id} has no sticker properties.`);
      if (clip.kind === 'contact' && !clip.contact) fail(`Contact clip ${clip.id} has no contact properties.`);
      if (clip.kind === 'keystroke' && (!clip.keystroke || !Array.isArray(clip.keystroke.keys) || clip.keystroke.keys.length === 0)) {
        fail(`Keystroke clip ${clip.id} has no keystroke properties.`);
      }
      if (clip.kind === 'endscreen' && !clip.endScreen) {
        fail(`End-screen clip ${clip.id} has no endScreen properties.`);
      }
      if (clip.kind === 'progressbar' && !clip.progressBar) {
        fail(`Progress-bar clip ${clip.id} has no progressBar properties.`);
      }
      if (clip.kind === 'pulse' && !clip.pulse) {
        fail(`Pulse clip ${clip.id} has no pulse properties.`);
      }
      if (clip.kind === 'countdown' && !clip.countdown) {
        fail(`Countdown clip ${clip.id} has no countdown properties.`);
      }
    }
  }
  for (const asset of project.assets) {
    if (!asset.id || !asset.path) fail('An asset entry is missing its id or path.');
    if (asset.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(asset.path)) {
      fail(`Asset ${asset.name} stores an absolute path; project files must use relative paths.`);
    }
  }
}

export function defaultClipTemplate() {
  return {
    transform: defaultTransform(),
    audio: defaultAudio(),
    effects: defaultEffects(),
    text: defaultText(),
    presenter: defaultPresenter(),
  };
}
