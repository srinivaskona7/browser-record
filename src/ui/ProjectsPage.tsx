import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { useEditor } from '../project/store';
import { Badge, Button, Dialog, EmptyState, Field, Panel, Select, Stat } from './components';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { ImportMediaButton } from './ImportMediaButton';
import { RecordingsLibrary } from './RecordingsLibrary';
import {
  chooseFolderWorkspace,
  importMediaIntoSession,
  openExistingProject,
} from '../app/bootstrap';
import {
  createAndOpenProject,
  deleteAllProjectsFromWorkspace,
  formatBytes,
  importProjectBundle,
} from '../app/actions';
import { loadSampleKubernetesLesson } from '../project/sampleLesson';
import * as ops from '../project/ops';
import { formatClock, TICKS_PER_SECOND, type FrameRate } from '../core/time';
import { listProjects, loadProject, saveProject } from '../workspace/workspace';
import type { ProjectSummary } from '../project/types';

type ProjectSortKey = 'updated-desc' | 'updated-asc' | 'name-asc' | 'duration-desc';

const CANVAS_PRESETS = [
  { id: '4k-16-9', label: '3840 × 2160 · 4K UHD (16:9)', width: 3840, height: 2160 },
  { id: '1440p', label: '2560 × 1440 · QHD (16:9)', width: 2560, height: 1440 },
  { id: '1080p', label: '1920 × 1080 · Full HD (16:9)', width: 1920, height: 1080 },
  { id: 'vertical-4k', label: '2160 × 3840 · 4K Vertical (9:16)', width: 2160, height: 3840 },
  { id: 'vertical-1080', label: '1080 × 1920 · Shorts / Reels (9:16)', width: 1080, height: 1920 },
  { id: 'square', label: '1080 × 1080 · Square (1:1)', width: 1080, height: 1080 },
];

const FPS_OPTIONS: Array<{ value: string; label: string; fps: FrameRate }> = [
  { value: '24', label: '24 fps (cinema)', fps: { num: 24, den: 1 } },
  { value: '30', label: '30 fps (standard)', fps: { num: 30, den: 1 } },
  { value: '60', label: '60 fps (high motion)', fps: { num: 60, den: 1 } },
];

export function ProjectsPage() {
  const workspace = useSession((s) => s.workspace);
  const currentFolder = useSession((s) => s.projectFolder);
  const setRoute = useSession((s) => s.setRoute);
  const pushToast = useSession((s) => s.pushToast);
  const currentProject = useEditor((s) => s.project);
  const apply = useEditor((s) => s.apply);
  const softUpdate = useEditor((s) => s.softUpdate);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ folder: string; project: ProjectSummary } | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [name, setName] = useState('Untitled session');
  const [preset, setPreset] = useState('1080p');
  const [fpsValue, setFpsValue] = useState('30');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<ProjectSortKey>('updated-desc');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [shotDraft, setShotDraft] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    if (!workspace) return;
    const rows = await listProjects(workspace.root);
    const summaries: ProjectSummary[] = rows
      .filter((row): row is { folder: string; project: NonNullable<typeof row.project> } => Boolean(row.project))
      .map((row) => ({
        id: row.project.id,
        name: row.project.name,
        folder: row.folder,
        updatedAt: row.project.updatedAt,
        durationTicks: row.project.durationTicks,
      }));
    setProjects(summaries);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, currentFolder, currentProject?.updatedAt, currentProject?.name]);

  const handleCreate = async () => {
    const selectedPreset = CANVAS_PRESETS.find((p) => p.id === preset) ?? CANVAS_PRESETS[2]!;
    const selectedFps = FPS_OPTIONS.find((f) => f.value === fpsValue) ?? FPS_OPTIONS[1]!;
    await createAndOpenProject({
      name: name.trim() || 'Untitled session',
      width: selectedPreset.width,
      height: selectedPreset.height,
      fps: selectedFps.fps,
    });
    setCreateOpen(false);
    await refresh();
  };

  const handleRenameProject = async (summary: ProjectSummary) => {
    if (!workspace) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenamingFolder(null);
      return;
    }
    try {
      if (currentFolder === summary.folder && currentProject) {
        apply('Rename project', (p) => ops.renameProject(p, trimmed));
      } else {
        const loaded = await loadProject(workspace.root, summary.folder);
        const renamed = ops.renameProject(loaded.project, trimmed);
        await saveProject(workspace.root, renamed, summary.folder);
      }
      setRenamingFolder(null);
      await refresh();
      pushToast(`Renamed project to "${trimmed}".`, 'success');
    } catch (err) {
      pushToast(`Could not rename project: ${(err as Error).message}`, 'error');
    }
  };

  const fsAccessSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const quota = workspace?.info.quota;

  const filteredProjects = useMemo(() => {
    const filtered = projects.filter((p) =>
      searchQuery.trim() ? p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) : true,
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === 'updated-asc') return a.updatedAt.localeCompare(b.updatedAt);
      if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
      if (sortBy === 'duration-desc') return b.durationTicks - a.durationTicks;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [projects, searchQuery, sortBy]);

  return (
    <div
      className="page stack"
      style={{
        gap: 18,
        outline: dragActive ? '2px dashed var(--lavender)' : undefined,
        outlineOffset: -6,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragActive) setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          void (async () => {
            await importMediaIntoSession(files);
            setRoute('edit');
          })();
        }
      }}
    >
      {/* Quick-action Hero Row: Visible by default: New recording, Import video */}
      <Panel
        title="Projects"
        subtitle="Start a new recording, import video, or open a recent project and saved takes."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => setRoute('record')}>
              ● New recording
            </Button>
            <ImportMediaButton label="Import video" navigateToEdit />
            <details className="rec-more-menu">
              <summary className="btn btn-ghost btn-md" aria-label="More project actions">
                More ▾
              </summary>
              <div className="rec-more-popover">
                <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)}>
                  + Blank project…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void loadSampleKubernetesLesson('edit')}
                  data-testid="load-sample-kubernetes-btn"
                >
                  Load sample lesson
                </Button>
                <Button size="sm" variant="ghost" onClick={() => backupInput.current?.click()}>
                  Restore backup (.json)…
                </Button>
              </div>
            </details>
            <input
              ref={backupInput}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void importProjectBundle(file).then(refresh);
              }}
            />
          </div>
        }
      >
        <details className="record-details">
          <summary>
            Storage, backup &amp; storyboard<span>Blank project, sample lesson, folder storage &amp; shot list</span>
          </summary>
          <div className="stack" style={{ gap: 14, paddingTop: 12 }}>
            <div className="grid-3">
              <Stat
                label="Storage mode"
                value={
                  workspace?.info.mode === 'fsa'
                    ? 'Disk folder'
                    : workspace?.info.mode === 'opfs'
                      ? 'Browser OPFS'
                      : 'In-memory'
                }
                sub={
                  workspace?.info.persistent
                    ? `Folder: ${workspace.info.name}`
                    : 'Temporary browser storage — pick a folder on disk for 30–60 min recordings'
                }
              />
              <Stat
                label="Browser quota"
                value={quota && quota.quota > 0 ? `${formatBytes(quota.usage)} / ${formatBytes(quota.quota)}` : 'Unbounded / native'}
                sub={
                  quota && quota.quota > 0
                    ? `${Math.round((quota.usage / quota.quota) * 100)}% used`
                    : 'Managed by your operating system'
                }
              />
              <div className="stack" style={{ justifyContent: 'center', gap: 8 }}>
                {fsAccessSupported ? (
                  <Button onClick={() => void chooseFolderWorkspace().then(() => refresh())}>
                    {workspace?.info.mode === 'fsa' ? 'Switch workspace folder…' : 'Choose workspace folder on disk…'}
                  </Button>
                ) : (
                  <div className="warn-card">
                    This browser does not expose the File System Access directory picker. Projects are stored in origin-private
                    storage (OPFS); export a backup JSON from the Export tab to keep a copy on disk.
                  </div>
                )}
              </div>
            </div>

            {currentProject && (
              <div className="grid-2">
                <Panel
                  title={`Active session: ${currentProject.name}`}
                  subtitle={`${currentProject.canvas.width}×${currentProject.canvas.height} · ${(currentProject.canvas.fps.num / currentProject.canvas.fps.den).toFixed(0)} fps · ${formatClock(currentProject.durationTicks)}`}
                  actions={
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Button size="sm" variant="primary" onClick={() => setRoute('edit')}>
                        Resume in Editor →
                      </Button>
                      <Button size="sm" onClick={() => setRoute('record')}>
                        Record into project
                      </Button>
                      <ImportMediaButton label="+ Add media" size="sm" variant="ghost" />
                    </div>
                  }
                >
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone="ok">{currentProject.assets.length} media assets</Badge>
                      <Badge>{currentProject.tracks.reduce((sum, t) => sum + t.clips.length, 0)} timeline clips</Badge>
                      <Badge>{currentProject.captions.length} caption cues</Badge>
                      <Badge>{currentProject.markers.length} chapter markers</Badge>
                    </div>
                    <Field label="Project notes">
                      <textarea
                        className="textarea"
                        aria-label="Project notes"
                        placeholder="Session notes, shot context, or technical checklist…"
                        value={currentProject.notes}
                        onChange={(e) => softUpdate((p) => ops.setProjectNotes(p, e.target.value))}
                      />
                    </Field>
                  </div>
                </Panel>

                <Panel
                  title="Compact Storyboard & Shot List"
                  subtitle="Plan shots and verify completion before final export."
                  actions={
                    <Badge>
                      {(currentProject.storyboard ?? []).filter((s) => s.done).length}/
                      {(currentProject.storyboard ?? []).length} shots done
                    </Badge>
                  }
                >
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <input
                        className="input"
                        placeholder="Add shot (e.g. 01 Terminal preflight check)…"
                        aria-label="New storyboard shot title"
                        value={shotDraft}
                        onChange={(e) => setShotDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && shotDraft.trim()) {
                            apply('Add storyboard shot', (p) => ops.addStoryboardItem(p, { title: shotDraft }));
                            setShotDraft('');
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!shotDraft.trim()) return;
                          apply('Add storyboard shot', (p) => ops.addStoryboardItem(p, { title: shotDraft }));
                          setShotDraft('');
                        }}
                      >
                        + Add shot
                      </Button>
                    </div>
                    {(currentProject.storyboard ?? []).length === 0 ? (
                      <div className="field-hint">
                        No storyboard shots yet. Add shots above or load the Sample Kubernetes Lesson to inspect a structured 4-shot lesson.
                      </div>
                    ) : (
                      <div className="storyboard-list">
                        {(currentProject.storyboard ?? []).map((shot) => (
                          <div key={shot.id} className={`storyboard-item ${shot.done ? 'done' : ''}`}>
                            <input
                              type="checkbox"
                              checked={shot.done}
                              aria-label={`Mark ${shot.title} complete`}
                              onChange={() => apply('Toggle storyboard shot', (p) => ops.toggleStoryboardItem(p, shot.id))}
                            />
                            <span className="storyboard-text" style={{ flex: 1 }}>
                              {shot.title}
                            </span>
                            {shot.durationSeconds && <Badge>{shot.durationSeconds}s</Badge>}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => apply('Remove storyboard shot', (p) => ops.removeStoryboardItem(p, shot.id))}
                            >
                              ×
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>
              </div>
            )}
          </div>
        </details>
      </Panel>

      {/* Projects Grid with Search, Sort, Rename, Open, Delete */}
      <Panel
        title={`Projects in workspace (${projects.length})`}
        subtitle="Each project has its own folder with project.json, raw recordings, imported originals, and captions."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {projects.length > 0 && (
              <>
                <input
                  className="input"
                  style={{ width: 210 }}
                  placeholder="Search projects…"
                  aria-label="Search projects"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Select
                  aria-label="Sort projects"
                  value={sortBy}
                  onChange={(val) => setSortBy(val)}
                  options={[
                    { value: 'updated-desc', label: 'Sort: Recently updated' },
                    { value: 'updated-asc', label: 'Sort: Oldest first' },
                    { value: 'name-asc', label: 'Sort: Name (A–Z)' },
                    { value: 'duration-desc', label: 'Sort: Longest duration' },
                  ]}
                />
                <Button
                  size="sm"
                  variant="danger"
                  data-testid="delete-all-projects-btn"
                  onClick={() => setDeleteAllOpen(true)}
                >
                  Delete all ({projects.length})…
                </Button>
              </>
            )}
          </div>
        }
      >
        {filteredProjects.length === 0 ? (
          <EmptyState
            title={projects.length === 0 ? 'No projects yet' : 'No matching projects'}
            body={
              projects.length === 0
                ? 'Start a new recording, import a local video/audio file, or load the Sample Kubernetes Lesson above.'
                : 'Try clearing the search filter above.'
            }
            action={
              projects.length === 0 ? (
                <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Button variant="primary" onClick={() => setRoute('record')}>
                    ● Start Recording
                  </Button>
                  <ImportMediaButton label="Import Media File" navigateToEdit />
                  <Button onClick={() => void loadSampleKubernetesLesson('edit')}>
                    Load Sample Kubernetes Lesson
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {filteredProjects.map((project) => {
              const isCurrent = project.folder === currentFolder;
              const isRenaming = renamingFolder === project.folder;
              const durationSec = Math.round(project.durationTicks / TICKS_PER_SECOND);
              return (
                <div key={project.id} className="project-card">
                  <div className="project-meta">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {isRenaming ? (
                        <div className="row" style={{ gap: 6 }}>
                          <input
                            className="input"
                            aria-label="New project name"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            style={{ width: 220 }}
                          />
                          <Button size="sm" variant="primary" onClick={() => void handleRenameProject(project)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenamingFolder(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <strong>{project.name}</strong>
                      )}
                      {isCurrent && <Badge tone="accent">Active</Badge>}
                      <Badge>{durationSec}s</Badge>
                    </div>
                    <div className="sub">
                      Updated {new Date(project.updatedAt).toLocaleString()} · folder <code>{project.folder}</code>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      size="sm"
                      variant={isCurrent ? 'ghost' : 'primary'}
                      onClick={() =>
                        void openExistingProject(project.folder).then(() => {
                          setRoute('edit');
                        })
                      }
                    >
                      {isCurrent ? 'Open in Editor' : 'Open'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenamingFolder(project.folder);
                        setRenameDraft(project.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        void openExistingProject(project.folder).then(() => {
                          setRoute('record');
                        })
                      }
                    >
                      Record
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setDeleteTarget({ folder: project.folder, project })}
                    >
                      Delete…
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Shared Recordings Library with Preview-First Clear Unused Recordings */}
      <RecordingsLibrary onChanged={() => void refresh()} />

      <Dialog
        open={createOpen}
        title="New project"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleCreate()}>
              Create &amp; open
            </Button>
          </>
        }
      >
        <Field label="Project name">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Kubernetes rollout demo"
            autoFocus
          />
        </Field>
        <Field label="Canvas resolution & aspect">
          <Select
            value={preset}
            onChange={setPreset}
            options={CANVAS_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Field>
        <Field label="Frame rate">
          <Select
            value={fpsValue}
            onChange={setFpsValue}
            options={FPS_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
          />
        </Field>
      </Dialog>

      <DeleteProjectDialog
        open={deleteTarget !== null}
        folder={deleteTarget?.folder ?? null}
        name={deleteTarget?.project?.name}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
      />

      <Dialog
        open={deleteAllOpen}
        title={`Delete all ${projects.length} project(s)?`}
        onClose={() => {
          if (!deletingAll) setDeleteAllOpen(false);
        }}
        footer={
          <>
            <Button variant="ghost" disabled={deletingAll} onClick={() => setDeleteAllOpen(false)}>
              Cancel — keep projects
            </Button>
            <Button
              variant="danger"
              disabled={deletingAll || projects.length === 0}
              data-testid="confirm-delete-all-projects-btn"
              onClick={async () => {
                setDeletingAll(true);
                try {
                  const res = await deleteAllProjectsFromWorkspace();
                  if (res.ok) {
                    setDeleteAllOpen(false);
                    await refresh();
                  } else if (res.reason) {
                    pushToast(res.reason, 'error');
                  }
                } finally {
                  setDeletingAll(false);
                }
              }}
            >
              {deletingAll ? 'Deleting all…' : `Delete all ${projects.length} project(s) permanently`}
            </Button>
          </>
        }
      >
        <div className="stack">
          <p>
            This permanently deletes all <strong>{projects.length}</strong> project folder(s) in this workspace,
            including their <code>project.json</code> timelines, recorded takes, and imported media copies.
          </p>
          <div className="warn-card">
            Exports you saved outside this workspace (Downloads, another folder) are not touched. This action cannot be
            undone.
          </div>
        </div>
      </Dialog>
    </div>
  );
}
