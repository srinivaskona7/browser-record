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

export function ProjectsPage() {
  const session = useSession();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('Linux fundamentals — lesson 1');
  // Conservative first run: 1080p. 4K is available once a capture/benchmark
  // shows the machine can sustain it.
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

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Browser 4K Studio</h1>
          <p className="page-subtitle">
            Record, edit and caption technical lessons entirely on this machine. Media never leaves your disk; there is
            no account and no upload path in the core workflow.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Badge tone={features.fileSystemAccess ? 'ok' : 'warn'}>
            {features.fileSystemAccess ? 'Folder access' : 'No folder access'}
          </Badge>
          <Badge tone={features.webCodecsEncode ? 'ok' : 'warn'}>{features.webCodecsEncode ? 'WebCodecs' : 'No WebCodecs'}</Badge>
          <Badge tone={features.webGpu ? 'ok' : 'neutral'}>{features.webGpu ? 'WebGPU' : 'CPU only'}</Badge>
        </div>
      </header>

      <div className="stack" style={{ gap: 18, maxWidth: 1180 }}>
        <Panel title="Start here" bodyClassName="stack">
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
              Start recording
            </Button>
            <Button
              onClick={() => importInput.current?.click()}
              disabled={quickImporting}
            >
              {quickImporting ? 'Importing…' : 'Import a video'}
            </Button>
            <Button variant="ghost" onClick={() => session.setRoute('edit')}>
              Open the editor
            </Button>
          </div>
          <div className="field-hint">
            No project is needed first. Recording creates a temporary local session automatically; importing creates one
            and places the clip on a timeline. Nothing is uploaded.
          </div>
          <input
            ref={importInput}
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            hidden
            onChange={async (event) => {
              // Copy before resetting the input: clearing `value` empties the
              // live FileList too, which made this handler silently do nothing.
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length === 0) return;
              setQuickImporting(true);
              try {
                await importMediaIntoSession(files);
                session.setRoute('edit');
              } catch (error) {
                session.pushToast(`Could not import: ${(error as Error).message}`, 'error');
              } finally {
                setQuickImporting(false);
              }
            }}
          />
        </Panel>

        <Panel title="Workspace" action={<Button size="sm" variant="ghost" onClick={() => session.setRoute('diagnostics')}>Diagnostics</Button>}>
          {workspace ? (
            <div className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{workspace.info.name}</div>
                  <div className="field-hint">
                    {workspace.info.mode === 'fsa' ? 'A real folder on disk. Files are readable outside this app.' : 'Browser-managed storage (OPFS). Export to disk to keep long-term copies.'}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Button size="sm" onClick={() => setCreateOpen(true)} variant="primary">
                    New project
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => projectBundleInput.current?.click()}>
                    Import project
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </Button>
                </div>
              </div>
              {project && (
                <div className="hint-card">
                  Open: <strong>{project.name}</strong> —{' '}
                  <Button size="sm" variant="ghost" onClick={() => session.setRoute('edit')}>
                    Back to editing
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void duplicateCurrentProject()}>
                    Duplicate
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="field-hint">
                Choose a folder once per browser profile. The browser remembers the grant, and the project folder stays
                portable: originals, proxies, captions and exports live inside it.
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => void connectDiskWorkspace()} disabled={!features.fileSystemAccess}>
                  Choose a folder
                </Button>
                <Button onClick={() => void connectFallbackWorkspace()} disabled={!features.opfs}>
                  Use browser storage instead
                </Button>
                <Button
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
                      // A granted handle can still point at an unmounted folder.
                      session.pushToast(`Could not reopen the workspace: ${(error as Error).message}`, 'error');
                    }
                  }}
                >
                  Reopen last workspace
                </Button>
                <Button variant="ghost" onClick={() => projectBundleInput.current?.click()}>
                  Import project bundle
                </Button>
              </div>
              {!features.fileSystemAccess && (
                <div className="warn-card">
                  This browser does not expose the File System Access API. Recording can still use browser storage,
                  but long 4K sessions are not safe there — export often, or use Chrome or Edge for folder-backed
                  recording. <span className="mono">{session.browser.name} {session.browser.version} on {session.browser.os}</span>
                </div>
              )}
            </div>
          )}
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
          {session.workspaceError && <div className="danger-card" style={{ marginTop: 12 }}>{session.workspaceError}</div>}
        </Panel>

        {workspace && (
          <Panel title={`Projects (${rows.length})`}>
            {rows.length === 0 ? (
              <EmptyState
                title="No projects in this folder"
                action={
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Create the first project
                  </Button>
                }
              >
                Each project gets its own folder with structured media subdirectories and an autosaved manifest.
              </EmptyState>
            ) : (
              <div className="grid-cards">
                {rows.map((row) => (
                  <div
                    key={row.folder}
                    className="panel"
                    style={{ textAlign: 'left', padding: 16 }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong style={{ fontSize: 14 }}>{row.project?.name ?? row.folder}</strong>
                      <div className="row" style={{ gap: 6 }}>
                        {row.error ? <Badge tone="danger">unreadable</Badge> : <Badge>project</Badge>}
                        {row.project && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Open ${row.project.name}`}
                            onClick={() => void openProjectFolder(row.folder)}
                          >
                            Open
                          </Button>
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
                    {row.error ? (
                      <div className="danger-card" style={{ marginTop: 8 }}>{row.error}</div>
                    ) : (
                      <div className="stack" style={{ gap: 10 }}>
                        <div className="row" style={{ gap: 18 }}>
                          <Stat label="Duration" value={formatClock(row.project?.durationTicks ?? 0)} />
                          <Stat label="Clips" value={row.project?.tracks.reduce((sum, track) => sum + track.clips.length, 0) ?? 0} />
                          <Stat label="Assets" value={row.project?.assets.length ?? 0} />
                        </div>
                        <div className="field-hint mono">
                          {row.project?.canvas.width}×{row.project?.canvas.height} ·{' '}
                          {row.project ? `${row.project.canvas.fps.num}/${row.project.canvas.fps.den}` : '—'} fps · updated{' '}
                          {row.project ? new Date(row.project.updatedAt).toLocaleString() : '—'}
                        </div>
                        <div className="field-hint mono" style={{ fontSize: 10.5 }}>
                          {row.folder}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        <Panel title="What this build can and cannot promise">
          <table className="table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Reality</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>True 4K capture</td>
                <td>Only when the display or window itself is 3840×2160. Smaller sources are upscaled and labelled as such. 1080p is the default capture target.</td>
              </tr>
              <tr>
                <td>System audio</td>
                <td>Offered only when the browser actually returns an audio track from the picker. Chrome does not on every surface.</td>
              </tr>
              <tr>
                <td>Auto zoom, cursor telemetry</td>
                <td>Manual zoom/pan keyframes. A web page cannot read OS-wide pointer input; nothing is invented.</td>
              </tr>
              <tr>
                <td>Crash recovery</td>
                <td>Committed segments survive. The active segment (up to the configured interval) can be lost and is reported, never hidden.</td>
              </tr>
              <tr>
                <td>File size</td>
                <td>Estimates from duration and bitrate. VBR lands near the target, not exactly on it.</td>
              </tr>
            </tbody>
          </table>
          <div className="field-hint" style={{ marginTop: 10 }}>
            Full matrix: <button type="button" className="btn btn-ghost btn-sm" onClick={() => session.setRoute('diagnostics')}>open diagnostics →</button>
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
          <Field label="Lesson name">
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label="Canvas" hint="This is the composition size. 1080p is the default; 4K is opt-in because it costs roughly four times the compositing work.">
            <Select
              value={resolution}
              onChange={setResolution}
              options={[
                { value: '4k', label: '3840×2160 — 4K 16:9' },
                { value: '1440', label: '2560×1440 — 1440p 16:9' },
                { value: '1080', label: '1920×1080 — 1080p 16:9' },
                { value: 'vertical', label: '1080×1920 — 9:16 vertical' },
                { value: 'square', label: '1080×1080 — 1:1 square' },
              ]}
            />
          </Field>
          <Field label="Frame rate" hint="30 fps is the default for terminal and slide lessons. 60 fps roughly doubles file size for little gain on static content.">
            <Select
              value={fps}
              onChange={setFps}
              options={[
                { value: '30', label: '30 fps' },
                { value: '60', label: '60 fps (test on this machine first)' },
              ]}
            />
          </Field>
          <Field label="Recording segment commit interval" hint="How often recorded bytes are flushed to disk. Shorter means less loss on a crash, more disk commits.">
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
            Disk estimate: one hour of 4K at 10 Mbps is about {formatBytes((10e6 * 3600) / 8)} including audio overhead.
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
