import { useEditor } from '../project/store';
import { useSession } from './session';
import { createProject, createTrack } from '../project/factory';
import type { Asset, Project } from '../project/types';
import * as ops from '../project/ops';
import {
  copyFile,
  copyTree,
  directoryExists,
  ensureLayout,
  listProjects,
  loadProject,
  openOpfsWorkspace,
  pickWorkspace,
  projectFolderName,
  projectPath,
  requestPersistentStorage,
  saveProject,
  writeBinary,
  type Workspace,
} from '../workspace/workspace';
import { WORKSPACE_LAYOUT, type DirectoryHandleLike } from '../workspace/types';
import { ensurePermission, loadWorkspaceHandle, saveWorkspaceHandle } from './handleStore';
import { readLastSession, writeLastSession } from './prefs';
import { assetFromFile, probeMediaFile, sanitizeFileName, uniquePath, type MediaInfo } from '../media/probe';
import { newId } from '../core/ids';

/**
 * Session bootstrap.
 *
 * Record and Edit must work straight from a cold start. Both call into this
 * module: it reuses whatever storage the user already has, otherwise creates a
 * browser-managed (OPFS) workspace, and always writes project metadata before a
 * recording segment or imported asset is written. No function here opens a
 * camera, a microphone or a screen picker — those require an explicit action.
 */

let workspacePromise: Promise<Workspace> | null = null;
let projectPromise: Promise<Project> | null = null;
let savingToFolder = false;

export function resetBootstrapStateForTests(): void {
  workspacePromise = null;
  projectPromise = null;
  savingToFolder = false;
}

export function defaultSessionName(now = new Date()): string {
  return `Untitled lesson — ${now.toLocaleDateString()}`;
}

function publishWorkspace(workspace: Workspace, mode: 'fsa' | 'opfs'): Workspace {
  const session = useSession.getState();
  session.setWorkspace(workspace);
  session.setStorageMode(mode);
  session.setWorkspaceError(null);
  writeLastSession({ mode });
  return workspace;
}

/**
 * Return the workspace in use, creating browser storage when there is none.
 * A remembered folder handle is only reused when its grant is still valid; we
 * never prompt from here, because permission prompts belong to a click.
 */
export async function ensureWorkspace(options: { allowPrompt?: boolean } = {}): Promise<Workspace> {
  const existing = useSession.getState().workspace;
  if (existing) return existing;
  if (workspacePromise) return workspacePromise;

  const run = (async (): Promise<Workspace> => {
    const last = readLastSession();
    if (last?.mode !== 'opfs') {
      const handle = await loadWorkspaceHandle();
      if (handle) {
        const permissioned = handle as DirectoryHandleLike & {
          queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
          requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
        };
        const granted = options.allowPrompt
          ? await ensurePermission(permissioned)
          : permissioned.queryPermission
            ? (await permissioned.queryPermission({ mode: 'readwrite' })) === 'granted'
            : true;
        if (granted) {
          await ensureLayout(handle);
          return publishWorkspace(
            { root: handle, info: { name: handle.name, mode: 'fsa', persistent: true } },
            'fsa',
          );
        }
      }
    }

    try {
      const workspace = await openOpfsWorkspace();
      await ensureLayout(workspace.root);
      await requestPersistentStorage();
      return publishWorkspace(workspace, 'opfs');
    } catch (error) {
      const message = (error as Error).message || 'Browser storage is unavailable.';
      throw new Error(
        `Could not prepare local storage. ${message} ` +
          'Choose a folder on this computer with “Choose where to save”, or try Chrome or Edge.',
        { cause: error },
      );
    }
  })();

  workspacePromise = run;
  try {
    return await run;
  } catch (error) {
    workspacePromise = null;
    const message = (error as Error).message;
    useSession.getState().setWorkspaceError(message);
    throw error;
  }
}

export interface PreparedSession {
  workspace: Workspace;
  project: Project;
  folder: string;
  /** True when this call created the project rather than reusing one. */
  created: boolean;
}

export interface EnsureProjectOptions {
  name?: string;
  width?: number;
  height?: number;
  fps?: { num: number; den: number };
  segmentSeconds?: number;
}

/**
 * Return the open project, or create and persist one first. The metadata write
 * happens before returning, so a caller may write recording segments knowing
 * `project.json` already names the project they belong to.
 *
 * Concurrent callers share one creation promise: a double click on Record used
 * to create two folders and load the second one.
 */
export async function ensureDraftProject(options: EnsureProjectOptions = {}): Promise<PreparedSession> {
  const editor = useEditor.getState();
  if (editor.project) {
    const session = useSession.getState();
    if (session.projectFolder) {
      return {
        workspace: await ensureWorkspace(),
        project: editor.project,
        folder: session.projectFolder,
        created: false,
      };
    }
    // A project bundle can be loaded without a folder. Persist it now.
    const workspace = await ensureWorkspace();
    const folder = await saveProject(workspace.root, editor.project);
    useSession.getState().setProjectFolder(folder);
    writeLastSession({ projectFolder: folder });
    useSession.getState().setSaveState('saved');
    return { workspace, project: editor.project, folder, created: false };
  }
  if (projectPromise) {
    const session = await projectPromise;
    return {
      workspace: await ensureWorkspace(),
      project: session,
      folder: useSession.getState().projectFolder ?? projectFolderName(session),
      created: false,
    };
  }

  const run = (async (): Promise<PreparedSession> => {
    const workspace = await ensureWorkspace();
    const session = useSession.getState();

    // A folder pointer can survive without a loaded project (deep link, failed
    // restore). Reuse it rather than creating a second project beside it.
    if (session.projectFolder) {
      try {
        const loaded = await loadProject(workspace.root, session.projectFolder);
        useEditor.getState().loadProject(loaded.project);
        useSession.getState().setSaveState('saved');
        return { workspace, project: loaded.project, folder: session.projectFolder, created: false };
      } catch {
        writeLastSession({ projectFolder: null });
        useSession.getState().setProjectFolder(null);
      }
    }

    const project = createProject({
      name: options.name ?? defaultSessionName(),
      ...(options.width ? { width: options.width } : {}),
      ...(options.height ? { height: options.height } : {}),
      ...(options.fps ? { fps: options.fps } : {}),
    });
    if (options.segmentSeconds) project.settings.segmentSeconds = options.segmentSeconds;

    let folder: string;
    try {
      folder = await saveProject(workspace.root, project);
    } catch (error) {
      throw new Error(
        `Could not create project metadata before starting: ${(error as Error).message}. ` +
          'No recording was started. Free some browser storage or choose a folder on disk.',
        { cause: error },
      );
    }
    useEditor.getState().loadProject(project);
    useSession.getState().setProjectFolder(folder);
    writeLastSession({ projectFolder: folder });
    useSession.getState().setSaveState('saved');
    return { workspace, project, folder, created: true };
  })();

  const trackable = run.then((session) => session.project).finally(() => {
    projectPromise = null;
  });
  projectPromise = trackable;
  return run;
}

/** Record and Edit both start here. Conservative 1080p/30 until measured. */
export async function prepareSession(): Promise<PreparedSession> {
  return ensureDraftProject({ width: 1920, height: 1080, fps: { num: 30, den: 1 } });
}

export interface ImportOutcome {
  imported: string[];
  failed: Array<{ name: string; message: string }>;
  /** True when the import created the project it landed in. */
  created: boolean;
}

/** Explain unsupported media without inventing a converter the app does not have. */
function describeImportFailure(file: File, error: unknown): string {
  const raw = (error as Error).message || 'the file could not be read';
  const readable = /decod|unsupported|no video or audio track/i.test(raw);
  if (!readable) return `${file.name}: ${raw}`;
  return (
    `${file.name}: this browser cannot decode this file (${raw}). ` +
    'Try MP4 with H.264/AAC or WebM with VP9/Opus. Converting with ffmpeg or HandBrake first usually fixes it.'
  );
}

function canvasFromMedia(info: MediaInfo): { width: number; height: number; fps: { num: number; den: number } } {
  const width = info.width && info.width >= 320 ? Math.min(7680, Math.round(info.width / 2) * 2) : 1920;
  const height = info.height && info.height >= 180 ? Math.min(4320, Math.round(info.height / 2) * 2) : 1080;
  const rate = info.frameRate && info.frameRate >= 50 ? 60 : 30;
  return { width, height, fps: { num: rate, den: 1 } };
}

/**
 * Import media without requiring an existing project. Every file is probed
 * first: an unreadable file must not create a project, and a batch with one bad
 * file still imports the rest with a specific per-file message.
 */
export async function importMediaIntoSession(files: FileList | File[]): Promise<ImportOutcome> {
  const list = Array.from(files);
  const outcome: ImportOutcome = { imported: [], failed: [], created: false };
  if (list.length === 0) return outcome;

  const probes: Array<{ file: File; info: MediaInfo }> = [];
  for (const file of list) {
    try {
      probes.push({ file, info: await probeMediaFile(file) });
    } catch (error) {
      outcome.failed.push({ name: file.name, message: describeImportFailure(file, error) });
    }
  }
  if (probes.length === 0) {
    for (const failure of outcome.failed) useSession.getState().pushToast(failure.message, 'error');
    return outcome;
  }

  const firstVideo = probes.find((probe) => probe.info.kind === 'video' && probe.info.width);
  const settings = firstVideo ? canvasFromMedia(firstVideo.info) : undefined;
  const prepared = await ensureDraftProject(settings ?? {});
  outcome.created = prepared.created;
  const { workspace, folder } = prepared;

  const created: Asset[] = [];
  const companionAudio: Asset[] = [];
  const existingPaths = (useEditor.getState().project?.assets ?? prepared.project.assets).map((asset) => asset.path);

  for (const { file, info } of probes) {
    try {
      const safeName = sanitizeFileName(file.name);
      const path = uniquePath(existingPaths, `${WORKSPACE_LAYOUT.originals}/${Date.now().toString(36)}-${safeName}`);
      await writeBinary(workspace.root, projectPath(folder, path), new Uint8Array(await file.arrayBuffer()));
      existingPaths.push(path);
      const asset = assetFromFile({ file, info, path, origin: 'imported' });
      created.push(asset);

      // The renderer and mixdown read video and audio through different paths.
      // A video with an audio track therefore gets a linked audio companion that
      // points at the same file, so its sound survives preview and export.
      if (info.kind === 'video' && info.channels) {
        companionAudio.push({
          ...asset,
          id: newId('asset'),
          kind: 'audio',
          name: `${file.name} (audio)`,
          origin: 'imported',
        });
      }
      outcome.imported.push(file.name);
    } catch (error) {
      outcome.failed.push({ name: file.name, message: describeImportFailure(file, error) });
    }
  }

  if (created.length === 0) {
    for (const failure of outcome.failed) useSession.getState().pushToast(failure.message, 'error');
    return outcome;
  }

  useEditor.getState().apply('Import media', (project) => {
    let working: Project = { ...project, assets: [...project.assets, ...created, ...companionAudio] };
    const startTicks = ops.nextFreeStart(working);
    let cursor = startTicks;
    for (const asset of created) {
      const trackKind = asset.kind === 'audio' ? 'audio' : 'video';
      let track = working.tracks.find((candidate) => candidate.kind === trackKind && !candidate.hidden && !candidate.locked);
      if (!track) {
        track = createTrackFor(trackKind);
        working = ops.addTrack(working, track);
      }
      const placed = ops.addAssetClip(working, track.id, asset.id, cursor, { mode: 'overwrite' });
      working = placed.project;
      if (asset.kind === 'video' && asset.durationTicks > 0) {
        const companion = companionAudio.find((audio) => audio.path === asset.path);
        if (companion) {
          const audioTrack = working.tracks.find((candidate) => candidate.kind === 'audio' && !candidate.hidden && !candidate.locked) ??
            createTrackFor('audio');
          if (!working.tracks.includes(audioTrack)) working = ops.addTrack(working, audioTrack);
          const audioPlacement = ops.addAssetClip(working, audioTrack.id, companion.id, cursor, { mode: 'overwrite' });
          working = audioPlacement.project;
          const linkId = newId('link');
          working = ops.updateClip(working, placed.clipId, { linkId });
          working = ops.updateClip(working, audioPlacement.clipId, { linkId });
        }
      }
      cursor += Math.max(1, asset.durationTicks);
    }
    return ops.withDuration(working);
  });

  try {
    await saveMetadata();
  } catch {
    // The assets are on disk and the editor is dirty; the debounced autosave
    // will retry and the failure is already surfaced by the save state.
  }

  if (outcome.failed.length > 0) {
    for (const failure of outcome.failed) useSession.getState().pushToast(failure.message, 'error');
  }
  useSession.getState().pushToast(
    `Imported ${outcome.imported.length} file${outcome.imported.length === 1 ? '' : 's'}.`,
    'success',
  );
  return outcome;
}

function createTrackFor(kind: 'video' | 'audio') {
  return createTrack(kind, kind === 'video' ? 'Screen' : 'Narration');
}

async function saveMetadata(): Promise<void> {
  const session = useSession.getState();
  const editor = useEditor.getState();
  if (!session.workspace || !editor.project || !editor.dirty) return;
  const folder = await saveProject(session.workspace.root, editor.project);
  session.setProjectFolder(folder);
  writeLastSession({ projectFolder: folder });
  useEditor.getState().markSaved(editor.revision, editor.project.id);
  session.setSaveState('saved');
}

/**
 * Copy the open project into a folder the user chooses. Originals in the
 * current workspace are copied, never moved or deleted.
 */
export async function saveSessionToFolder(): Promise<boolean> {
  if (savingToFolder) return false;
  const session = useSession.getState();
  const editor = useEditor.getState();
  if (!editor.project) {
    session.pushToast('There is no project to save yet.', 'error');
    return false;
  }
  savingToFolder = true;
  try {
    const target = await pickWorkspace();
    await ensureLayout(target.root);
    const sourceFolder = session.projectFolder;
    const sourceRoot = session.workspace?.root;
    const folder = projectFolderName(editor.project);
    const failures: string[] = [];

    if (sourceRoot && sourceFolder) {
      const sourceProject = `${WORKSPACE_LAYOUT.projects}/${sourceFolder}`;
      const targetProject = `${WORKSPACE_LAYOUT.projects}/${folder}`;
      // Copy the whole recordings folder, not just the assets already on the
      // timeline: a take that finished but has not been inserted yet lives
      // there too, and the target workspace is where later edits will read it.
      // A project with only imported media has no recordings folder; that is
      // not a copy failure.
      const sourceRecordings = `${sourceProject}/${WORKSPACE_LAYOUT.recordings}`;
      if (await directoryExists(sourceRoot, sourceRecordings)) {
        try {
          await copyTree(
            sourceRoot,
            sourceRecordings,
            target.root,
            `${targetProject}/${WORKSPACE_LAYOUT.recordings}`,
          );
        } catch (error) {
          // Never switch to a destination that is missing recorded media: the
          // very next export would report missing frames and audio, which is
          // the failure this copy exists to prevent.
          console.warn('Could not copy the recordings folder into the chosen folder:', error);
          session.pushToast(
            `Could not copy the recordings folder: ${(error as Error).message}. You are still in the original workspace, so nothing was switched.`,
            'error',
          );
          return false;
        }
      }
      for (const asset of editor.project.assets) {
        if (asset.path.startsWith(`${WORKSPACE_LAYOUT.recordings}/`)) continue;
        const paths = [asset.path, ...(asset.proxyPath ? [asset.proxyPath] : [])];
        for (const relative of paths) {
          try {
            await copyFile(sourceRoot, `${sourceProject}/${relative}`, target.root, `${targetProject}/${relative}`);
          } catch (error) {
            failures.push(relative);
            console.warn(`Could not copy ${relative} into the chosen folder:`, error);
          }
        }
      }
    }

    let project = editor.project;
    if (failures.length > 0) {
      const failed = new Set(failures);
      project = {
        ...project,
        assets: project.assets.map((asset) => (failed.has(asset.path) ? { ...asset, missing: true } : asset)),
      };
      editor.apply('Mark media copied to the chosen folder', () => project);
    }
    const savedFolder = await saveProject(target.root, project);
    await saveWorkspaceHandle(target.root);
    session.setWorkspace({ root: target.root, info: { name: target.root.name, mode: 'fsa', persistent: true } });
    session.setStorageMode('fsa');
    session.setProjectFolder(savedFolder);
    writeLastSession({ mode: 'fsa', projectFolder: savedFolder });
    session.setSaveState('saved');
    editor.markSaved(editor.revision, project.id);

    if (failures.length > 0) {
      session.pushToast(
        `Saved to “${target.root.name}”, but ${failures.length} media file(s) could not be copied. Relink them from the media panel.`,
        'error',
      );
    } else {
      session.pushToast(`Project saved to “${target.root.name}” on this computer.`, 'success');
    }
    return true;
  } catch (error) {
    if (/abort/i.test((error as Error).message)) return false;
    session.pushToast(`Could not save to a folder: ${(error as Error).message}`, 'error');
    return false;
  } finally {
    savingToFolder = false;
  }
}

/** Projects available in the current workspace, newest first. */
export async function listRecentProjects(limit = 8): Promise<Array<{ folder: string; project: Project }>> {
  const session = useSession.getState();
  const workspace = session.workspace;
  if (!workspace) return [];
  try {
    const rows = await listProjects(workspace.root);
    return rows
      .filter((row): row is { folder: string; project: Project } => Boolean(row.project))
      .sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Save any pending edits before switching projects. Losing edits because a
 * different project was opened is avoidable; refusing the switch is better than
 * silently discarding them.
 */
async function flushPendingEdits(): Promise<boolean> {
  const editor = useEditor.getState();
  if (!editor.dirty) return true;
  try {
    await saveMetadata();
  } catch (error) {
    useSession.getState().pushToast(`Could not save the current project: ${(error as Error).message}`, 'error');
    return false;
  }
  if (useEditor.getState().dirty) {
    useSession
      .getState()
      .pushToast('The current project still has unsaved changes, so it was not replaced. Save it and try again.', 'error');
    return false;
  }
  return true;
}

/** Open a project folder from the recent list, keeping the current route sensible. */
export async function openExistingProject(folder: string): Promise<boolean> {
  const session = useSession.getState();
  if (!(await flushPendingEdits())) return false;
  const workspace = await ensureWorkspace();
  try {
    const loaded = await loadProject(workspace.root, folder);
    useEditor.getState().loadProject(loaded.project);
    session.setProjectFolder(folder);
    writeLastSession({ projectFolder: folder });
    session.setSaveState('saved');
    session.setRoute('edit');
    if (loaded.recoveredFromBackup) {
      session.pushToast('project.json was unreadable; opened the .bak copy instead.', 'info');
    }
    return true;
  } catch (error) {
    session.pushToast(`Could not open ${folder}: ${(error as Error).message}`, 'error');
    return false;
  }
}

/** A folder-backed workspace chosen explicitly by the user. */
export async function chooseFolderWorkspace(): Promise<boolean> {
  const session = useSession.getState();
  const editor = useEditor.getState();
  // Switching roots would strand media that lives in the old workspace. Use
  // "Save recordings to a folder…" instead, which copies it first.
  if (editor.project && editor.project.assets.length > 0) {
    session.pushToast(
      'This project already has media in the current workspace. Use "Save recordings to a folder…" so the media moves with it.',
      'error',
    );
    return false;
  }
  try {
    const workspace = await pickWorkspace();
    await ensureLayout(workspace.root);
    await requestPersistentStorage();
    await saveWorkspaceHandle(workspace.root);
    publishWorkspace(workspace, 'fsa');
    // Persist the open (empty) draft into the folder just chosen. project.json
    // must exist before the first segment is written, or a reload cannot find
    // the take that belongs to it.
    if (editor.project) {
      try {
        const folder = await saveProject(workspace.root, editor.project);
        const current = useSession.getState();
        current.setProjectFolder(folder);
        current.setSaveState('saved');
        writeLastSession({ mode: 'fsa', projectFolder: folder });
      } catch (error) {
        session.pushToast(
          `The folder opened, but the project metadata could not be written there: ${(error as Error).message}. Do not record into it until this is resolved.`,
          'error',
        );
        return false;
      }
    }
    return true;
  } catch (error) {
    if (/abort/i.test((error as Error).message)) return false;
    session.setWorkspaceError((error as Error).message);
    session.pushToast(`Could not open that folder: ${(error as Error).message}`, 'error');
    return false;
  }
}
