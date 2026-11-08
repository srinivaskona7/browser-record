import { create } from 'zustand';
import type { Tick } from '../core/time';
import type { AlphaMaskProps, Project, Clip } from './types';
import * as ops from './ops';
import {
  NONE_SELECTION,
  createCaptionSelection,
  createClipsSelection,
  createRangeSelection,
  stepBackSelection as stepBackSel,
  type EditorSelection,
  type SelectionOrigin,
} from '../editor/selection';
import { EDITOR_COMMAND_REGISTRY } from '../editor/actions';

export interface HistoryEntry {
  label: string;
  project: Project;
  at: number;
}

export type Clipboard =
  | { kind: 'clips'; clips: Array<{ trackKind: string; clip: Clip }>; atTicks: Tick }
  | null;

const HISTORY_LIMIT = 200;

export interface EditorState {
  project: Project | null;
  selection: EditorSelection;
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
  /** Bypass color grading in preview to compare Original vs Graded. */
  compareOriginal: boolean;
  /** Active specialist workspace view inside EditPage (05..11). */
  workspaceView: '05-timeline' | '06-presenter' | '07-color' | '08-effects' | '09-text' | '10-audio' | '11-planning';
  panel: 'media' | 'captions' | 'effects';
  /** Incremented on every semantic change; the workspace autosaves on change. */
  revision: number;
  dirty: boolean;
  history: HistoryEntry[];
  future: HistoryEntry[];
  lastAction: string | null;
  toast: { message: string; tone: 'info' | 'error' | 'success' } | null;
  /** Snapshot captured at the start of a pointer gesture (one undo entry). */
  gesture: { label: string; before: Project; revision: number } | null;

  loadProject: (project: Project) => void;
  closeProject: () => void;
  apply: (label: string, fn: (project: Project) => Project) => void;
  /** Start a multi-step gesture; every `updateGesture` is one undo entry together. */
  beginGesture: (label: string) => void;
  updateGesture: (fn: (project: Project) => Project) => void;
  endGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  setPlayhead: (ticks: Tick) => void;
  setPlaying: (playing: boolean) => void;
  setSelection: (selection: EditorSelection) => void;
  selectClips: (ids: string[], additive?: boolean, origin?: SelectionOrigin) => void;
  selectRange: (start: Tick, end: Tick, tracks?: 'unlocked' | string[]) => void;
  selectCaption: (cueId: string | null, wordIndex?: number) => void;
  stepBackSelection: () => void;
  runCommand: (commandId: string, arg?: unknown) => boolean;
  selectAsset: (id: string | null) => void;
  selectCue: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setEditMode: (mode: ops.EditMode) => void;
  setSnapping: (on: boolean) => void;
  setShowSafeAreas: (on: boolean) => void;
  setShowProxy: (on: boolean) => void;
  setPreviewScale: (scale: number) => void;
  setCompareOriginal: (on: boolean) => void;
  setWorkspaceView: (view: EditorState['workspaceView']) => void;
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

  // Tool actions bound to the active selection / project
  applyEffect: (effect: string, clipId?: string) => void;
  addTransition: (filterId: string, clipId?: string) => void;
  applyFilter: (filter: string, clipId?: string) => void;
  applyLUT: (table: string, clipId?: string) => void;
  setTextAnimation: (animation: string, clipId?: string) => void;
  applyTextPreset: (name: string, clipId?: string) => void;
  setTextFont: (family: string, clipId?: string) => void;
  setEmphasis: (style: string, clipId?: string) => void;
  setCaptionStyle: (style: string) => void;
  selectSpeedPanelPreset: (preset: string, clipId?: string) => void;
  setMask: (shape: string, clipId?: string, options?: Partial<AlphaMaskProps>) => void;
  applyPlatformPreset: (presetId: string) => void;
}

function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  selection: NONE_SELECTION,
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
  compareOriginal: false,
  workspaceView: '05-timeline',
  panel: 'media',
  revision: 0,
  dirty: false,
  history: [],
  future: [],
  lastAction: null,
  toast: null,
  gesture: null,

  loadProject: (project) =>
    set({
      project,
      selection: NONE_SELECTION,
      gesture: null,
      history: [],
      future: [],
      selectedClipIds: [],
      selectedCueId: null,
      playheadTicks: 0,
      playing: false,
      revision: 0,
      dirty: false,
      lastAction: 'Opened project',
    }),

  closeProject: () =>
    set({
      project: null,
      selection: NONE_SELECTION,
      history: [],
      future: [],
      selectedClipIds: [],
      selectedCueId: null,
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

  beginGesture: (label) => {
    const state = get();
    if (!state.project) return;
    set({ gesture: { label, before: cloneProject(state.project), revision: state.revision } });
  },

  updateGesture: (fn) => {
    const state = get();
    if (!state.project) return;
    let next: Project;
    try {
      next = fn(state.project);
    } catch (error) {
      set({ toast: { message: `Edit failed: ${(error as Error).message}`, tone: 'error' } });
      return;
    }
    if (next === state.project) return;
    set({
      project: { ...next, updatedAt: new Date().toISOString() },
      revision: state.revision + 1,
      dirty: true,
    });
  },

  endGesture: () => {
    const state = get();
    const gesture = state.gesture;
    if (!gesture || !state.project) {
      set({ gesture: null });
      return;
    }
    // Nothing actually changed (a click without a drag): never push an entry.
    if (gesture.revision === state.revision) {
      set({ gesture: null });
      return;
    }
    set({
      gesture: null,
      history: [...state.history, { label: gesture.label, project: gesture.before, at: Date.now() }].slice(-HISTORY_LIMIT),
      future: [],
      lastAction: gesture.label,
    });
  },

  cancelGesture: () => {
    const state = get();
    const gesture = state.gesture;
    if (!gesture) return;
    set({
      gesture: null,
      project: gesture.before,
      revision: state.revision + 1,
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
  setSelection: (selection) =>
    set({
      selection,
      selectedClipIds: selection.kind === 'clips' ? selection.ids : [],
      selectedCueId: selection.kind === 'caption' ? selection.cueId : null,
    }),
  selectClips: (ids, additive = false, origin = 'timeline') => {
    const state = get();
    const nextIds = additive ? Array.from(new Set([...state.selectedClipIds, ...ids])) : ids;
    const selection = createClipsSelection(nextIds, origin);
    set({
      selection,
      selectedClipIds: selection.kind === 'clips' ? selection.ids : [],
      selectedCueId: null,
    });
  },
  selectRange: (start, end, tracks = 'unlocked') => {
    const selection = createRangeSelection(start, end, tracks);
    set({
      selection,
      selectedClipIds: [],
      selectedCueId: null,
    });
  },
  selectCaption: (cueId, wordIndex) => {
    if (!cueId) {
      set({ selection: NONE_SELECTION, selectedClipIds: [], selectedCueId: null });
      return;
    }
    const selection = createCaptionSelection(cueId, wordIndex);
    set({
      selection,
      selectedClipIds: [],
      selectedCueId: cueId,
    });
  },
  stepBackSelection: () => {
    const next = stepBackSel(get().selection);
    get().setSelection(next);
  },
  runCommand: (commandId, arg) => {
    const state = get();
    if (!state.project) return false;
    const cmd = EDITOR_COMMAND_REGISTRY.find((c) => c.id === commandId);
    if (!cmd) return false;
    const eligibility = cmd.isEligible(state.selection, state.project, state.playheadTicks);
    if (!eligibility.ok) return false;
    state.apply(cmd.label, (p) => cmd.run(state.selection, p, state.playheadTicks, arg));
    return true;
  },
  selectAsset: (id) => set({ selectedAssetId: id }),
  selectCue: (id) => {
    if (!id) {
      set({ selection: NONE_SELECTION, selectedCueId: null, selectedClipIds: [] });
    } else {
      set({ selection: createCaptionSelection(id), selectedCueId: id, selectedClipIds: [] });
    }
  },
  setZoom: (zoom) => set({ zoom: Math.min(Math.max(zoom, 10), 800) }),
  setEditMode: (mode) => set({ editMode: mode }),
  setSnapping: (on) => set({ snapping: on }),
  setShowSafeAreas: (on) => set({ showSafeAreas: on }),
  setShowProxy: (on) => set({ showProxy: on }),
  setPreviewScale: (scale) => set({ previewScale: Math.min(Math.max(scale, 0.1), 1) }),
  setCompareOriginal: (on) => set({ compareOriginal: on }),
  setWorkspaceView: (view) => set({ workspaceView: view }),
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

  applyEffect: (effect, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Video effect: ${effect}`, (p) =>
      targetId ? ops.applyEffect(p, targetId, effect) : ops.applyEffect(p, effect),
    );
  },

  addTransition: (filterId, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Transition: ${filterId}`, (p) =>
      targetId ? ops.addTransition(p, targetId, filterId) : ops.addTransition(p, filterId),
    );
  },

  applyFilter: (filter, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Color filter: ${filter}`, (p) =>
      targetId ? ops.applyFilter(p, targetId, filter) : ops.applyFilter(p, filter),
    );
  },

  applyLUT: (table, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`3D LUT: ${table}`, (p) =>
      targetId ? ops.applyLUT(p, targetId, table) : ops.applyLUT(p, table),
    );
  },

  setTextAnimation: (animation, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Text animation: ${animation}`, (p) =>
      targetId ? ops.setTextAnimation(p, targetId, animation) : ops.setTextAnimation(p, animation),
    );
  },

  applyTextPreset: (name, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Text preset: ${name}`, (p) =>
      targetId ? ops.applyTextPreset(p, targetId, name) : ops.applyTextPreset(p, name),
    );
  },

  setTextFont: (family, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Font: ${family}`, (p) =>
      targetId ? ops.setTextFont(p, targetId, family) : ops.setTextFont(p, family),
    );
  },

  setEmphasis: (style, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Emphasis: ${style}`, (p) =>
      targetId ? ops.setEmphasis(p, targetId, style) : ops.setEmphasis(p, style),
    );
  },

  setCaptionStyle: (style) => {
    get().apply(`Caption style: ${style}`, (p) => ops.setCaptionStyle(p, style));
  },

  selectSpeedPanelPreset: (preset, clipId) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Speed curve: ${preset}`, (p) =>
      targetId ? ops.selectSpeedPanelPreset(p, targetId, preset) : ops.selectSpeedPanelPreset(p, preset),
    );
  },

  setMask: (shape, clipId, options) => {
    const targetId = clipId ?? get().selectedClipIds[0];
    get().apply(`Alpha mask: ${shape}`, (p) =>
      targetId ? ops.setMask(p, targetId, shape, options) : ops.setMask(p, shape, options),
    );
  },

  applyPlatformPreset: (presetId) => {
    get().apply(`Platform preset: ${presetId}`, (p) => ops.applyPlatformPreset(p, presetId));
  },
}));

/** Convenience for components that need to assert a project is loaded. */
export function requireProject(): Project {
  const project = useEditor.getState().project;
  if (!project) throw new Error('No project loaded');
  return project;
}
