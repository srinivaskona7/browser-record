import { create } from 'zustand';
import type { Tick } from '../core/time';
import type { Project, Clip } from './types';
import * as ops from './ops';

export interface HistoryEntry {
  label: string;
  project: Project;
  at: number;
}

export type Clipboard =
  | { kind: 'clips'; clips: Array<{ trackKind: string; clip: Clip }>; atTicks: Tick }
  | null;

const HISTORY_LIMIT = 120;

export interface EditorState {
  project: Project | null;
  selectedClipIds: string[];
  selectedAssetId: string | null;
  selectedCueId: string | null;
  playheadTicks: Tick;
  playing: boolean;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  editMode: ops.EditMode;
  snapping: boolean;
  showSafeAreas: boolean;
  showProxy: boolean;
  previewScale: number;
  panel: 'media' | 'captions' | 'effects';
  /** Incremented on every semantic change; the workspace autosaves on change. */
  revision: number;
  dirty: boolean;
  history: HistoryEntry[];
  future: HistoryEntry[];
  lastAction: string | null;
  toast: { message: string; tone: 'info' | 'error' | 'success' } | null;

  loadProject: (project: Project) => void;
  closeProject: () => void;
  apply: (label: string, fn: (project: Project) => Project) => void;
  undo: () => void;
  redo: () => void;
  setPlayhead: (ticks: Tick) => void;
  setPlaying: (playing: boolean) => void;
  selectClips: (ids: string[], additive?: boolean) => void;
  selectAsset: (id: string | null) => void;
  selectCue: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setEditMode: (mode: ops.EditMode) => void;
  setSnapping: (on: boolean) => void;
  setShowSafeAreas: (on: boolean) => void;
  setShowProxy: (on: boolean) => void;
  setPreviewScale: (scale: number) => void;
  setPanel: (panel: EditorState['panel']) => void;
  setToast: (toast: EditorState['toast']) => void;
  /**
   * Mark the project clean as of the revision that was actually written.
   * Both the revision and the project id must match: opening another project
   * resets the counter, and an in-flight save must not clear its dirty flag.
   */
  markSaved: (savedRevision: number, projectId: string) => void;
  /** Update project fields without a user-visible undo entry (playhead, notes). */
  softUpdate: (fn: (project: Project) => Project) => void;
}

function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selectedClipIds: [],
  selectedAssetId: null,
  selectedCueId: null,
  playheadTicks: 0,
  playing: false,
  zoom: 90,
  editMode: 'overwrite',
  snapping: true,
  showSafeAreas: false,
  showProxy: true,
  previewScale: 0.5,
  panel: 'media',
  revision: 0,
  dirty: false,
  history: [],
  future: [],
  lastAction: null,
  toast: null,

  loadProject: (project) =>
    set({
      project,
      history: [],
      future: [],
      selectedClipIds: [],
      playheadTicks: 0,
      playing: false,
      revision: 0,
      dirty: false,
      lastAction: 'Opened project',
    }),

  closeProject: () =>
    set({
      project: null,
      history: [],
      future: [],
      selectedClipIds: [],
      playheadTicks: 0,
      playing: false,
      dirty: false,
    }),

  apply: (label, fn) => {
    const state = get();
    if (!state.project) return;
    const before = state.project;
    let next: Project;
    try {
      next = fn(before);
    } catch (error) {
      set({ toast: { message: `Edit failed: ${(error as Error).message}`, tone: 'error' } });
      return;
    }
    if (next === before) return;
    const stamped: Project = { ...next, updatedAt: new Date().toISOString() };
    set({
      project: stamped,
      history: [...state.history, { label, project: cloneProject(before), at: Date.now() }].slice(-HISTORY_LIMIT),
      future: [],
      revision: state.revision + 1,
      dirty: true,
      lastAction: label,
    });
  },

  undo: () => {
    const state = get();
    const entry = state.history[state.history.length - 1];
    if (!entry || !state.project) return;
    set({
      project: entry.project,
      history: state.history.slice(0, -1),
      future: [...state.future, { label: entry.label, project: cloneProject(state.project), at: Date.now() }],
      revision: state.revision + 1,
      dirty: true,
      lastAction: `Undo ${entry.label}`,
      selectedClipIds: state.selectedClipIds.filter((id) => ops.findClipById(entry.project, id)),
    });
  },

  redo: () => {
    const state = get();
    const entry = state.future[state.future.length - 1];
    if (!entry || !state.project) return;
    set({
      project: entry.project,
      future: state.future.slice(0, -1),
      history: [...state.history, { label: entry.label, project: cloneProject(state.project), at: Date.now() }],
      revision: state.revision + 1,
      dirty: true,
      lastAction: `Redo ${entry.label}`,
      selectedClipIds: state.selectedClipIds.filter((id) => ops.findClipById(entry.project, id)),
    });
  },

  setPlayhead: (ticks) => set({ playheadTicks: Math.max(0, Math.round(ticks)) }),
  setPlaying: (playing) => set({ playing }),
  selectClips: (ids, additive = false) => {
    const state = get();
    const next = additive ? Array.from(new Set([...state.selectedClipIds, ...ids])) : ids;
    set({ selectedClipIds: next });
  },
  selectAsset: (id) => set({ selectedAssetId: id }),
  selectCue: (id) => set({ selectedCueId: id }),
  setZoom: (zoom) => set({ zoom: Math.min(Math.max(zoom, 10), 800) }),
  setEditMode: (mode) => set({ editMode: mode }),
  setSnapping: (on) => set({ snapping: on }),
  setShowSafeAreas: (on) => set({ showSafeAreas: on }),
  setShowProxy: (on) => set({ showProxy: on }),
  setPreviewScale: (scale) => set({ previewScale: Math.min(Math.max(scale, 0.1), 1) }),
  setPanel: (panel) => set({ panel }),
  setToast: (toast) => set({ toast }),

  markSaved: (savedRevision, projectId) =>
    set((state) => ({ dirty: state.revision !== savedRevision || state.project?.id !== projectId })),

  softUpdate: (fn) => {
    const state = get();
    if (!state.project) return;
    const next = fn(state.project);
    if (next === state.project) return;
    set({ project: next, revision: state.revision + 1 });
  },
}));

/** Convenience for components that need to assert a project is loaded. */
export function requireProject(): Project {
  const project = useEditor.getState().project;
  if (!project) throw new Error('No project loaded');
  return project;
}
