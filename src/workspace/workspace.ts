import type { Project } from '../project/types';
import { parseProject, serializeProject } from '../project/serialize';
import { takeIdsOf } from './takeRefs';
import {
  WORKSPACE_LAYOUT,
  type DirectoryHandleLike,
  type FileHandleLike,
  type RecordingManifest,
  type StorageMode,
  type TakeSummary,
  type WorkspaceInfo,
  type WritableLike,
} from './types';

export const PROJECT_FILE = 'project.json';
export const PROJECT_TEMP = 'project.json.tmp';
export const PROJECT_BACKUP = 'project.json.bak';

export interface Workspace {
  root: DirectoryHandleLike;
  info: WorkspaceInfo;
}

export class WorkspaceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export async function pickWorkspace(): Promise<Workspace> {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    throw new WorkspaceError(
      'This browser cannot open a disk folder. Chrome or Edge on desktop supports the File System Access API; use OPFS mode instead.',
    );
  }
  const picker = (window as unknown as {
    showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandleLike>;
  }).showDirectoryPicker;
  const root = await picker({ mode: 'readwrite', id: 'browser-record-workspace' });
  const quota = await readQuota();
  return {
    root,
    info: {
      name: root.name,
      mode: 'fsa',
      persistent: true,
      ...(quota ? { quota } : {}),
    },
  };
}

export async function openOpfsWorkspace(): Promise<Workspace> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new WorkspaceError('OPFS is not available in this browser.');
  }
  const root = (await navigator.storage.getDirectory()) as unknown as DirectoryHandleLike;
  const quota = await readQuota();
  return {
    root,
    info: { name: `Browser storage (${root.name || 'origin-private'})`, mode: 'opfs', persistent: false, ...(quota ? { quota } : {}) },
  };
}

export async function readQuota(): Promise<{ usage: number; quota: number } | undefined> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return undefined;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return undefined;
  }
}

/** Ask the browser for durable storage; never required for the app to run. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageHeadroom {
  /** Bytes the browser says remain, or null when it will not tell us. */
  availableBytes: number | null;
  quotaBytes: number | null;
  enough: boolean;
  message: string;
}

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * How much room is left for a recording or export. Estimates are advisory:
 * browsers do not reserve space ahead of a write, so this reports numbers
 * rather than promising the write will succeed.
 */
export async function checkStorageHeadroom(requiredBytes: number): Promise<StorageHeadroom> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {
      availableBytes: null,
      quotaBytes: null,
      enough: true,
      message: 'This browser does not report available storage, so the space check is skipped.',
    };
  }
  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    const available = Math.max(0, quota - usage);
    const enough = requiredBytes <= 0 || available >= requiredBytes;
    return {
      availableBytes: available,
      quotaBytes: quota || null,
      enough,
      message: enough
        ? `${humanBytes(available)} available; this needs about ${humanBytes(requiredBytes)}.`
        : `Only ${humanBytes(available)} available but this needs about ${humanBytes(requiredBytes)}. Free some space or export to a folder on disk first.`,
    };
  } catch {
    return {
      availableBytes: null,
      quotaBytes: null,
      enough: true,
      message: 'Available storage could not be read, so the space check is skipped.',
    };
  }
}

/** Loopback-friendly check used by recovery prompts. */
export function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = (error as Error | null)?.message ?? '';
  return /NotAllowedError|SecurityError|permission|denied/i.test(`${name} ${message}`);
}

export async function ensureLayout(root: DirectoryHandleLike): Promise<void> {
  for (const path of Object.values(WORKSPACE_LAYOUT)) {
    await ensureDir(root, path);
  }
}

export async function ensureDir(root: DirectoryHandleLike, path: string): Promise<DirectoryHandleLike> {
  let dir = root;
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

export async function resolveFile(root: DirectoryHandleLike, path: string, create = false): Promise<FileHandleLike> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new WorkspaceError(`Invalid file path: ${path}`);
  // Parent directories are only created when the caller asked for a writable
  // file. Creating them on a read re-created folders that had just been
  // deleted, so `fileExists()` on a removed project left a ghost row behind.
  let dir: DirectoryHandleLike = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, create ? { create: true } : undefined);
  return dir.getFileHandle(name, { create });
}

export async function readText(root: DirectoryHandleLike, path: string): Promise<string> {
  const handle = await resolveFile(root, path);
  const file = await handle.getFile();
  return file.text();
}

export async function readJson<T>(root: DirectoryHandleLike, path: string): Promise<T> {
  return JSON.parse(await readText(root, path)) as T;
}

export async function readBlob(root: DirectoryHandleLike, path: string): Promise<File> {
  const handle = await resolveFile(root, path);
  return handle.getFile();
}

export async function readFile(root: DirectoryHandleLike, path: string): Promise<File | null> {
  try {
    return await readBlob(root, path);
  } catch {
    return null;
  }
}

/**
 * Write a file atomically where the browser allows it: write to a temp name,
 * then move it over the target. If move() is unavailable the target is written
 * directly and a .bak copy of the previous contents is kept.
 */
export async function writeTextAtomic(root: DirectoryHandleLike, path: string, text: string): Promise<void> {
  const target = await resolveFile(root, path, true);
  const tempPath = `${path}.tmp`;
  const temp = await resolveFile(root, tempPath, true);
  const writable = await temp.createWritable();
  await writable.write(new TextEncoder().encode(text));
  await writable.close();
  const dirPath = path.split('/').filter(Boolean).slice(0, -1).join('/');
  if (typeof temp.move === 'function') {
    const moved = await moveFile(root, tempPath, dirPath, baseName(path));
    if (moved) return;
  }
  // Fallback: keep the previous content as a backup, then overwrite in place.
  // Only "no previous file" is tolerable here; a failed backup write must not
  // be reported as one, or `.bak` recovery silently has nothing to restore.
  let previous: File | null = null;
  try {
    previous = await target.getFile();
  } catch {
    // No previous file: nothing to back up.
  }
  if (previous && previous.size > 0) {
    const backup = await resolveFile(root, `${path}.bak`, true);
    const bw = await backup.createWritable();
    try {
      await bw.write(new Uint8Array(await previous.arrayBuffer()));
      await bw.close();
    } catch (error) {
      try {
        await bw.abort?.();
      } catch {
        /* nothing to abort */
      }
      throw new WorkspaceError(
        `Could not back up the previous ${baseName(path)} before overwriting: ${(error as Error).message}. Nothing was written.`,
        error,
      );
    }
  }
  const direct = await target.createWritable();
  await direct.write(new TextEncoder().encode(text));
  await direct.close();
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export async function moveFile(root: DirectoryHandleLike, from: string, toDirPath: string, newName: string): Promise<boolean> {
  const temp = await resolveFile(root, from);
  if (typeof temp.move !== 'function') return false;
  const dir = await ensureDir(root, toDirPath);
  await temp.move(dir, newName);
  return true;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

export function projectFolderName(project: Pick<Project, 'id' | 'name'>): string {
  return `${slugify(project.name)}-${project.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`;
}

/**
 * Every file a project owns is stored relative to its own folder. Writing media
 * anywhere else makes it look recorded but unreadable on the next reload.
 */
export function projectPath(folder: string, relativePath: string): string {
  return `${WORKSPACE_LAYOUT.projects}/${folder}/${relativePath}`;
}

/**
 * Older builds wrote media outside the project folder: at the workspace root,
 * or under a root-level copy of the folder name. Copy anything a project still
 * references back to where the app reads it, and mark what is truly gone so the
 * UI stops presenting a missing file as present.
 */
export async function repairProjectMedia(root: DirectoryHandleLike, folder: string, project: Project): Promise<string[]> {
  const repaired: string[] = [];
  for (const asset of project.assets) {
    const canonical = projectPath(folder, asset.path);
    if (await fileExists(root, canonical)) {
      asset.missing = false;
      continue;
    }
    let found = false;
    for (const candidate of [`${folder}/${asset.path}`, asset.path]) {
      if (await fileExists(root, candidate)) {
        await copyFile(root, candidate, root, canonical);
        repaired.push(asset.path);
        found = true;
        break;
      }
    }
    asset.missing = !found;
  }
  return repaired;
}

export interface LoadedProject {
  project: Project;
  folder: string;
  /** Present when a .bak file was used because project.json was unreadable. */
  recoveredFromBackup?: boolean;
}

export async function loadProject(root: DirectoryHandleLike, folder: string): Promise<LoadedProject> {
  const base = `${WORKSPACE_LAYOUT.projects}/${folder}`;
  let loaded: LoadedProject;
  try {
    const text = await readText(root, `${base}/${PROJECT_FILE}`);
    loaded = { project: parseProject(text), folder };
  } catch (error) {
    try {
      const backup = await readText(root, `${base}/${PROJECT_BACKUP}`);
      loaded = { project: parseProject(backup), folder, recoveredFromBackup: true };
    } catch {
      throw error instanceof Error
        ? new WorkspaceError(`Could not open ${folder}: ${error.message}`, error)
        : new WorkspaceError(`Could not open ${folder}`);
    }
  }
  try {
    await repairProjectMedia(root, folder, loaded.project);
  } catch (error) {
    // A read-only workspace can still open the project; it just cannot be
    // repaired in place. Say so rather than pretending every asset is present.
    console.warn('Could not repair project media paths:', error);
  }
  return loaded;
}

export async function saveProject(
  root: DirectoryHandleLike,
  project: Project,
  folderOverride?: string,
): Promise<string> {
  const folder = folderOverride ?? projectFolderName(project);
  const base = `${WORKSPACE_LAYOUT.projects}/${folder}`;
  await ensureDir(root, base);
  try {
    await writeTextAtomic(root, `${base}/${PROJECT_FILE}`, serializeProject(project));
    return folder;
  } catch (error) {
    throw new WorkspaceError(`Could not save project: ${(error as Error).message}`, error);
  }
}

export async function listProjectFolders(root: DirectoryHandleLike): Promise<string[]> {
  const projects = await ensureDir(root, WORKSPACE_LAYOUT.projects);
  const names: string[] = [];
  for await (const entry of projects.values()) {
    if (entry.kind === 'directory') names.push(entry.name);
  }
  return names.sort();
}

export async function listProjects(root: DirectoryHandleLike): Promise<Array<{ folder: string; project?: Project; error?: string }>> {
  const folders = await listProjectFolders(root);
  const out: Array<{ folder: string; project?: Project; error?: string }> = [];
  for (const folder of folders) {
    try {
      const loaded = await loadProject(root, folder);
      out.push({ folder, project: loaded.project });
    } catch (error) {
      out.push({ folder, error: (error as Error).message });
    }
  }
  return out;
}

export async function duplicateProject(root: DirectoryHandleLike, folder: string, newName: string, newId: string): Promise<string> {
  const loaded = await loadProject(root, folder);
  const copy: Project = {
    ...structuredClone(loaded.project),
    id: newId,
    name: newName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Copy referenced media so the duplicate is self-contained.
  for (const asset of copy.assets) {
    await copyFile(
      root,
      `${WORKSPACE_LAYOUT.projects}/${folder}/${asset.path}`,
      root,
      `${WORKSPACE_LAYOUT.projects}/${projectFolderName(copy)}/${asset.path}`,
    );
    if (asset.proxyPath) {
      await copyFile(
        root,
        `${WORKSPACE_LAYOUT.projects}/${folder}/${asset.proxyPath}`,
        root,
        `${WORKSPACE_LAYOUT.projects}/${projectFolderName(copy)}/${asset.proxyPath}`,
      );
    }
  }
  return saveProject(root, copy);
}

/**
 * Copy one file. The source and destination roots are separate on purpose:
 * moving a session to a folder used to pass the source root twice, so the
 * destination folder was never written and the export could not find the take
 * files it had just "saved".
 */
export async function copyFile(
  fromRoot: DirectoryHandleLike,
  from: string,
  toRoot: DirectoryHandleLike,
  to: string,
): Promise<void> {
  const source = await readBlob(fromRoot, from);
  const target = await resolveFile(toRoot, to, true);
  const writable = await target.createWritable();
  await writable.write(new Uint8Array(await source.arrayBuffer()));
  await writable.close();
}

export interface CopyTreeResult {
  files: number;
  bytes: number;
}

/**
 * Recursively copy a directory between two roots. Used when a whole recorded
 * take must move with its project, including media that is not yet referenced
 * by an asset (a take that finished but was not inserted on the timeline).
 */
export async function copyTree(
  fromRoot: DirectoryHandleLike,
  from: string,
  toRoot: DirectoryHandleLike,
  to: string,
): Promise<CopyTreeResult> {
  const sourceDir = await resolveDir(fromRoot, from);
  const result: CopyTreeResult = { files: 0, bytes: 0 };
  for await (const entry of sourceDir.values()) {
    const childFrom = `${from}/${entry.name}`;
    const childTo = `${to}/${entry.name}`;
    if (entry.kind === 'directory') {
      const nested = await copyTree(fromRoot, childFrom, toRoot, childTo);
      result.files += nested.files;
      result.bytes += nested.bytes;
      continue;
    }
    const file = await entry.getFile();
    const target = await resolveFile(toRoot, childTo, true);
    const writable = await target.createWritable();
    await writable.write(new Uint8Array(await file.arrayBuffer()));
    await writable.close();
    result.files += 1;
    result.bytes += file.size;
  }
  return result;
}

async function resolveDir(root: DirectoryHandleLike, path: string): Promise<DirectoryHandleLike> {
  let dir = root;
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);
  return dir;
}

export async function writeBinary(root: DirectoryHandleLike, path: string, bytes: Uint8Array): Promise<void> {
  const target = await resolveFile(root, path, true);
  const writable = await target.createWritable();
  await writable.write(bytes);
  await writable.close();
}

export async function fileExists(root: DirectoryHandleLike, path: string): Promise<boolean> {
  try {
    await resolveFile(root, path);
    return true;
  } catch {
    return false;
  }
}

/** True only when the directory exists; unlike resolveDir callers, never creates it. */
export async function directoryExists(root: DirectoryHandleLike, path: string): Promise<boolean> {
  try {
    await resolveDir(root, path);
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(root: DirectoryHandleLike, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return;
  const dir = await ensureDir(root, parts.join('/'));
  try {
    await dir.removeEntry(name);
  } catch {
    // Already gone is the desired state.
  }
}

/* ------------------------------------------------------------------ */
/* Recording takes                                                      */
/* ------------------------------------------------------------------ */

export function takeFolder(projectFolder: string, takeId: string): string {
  return `${WORKSPACE_LAYOUT.projects}/${projectFolder}/${WORKSPACE_LAYOUT.recordings}/${takeId}`;
}

export async function writeTakeManifest(root: DirectoryHandleLike, projectFolder: string, manifest: RecordingManifest): Promise<void> {
  const dir = takeFolder(projectFolder, manifest.takeId);
  await writeTextAtomic(root, `${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
}

export async function readTakeManifest(root: DirectoryHandleLike, projectFolder: string, takeId: string): Promise<RecordingManifest | null> {
  try {
    return await readJson<RecordingManifest>(root, `${takeFolder(projectFolder, takeId)}/manifest.json`);
  } catch {
    return null;
  }
}

/**
 * List takes and flag interrupted ones. An interrupted take is not a failure:
 * every committed segment is still on disk and recoverable.
 */
export async function listTakes(root: DirectoryHandleLike, projectFolder: string): Promise<TakeSummary[]> {
  const dir = await ensureDir(root, `${WORKSPACE_LAYOUT.projects}/${projectFolder}/${WORKSPACE_LAYOUT.recordings}`);
  const takes: TakeSummary[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'directory') continue;
    const takeId = entry.name;
    const manifest = await readTakeManifest(root, projectFolder, takeId);
    if (!manifest) continue;
    takes.push({ takeId, path: takeFolder(projectFolder, takeId), manifest, interrupted: manifest.status === 'recording' });
  }
  return takes.sort((a, b) => b.manifest.startedAt.localeCompare(a.manifest.startedAt));
}

/** Delete one take folder. Nothing outside `recordings/<takeId>` is touched. */
export async function deleteTake(root: DirectoryHandleLike, projectFolder: string, takeId: string): Promise<boolean> {
  try {
    const recordings = await ensureDir(root, `${WORKSPACE_LAYOUT.projects}/${projectFolder}/${WORKSPACE_LAYOUT.recordings}`);
    await recordings.removeEntry(takeId, { recursive: true });
    return true;
  } catch (error) {
    // Already gone is the desired end state, not a failure: a second click, or
    // a discard after recovery renamed the folder, used to report an error.
    if ((error as { name?: string } | null)?.name === 'NotFoundError') return true;
    console.warn(`Could not delete take ${takeId}:`, error);
    return false;
  }
}

export interface DeleteProjectResult {
  ok: boolean;
  /** Why the folder was not removed. Only set when `ok` is false. */
  reason?: string;
}

/**
 * Remove one project folder and everything in it: project.json, originals,
 * proxies, exports and every take folder. Exports the user saved elsewhere
 * are untouched, because nothing outside `projects/<folder>` is reached.
 *
 * The folder name is validated against the listed projects instead of being
 * passed to removeEntry directly, so a stray `..` or a nested path can never
 * delete something outside the workspace.
 */
export async function deleteProject(root: DirectoryHandleLike, folder: string): Promise<DeleteProjectResult> {
  if (!folder || folder.includes('/') || folder.includes('\\') || folder === '.' || folder === '..') {
    return { ok: false, reason: `"${folder}" is not a project folder name.` };
  }
  const folders = await listProjectFolders(root);
  if (!folders.includes(folder)) {
    return { ok: false, reason: `No project folder named "${folder}" exists in this workspace.` };
  }
  try {
    const projects = await ensureDir(root, WORKSPACE_LAYOUT.projects);
    await projects.removeEntry(folder, { recursive: true });
    return { ok: true };
  } catch (error) {
    console.warn(`Could not delete project ${folder}:`, error);
    return { ok: false, reason: (error as Error).message || 'the folder could not be removed' };
  }
}

export interface CleanRecordingsResult {
  deleted: string[];
  failed: string[];
  kept: string[];
}

/**
 * Delete every take folder the current project does not reference. Takes used
 * by the timeline are always kept; only folders under this project's
 * `recordings/` with a readable manifest are candidates.
 */
export async function cleanRecordingsFolder(
  root: DirectoryHandleLike,
  projectFolder: string,
  keep: ReadonlySet<string>,
): Promise<CleanRecordingsResult> {
  const takes = await listTakes(root, projectFolder);
  const result: CleanRecordingsResult = { deleted: [], failed: [], kept: [] };
  for (const take of takes) {
    if (keep.has(take.takeId)) {
      result.kept.push(take.takeId);
      continue;
    }
    if (await deleteTake(root, projectFolder, take.takeId)) result.deleted.push(take.takeId);
    else result.failed.push(take.takeId);
  }
  return result;
}

/** Sum of durable bytes per the manifest — what recovery can actually rely on. */
export function committedBytes(manifest: RecordingManifest): number {
  return manifest.assets.reduce((sum, asset) => sum + asset.committedBytes, 0);
}

/** Update the human-readable label of a saved take manifest in place. */
export async function renameTake(
  root: DirectoryHandleLike,
  projectFolder: string,
  takeId: string,
  label: string,
): Promise<RecordingManifest | null> {
  const manifest = await readTakeManifest(root, projectFolder, takeId);
  if (!manifest) return null;
  const updated: RecordingManifest = { ...manifest, label: label.trim() || manifest.takeId };
  await writeTakeManifest(root, projectFolder, updated);
  return updated;
}

export interface ClearUnusedTakeCandidate {
  projectFolder: string;
  projectName: string;
  takeId: string;
  label: string;
  startedAt: string;
  durationSeconds: number;
  bytes: number;
  sourceSummary: string;
  status: 'saved' | 'recoverable';
}

export interface ClearUnusedExcludedTake {
  projectFolder: string;
  projectName: string;
  takeId: string;
  bytes: number;
  reason: 'active' | 'used-in-timeline' | 'recoverable-unselected';
}

export interface ClearUnusedPlan {
  candidates: ClearUnusedTakeCandidate[];
  excluded: ClearUnusedExcludedTake[];
  totalReclaimBytes: number;
  affectedProjects: Array<{ folder: string; name: string; count: number; bytes: number }>;
  /** Snapshot fingerprint of referenced and active takes so stale plans are rejected. */
  fingerprint: string;
  createdAt: string;
}

export interface ExecuteClearUnusedResult {
  ok: boolean;
  stale: boolean;
  error?: string;
  deleted: Array<{ projectFolder: string; takeId: string; bytes: number }>;
  failed: Array<{ projectFolder: string; takeId: string; reason: string }>;
  reclaimedBytes: number;
}

function summarizeTakeDurationSeconds(manifest: RecordingManifest): number {
  if (manifest.startedAt && manifest.endedAt) {
    const ms = Date.parse(manifest.endedAt) - Date.parse(manifest.startedAt);
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 100) / 10;
  }
  const segCount = Math.max(0, ...manifest.assets.map((a) => a.segments.length));
  return segCount * (manifest.segmentSeconds || 5);
}

function summarizeTakeSources(manifest: RecordingManifest): string {
  const kinds = manifest.assets.map((a) => a.kind);
  return kinds.length > 0 ? kinds.join(' + ') : 'recording';
}

async function computeWorkspaceReferenceSnapshot(
  root: DirectoryHandleLike,
  folders: readonly string[],
  currentProjects?: ReadonlyMap<string, Project>,
  activeTakeIds?: ReadonlySet<string>,
): Promise<{
  refsByFolder: Map<string, Set<string>>;
  namesByFolder: Map<string, string>;
  fingerprint: string;
}> {
  const refsByFolder = new Map<string, Set<string>>();
  const namesByFolder = new Map<string, string>();
  const parts: string[] = [];
  const activeSorted = [...(activeTakeIds ?? [])].sort();
  parts.push(`active:${activeSorted.join(',')}`);

  for (const folder of [...folders].sort()) {
    let project = currentProjects?.get(folder) ?? null;
    if (!project) {
      try {
        const loaded = await loadProject(root, folder);
        project = loaded.project;
      } catch {
        project = null;
      }
    }
    const refs = new Set<string>(project ? takeIdsOf(project) : []);
    refsByFolder.set(folder, refs);
    namesByFolder.set(folder, project?.name ?? folder);
    parts.push(`${folder}:${[...refs].sort().join(',')}`);
  }
  return {
    refsByFolder,
    namesByFolder,
    fingerprint: parts.join('|'),
  };
}

/**
 * Preview-first planner for "Clear unused recordings".
 * Excludes active takes, takes referenced anywhere in their owning project,
 * and recoverable interrupted sessions unless explicitly selected in
 * `selectedRecoverableTakeIds`.
 */
export async function planClearUnusedRecordings(
  root: DirectoryHandleLike,
  options: {
    projectFolder?: string;
    activeTakeIds?: ReadonlySet<string>;
    selectedRecoverableTakeIds?: ReadonlySet<string>;
    currentProjects?: ReadonlyMap<string, Project>;
  } = {},
): Promise<ClearUnusedPlan> {
  const allFolders = await listProjectFolders(root);
  const folders = options.projectFolder
    ? allFolders.filter((f) => f === options.projectFolder)
    : allFolders;
  const activeSet = options.activeTakeIds ?? new Set<string>();
  const selectedRecoverable = options.selectedRecoverableTakeIds ?? new Set<string>();

  const snapshot = await computeWorkspaceReferenceSnapshot(
    root,
    folders,
    options.currentProjects,
    activeSet,
  );

  const candidates: ClearUnusedTakeCandidate[] = [];
  const excluded: ClearUnusedExcludedTake[] = [];
  const byProject = new Map<string, { folder: string; name: string; count: number; bytes: number }>();

  for (const folder of folders) {
    const projectName = snapshot.namesByFolder.get(folder) ?? folder;
    const refs = snapshot.refsByFolder.get(folder) ?? new Set<string>();
    const takes = await listTakes(root, folder);
    for (const take of takes) {
      const bytes = committedBytes(take.manifest);
      const isActive = activeSet.has(take.takeId);
      const isReferenced = refs.has(take.takeId);
      const isRecoverable = take.interrupted || take.manifest.status === 'recording';

      if (isActive) {
        excluded.push({ projectFolder: folder, projectName, takeId: take.takeId, bytes, reason: 'active' });
        continue;
      }
      if (isReferenced) {
        excluded.push({ projectFolder: folder, projectName, takeId: take.takeId, bytes, reason: 'used-in-timeline' });
        continue;
      }
      if (isRecoverable && !selectedRecoverable.has(take.takeId)) {
        excluded.push({
          projectFolder: folder,
          projectName,
          takeId: take.takeId,
          bytes,
          reason: 'recoverable-unselected',
        });
        continue;
      }

      candidates.push({
        projectFolder: folder,
        projectName,
        takeId: take.takeId,
        label: take.manifest.label || take.takeId,
        startedAt: take.manifest.startedAt,
        durationSeconds: summarizeTakeDurationSeconds(take.manifest),
        bytes,
        sourceSummary: summarizeTakeSources(take.manifest),
        status: isRecoverable ? 'recoverable' : 'saved',
      });
      const existing = byProject.get(folder) ?? { folder, name: projectName, count: 0, bytes: 0 };
      existing.count += 1;
      existing.bytes += bytes;
      byProject.set(folder, existing);
    }
  }

  return {
    candidates,
    excluded,
    totalReclaimBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    affectedProjects: [...byProject.values()],
    fingerprint: snapshot.fingerprint,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Execute a previously previewed `ClearUnusedPlan`.
 * Rejects stale plans if any project's take references or active takes changed
 * since the preview was generated.
 */
export async function executeClearUnusedPlan(
  root: DirectoryHandleLike,
  plan: ClearUnusedPlan,
  options: {
    currentProjects?: ReadonlyMap<string, Project>;
    activeTakeIds?: ReadonlySet<string>;
  } = {},
): Promise<ExecuteClearUnusedResult> {
  const allFolders = await listProjectFolders(root);
  const planFolders = Array.from(
    new Set([
      ...plan.candidates.map((c) => c.projectFolder),
      ...plan.excluded.map((e) => e.projectFolder),
    ]),
  );
  const checkFolders = planFolders.length > 0 ? planFolders : allFolders;
  const currentSnapshot = await computeWorkspaceReferenceSnapshot(
    root,
    checkFolders,
    options.currentProjects,
    options.activeTakeIds,
  );

  if (currentSnapshot.fingerprint !== plan.fingerprint) {
    return {
      ok: false,
      stale: true,
      error: 'Project references or active takes changed since the preview was generated. Refresh the preview before deleting.',
      deleted: [],
      failed: [],
      reclaimedBytes: 0,
    };
  }

  const deleted: Array<{ projectFolder: string; takeId: string; bytes: number }> = [];
  const failed: Array<{ projectFolder: string; takeId: string; reason: string }> = [];
  let reclaimedBytes = 0;

  for (const candidate of plan.candidates) {
    const refs = currentSnapshot.refsByFolder.get(candidate.projectFolder);
    if (refs?.has(candidate.takeId) || options.activeTakeIds?.has(candidate.takeId)) {
      return {
        ok: false,
        stale: true,
        error: `Take "${candidate.label}" became referenced or active before deletion started.`,
        deleted,
        failed,
        reclaimedBytes,
      };
    }
    const ok = await deleteTake(root, candidate.projectFolder, candidate.takeId);
    if (ok) {
      deleted.push({
        projectFolder: candidate.projectFolder,
        takeId: candidate.takeId,
        bytes: candidate.bytes,
      });
      reclaimedBytes += candidate.bytes;
    } else {
      failed.push({
        projectFolder: candidate.projectFolder,
        takeId: candidate.takeId,
        reason: 'Could not remove take folder from storage.',
      });
    }
  }

  return {
    ok: failed.length === 0,
    stale: false,
    deleted,
    failed,
    reclaimedBytes,
  };
}

/** Segment writer that commits bounded byte ranges to disk and records them. */
export class SegmentWriter {
  private writable: WritableLike | null = null;
  /** Bytes appended, including those not yet flushed by close(). */
  private offset = 0;
  /** Bytes known durable — advanced only after a successful close(). */
  private committedOffset = 0;
  /**
   * MediaRecorder fires ondataavailable on its own cadence, so an append can
   * land while a commit is closing the stream. Every operation runs through
   * this chain: a write to a closing stream throws "Cannot write to a closing
   * writable stream" and kills the track.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly handle: FileHandleLike,
    private readonly onCommit: (committedBytes: number) => Promise<void>,
    private readonly onError?: (error: Error) => void,
  ) {}

  get committed(): number {
    return this.committedOffset;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async ensureWritable(): Promise<WritableLike> {
    if (!this.writable) {
      this.writable = await this.handle.createWritable({ keepExistingData: this.offset > 0 });
    }
    return this.writable;
  }

  /** Append bytes. Positional writes keep the file a single continuous stream. */
  append(data: Uint8Array): Promise<void> {
    return this.enqueue(async () => {
      const writable = await this.ensureWritable();
      await writable.write({ type: 'write', position: this.offset, data });
      this.offset += data.byteLength;
    });
  }

  /**
   * Close the stream so the browser flushes to disk, then reopen at the same
   * position on the next append. Only after close() resolves is the byte range
   * considered durable.
   */
  commit(): Promise<number> {
    return this.enqueue(async () => {
      const writable = this.writable;
      // Release the handle before awaiting close(), so nothing can reuse a
      // stream that is already shutting down.
      this.writable = null;
      if (writable) await writable.close();
      this.committedOffset = this.offset;
      await this.onCommit(this.committedOffset);
      return this.committedOffset;
    });
  }

  abort(): Promise<void> {
    return this.enqueue(async () => {
      const writable = this.writable;
      this.writable = null;
      try {
        await writable?.abort?.();
      } catch (error) {
        this.onError?.(error as Error);
      }
    });
  }

  close(): Promise<number> {
    return this.commit();
  }
}

/** Truncate a recording to its last committed byte count (best-effort). */
export async function verifyCommittedBytes(root: DirectoryHandleLike, path: string, committed: number): Promise<{ actual: number; extra: number }> {
  const file = await readBlob(root, path);
  return { actual: file.size, extra: Math.max(0, file.size - committed) };
}

export async function storageModeLabel(mode: StorageMode): Promise<string> {
  return mode === 'fsa' ? 'Folder on disk' : mode === 'opfs' ? 'Browser storage (OPFS)' : 'In-memory (tests only)';
}
