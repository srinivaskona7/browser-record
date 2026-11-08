import { useEffect, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { useEditor } from '../project/store';
import { Badge, Button, Dialog, EmptyState, Field, Panel, Select, Stat } from './components';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import {
  connectDiskWorkspace,
  connectFallbackWorkspace,
  createAndOpenProject,
  duplicateCurrentProject,
  importProjectBundle,
  openProjectFolder,
  refreshProjectList,
  restoreLastProject,
  restoreLastWorkspace,
} from '../app/actions';
import { importMediaIntoSession, prepareSession } from '../app/bootstrap';
import { formatBytes } from '../export/presets';
import { formatClock } from '../core/time';
import type { Project } from '../project/types';

interface ProjectRow {
  folder: string;
  project?: Project;
  error?: string;
}

function aspectLabel(width?: number, height?: number): string {
  if (!width || !height) return '16:9';
  if (width === height) return '1:1 Square';
  if (width < height) return width * 5 === height * 4 ? '4:5 Portrait' : '9:16 Vertical';
  return width >= 3840 ? '16:9 4K' : '16:9 HD';
}

export function ProjectsPage() {
  const session = useSession();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [name, setName] = useState('Linux fundamentals — lesson 1');
  const [resolution, setResolution] = useState<'4k' | '1440' | '1080' | 'vertical' | 'square'>('1080');
  const [fps, setFps] = useState<'30' | '60'>('30');
  const [segmentSeconds, setSegmentSeconds] = useState('10');
  const importInput = useRef<HTMLInputElement>(null);
  const projectBundleInput = useRef<HTMLInputElement>(null);
  const [quickImporting, setQuickImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const features = session.features;
  const workspace = session.workspace;
  const project = useEditor((state) => state.project);

  const refresh = async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      setRows((await refreshProjectList()) as ProjectRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  const dimensions = (() => {
    switch (resolution) {
      case '4k':
        return { width: 3840, height: 2160 };
      case '1440':
        return { width: 2560, height: 1440 };
      case '1080':
        return { width: 1920, height: 1080 };
      case 'vertical':
        return { width: 1080, height: 1920 };
      case 'square':
        return { width: 1080, height: 1080 };
    }
  })();

  const filteredRows = rows.filter((row) => {
    if (!searchQuery.trim()) return true;
    const label = `${row.project?.name ?? ''} ${row.folder}`.toLowerCase();
    return label.includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">LOCAL CREATOR WORKSPACE</span>
          <h1 className="page-title">Projects &amp; Recordings</h1>
          <p className="page-subtitle">
            Start a new screen recording, import media directly into the editor, or reopen a saved project.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={workspace?.info.mode === 'fsa' ? 'ok' : 'warn'}>
            {workspace ? `${workspace.info.name} (${workspace.info.mode === 'fsa' ? 'Disk folder' : 'Browser storage'})` : 'No workspace connected'}
          </Badge>
          <Badge tone={features.webCodecsEncode ? 'ok' : 'warn'}>{features.webCodecsEncode ? 'WebCodecs ready' : 'WebM fallback'}</Badge>
        </div>
      </header>

      <div className="stack" style={{ gap: 16, maxWidth: 1180 }}>
        <section className="projects-hero" aria-label="Quick creation actions">
          <div className="stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: 16 }}>Create or continue</strong>
            <span className="field-hint">
              Recordings and edits stay 100% local on this machine — no account or cloud upload required.
            </span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await prepareSession();
                  session.setRoute('record');
                } catch (error) {
                  session.pushToast(`Could not start a session: ${(error as Error).message}`, 'error');
                }
              }}
            >
              ● Start recording
            </Button>
            <Button onClick={() => importInput.current?.click()} disabled={quickImporting}>
              {quickImporting ? 'Importing…' : '+ Import media'}
            </Button>
            <Button onClick={() => setCreateOpen(true)} disabled={!workspace}>
              + New project
            </Button>
            <Button variant="ghost" onClick={() => session.setRoute('edit')}>
              Open the editor ↗
            </Button>
          </div>
          <input
            ref={importInput}
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            hidden
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length === 0) return;
              setQuickImporting(true);
              try {
                const outcome = await importMediaIntoSession(files);
                if (outcome.imported.length > 0) {
                  session.setRoute('edit');
                }
              } catch (error) {
                session.pushToast(`Could not import: ${(error as Error).message}`, 'error');
              } finally {
                setQuickImporting(false);
              }
            }}
          />
        </section>

        {project && (
          <div className="hint-card row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <span className="eyebrow">ACTIVE SESSION</span>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {project.name} · <span className="mono">{project.canvas.width}×{project.canvas.height}</span> ·{' '}
                {formatClock(project.durationTicks)}
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" variant="primary" onClick={() => session.setRoute('edit')}>
                Resume editing ↗
              </Button>
              <Button size="sm" variant="ghost" onClick={() => session.setRoute('record')}>
                Record another take
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void duplicateCurrentProject()}>
                Duplicate
              </Button>
            </div>
          </div>
        )}

        {workspace ? (
          <Panel
            title={`Saved Projects (${filteredRows.length})`}
            action={
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  aria-label="Search projects"
                  placeholder="Filter projects…"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  style={{ width: 180, padding: '4px 8px', fontSize: 12 }}
                />
                <Button size="sm" variant="ghost" onClick={() => projectBundleInput.current?.click()}>
                  Import .json
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            }
          >
            {filteredRows.length === 0 ? (
              <EmptyState
                title={rows.length === 0 ? 'No projects in this workspace yet' : 'No matching projects'}
                action={
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Create project
                  </Button>
                }
              >
                Each project stores its timeline, recordings, imported assets, and captions in its own folder.
              </EmptyState>
            ) : (
              <div className="grid-cards">
                {filteredRows.map((row) => (
                  <div key={row.folder} className="project-card">
                    <div>
                      <div className="project-card-preview" style={{ marginBottom: 10 }}>
                        <Badge tone="ok">{aspectLabel(row.project?.canvas.width, row.project?.canvas.height)}</Badge>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
                          {formatClock(row.project?.durationTicks ?? 0)}
                        </span>
                      </div>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <strong style={{ fontSize: 14.5 }}>{row.project?.name ?? row.folder}</strong>
                        {row.error && <Badge tone="danger">unreadable</Badge>}
                      </div>
                      {row.error ? (
                        <div className="danger-card" style={{ marginTop: 8 }}>{row.error}</div>
                      ) : (
                        <div className="field-hint mono" style={{ marginTop: 4 }}>
                          {row.project?.canvas.width}×{row.project?.canvas.height} ·{' '}
                          {row.project ? `${row.project.canvas.fps.num}/${row.project.canvas.fps.den}` : '30'} fps ·{' '}
                          {row.project ? new Date(row.project.updatedAt).toLocaleDateString() : '—'}
                        </div>
                      )}
                    </div>

                    {!row.error && (
                      <div className="row" style={{ gap: 16 }}>
                        <Stat
                          label="Clips"
                          value={row.project?.tracks.reduce((sum, track) => sum + track.clips.length, 0) ?? 0}
                        />
                        <Stat label="Assets" value={row.project?.assets.length ?? 0} />
                      </div>
                    )}

                    <div className="row" style={{ justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                      {row.project && (
                        <div className="row" style={{ gap: 6 }}>
                          <Button
                            size="sm"
                            variant="primary"
                            aria-label={`Open ${row.project.name}`}
                            onClick={() => void openProjectFolder(row.folder)}
                          >
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await openProjectFolder(row.folder);
                              session.setRoute('record');
                            }}
                          >
                            Record take
                          </Button>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${row.project?.name ?? row.folder}`}
                        onClick={() => setDeleteTarget(row)}
                      >
                        Delete…
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : null}

        <Panel
          title="Workspace &amp; Storage Location"
          action={
            <Button size="sm" variant="ghost" onClick={() => session.setRoute('diagnostics')}>
              Diagnostics
            </Button>
          }
        >
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div className="field-hint" style={{ maxWidth: 620 }}>
                {workspace
                  ? workspace.info.mode === 'fsa'
                    ? `Connected to disk folder "${workspace.info.name}". Recordings and exports are written directly to your computer.`
                    : `Using browser-managed storage (${workspace.info.name}). Choose a disk folder in Chrome or Edge for permanent file-system storage.`
                  : 'Connect a local folder on disk (Chrome/Edge) or use private browser storage (OPFS).'}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant={workspace ? 'ghost' : 'primary'}
                  onClick={() => void connectDiskWorkspace()}
                  disabled={!features.fileSystemAccess}
                >
                  Choose a folder
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void connectFallbackWorkspace()} disabled={!features.opfs}>
                  Use browser storage instead
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const restored = await restoreLastWorkspace();
                      if (restored) await restoreLastProject();
                      session.pushToast(
                        restored ? 'Workspace reopened.' : 'No previous workspace grant found.',
                        restored ? 'success' : 'error',
                      );
                    } catch (error) {
                      session.pushToast(`Could not reopen the workspace: ${(error as Error).message}`, 'error');
                    }
                  }}
                >
                  Reopen last workspace
                </Button>
                <Button size="sm" variant="ghost" onClick={() => projectBundleInput.current?.click()}>
                  Import project bundle
                </Button>
              </div>
            </div>
            <input
              ref={projectBundleInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) await importProjectBundle(file);
                event.target.value = '';
              }}
            />
            {session.workspaceError && <div className="danger-card">{session.workspaceError}</div>}
          </div>
        </Panel>
      </div>

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                setCreateOpen(false);
                await createAndOpenProject({
                  name: name.trim() || 'Untitled lesson',
                  width: dimensions.width,
                  height: dimensions.height,
                  fps: fps === '60' ? { num: 60, den: 1 } : { num: 30, den: 1 },
                  segmentSeconds: Number(segmentSeconds),
                });
              }}
            >
              Create project
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Project name">
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label="Canvas aspect ratio &amp; resolution">
            <Select
              value={resolution}
              onChange={setResolution}
              options={[
                { value: '1080', label: '1920×1080 — 1080p 16:9 (YouTube / LinkedIn)' },
                { value: '4k', label: '3840×2160 — 4K 16:9 (Studio Master)' },
                { value: 'vertical', label: '1080×1920 — 9:16 Vertical (Shorts / Reels)' },
                { value: 'square', label: '1080×1080 — 1:1 Square (Carousel / Post)' },
                { value: '1440', label: '2560×1440 — 1440p 16:9' },
              ]}
            />
          </Field>
          <Field label="Frame rate">
            <Select
              value={fps}
              onChange={setFps}
              options={[
                { value: '30', label: '30 fps (recommended)' },
                { value: '60', label: '60 fps (high motion)' },
              ]}
            />
          </Field>
          <Field label="Recording segment commit interval">
            <Select
              value={segmentSeconds}
              onChange={setSegmentSeconds}
              options={[
                { value: '5', label: '5 seconds' },
                { value: '10', label: '10 seconds (recommended)' },
                { value: '20', label: '20 seconds' },
                { value: '30', label: '30 seconds' },
              ]}
            />
          </Field>
          <div className="field-hint">
            Estimated disk usage: 1 hour of 1080p is ~{formatBytes((6e6 * 3600) / 8)}.
          </div>
        </div>
      </Dialog>

      <DeleteProjectDialog
        open={deleteTarget !== null}
        folder={deleteTarget?.folder ?? null}
        name={deleteTarget?.project?.name}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
      />
    </div>
  );
}
