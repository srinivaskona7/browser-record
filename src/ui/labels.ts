/**
 * User-facing names for presets whose stored id is a code slug.
 *
 * The ids stay in the project file (they are part of the schema); only the UI shows these
 * labels, so a project written by an older build still loads. Every label here is also used
 * for the undo/redo entry, so the history reads in the same words as the button.
 */
import type { ColorLookPreset, PipPreset, ShadowGlowPreset } from '../project/types';

export const COLOR_LOOK_LABELS: Record<ColorLookPreset, string> = {
  neutral: 'Neutral',
  'cinema-teal': 'Cinema teal',
  'warm-creator': 'Warm creator',
  'high-contrast-terminal': 'High-contrast terminal',
  'crisp-daylight': 'Crisp daylight',
  'noir-mono': 'Noir mono',
  'vibrant-reel': 'Vibrant reel',
};

export const PIP_PLACEMENT_LABELS: Record<PipPreset, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
  'floating-center': 'Floating center',
  'cinema-bar': 'Cinema bar',
};

export const SHADOW_GLOW_LABELS: Record<ShadowGlowPreset, string> = {
  none: 'None',
  'soft-card': 'Soft card',
  'deep-studio': 'Deep studio',
  'neon-cyan': 'Neon cyan',
  'neon-amber': 'Neon amber',
};
