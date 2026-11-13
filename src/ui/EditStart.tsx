import { useEffect, useRef, useState } from 'react';
import { useSession } from '../app/session';
import { useEditor } from '../project/store';
import {
  chooseFolderWorkspace,
  ensureWorkspace,
  importMediaIntoSession,
  openExistingProject,
  prepareSession,
} from '../app/bootstrap';
import { listProjects, listTakes } from '../workspace/workspace';
import { formatClock } from '../core/time';
import { formatBytes } from '../export/presets';
import { loadSampleKubernetesLesson } from '../project/sampleLesson';
import { Badge, Button, EmptyState, Panel } from './components';
import type { Project } from '../project/types';

interface RecentRow {
  folder: string;
  project: Project;
  takes: number;
  interrupted: number;
  bytes: number;
}

/**
 * The Edit entry screen. Edit used to require a project first, which made an
 * import wait on manual project setup. Everything here creates what it needs.
 */
export function EditStart() {
  const session = useSession();
  const project = useEditor((state) => state.project);
  const importInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RecentRow[]>([]);
  // Recent projects load on mount and again whenever the workspace or project folder changes.
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadKey = `${session.workspace?.info.name ?? ''}\u0000${session.projectFolder ?? ''}`;
  const [requestedKey, setRequestedKey] = useState(loadKey);
  if (requestedKey !== loadKey) {
    setRequestedKey(loadKey);
    setLoading(true);
    setError(null);
  }

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadRecentRows());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadRecentRows()
      .then(
        (next) => {
          if (!cancelled) setRows(next);
        },
        (err: unknown) => {
          if (!cancelled) setError((err as Error).message);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  const startRecording = async () => {
    setBusy(true);
    setError(null);
    try {
      await prepareSession();
      session.setRoute('record');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Edit</h1>
          <p className="page-subtitle">
            Import a clip or open a recording. A project is created automatically when you import; nothing is uploaded.
          </p>
        </div>
        <Badge tone={session.workspace?.info.mode === 'fsa' ? 'ok' : 'warn'}>
          {session.workspace?.info.mode === 'fsa'
            ? `Folder: ${session.workspace.info.name}`
            : session.workspace
              ? 'Browser storage'
              : 'No storage yet'}
        </Badge>
      </header>

      <div className="stack" style={{ gap: 16, maxWidth: 1000 }}>
        <Panel title="Start editing" bodyClassName="stack">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" data-magnetic onClick={() => importInput.current?.click()} disabled={importing || busy}>
              {importing ? 'Importing…' : 'Import a video or audio file'}
            </Button>
            <Button onClick={() => void startRecording()} disabled={busy || importing}>
              Start a new recording
            </Button>
            <Button
              variant="ghost"
              onClick={() => void loadSampleKubernetesLesson('edit')}
              disabled={busy || importing}
              data-testid="edit-start-sample-lesson-btn"
            >
              Load Sample Kubernetes Lesson
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                setBusy(true);
                const ok = await chooseFolderWorkspace();
                setBusy(false);
                if (ok) await refresh();
              }}
              disabled={busy || importing}
            >
              Choose a folder…
            </Button>
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
              setImporting(true);
              setError(null);
              try {
                await importMediaIntoSession(files);
                session.setRoute('edit');
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setImporting(false);
              }
            }}
          />
          <div className="field-hint">
            Supported: containers this browser can actually decode — MP4 (H.264/AAC) and WebM (VP9/Opus) are the safe
            choices. A file this browser cannot decode is reported and left alone; there is no hidden conversion step.
          </div>
          <div className="field-hint">
            {session.workspace
              ? session.workspace.info.mode === 'fsa'
                ? `Files are stored in the folder “${session.workspace.info.name}” on this computer.`
                : `Files are stored in this browser’s storage (${session.workspace.info.name}). The browser can evict it — save to a folder to keep a durable copy.`
              : 'Storage is prepared automatically when you import or record.'}
          </div>
          {error && (
            <div className="danger-card" role="alert">
              {error}
            </div>
          )}
        </Panel>

        <Panel title={`Open a saved project${rows.length > 0 ? ` (${rows.length})` : ''}`} bodyClassName="stack">
          {loading && rows.length === 0 ? (
            <div className="hint-card">Looking for projects…</div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No saved projects yet"
              action={
                <Button variant="primary" onClick={() => importInput.current?.click()}>
                  Import a video
                </Button>
              }
            >
              Importing a clip creates a project automatically. You can also start a recording and edit it straight away.
            </EmptyState>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {rows.map((row) => (
                <div
                  key={row.folder}
                  className="row"
                  style={{
                    gap: 12,
                    justifyContent: 'space-between',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 'var(--token-font-base)' }}>{row.project.name}</strong>
                      {row.interrupted > 0 && <Badge tone="warn">{row.interrupted} interrupted recording</Badge>}
                      {row.takes > 0 && <Badge>{row.takes} recording{row.takes === 1 ? '' : 's'}</Badge>}
                    </div>
                    <div className="field-hint mono" style={{ fontSize: 'var(--token-font-xs)' }}>
                      {row.project.canvas.width}×{row.project.canvas.height} · {formatClock(row.project.durationTicks)} ·{' '}
                      {formatBytes(row.bytes)} recorded · updated {new Date(row.project.updatedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" onClick={() => void openExistingProject(row.folder)}>
                      Open
                    </Button>
                    {row.interrupted > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await openExistingProject(row.folder);
                          session.setRoute('record');
                          session.pushToast(
                            'Scroll to “Takes in this project” and choose Add to timeline to recover the interrupted recording.',
                            'info',
                          );
                        }}
                      >
                        Recover recording
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="field-hint">
            A recording opens as a project and can be edited immediately. Recordings that were interrupted are listed
            with the recover control.
          </div>
        </Panel>

        {project && (
          <div className="hint-card">
            <strong>{project.name}</strong> is already open.{' '}
            <Button size="sm" variant="ghost" onClick={() => session.setRoute('edit')}>
              Back to editing
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The eight most recently updated projects with their take counts and sizes. */
async function loadRecentRows(): Promise<RecentRow[]> {
  const workspace = await ensureWorkspace();
  const projects = (await listProjects(workspace.root))
    .filter((row): row is { folder: string; project: Project } => Boolean(row.project))
    .sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
    .slice(0, 8);
  const enriched: RecentRow[] = [];
  for (const row of projects) {
    const takes = await listTakes(workspace.root, row.folder).catch(() => []);
    enriched.push({
      folder: row.folder,
      project: row.project,
      takes: takes.length,
      interrupted: takes.filter((take) => take.interrupted).length,
      bytes: takes.reduce(
        (sum, take) => sum + take.manifest.assets.reduce((inner, asset) => inner + asset.committedBytes, 0),
        0,
      ),
    });
  }
  return enriched;
}
