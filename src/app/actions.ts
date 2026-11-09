import { useEditor } from '../project/store';
import { useSession } from './session';
import { createProject, defaultCaptionStyle } from '../project/factory';
import type { Project } from '../project/types';
import {
  copyFile,
  deleteProject,
  ensureLayout,
  listProjects,
  loadProject,
  openOpfsWorkspace,
  pickWorkspace,
  projectFolderName,
  projectPath,
  readBlob,
  requestPersistentStorage,
  saveProject,
  writeBinary,
  writeTextAtomic,
} from '../workspace/workspace';
import { ensurePermission, loadWorkspaceHandle, saveWorkspaceHandle } from './handleStore';
import type { DirectoryHandleLike } from '../workspace/types';
import { DEFAULT_IMAGE_DURATION_SECONDS, assetFromFile, probeMediaFile, sanitizeFileName, uniquePath } from '../media/probe';
import { newId } from '../core/ids';
import { parseProject, serializeProject } from '../project/serialize';
import { relinkAssetInProject } from '../project/ops';
import { WORKSPACE_LAYOUT } from '../workspace/types';
import { clearLastSession, readLastSession, writeLastSession } from './prefs';

export async function connectDiskWorkspace(): Promise<void> {
  const session = useSession.getState();
  try {
    const workspace = await pickWorkspace();
    await saveWorkspaceHandle(workspace.root);
    await ensureLayout(workspace.root);
    const persisted = await requestPersistentStorage();
    if (!persisted) {
      session.pushToast('Storage is not marked persistent. Keep backups of long recordings.', 'info');
    }
    session.setWorkspace(workspace);
    session.setStorageMode('fsa');
    writeLastSession({ mode: 'fsa' });
    session.pushToast(`Workspace connected: ${workspace.info.name}`, 'success');
  } catch (error) {
    const message = (error as Error).message;
    if (/abort/i.test(message)) return;
    session.setWorkspaceError(message);
    session.pushToast(message, 'error');
  }
}

export async function connectFallbackWorkspace(): Promise<void> {
  const session = useSession.getState();
  try {
    const workspace = await openOpfsWorkspace();
    await ensureLayout(workspace.root);
    await requestPersistentStorage();
    session.setWorkspace(workspace);
    session.setStorageMode('opfs');
    writeLastSession({ mode: 'opfs' });
    session.pushToast('Using browser storage. Export recordings to disk to keep them safe.', 'info');
  } catch (error) {
    session.setWorkspaceError((error as Error).message);
    session.pushToast((error as Error).message, 'error');
  }
}

export async function restoreLastWorkspace(): Promise<boolean> {
  const last = readLastSession();
  // Honour the mode actually in use. A stored folder handle from an earlier
  // session must never replace the browser-storage workspace chosen since.
  if (last?.mode === 'opfs') {
    const workspace = await openOpfsWorkspace();
    await ensureLayout(workspace.root);
    useSession.getState().setWorkspace(workspace);
    useSession.getState().setStorageMode('opfs');
    return true;
  }
  const handle = await loadWorkspaceHandle();
  if (!handle) return false;
  const granted = await ensurePermission(handle as DirectoryHandleLike & {
    queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  });
  if (!granted) return false;
  await ensureLayout(handle);
  useSession.getState().setWorkspace({
    root: handle,
    info: { name: handle.name, mode: 'fsa', persistent: true },
  });
  useSession.getState().setStorageMode('fsa');
  return true;
}

/**
 * Reopen the project that was last editing, without hijacking a deep link
 * (e.g. a refresh on `#/export` must stay on Export).
 */
export async function restoreLastProject(): Promise<boolean> {
  const session = useSession.getState();
  if (!session.workspace || session.projectFolder || useEditor.getState().project) return false;
  const folder = readLastSession()?.projectFolder;
  if (!folder) return false;
  const stayOnRoute = session.route;
  try {
    const loaded = await loadProject(session.workspace.root, folder);
    // The Projects page is already interactive during boot; if the user opened
    // something while this read was in flight, their choice wins.
    const now = useSession.getState();
    if (useEditor.getState().project || now.projectFolder || now.route !== stayOnRoute) return false;
    useEditor.getState().loadProject(loaded.project);
    now.setProjectFolder(folder);
    now.setSaveState('saved');
    if (loaded.recoveredFromBackup) {
      useSession.getState().pushToast('project.json was unreadable; opened the .bak copy instead.', 'info');
    }
    return true;
  } catch (error) {
    const message = (error as Error).message;
    const missing = /not\s*found|NotFound/i.test(`${(error as Error).name} ${message}`);
    console.warn('Could not reopen the last project:', error);
    if (missing) {
      // The folder was moved or deleted. Clear the pointer so boot stops retrying.
      writeLastSession({ projectFolder: null });
      useSession.getState().pushToast('The last project is no longer in this workspace.', 'info');
    } else {
      // A corrupt or unreadable project is not a reason to forget it.
      useSession.getState().pushToast(`Could not reopen the last project: ${message}`, 'error');
    }
    return false;
  }
}

export async function createAndOpenProject(params: {
  name: string;
  width: number;
  height: number;
  fps: { num: number; den: number };
  segmentSeconds?: number;
}): Promise<void> {
  const session = useSession.getState();
  const workspace = session.workspace;
  if (!workspace) throw new Error('Connect a workspace first.');
  const project = createProject(params);
  project.settings.segmentSeconds = params.segmentSeconds ?? 5;
  const folder = await saveProject(workspace.root, project);
  useEditor.getState().loadProject(project);
  useSession.getState().setProjectFolder(folder);
  writeLastSession({ projectFolder: folder });
  useSession.getState().setSaveState('saved');
  useSession.getState().setRoute('record');
}

export async function openProjectFolder(folder: string): Promise<void> {
  const session = useSession.getState();
  const workspace = session.workspace;
  if (!workspace) throw new Error('Connect a workspace first.');
  try {
    // Never replace a project with unsaved changes: autosave may be in flight
    // or may have failed. Saving first makes switching lossless.
    if (useEditor.getState().dirty) {
      await saveNow();
      if (useEditor.getState().dirty) {
        session.pushToast(
          'The current project still has unsaved changes, so it was not replaced. Save it and try again.',
          'error',
        );
        return;
      }
    }
    const loaded = await loadProject(workspace.root, folder);
    useEditor.getState().loadProject(loaded.project);
    session.setProjectFolder(folder);
    writeLastSession({ projectFolder: folder });
    session.setSaveState('saved');
    session.setRoute('edit');
    if (loaded.recoveredFromBackup) {
      session.pushToast('project.json was unreadable; opened the .bak copy instead.', 'info');
    }
  } catch (error) {
    session.pushToast((error as Error).message, 'error');
  }
}

/**
 * Delete a project folder permanently, including its recordings and imported
 * media. Refuses while a save is still writing, because a late write recreates
 * the folder that was just removed.
 */
export async function deleteProjectFolder(folder: string): Promise<{ ok: boolean; reason?: string }> {
  const session = useSession.getState();
  const workspace = session.workspace;
  if (!workspace) return { ok: false, reason: 'No workspace is open, so nothing was deleted.' };
  const isOpen = session.projectFolder === folder;
  if (isOpen) {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // Block autosave before waiting: a save that finishes mid-wait would
    // otherwise schedule another one, and that write would recreate the folder
    // while removeEntry is still walking it.
    deletingFolder = folder;
    const deadline = Date.now() + 5000;
    while (saving && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    if (saving) {
      deletingFolder = null;
      return { ok: false, reason: 'A save is still in progress. Try again in a moment.' };
    }
    // The finishing save may have re-armed the debounce after the clear above.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }
  let result: Awaited<ReturnType<typeof deleteProject>>;
  try {
    result = await deleteProject(workspace.root, folder);
  } finally {
    deletingFolder = null;
  }
  if (!result.ok) return result;
  if (isOpen) {
    useEditor.getState().closeProject();
    useSession.getState().setProjectFolder(null);
    useSession.getState().setSaveState('saved');
    writeLastSession({ projectFolder: null });
    useSession.getState().setRoute('projects');
  } else if (useEditor.getState().dirty && useEditor.getState().project) {
    // A save blocked by the delete still owns its unsaved edits.
    scheduleAutosave();
  }
  useSession
    .getState()
    .pushToast(
      `Deleted "${folder}" from the workspace, including its recordings. Exports you saved elsewhere are untouched.`,
    'info',
    );
  return { ok: true };
}

/**
 * Permanently delete every project folder in the current workspace (including
 * their recordings and imported originals). Closes the active project if open.
 */
export async function deleteAllProjectsFromWorkspace(): Promise<{
  ok: boolean;
  deletedCount: number;
  reason?: string;
}> {
  const session = useSession.getState();
  const workspace = session.workspace;
  if (!workspace) return { ok: false, deletedCount: 0, reason: 'No workspace is open, so nothing was deleted.' };
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  deletingFolder = '__all__';
  const deadline = Date.now() + 5000;
  while (saving && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (saving) {
    deletingFolder = null;
    return { ok: false, deletedCount: 0, reason: 'A save is still in progress. Try again in a moment.' };
  }
  let deletedCount = 0;
  try {
    const rows = await listProjects(workspace.root);
    for (const row of rows) {
      const res = await deleteProject(workspace.root, row.folder);
      if (res.ok) deletedCount += 1;
    }
  } finally {
    deletingFolder = null;
  }
  useEditor.getState().closeProject();
  useSession.getState().setProjectFolder(null);
  useSession.getState().setSaveState('saved');
  writeLastSession({ projectFolder: null });
  useSession.getState().setRoute('projects');
  useSession
    .getState()
    .pushToast(
      `Deleted all ${deletedCount} project(s) and their recordings from the workspace.`,
      'info',
    );
  return { ok: true, deletedCount };
}

export async function refreshProjectList() {
  const session = useSession.getState();
  if (!session.workspace) return [];
  return listProjects(session.workspace.root);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
/**
 * Folder currently being deleted. Autosave refuses to write while it is set;
 * otherwise a save finishing mid-delete re-creates the folder being removed.
 */
let deletingFolder: string | null = null;

/** Debounced autosave. Never blocks editing, never fires while nothing changed. */
export function scheduleAutosave(delayMs = 900): void {
  if (deletingFolder) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveNow();
  }, delayMs);
}

export async function saveNow(): Promise<void> {
  const session = useSession.getState();
  const editor = useEditor.getState();
  if (!session.workspace || !editor.project || !editor.dirty || saving || deletingFolder) return;
  saving = true;
  // The revision we are about to write. Anything edited after this point must
  // stay dirty, or the UI would claim a save that never happened.
  const savedRevision = editor.revision;
  const savedProjectId = editor.project.id;
  session.setSaveState('saving');
  let succeeded = false;
  try {
    const folder = await saveProject(session.workspace.root, editor.project);
    // Another project may have been opened while this save was in flight; the
    // folder and the clean marker belong to the project we actually wrote.
    if (useEditor.getState().project?.id === savedProjectId) {
      useSession.getState().setProjectFolder(folder);
      writeLastSession({ projectFolder: folder });
      useEditor.getState().markSaved(savedRevision, savedProjectId);
      useSession.getState().setSaveState('saved');
    }
    succeeded = true;
  } catch (error) {
    useSession.getState().setSaveState('error', (error as Error).message);
    useSession.getState().pushToast(`Autosave failed: ${(error as Error).message}`, 'error');
  } finally {
    saving = false;
  }
  // Edits that landed during a successful save still need writing. After a
  // failure, do not retry on a timer: that would toast the same error forever.
  if (succeeded && useEditor.getState().dirty) scheduleAutosave();
}

export async function importMediaFiles(files: FileList | File[]): Promise<void> {
  const session = useSession.getState();
  const editor = useEditor.getState();
  const workspace = session.workspace;
  const folder = session.projectFolder;
  if (!workspace || !editor.project) {
    session.pushToast('Open a project before importing media.', 'error');
    return;
  }
  if (!folder) {
    session.pushToast('This project has no folder yet; save it before importing media.', 'error');
    return;
  }
  const existing = editor.project.assets.map((asset) => asset.path);
  for (const file of Array.from(files)) {
    try {
      const info = await probeMediaFile(file);
      const safeName = sanitizeFileName(file.name);
      const path = uniquePath(existing, `${WORKSPACE_LAYOUT.originals}/${Date.now().toString(36)}-${safeName}`);
      await writeBinary(workspace.root, projectPath(folder, path), new Uint8Array(await file.arrayBuffer()));
      existing.push(path);
      const asset = assetFromFile({ file, info, path, origin: 'imported' });
      editor.apply(`Import ${file.name}`, (project) => ({ ...project, assets: [...project.assets, asset] }));
      session.pushToast(`Imported ${file.name}`, 'success');
    } catch (error) {
      session.pushToast(`Could not import ${file.name}: ${(error as Error).message}`, 'error');
    }
  }
}

export async function ensureAssetFile(path: string): Promise<File> {
  const session = useSession.getState();
  const workspace = session.workspace;
  const folder = session.projectFolder;
  if (!workspace || !folder) throw new Error('No workspace or project folder.');
  return readBlob(workspace.root, `${WORKSPACE_LAYOUT.projects}/${folder}/${path}`);
}

export async function exportProjectBundle(): Promise<void> {
  const editor = useEditor.getState();
  if (!editor.project) return;
  const bundle = {
    kind: 'browser-record-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: editor.project,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${editor.project.name.replace(/\s+/g, '-').toLowerCase()}.browserrecord.json`);
}

export async function importProjectBundle(file: File): Promise<void> {
  const session = useSession.getState();
  const workspace = session.workspace;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as { kind?: string; project?: unknown };
    const raw = parsed.kind === 'browser-record-project' ? parsed.project : parsed;
    const project = parseProject(raw);
    // Imports get fresh ids so they never collide with an existing project.
    project.id = newId('proj');
    project.name = `${project.name} (imported)`;
    for (const track of project.tracks) {
      for (const clip of track.clips) clip.id = newId('clip');
    }
    if (workspace) {
      const folder = await saveProject(workspace.root, project);
      useSession.getState().setProjectFolder(folder);
      writeLastSession({ projectFolder: folder });
      useEditor.getState().loadProject(project);
      useSession.getState().setRoute('edit');
      const missing = project.assets.length;
      if (missing > 0) {
        useSession
          .getState()
          .pushToast(`Imported project references ${missing} media file(s). Relink them in the media panel.`, 'info');
      }
    } else {
      useEditor.getState().loadProject(project);
    }
  } catch (error) {
    session.pushToast(`Could not import project: ${(error as Error).message}`, 'error');
  }
}

export async function relinkAsset(assetId: string, file: File): Promise<void> {
  const session = useSession.getState();
  const workspace = session.workspace;
  const folder = session.projectFolder;
  const editor = useEditor.getState();
  if (!workspace || !editor.project) return;
  if (!folder) {
    session.pushToast('This project has no folder yet; save it before relinking media.', 'error');
    return;
  }
  try {
    const info = await probeMediaFile(file);
    const safeName = sanitizeFileName(file.name);
    const path = `${WORKSPACE_LAYOUT.originals}/${Date.now().toString(36)}-${safeName}`;
    await writeBinary(workspace.root, projectPath(folder, path), new Uint8Array(await file.arrayBuffer()));
    editor.apply('Relink media', (project) =>
      relinkAssetInProject(project, assetId, {
        path,
        durationSeconds: info.kind === 'image' ? DEFAULT_IMAGE_DURATION_SECONDS : info.durationSeconds,
        ...(info.width ? { width: info.width } : {}),
        ...(info.height ? { height: info.height } : {}),
        ...(file.type ? { mimeType: file.type } : {}),
      }),
    );
    session.pushToast('Media relinked.', 'success');
  } catch (error) {
    session.pushToast(`Relink failed: ${(error as Error).message}`, 'error');
  }
}

export async function duplicateCurrentProject(): Promise<void> {
  const session = useSession.getState();
  const editor = useEditor.getState();
  const workspace = session.workspace;
  const folder = session.projectFolder;
  if (!workspace || !editor.project || !folder) return;
  try {
    const copy: Project = structuredClone(editor.project);
    copy.id = newId('proj');
    copy.name = `${copy.name} copy`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    const newFolder = projectFolderName(copy);
    const failed: string[] = [];
    for (const asset of copy.assets) {
      const from = `${WORKSPACE_LAYOUT.projects}/${folder}`;
      const to = `${WORKSPACE_LAYOUT.projects}/${newFolder}`;
      try {
        await copyFile(workspace.root, `${from}/${asset.path}`, workspace.root, `${to}/${asset.path}`);
      } catch (error) {
        // Record it instead of pretending the copy is complete.
        asset.missing = true;
        failed.push(asset.name);
        console.warn(`Could not copy ${asset.path} into the duplicate:`, error);
      }
      if (asset.proxyPath) {
        try {
          await copyFile(workspace.root, `${from}/${asset.proxyPath}`, workspace.root, `${to}/${asset.proxyPath}`);
        } catch {
          // A stale proxy path would point at a file that is not in the copy.
          delete asset.proxyPath;
        }
      }
    }
    await saveProject(workspace.root, copy);
    if (failed.length > 0) {
      session.pushToast(
        `Project duplicated, but ${failed.length} media file(s) could not be copied: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}. Relink them in the copy.`,
        'error',
      );
    } else {
      session.pushToast('Project duplicated.', 'success');
    }
  } catch (error) {
    session.pushToast(`Duplicate failed: ${(error as Error).message}`, 'error');
  }
}

export async function writeProjectNotes(notes: string): Promise<void> {
  const session = useSession.getState();
  const editor = useEditor.getState();
  if (!session.workspace || !editor.project) return;
  useEditor.getState().apply('Edit project notes', (project) => ({ ...project, notes }));
}

export async function saveRecordingManifestFile(name: string, contents: string): Promise<void> {
  const session = useSession.getState();
  const workspace = session.workspace;
  const folder = session.projectFolder;
  if (!workspace || !folder) return;
  await writeTextAtomic(workspace.root, `${WORKSPACE_LAYOUT.projects}/${folder}/${WORKSPACE_LAYOUT.captions}/${name}`, contents);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ensureDefaultCaptionStyle(project: Project): Project {
  if (project.captionStyle) return project;
  return { ...project, captionStyle: defaultCaptionStyle() };
}

export { formatBytes } from '../export/presets';
export const importFilesIntoProject = importMediaFiles;
export { serializeProject };

declare const __APP_BUILD_ID__: string | undefined;

export const APP_BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== 'undefined' && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : 'studio-latest';

const BUILD_ID_KEY = 'browser-record-build-id';

/**
 * When a new deployment is detected, purge any stale Cache Storage / Service Workers
 * and clear temporary OPFS auto-reopen pointers so fresh changes reflect immediately.
 */
export async function syncBuildCacheVersion(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    const previous = localStorage.getItem(BUILD_ID_KEY);
    if (previous === APP_BUILD_ID) return false;
    localStorage.setItem(BUILD_ID_KEY, APP_BUILD_ID);
    const last = readLastSession();
    if (last?.mode === 'opfs') {
      clearLastSession();
    }
    if ('serviceWorker' in navigator && navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
    }
    if ('caches' in window && window.caches?.keys) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key).catch(() => false)));
    }
    return previous !== null;
  } catch {
    return false;
  }
}

/**
 * Explicit hard refresh: clears Cache Storage, unregisters any Service Workers,
 * resets temporary session pointers, and reloads with a cache-busting query param.
 */
export async function performHardRefresh(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    clearLastSession();
    if ('serviceWorker' in navigator && navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
    }
    if ('caches' in window && window.caches?.keys) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key).catch(() => false)));
    }
  } catch {
    /* proceed to reload even if cache APIs are restricted */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('v', `${APP_BUILD_ID}-${Date.now().toString(36)}`);
  window.location.replace(url.toString());
}


