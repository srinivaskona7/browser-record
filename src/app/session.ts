import { create } from 'zustand';
import type { BrowserInfo, FeatureFlags } from '../capabilities/detect';
import { detectBrowser, detectFeatures } from '../capabilities/detect';
import type { BenchmarkResult } from '../capabilities/benchmark';
import type { CodecSupport } from '../capabilities/codecs';
import type { Workspace } from '../workspace/workspace';
import type { StorageMode } from '../workspace/types';

export type Route = 'projects' | 'record' | 'edit' | 'export' | 'diagnostics';

export const ROUTES: Array<{ id: Route; label: string }> = [
  { id: 'projects', label: 'Projects' },
  { id: 'record', label: 'Record' },
  { id: 'edit', label: 'Edit' },
  { id: 'export', label: 'Export' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function routeFromHash(hash: string): Route | null {
  const value = hash.replace(/^#\/?/, '');
  const match = ROUTES.find((item) => item.id === value);
  return match ? match.id : null;
}

/**
 * What the user is looking at, in plain language:
 *  - none: nothing opened yet
 *  - temporary: a session in browser-managed storage (OPFS), evictable
 *  - saved: a project in a folder on disk
 */
export type SessionKind = 'none' | 'temporary' | 'saved';

export function sessionKindOf(
  workspace: { info: { mode: string } } | null,
  hasProject: boolean,
): SessionKind {
  if (!hasProject) return 'none';
  return workspace?.info.mode === 'fsa' ? 'saved' : 'temporary';
}

export function storageDescription(workspace: { info: { name: string; mode: string } } | null): string {
  if (!workspace) return 'No storage selected yet.';
  return workspace.info.mode === 'fsa'
    ? `Stored in the folder “${workspace.info.name}” on this computer.`
    : `Stored in this browser’s storage (${workspace.info.name}). The browser can evict it — export a copy to keep it.`;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

export interface SessionState {
  workspace: Workspace | null;
  workspaceError: string | null;
  projectFolder: string | null;
  route: Route;
  theme: 'dark' | 'light';
  browser: BrowserInfo;
  features: FeatureFlags;
  codecSupport: CodecSupport[];
  benchmark: BenchmarkResult | null;
  benchmarkRunning: boolean;
  storageMode: StorageMode;
  diagnosticsOpen: boolean;
  toasts: Toast[];
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  lastSavedAt: string | null;

  setWorkspace: (workspace: Workspace | null) => void;
  setWorkspaceError: (message: string | null) => void;
  setProjectFolder: (folder: string | null) => void;
  setRoute: (route: Route) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setCodecSupport: (support: CodecSupport[]) => void;
  setBenchmark: (result: BenchmarkResult | null) => void;
  setBenchmarkRunning: (running: boolean) => void;
  setStorageMode: (mode: StorageMode) => void;
  setDiagnosticsOpen: (open: boolean) => void;
  pushToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  setSaveState: (state: SessionState['saveState'], error?: string | null) => void;
}

let toastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function initialTheme(): 'dark' | 'light' {
  if (typeof localStorage === 'undefined') return 'dark';
  const stored = localStorage.getItem('browser-record-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

export const useSession = create<SessionState>((set, get) => ({
  workspace: null,
  workspaceError: null,
  projectFolder: null,
  route: typeof location !== 'undefined' ? routeFromHash(location.hash) ?? 'projects' : 'projects',
  theme: initialTheme(),
  browser: detectBrowser(),
  features: detectFeatures(),
  codecSupport: [],
  benchmark: null,
  benchmarkRunning: false,
  storageMode: 'fsa',
  diagnosticsOpen: false,
  toasts: [],
  saveState: 'idle',
  saveError: null,
  lastSavedAt: null,

  setWorkspace: (workspace) => set({ workspace, workspaceError: null }),
  setWorkspaceError: (workspaceError) => set({ workspaceError }),
  setProjectFolder: (projectFolder) => set({ projectFolder }),
  setRoute: (route) => set({ route }),
  setTheme: (theme) => {
    set({ theme });
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
    if (typeof localStorage !== 'undefined') localStorage.setItem('browser-record-theme', theme);
  },
  setCodecSupport: (codecSupport) => set({ codecSupport }),
  setBenchmark: (benchmark) => set({ benchmark }),
  setBenchmarkRunning: (benchmarkRunning) => set({ benchmarkRunning }),
  setStorageMode: (storageMode) => set({ storageMode }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),

  pushToast: (message, tone = 'info') => {
    toastId += 1;
    const id = toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    const timer = setTimeout(() => {
      toastTimers.delete(id);
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
    }, tone === 'error' ? 9000 : 4500);
    toastTimers.set(id, timer);
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.delete(id);
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
  setSaveState: (saveState, saveError = null) =>
    set({ saveState, saveError, lastSavedAt: saveState === 'saved' ? new Date().toISOString() : get().lastSavedAt }),
}));
