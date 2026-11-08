export type RecorderStage =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'finishing'
  | 'review'
  | 'postRecord'
  | 'interrupted'
  | 'recoverable failure'
  | 'recoverable_failure';

export type CapMode = 'instant' | 'studio' | 'screenshot';

export type QuietMode = 'full' | 'compact' | 'controls-only';

export const QUIET_MODES: ReadonlyArray<{ id: QuietMode; label: string; description: string }> = [
  { id: 'full', label: 'Full controls', description: 'Show REC timer, level meters, marker, pause/resume, and stop.' },
  { id: 'compact', label: 'Compact controls', description: 'Condense the control bar to timer, pause/resume, and stop.' },
  { id: 'controls-only', label: 'Controls only', description: 'Minimal pill with elapsed timer and stop.' },
];

export type CameraDuplicationMode = 'baked-in-screen' | 'separate-layer';

const ALLOWED_TRANSITIONS: Record<RecorderStage, ReadonlyArray<RecorderStage>> = {
  idle: ['selecting', 'ready', 'countdown', 'recording', 'interrupted', 'recoverable failure', 'recoverable_failure'],
  selecting: ['ready', 'idle', 'interrupted', 'recoverable failure', 'recoverable_failure'],
  ready: ['countdown', 'recording', 'selecting', 'idle', 'interrupted', 'recoverable failure', 'recoverable_failure'],
  countdown: ['recording', 'ready', 'idle', 'interrupted', 'recoverable failure', 'recoverable_failure'],
  recording: ['paused', 'finalizing', 'finishing', 'interrupted', 'recoverable failure', 'recoverable_failure', 'idle'],
  paused: ['recording', 'finalizing', 'finishing', 'interrupted', 'recoverable failure', 'recoverable_failure', 'idle'],
  finalizing: ['review', 'postRecord', 'interrupted', 'recoverable failure', 'recoverable_failure', 'idle'],
  finishing: ['postRecord', 'review', 'interrupted', 'recoverable failure', 'recoverable_failure', 'idle'],
  review: ['idle', 'selecting', 'ready'],
  postRecord: ['idle', 'selecting', 'ready'],
  interrupted: ['recoverable failure', 'recoverable_failure', 'review', 'postRecord', 'idle', 'selecting'],
  'recoverable failure': ['review', 'postRecord', 'idle', 'selecting', 'ready'],
  recoverable_failure: ['review', 'postRecord', 'idle', 'selecting', 'ready'],
};

export function canTransitionStage(from: RecorderStage, to: RecorderStage): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionRecorderStage(from: RecorderStage, to: RecorderStage): RecorderStage {
  return canTransitionStage(from, to) ? to : from;
}

export function describeCapMode(mode: CapMode): { label: string; subLabel: string; actionLabel: string } {
  switch (mode) {
    case 'instant':
      return {
        label: 'Instant',
        subLabel: 'Stop → Quick Export sheet',
        actionLabel: 'Start Instant Recording',
      };
    case 'studio':
      return {
        label: 'Studio',
        subLabel: 'Stop → Multi-track Editor',
        actionLabel: 'Start Studio Recording',
      };
    case 'screenshot':
      return {
        label: 'Screenshot',
        subLabel: 'Capture frame → Editor',
        actionLabel: 'Capture Screenshot',
      };
  }
}

/**
 * Implements the Phase 3 Camera-Duplication Rule so the exported video
 * contains the presenter camera layer at most once:
 * 1. Display / Window capture with visible floating preview and 'baked-in-screen' default:
 *    The floating bubble is already visible in screen.webm, so do NOT composite the
 *    separate camera track a second time in export (presenter.visible = false), while
 *    still saving raw camera.webm in the project for Studio re-editing.
 * 2. Display / Window capture with 'separate-layer' (or when floating preview is hidden):
 *    Composite the separate camera track in preview and export (presenter.visible = true).
 * 3. Browser tab capture ('tab'):
 *    Single-tab capture never includes the floating PiP window, so composite the
 *    separate camera track in preview and export (presenter.visible = true).
 */
export function resolveCameraLayerVisibility(options: {
  cameraOn: boolean;
  surface: 'screen' | 'window' | 'tab' | null;
  hideFloatingPreview: boolean;
  duplicationMode: CameraDuplicationMode;
}): { compositeInExport: boolean; warning?: string; summary: string } {
  if (!options.cameraOn) {
    return {
      compositeInExport: false,
      summary: 'Camera is off.',
    };
  }
  if (options.surface === 'tab' || options.surface === null) {
    return {
      compositeInExport: true,
      summary: 'Browser tab capture excludes the floating PiP window — camera layer is composited once in preview and export.',
    };
  }
  // Display ('screen') or Window ('window')
  if (options.hideFloatingPreview) {
    return {
      compositeInExport: true,
      summary: 'Floating preview is hidden during capture — separate camera layer is composited once in preview and export.',
    };
  }
  if (options.duplicationMode === 'baked-in-screen') {
    return {
      compositeInExport: false,
      summary: 'Bubble baked into screen capture — raw camera track is stored for Studio re-editing and not composited a second time in export.',
    };
  }
  return {
    compositeInExport: true,
    warning:
      'Separate camera layer is active on Display/Window capture: hide the floating preview during recording so the camera does not appear twice.',
    summary: 'Separate camera layer enabled — composited in preview and export.',
  };
}
