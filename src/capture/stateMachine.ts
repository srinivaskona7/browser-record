export type RecorderStage =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'finishing'
  | 'postRecord';

export type CapMode = 'instant' | 'studio' | 'screenshot';

export type CameraDuplicationMode = 'baked-in-screen' | 'separate-layer';

const ALLOWED_TRANSITIONS: Record<RecorderStage, ReadonlyArray<RecorderStage>> = {
  idle: ['selecting', 'countdown', 'recording'],
  selecting: ['ready', 'idle'],
  ready: ['countdown', 'recording', 'selecting', 'idle'],
  countdown: ['recording', 'idle'],
  recording: ['paused', 'finishing', 'idle'],
  paused: ['recording', 'finishing', 'idle'],
  finishing: ['postRecord', 'idle'],
  postRecord: ['idle', 'selecting'],
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
