import { useEffect, useState } from 'react';
import { ROUTES, routeFromHash, sessionKindOf, storageDescription, useSession } from './app/session';
import { useEditor } from './project/store';
import { restoreLastProject, restoreLastWorkspace, saveNow, scheduleAutosave } from './app/actions';
import { ProjectsPage } from './ui/ProjectsPage';
import { RecordPage } from './ui/RecordPage';
import { EditPage } from './ui/EditPage';
import { ExportPage } from './ui/ExportPage';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { Badge, Button } from './ui/components';
import { AboutDialog } from './ui/AboutDialog';

export function App() {
  const route = useSession((state) => state.route);
  const setRoute = useSession((state) => state.setRoute);
  const theme = useSession((state) => state.theme);
  const setTheme = useSession((state) => state.setTheme);
  const toasts = useSession((state) => state.toasts);
  const dismissToast = useSession((state) => state.dismissToast);
  const workspace = useSession((state) => state.workspace);
  const saveState = useSession((state) => state.saveState);
  const saveError = useSession((state) => state.saveError);
  const lastSavedAt = useSession((state) => state.lastSavedAt);
  const project = useEditor((state) => state.project);
  const dirty = useEditor((state) => state.dirty);
  const [booted, setBooted] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const sync = () => {
      const next = routeFromHash(location.hash);
      if (next && next !== useSession.getState().route) useSession.getState().setRoute(next);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    const next = `#/${route}`;
    if (location.hash !== next) history.replaceState(null, '', next);
  }, [route]);

  // Autosave on every real edit, debounced. A failed save is surfaced, never swallowed.
  useEffect(() => {
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.revision !== previous.revision && state.dirty) scheduleAutosave();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const restored = await restoreLastWorkspace();
        if (restored) {
          const projectRestored = await restoreLastProject();
          useSession
            .getState()
            .pushToast(
              projectRestored ? 'Reopened your last project.' : 'Reopened the last workspace.',
              'success',
            );
        }
      } catch (error) {
        // A missing or revoked grant is normal; the Projects page asks again.
        console.warn('Could not restore the previous workspace:', error);
        const message = (error as Error).message ?? '';
        if (!/abort|denied|permission/i.test(message)) {
          useSession.getState().pushToast(`Could not reopen the previous workspace: ${message}`, 'error');
        }
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useEditor.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ●
          </span>
          <span>Browser 4K Studio</span>
        </div>
        <nav className="nav-tabs" aria-label="Main">
          {ROUTES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-tab"
              aria-current={route === item.id ? 'page' : undefined}
              onClick={() => setRoute(item.id)}
              title={item.id === 'export' && !project ? 'Add a recording or import a video first' : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-meta">
          <SessionBadge kind={sessionKindOf(workspace, Boolean(project))} storage={storageDescription(workspace)} />
          {workspace && <span className="topbar-workspace" title={storageDescription(workspace)}>{workspace.info.name}</span>}
          <SaveIndicator
            state={saveState}
            lastSavedAt={lastSavedAt}
            error={saveError}
            dirty={dirty}
            browserStorage={workspace?.info.mode === 'opfs'}
          />
          <Button size="sm" variant="ghost" onClick={() => void saveNow()} disabled={!project || !dirty}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAboutOpen(true)} aria-label="About and walkthrough" title="Features and walkthrough">
            i
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle colour theme">
            {theme === 'dark' ? '☾ Dark' : '☀ Light'}
          </Button>
        </div>
      </header>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <main className="app-main">
        <RecordPage hidden={route !== 'record'} />
        {!booted && !workspace && route === 'projects' ? (
          <div className="page">
            <div className="hint-card">Checking for a previous workspace…</div>
          </div>
        ) : route === 'record' ? null : route === 'edit' ? (
          <EditPage />
        ) : route === 'export' ? (
          <ExportPage />
        ) : route === 'diagnostics' ? (
          <DiagnosticsPanel />
        ) : (
          <ProjectsPage />
        )}
      </main>

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className="toast"
            data-tone={toast.tone}
            onClick={() => dismissToast(toast.id)}
          >
            <span>{toast.message}</span>
            <span aria-hidden>✕</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SessionBadge({
  kind,
  storage,
}: {
  kind: 'none' | 'temporary' | 'saved';
  storage: string;
}) {
  const label = kind === 'saved' ? 'Saved project' : kind === 'temporary' ? 'Temporary session' : 'No session';
  const tone = kind === 'saved' ? 'ok' : kind === 'temporary' ? 'warn' : 'neutral';
  return (
    <span title={storage}>
      <Badge tone={tone}>{label}</Badge>
    </span>
  );
}

function SaveIndicator({
  state,
  lastSavedAt,
  error,
  dirty,
  browserStorage,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: string | null;
  error: string | null;
  dirty: boolean;
  browserStorage?: boolean;
}) {
  if (state === 'saving') return <Badge tone="neutral">Saving…</Badge>;
  if (state === 'error') return <Badge tone="danger" >Save failed: {error ?? 'unknown error'}</Badge>;
  if (dirty) return <Badge tone="warn">Unsaved changes</Badge>;
  if (lastSavedAt) {
    // A project in OPFS is written, but it is not a durable copy on disk.
    return (
      <Badge tone={browserStorage ? 'warn' : 'ok'}>
        {browserStorage ? 'Saved in this browser' : 'Saved'} {new Date(lastSavedAt).toLocaleTimeString()}
      </Badge>
    );
  }
  return null;
}
