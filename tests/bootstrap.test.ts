import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDirectoryHandle } from '../src/workspace/memoryFs';
import { useEditor } from '../src/project/store';
import { useSession, routeFromHash, sessionKindOf, storageDescription } from '../src/app/session';
import {
  ensureDraftProject,
  ensureWorkspace,
  importMediaIntoSession,
  resetBootstrapStateForTests,
} from '../src/app/bootstrap';
import { fileExists, loadProject, projectFolderName } from '../src/workspace/workspace';
import { PROJECT_FILE } from '../src/workspace/workspace';
import { nextFreeStart } from '../src/project/ops';
import { createClip, createProject } from '../src/project/factory';
import { resolutionForCanvas, recordingBitrate, frameRateForCanvas } from '../src/capture/quality';

function useMemoryWorkspace(name = 'workspace'): MemoryDirectoryHandle {
  const root = new MemoryDirectoryHandle(name);
  useSession.setState({
    workspace: { root, info: { name, mode: 'memory', persistent: false } },
    workspaceError: null,
  });
  return root;
}

describe('session bootstrap', () => {
  beforeEach(() => {
    resetBootstrapStateForTests();
    useEditor.getState().closeProject();
    useSession.setState({ workspace: null, projectFolder: null, route: 'projects', workspaceError: null });
  });

  it('creates and persists project metadata before returning', async () => {
    const root = useMemoryWorkspace();
    const prepared = await ensureDraftProject({ width: 1920, height: 1080 });
    expect(prepared.created).toBe(true);
    expect(useEditor.getState().project?.id).toBe(prepared.project.id);
    expect(useSession.getState().projectFolder).toBe(prepared.folder);
    expect(await fileExists(root, `projects/${prepared.folder}/${PROJECT_FILE}`)).toBe(true);

    const loaded = await loadProject(root, prepared.folder);
    expect(loaded.project.id).toBe(prepared.project.id);
    expect(loaded.project.canvas.width).toBe(1920);
  });

  it('reuses the open project across routes instead of creating another', async () => {
    useMemoryWorkspace();
    const first = await ensureDraftProject({ width: 1920, height: 1080 });
    useSession.getState().setRoute('edit');
    const second = await ensureDraftProject({ width: 3840, height: 2160 });
    expect(second.created).toBe(false);
    expect(second.project.id).toBe(first.project.id);
    expect(second.folder).toBe(first.folder);
  });

  it('shares one creation promise between concurrent callers', async () => {
    useMemoryWorkspace();
    const [a, b] = await Promise.all([
      ensureDraftProject({ width: 1920, height: 1080 }),
      ensureDraftProject({ width: 1920, height: 1080 }),
    ]);
    expect(a.project.id).toBe(b.project.id);
  });

  it('reuses a remembered project folder when the editor is empty', async () => {
    const root = useMemoryWorkspace();
    const created = await ensureDraftProject({ width: 1920, height: 1080 });
    useEditor.getState().closeProject();
    useSession.getState().setProjectFolder(created.folder);
    const reopened = await ensureDraftProject();
    expect(reopened.project.id).toBe(created.project.id);
    expect(reopened.folder).toBe(created.folder);
    expect(await fileExists(root, `projects/${created.folder}/${PROJECT_FILE}`)).toBe(true);
  });

  it('uses the workspace already in session without opening another', async () => {
    const root = useMemoryWorkspace('picked-folder');
    const workspace = await ensureWorkspace();
    expect(workspace.root).toBe(root);
    expect(useSession.getState().workspace?.info.name).toBe('picked-folder');
  });

  it('reports an unsupported import without creating a project', async () => {
    useMemoryWorkspace();
    const outcome = await importMediaIntoSession([new File(['not media'], 'notes.txt', { type: 'text/plain' })]);
    expect(outcome.imported).toHaveLength(0);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]!.message).toMatch(/cannot decode|read/i);
    expect(useEditor.getState().project).toBeNull();
  });
});

describe('session state helpers', () => {
  it('parses every route from the hash', () => {
    expect(routeFromHash('#/record')).toBe('record');
    expect(routeFromHash('#edit')).toBe('edit');
    expect(routeFromHash('#/export')).toBe('export');
    expect(routeFromHash('#/nope')).toBeNull();
  });

  it('distinguishes no session, temporary and saved', () => {
    expect(sessionKindOf(null, false)).toBe('none');
    expect(sessionKindOf({ info: { mode: 'opfs' } }, true)).toBe('temporary');
    expect(sessionKindOf({ info: { mode: 'fsa' } }, true)).toBe('saved');
  });

  it('never calls browser storage a durable save', () => {
    const text = storageDescription({ info: { name: 'Browser storage', mode: 'opfs' } });
    expect(text).toMatch(/evict/i);
    expect(storageDescription({ info: { name: 'Lessons', mode: 'fsa' } })).toMatch(/folder/i);
  });
});

describe('capture quality defaults', () => {
  it('maps a project canvas to a capture target', () => {
    expect(resolutionForCanvas({ width: 1920, height: 1080 })).toBe('1080');
    expect(resolutionForCanvas({ width: 1080, height: 1920 })).toBe('1080');
    expect(resolutionForCanvas({ width: 2560, height: 1440 })).toBe('1440');
    expect(resolutionForCanvas({ width: 3840, height: 2160 })).toBe('4k');
  });

  it('keeps a 1080p target far below a 4K bitrate and makes 4K recording 4x smaller in Ultra-Compact VBR mode', async () => {
    const { firstRunQuality } = await import('../src/capture/quality');
    expect(firstRunQuality().resolution).toBe('4k');
    expect(firstRunQuality().dimensions).toEqual({ width: 3840, height: 2160 });
    expect(recordingBitrate(1920, 1080, 30)).toBeLessThan(recordingBitrate(3840, 2160, 30));
    expect(recordingBitrate(1920, 1080, 60)).toBeGreaterThan(recordingBitrate(1920, 1080, 30));
    // 4K30 Ultra-Compact VBR is ~3.73 Mbps (4x smaller than the 14.93 Mbps legacy rate)
    const compact4k = recordingBitrate(3840, 2160, 30, true);
    const legacy4k = recordingBitrate(3840, 2160, 30, false);
    expect(compact4k).toBeLessThanOrEqual(Math.round(legacy4k * 0.26));
  });

  it('reads frame rate from the project canvas', () => {
    expect(frameRateForCanvas({ fps: { num: 30, den: 1 } })).toBe(30);
    expect(frameRateForCanvas({ fps: { num: 60, den: 1 } })).toBe(60);
  });
});

describe('timeline append point', () => {
  it('finds the end of the latest clip across tracks', () => {
    const project = createProject({ name: 'append', width: 1920, height: 1080 });
    const withClips = {
      ...project,
      tracks: project.tracks.map((track, index) =>
        index === 0
          ? { ...track, clips: [createClip({ assetId: 'a', startTicks: 0, durationTicks: 5_000 })] }
          : index === 1
            ? { ...track, clips: [createClip({ assetId: 'b', startTicks: 1_000, durationTicks: 9_000 })] }
            : track,
      ),
    };
    expect(nextFreeStart(withClips)).toBe(10_000);
  });

  it('keeps a stable folder name for the same project id', () => {
    const project = { id: 'proj_abcdefgh12345678', name: 'Linux — lesson 1' };
    const folder = projectFolderName(project);
    expect(folder).toMatch(/^linux-lesson-1-/);
    expect(projectFolderName({ ...project })).toBe(folder);
  });
});
