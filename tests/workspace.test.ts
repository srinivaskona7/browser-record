import { describe, expect, it } from 'vitest';
import { MemoryDirectoryHandle } from '../src/workspace/memoryFs';
import {
  SegmentWriter,
  PROJECT_FILE,
  cleanRecordingsFolder,
  copyFile,
  copyTree,
  deleteProject,
  deleteTake,
  directoryExists,
  ensureLayout,
  fileExists,
  listProjects,
  loadProject,

  readText,
  resolveFile,
  saveProject,
  verifyCommittedBytes,
  writeBinary,
  writeTextAtomic,
} from '../src/workspace/workspace';
import { WORKSPACE_LAYOUT, type FileHandleLike } from '../src/workspace/types';
import { takeIdsOf } from '../src/workspace/takeRefs';
import { createProject } from '../src/project/factory';

const NOW = '2026-03-03T09:00:00.000Z';

describe('workspace layout', () => {
  it('creates the readable directory tree', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    await ensureLayout(root);
    for (const path of Object.values(WORKSPACE_LAYOUT)) {
      const dir = await root.getDirectoryHandle(path.split('/')[0]!);
      expect(dir.name).toBe(path.split('/')[0]);
    }
    await expect(root.getDirectoryHandle('media').then((media) => media.getDirectoryHandle('originals'))).resolves.toBeTruthy();
  });

  it('saves and reopens a project from its folder', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const project = createProject({ name: 'Lesson one', id: 'proj_save', now: NOW });
    const folder = await saveProject(root, project);
    const path = `projects/${folder}/${PROJECT_FILE}`;
    expect(await fileExists(root, path)).toBe(true);
    const loaded = await loadProject(root, folder);
    expect(loaded.project.id).toBe('proj_save');
    expect(loaded.project.name).toBe('Lesson one');
    const listed = await listProjects(root);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.project?.id).toBe('proj_save');
  });

  it('writes atomically and keeps the old content readable during the swap', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    await writeTextAtomic(root, 'projects/demo/notes.txt', 'first');
    expect(await readText(root, 'projects/demo/notes.txt')).toBe('first');
    await writeTextAtomic(root, 'projects/demo/notes.txt', 'second');
    expect(await readText(root, 'projects/demo/notes.txt')).toBe('second');
  });
});

describe('SegmentWriter durability', () => {
  it('counts only bytes that survived close() as committed', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const handle = await resolveFile(root, 'projects/demo/take.webm', true);
    const commits: number[] = [];
    const writer = new SegmentWriter(handle, async (bytes) => {
      commits.push(bytes);
    });

    await writer.append(new Uint8Array([1, 2, 3]));
    await writer.append(new Uint8Array([4, 5]));
    expect(writer.committed).toBe(0);

    await writer.commit();
    expect(writer.committed).toBe(5);
    expect(commits).toEqual([5]);
    expect((await handle.getFile()).size).toBe(5);

    const verified = await verifyCommittedBytes(root, 'projects/demo/take.webm', writer.committed);
    expect(verified).toEqual({ actual: 5, extra: 0 });
  });

  it('reports bytes written but never committed as the recovery gap', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const handle = await resolveFile(root, 'projects/demo/take.webm', true);
    const writer = new SegmentWriter(handle, async () => {});

    await writer.append(new Uint8Array([1, 2, 3]));
    await writer.commit();
    await writer.append(new Uint8Array([4, 5, 6, 7]));
    await writer.abort();

    const verified = await verifyCommittedBytes(root, 'projects/demo/take.webm', writer.committed);
    expect(writer.committed).toBe(3);
    // The in-memory file keeps the uncommitted tail; recovery must report it.
    expect(verified).toEqual({ actual: 7, extra: 4 });
  });

  it('serialises an append that arrives while a commit is closing the stream', async () => {
    // The real failure: MediaRecorder writes while commit() is mid-close and
    // the browser throws "Cannot write to a closing writable stream".
    let stored: number[] = [];
    const handle = {
      kind: 'file' as const,
      name: 'take.webm',
      async getFile() {
        return new File([new Uint8Array(stored)], 'take.webm');
      },
      async createWritable() {
        // Each writable is independently open; only a closed one rejects.
        let open = true;
        return {
          async write({ data }: { data: Uint8Array }) {
            if (!open) throw new Error('Cannot write to a closing writable stream');
            stored = [...stored, ...Array.from(data)];
          },
          async close() {
            open = false;
            await new Promise((resolve) => setTimeout(resolve, 5));
          },
          async abort() {
            open = false;
          },
        };
      },
    };
    const writer = new SegmentWriter(handle as unknown as FileHandleLike, async () => {});
    const first = writer.append(new Uint8Array([1, 2]));
    const committing = writer.commit();
    const second = writer.append(new Uint8Array([3]));
    await Promise.all([first, committing, second]);
    // The commit covers what was written when it ran; the later append must
    // land on a fresh writable instead of hitting the closing one.
    expect(writer.committed).toBe(2);
    expect(stored).toEqual([1, 2, 3]);
    await writer.commit();
    expect(writer.committed).toBe(3);
  });

  it('appends a second committed segment after the first', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const handle = await resolveFile(root, 'projects/demo/take.webm', true);
    const writer = new SegmentWriter(handle, async () => {});
    await writer.append(new Uint8Array([1, 2]));
    await writer.commit();
    await writer.append(new Uint8Array([3, 4]));
    await writer.commit();
    const file = await handle.getFile();
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });
});

describe('project media repair', () => {
  const takePath = `${WORKSPACE_LAYOUT.recordings}/take-1/screen.webm`;

  function projectWithAsset() {
    const project = createProject({ name: 'Legacy lesson', id: 'proj_legacy', now: NOW });
    project.assets.push({
      id: 'asset_screen',
      kind: 'video',
      name: 'screen.webm',
      path: takePath,
      durationTicks: 720_000,
      origin: 'recorded',
      createdAt: NOW,
    });
    return project;
  }

  it('copies media left outside the project folder back where the app reads it', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const folder = await saveProject(root, projectWithAsset());
    // Old builds wrote take media next to a root-level copy of the folder name.
    await writeBinary(root, `${folder}/${takePath}`, new Uint8Array([1, 2, 3]));

    const loaded = await loadProject(root, folder);
    expect(loaded.project.assets[0]!.missing).toBe(false);
    expect(await fileExists(root, `projects/${folder}/${takePath}`)).toBe(true);
  });

  it('marks an asset missing when no copy exists anywhere', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const folder = await saveProject(root, projectWithAsset());

    const loaded = await loadProject(root, folder);
    expect(loaded.project.assets[0]!.missing).toBe(true);
  });

  it('leaves assets that are already in place untouched', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const folder = await saveProject(root, projectWithAsset());
    await writeBinary(root, `projects/${folder}/${takePath}`, new Uint8Array([9, 9]));

    const loaded = await loadProject(root, folder);
    expect(loaded.project.assets[0]!.missing).toBe(false);
  });
});

describe('binary files', () => {
  it('writes exact bytes without text encoding', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const bytes = new Uint8Array([0, 255, 128, 7]);
    await writeBinary(root, 'projects/demo/media/originals/clip.bin', bytes);
    const file = await (await resolveFile(root, 'projects/demo/media/originals/clip.bin')).getFile();
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0, 255, 128, 7]);
  });
});

describe('discarding a take', () => {
  it('removes the take media and manifest together, and nothing else', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    await writeBinary(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-1/screen.webm`, new Uint8Array(10));
    await writeBinary(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-1/manifest.json`, new Uint8Array(2));
    await writeBinary(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-2/screen.webm`, new Uint8Array(10));
    await writeBinary(root, 'projects/demo/project.json', new Uint8Array(2));

    expect(await deleteTake(root, 'demo', 'take-1')).toBe(true);
    await expect(resolveFile(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-1/screen.webm`)).rejects.toThrow();
    await expect(resolveFile(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-1/manifest.json`)).rejects.toThrow();
    expect(await fileExists(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-2/screen.webm`)).toBe(true);
    expect(await fileExists(root, 'projects/demo/project.json')).toBe(true);
  });

  it('treats a second delete as success instead of an error', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    await writeBinary(root, `projects/demo/${WORKSPACE_LAYOUT.recordings}/take-1/screen.webm`, new Uint8Array(10));
    expect(await deleteTake(root, 'demo', 'take-1')).toBe(true);
    expect(await deleteTake(root, 'demo', 'take-1')).toBe(true);
  });
});

describe('copying a project between workspaces', () => {
  it('writes the file into the destination root, not back into the source', async () => {
    const source = new MemoryDirectoryHandle('source');
    const target = new MemoryDirectoryHandle('target');
    const path = 'projects/demo/recordings/take-1/screen.webm';
    await writeBinary(source, path, new Uint8Array([1, 2, 3]));

    await copyFile(source, path, target, path);

    expect(await fileExists(target, path)).toBe(true);
    const copied = await (await resolveFile(target, path)).getFile();
    expect(Array.from(new Uint8Array(await copied.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('copies a whole take tree, including a take not yet on the timeline', async () => {
    const source = new MemoryDirectoryHandle('source');
    const target = new MemoryDirectoryHandle('target');
    const base = 'projects/demo/recordings';
    await writeBinary(source, `${base}/take-1/screen.webm`, new Uint8Array(4));
    await writeBinary(source, `${base}/take-1/manifest.json`, new Uint8Array([7]));

    const result = await copyTree(source, base, target, base);

    expect(result).toEqual({ files: 2, bytes: 5 });
    expect(await fileExists(target, `${base}/take-1/screen.webm`)).toBe(true);
    expect(await fileExists(target, `${base}/take-1/manifest.json`)).toBe(true);
  });

  it('detects an absent recordings folder without creating it', async () => {
    // An import-only project never records, so copyTree must not be asked to
    // copy a directory that does not exist; its caller checks first.
    const root = new MemoryDirectoryHandle('workspace');
    const base = 'projects/demo/recordings';
    expect(await directoryExists(root, base)).toBe(false);
    await expect(copyTree(root, base, root, 'projects/copy/recordings')).rejects.toThrow();

    await writeBinary(root, `${base}/take-1/screen.webm`, new Uint8Array(2));
    expect(await directoryExists(root, base)).toBe(true);
  });
});

describe('deleting a project', () => {
  it('removes the whole folder, including takes, and leaves sibling projects alone', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const doomed = await saveProject(root, createProject({ name: 'Doomed lesson', id: 'proj_doomed', now: NOW }));
    const kept = await saveProject(root, createProject({ name: 'Kept lesson', id: 'proj_kept', now: NOW }));
    await writeBinary(root, `projects/${doomed}/${WORKSPACE_LAYOUT.recordings}/take-1/screen.webm`, new Uint8Array(10));
    await writeBinary(root, `projects/${doomed}/${WORKSPACE_LAYOUT.originals}/intro.mp4`, new Uint8Array(10));

    const result = await deleteProject(root, doomed);
    expect(result.ok).toBe(true);
    expect(await fileExists(root, `projects/${doomed}/project.json`)).toBe(false);
    expect(await fileExists(root, `projects/${doomed}/${WORKSPACE_LAYOUT.recordings}/take-1/screen.webm`)).toBe(false);
    expect(await fileExists(root, `projects/${kept}/project.json`)).toBe(true);
    expect((await listProjects(root)).map((row) => row.folder)).toEqual([kept]);
  });

  it('a failed existence check does not recreate the folder it looked in', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const folder = await saveProject(root, createProject({ name: 'Gone', id: 'proj_gone', now: NOW }));
    expect((await deleteProject(root, folder)).ok).toBe(true);
    // This is what the editor does for every asset path; it used to create the
    // parent directories as a side effect, leaving an empty "unreadable" row.
    expect(await fileExists(root, `projects/${folder}/media/originals/missing.mp4`)).toBe(false);
    expect(await listProjects(root)).toEqual([]);
  });

  it('refuses a folder name it does not own instead of touching the filesystem', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const kept = await saveProject(root, createProject({ name: 'Kept', id: 'proj_kept', now: NOW }));
    for (const bad of ['', '..', '../media', 'media/originals', 'does-not-exist']) {
      const result = await deleteProject(root, bad);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    }
    expect(await fileExists(root, `projects/${kept}/project.json`)).toBe(true);
  });
});

describe('cleaning unused recordings', () => {  const manifest = (takeId: string) =>
    JSON.stringify({
      version: 1,
      takeId,
      projectId: 'proj_demo',
      startedAt: NOW,
      status: 'finalized',
      segmentSeconds: 4,
      assets: [],
    });

  it('keeps referenced takes and deletes only unreferenced ones', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    const recordings = `projects/demo/${WORKSPACE_LAYOUT.recordings}`;
    for (const takeId of ['take-keep', 'take-drop']) {
      await writeBinary(root, `${recordings}/${takeId}/screen.webm`, new Uint8Array(10));
      await writeTextAtomic(root, `${recordings}/${takeId}/manifest.json`, manifest(takeId));
    }
    // A folder with no manifest is not a take the app can reason about; it is
    // left alone rather than deleted blind.
    await writeBinary(root, `${recordings}/folder-without-manifest/blob.bin`, new Uint8Array(3));

    const result = await cleanRecordingsFolder(root, 'demo', new Set(['take-keep']));
    expect(result.deleted).toEqual(['take-drop']);
    expect(result.kept).toEqual(['take-keep']);
    expect(result.failed).toEqual([]);
    expect(await fileExists(root, `${recordings}/take-keep/screen.webm`)).toBe(true);
    expect(await fileExists(root, `${recordings}/take-drop/screen.webm`)).toBe(false);
    expect(await fileExists(root, `${recordings}/folder-without-manifest/blob.bin`)).toBe(true);
  });
});

describe('take ids referenced by a project', () => {
  const asset = (path: string, segments?: string[]) => ({
    id: `asset_${path}`,
    kind: 'video' as const,
    name: path.split('/').pop()!,
    path,
    durationTicks: 720_000,
    origin: 'recorded' as const,
    createdAt: NOW,
    ...(segments ? { segments: segments.map((path, index) => ({ path, bytes: 1024, startTicks: index * 720_000, durationTicks: 720_000 })) } : {}),
  });

  it('finds takes through the relative paths assets actually store', () => {
    // The real failure: asset paths are relative, so requiring a leading slash
    // reported zero references and the cleaner deleted live media.
    expect(takeIdsOf({ assets: [asset('recordings/take_live/screen.webm')] })).toEqual(['take_live']);
  });

  it('finds takes through segment paths and paths with a leading slash', () => {
    expect(takeIdsOf({ assets: [asset('/projects/demo/recordings/take_seg/camera.webm')] })).toEqual(['take_seg']);
    expect(
      takeIdsOf({ assets: [asset('media/originals/clip.mp4', ['recordings/take_a/part-0.webm', 'recordings/take_b/part-1.webm'])] }),
    ).toEqual(['take_a', 'take_b']);
  });

  it('ignores media that is not a take, so a clean run keeps originals', () => {
    expect(takeIdsOf({ assets: [asset('media/originals/voiceover-1.webm')] })).toEqual([]);
  });
});
