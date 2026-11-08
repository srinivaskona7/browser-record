import { TICKS_PER_SECOND, type Tick } from '../core/time';

// ============================================================================
// Coordinate System, Rotation, Time & Color Invariant Utilities
// ============================================================================

export interface NormalizedPoint {
  /** Normalized 0.0 - 1.0, origin top-left (0, 0), +x right, denotes center X. */
  x: number;
  /** Normalized 0.0 - 1.0, origin top-left (0, 0), +y down, denotes center Y. */
  y: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Normalize center coordinates into [0.0, 1.0] with origin at top-left (0,0) and +y down. */
export function normalizeCanvasPoint(x: number, y: number): NormalizedPoint {
  return { x: clamp01(x), y: clamp01(y) };
}

/** Normalize clockwise rotation degrees into [0, 360). */
export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = deg % 360;
  return mod < 0 ? mod + 360 : Object.is(mod, -0) ? 0 : mod;
}

/** Convert timeline ticks to exact timeline seconds (float). */
export function ticksToTimelineSeconds(ticks: Tick): number {
  return ticks / TICKS_PER_SECOND;
}

/** Convert exact timeline seconds (float) to timeline ticks. */
export function timelineSecondsToTicks(seconds: number): Tick {
  return Math.round(seconds * TICKS_PER_SECOND);
}

/** Convert timeline ticks to audio sampling milliseconds (*Ms). */
export function ticksToAudioMs(ticks: Tick): number {
  return (ticks / TICKS_PER_SECOND) * 1000;
}

/** Convert audio sampling milliseconds (*Ms) to timeline ticks. */
export function audioMsToTicks(ms: number): Tick {
  return Math.round((ms / 1000) * TICKS_PER_SECOND);
}

/** Validate and normalize hex colors (#RRGGBB or #RRGGBBAA). */
export function normalizeHexColor(input: string, fallback = '#FFFFFF'): string {
  const trimmed = (input ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{4}$/.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    const a = trimmed[4]!;
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`.toUpperCase();
  }
  return fallback.toUpperCase();
}

function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ============================================================================
// 1. Core Video Effects & Dynamic Motion (148 Video Effects)
//    Tool: applyEffect(effect: string) | Target: video | Neutral: 'none'
// ============================================================================

export type VideoEffectCategory = 'camera-motion' | 'geometric-dynamics' | 'glitch-shader';

export interface VideoEffectSpec {
  id: string;
  name: string;
  category: VideoEffectCategory;
  /** Position jitter / drift amplitude in normalized canvas fraction (0..0.15). */
  shakeAmpX: number;
  shakeAmpY: number;
  /** Oscillation frequency in Hz. */
  frequencyHz: number;
  /** Dynamic zoom pulse delta (-0.4..0.5). */
  zoomDelta: number;
  /** Continuous or oscillating rotation amplitude in degrees. */
  rotationAmpDeg: number;
  /** Continuous spin revolutions per clip (0 for oscillation). */
  spinRevolutions: number;
  /** Mirror flip flags. */
  flipX?: boolean;
  flipY?: boolean;
  /** RGB chromatic aberration offset in normalized width (0..0.03). */
  rgbSplit: number;
  /** Strobe / flash brightness modulation amplitude (0..1). */
  flashAmp: number;
  /** Scanline overlay intensity (0..1). */
  scanlines: number;
  /** Light leak warm overlay intensity (0..1). */
  lightLeak: number;
  /** Lens vignette / optical warp intensity (0..1). */
  vignettePulse: number;
  /** Hue shift oscillation in degrees. */
  hueSwingDeg: number;
}

const CAMERA_MOTION_EFFECT_IDS: readonly string[] = [
  'video_handheld',
  'video_handheld_zoom',
  'video_handheld_flash',
  'video_shake',
  'video_super_shake',
  'video_steady_in',
  'video_steady_out',
  'video_drift_up',
  'video_drift_down',
  'video_drift_left',
  'video_drift_right',
  'video_micro_jitter',
  'video_heavy_quake',
  'video_impact_tremor',
  'video_bass_thump',
  'video_heartbeat_zoom',
  'video_snap_zoom_in',
  'video_snap_zoom_out',
  'video_crash_zoom',
  'video_whip_shake_left',
  'video_whip_shake_right',
  'video_whip_shake_up',
  'video_whip_shake_down',
  'video_dolly_push',
  'video_dolly_pull',
  'video_vertigo_zolly',
  'video_pan_sweep_left',
  'video_pan_sweep_right',
  'video_tilt_rise',
  'video_tilt_drop',
  'video_float_dream',
  'video_cinematic_sway',
  'video_action_cam',
  'video_sprint_bob',
  'video_cockpit_vibration',
  'video_explosion_shock',
  'video_subwoofer_pulse',
  'video_pendulum_cam',
  'video_orbit_sway',
  'video_crane_lift',
  'video_crane_descent',
  'video_gimbal_glide',
  'video_shoulder_rig',
  'video_documentary_walk',
  'video_paparazzi_flash_shake',
  'video_nervous_twitch',
  'video_adrenaline_rush',
  'video_breath_hold',
  'video_zero_gravity',
  'video_turbulence',
]; // 50 camera motion effects

const GEOMETRIC_DYNAMICS_EFFECT_IDS: readonly string[] = [
  'video_roll',
  'video_spin',
  'video_flip',
  'video_bounce',
  'video_wavy',
  'video_roll_ccw',
  'video_spin_fast',
  'video_spin_elastic',
  'video_flip_vertical',
  'video_flip_both',
  'video_mirror_left',
  'video_mirror_right',
  'video_mirror_top',
  'video_mirror_bottom',
  'video_kaleidoscope_quad',
  'video_bounce_hard',
  'video_bounce_jelly',
  'video_rubber_band',
  'video_squash_stretch',
  'video_wavy_horizontal',
  'video_wavy_vertical',
  'video_ripple_pond',
  'video_flag_wave',
  'video_twirl_center',
  'video_vortex_spin',
  'video_pendulum_swing',
  'video_metronome_tick',
  'video_seesaw_tilt',
  'video_orbit_circle',
  'video_figure_eight',
  'video_zigzag_hop',
  'video_spiral_in',
  'video_spiral_out',
  'video_slingshot_snap',
  'video_boomerang_loop',
  'video_accordion_squeeze',
  'video_accordion_expand',
  'video_perspective_tilt_up',
  'video_perspective_tilt_down',
  'video_perspective_lean_left',
  'video_perspective_lean_right',
  'video_cube_tumble',
  'video_card_spin',
  'video_coin_toss',
  'video_domino_fall',
  'video_spring_pop',
  'video_trampoline_jump',
  'video_levitate_bob',
  'video_gyroscope_twist',
]; // 49 geometric dynamics effects

const GLITCH_SHADER_EFFECT_IDS: readonly string[] = [
  'video_rgb_split',
  'video_chromatic_aberration',
  'video_glitch_slice',
  'video_glitch_block',
  'video_vhs_tracking',
  'video_crt_scanlines',
  'video_retro_tv',
  'video_cyber_glitch',
  'video_digital_corrupt',
  'video_pixel_sort',
  'video_mosaic_pulse',
  'video_halftone_dots',
  'video_lens_warp',
  'video_fisheye_bulge',
  'video_barrel_distortion',
  'video_pincushion_pinch',
  'video_anamorphic_flare',
  'video_prism_refract',
  'video_rainbow_dispersion',
  'video_strobe_white',
  'video_strobe_dark',
  'video_strobe_rgb',
  'video_club_flash',
  'video_lightning_strike',
  'video_light_leak_warm',
  'video_light_leak_neon',
  'video_film_burn_edge',
  'video_super8_sprocket',
  'video_vintage_grain',
  'video_dust_scratches',
  'video_sepia_flicker',
  'video_projector_gate',
  'video_night_vision',
  'video_thermal_infrared',
  'video_xray_invert',
  'video_solarize_pulse',
  'video_posterize_pop',
  'video_duotone_cyber',
  'video_neon_edge_glow',
  'video_bloom_halation',
  'video_dreamy_mist',
  'video_radial_zoom_blur',
  'video_motion_ghost',
  'video_echo_trail',
  'video_double_exposure',
  'video_shutter_streak',
  'video_hologram_flicker',
  'video_matrix_code_tint',
  'video_vaporwave_grid',
]; // 49 glitch, distortion & stylized shader effects (50 + 49 + 49 = 148 total)

function formatEffectLabel(id: string): string {
  return id
    .replace(/^video_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildVideoEffectSpec(id: string, category: VideoEffectCategory, index: number): VideoEffectSpec {
  const isShake = id.includes('shake') || id.includes('quake') || id.includes('tremor') || id.includes('jitter') || id.includes('turbulence') || id.includes('vibration');
  const isHandheld = id.includes('handheld') || id.includes('shoulder') || id.includes('walk') || id.includes('sway') || id.includes('float');
  const isZoom = id.includes('zoom') || id.includes('dolly') || id.includes('zolly') || id.includes('push') || id.includes('pull') || id.includes('pulse') || id.includes('thump') || id.includes('steady');
  const isSpin = id.includes('spin') || id.includes('roll') || id.includes('vortex') || id.includes('twirl') || id.includes('spiral') || id.includes('tumble');
  const isBounce = id.includes('bounce') || id.includes('jump') || id.includes('hop') || id.includes('bob') || id.includes('spring') || id.includes('trampoline');
  const isWave = id.includes('wavy') || id.includes('wave') || id.includes('ripple') || id.includes('swing') || id.includes('pendulum');
  const isRgb = id.includes('rgb') || id.includes('chromatic') || id.includes('prism') || id.includes('glitch') || id.includes('vhs') || id.includes('cyber') || id.includes('hologram');
  const isFlash = id.includes('flash') || id.includes('strobe') || id.includes('lightning') || id.includes('flicker');
  const isScan = id.includes('scanline') || id.includes('crt') || id.includes('vhs') || id.includes('retro') || id.includes('hologram') || id.includes('matrix');
  const isLeak = id.includes('leak') || id.includes('burn') || id.includes('flare') || id.includes('bloom') || id.includes('dream');

  return {
    id,
    name: formatEffectLabel(id),
    category,
    shakeAmpX: isShake ? 0.022 + (index % 5) * 0.006 : isHandheld ? 0.008 + (index % 3) * 0.003 : isWave ? 0.014 : 0,
    shakeAmpY: isShake ? 0.02 + (index % 4) * 0.005 : isHandheld ? 0.007 + (index % 3) * 0.003 : isBounce ? 0.035 : 0,
    frequencyHz: isShake ? 9 + (index % 7) * 2 : isBounce ? 3.5 : isHandheld ? 1.8 : 2.5,
    zoomDelta: isZoom ? (id.includes('out') || id.includes('pull') ? -0.16 : 0.18) : isShake ? 0.05 : 0,
    rotationAmpDeg: isWave || isHandheld ? 2.5 + (index % 4) : isShake ? 1.8 : 0,
    spinRevolutions: isSpin ? (id.includes('ccw') ? -1 : id.includes('fast') ? 2 : 1) : 0,
    flipX: id === 'video_flip' || id === 'video_flip_both' || id === 'video_mirror_left' || id === 'video_mirror_right',
    flipY: id === 'video_flip_vertical' || id === 'video_flip_both' || id === 'video_mirror_top' || id === 'video_mirror_bottom',
    rgbSplit: isRgb ? 0.008 + (index % 4) * 0.003 : 0,
    flashAmp: isFlash ? 0.38 + (index % 3) * 0.12 : 0,
    scanlines: isScan ? 0.35 : 0,
    lightLeak: isLeak ? 0.32 : 0,
    vignettePulse: id.includes('lens') || id.includes('fisheye') || id.includes('barrel') || id.includes('pincushion') || id.includes('night_vision') ? 0.45 : 0,
    hueSwingDeg: id.includes('rainbow') || id.includes('vaporwave') || id.includes('thermal') || id.includes('solarize') || id.includes('duotone') ? 90 : 0,
  };
}

export const VIDEO_EFFECTS: readonly VideoEffectSpec[] = [
  ...CAMERA_MOTION_EFFECT_IDS.map((id, idx) => buildVideoEffectSpec(id, 'camera-motion', idx)),
  ...GEOMETRIC_DYNAMICS_EFFECT_IDS.map((id, idx) => buildVideoEffectSpec(id, 'geometric-dynamics', idx)),
  ...GLITCH_SHADER_EFFECT_IDS.map((id, idx) => buildVideoEffectSpec(id, 'glitch-shader', idx)),
];

export const NEUTRAL_VIDEO_EFFECT = 'none' as const;

export function resolveVideoEffect(effect: string | undefined): VideoEffectSpec | null {
  if (!effect || effect === 'none' || effect === 'normal') return null;
  const direct = VIDEO_EFFECTS.find((item) => item.id === effect || item.name.toLowerCase() === effect.toLowerCase());
  if (direct) return direct;
  const normalized = slugifyId(effect);
  const withPrefix = normalized.startsWith('video_') ? normalized : `video_${normalized}`;
  return VIDEO_EFFECTS.find((item) => item.id === normalized || item.id === withPrefix) ?? null;
}

// ============================================================================
// 2. Boundary Video Transitions (51 Filters)
//    Tool: addTransition(filterId: string) | Target: videoBoundary | Neutral: 'normal'
// ============================================================================

export type TransitionMode =
  | 'fade'
  | 'dissolve'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'wipe-radial'
  | 'whip-pan'
  | 'zoom-burst'
  | 'glitch-cut'
  | 'push'
  | 'split'
  | 'spin-wipe'
  | 'page-curl'
  | 'directional-blur';

export interface BoundaryTransitionSpec {
  id: string;
  name: string;
  mode: TransitionMode;
  defaultDurationSeconds: number;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  directionX: -1 | 0 | 1;
  directionY: -1 | 0 | 1;
  zoomScale: number;
  rotationDeg: number;
  flashStrength: number;
  rgbJitter: number;
}

const RAW_BOUNDARY_TRANSITIONS: ReadonlyArray<{ id: string; name: string; mode: TransitionMode; dirX?: -1 | 0 | 1; dirY?: -1 | 0 | 1 }> = [
  { id: 'fade', name: 'Fade to Black', mode: 'fade' },
  { id: 'fade_white', name: 'Fade to White', mode: 'fade' },
  { id: 'dissolve', name: 'Cross Dissolve', mode: 'dissolve' },
  { id: 'film_dissolve', name: 'Film Dissolve', mode: 'dissolve' },
  { id: 'additive_dissolve', name: 'Additive Dissolve', mode: 'dissolve' },
  { id: 'dip_to_black', name: 'Dip to Black', mode: 'fade' },
  { id: 'dip_to_white', name: 'Dip to White', mode: 'fade' },
  { id: 'flash_cut', name: 'Camera Flash Cut', mode: 'fade' },
  { id: 'slide-left', name: 'Slide Left', mode: 'push', dirX: -1 },
  { id: 'slide-right', name: 'Slide Right', mode: 'push', dirX: 1 },
  { id: 'slide_up', name: 'Slide Up', mode: 'push', dirY: -1 },
  { id: 'slide_down', name: 'Slide Down', mode: 'push', dirY: 1 },
  { id: 'push_left', name: 'Push Left', mode: 'push', dirX: -1 },
  { id: 'push_right', name: 'Push Right', mode: 'push', dirX: 1 },
  { id: 'push_up', name: 'Push Up', mode: 'push', dirY: -1 },
  { id: 'push_down', name: 'Push Down', mode: 'push', dirY: 1 },
  { id: 'wipe', name: 'Linear Wipe Right', mode: 'wipe-right', dirX: 1 },
  { id: 'wipe_left', name: 'Linear Wipe Left', mode: 'wipe-left', dirX: -1 },
  { id: 'wipe_top', name: 'Linear Wipe Top', mode: 'wipe-up', dirY: -1 },
  { id: 'wipe_bottom', name: 'Linear Wipe Bottom', mode: 'wipe-down', dirY: 1 },
  { id: 'wipe_radial_cw', name: 'Radial Clock Wipe CW', mode: 'wipe-radial' },
  { id: 'wipe_radial_ccw', name: 'Radial Clock Wipe CCW', mode: 'wipe-radial' },
  { id: 'iris_circle_in', name: 'Iris Circle Open', mode: 'wipe-radial' },
  { id: 'iris_circle_out', name: 'Iris Circle Close', mode: 'wipe-radial' },
  { id: 'iris_diamond', name: 'Iris Diamond Reveal', mode: 'wipe-radial' },
  { id: 'split_horizontal', name: 'Barn Door Horizontal Split', mode: 'split', dirX: 1 },
  { id: 'split_vertical', name: 'Barn Door Vertical Split', mode: 'split', dirY: 1 },
  { id: 'split_diagonal', name: 'Diagonal Slash Split', mode: 'split', dirX: 1, dirY: 1 },
  { id: 'whip_pan_left', name: 'Whip Pan Left', mode: 'whip-pan', dirX: -1 },
  { id: 'whip_pan_right', name: 'Whip Pan Right', mode: 'whip-pan', dirX: 1 },
  { id: 'whip_pan_up', name: 'Whip Pan Up', mode: 'whip-pan', dirY: -1 },
  { id: 'whip_pan_down', name: 'Whip Pan Down', mode: 'whip-pan', dirY: 1 },
  { id: 'zoom_burst_in', name: 'Zoom Burst In', mode: 'zoom-burst' },
  { id: 'zoom_burst_out', name: 'Zoom Burst Out', mode: 'zoom-burst' },
  { id: 'zoom_warp_spin', name: 'Zoom Warp Spin', mode: 'zoom-burst' },
  { id: 'hyper_zoom_through', name: 'Hyper Zoom Through', mode: 'zoom-burst' },
  { id: 'glitch_cut_rgb', name: 'RGB Glitch Cut', mode: 'glitch-cut' },
  { id: 'glitch_datamosh', name: 'Datamosh Pixel Cut', mode: 'glitch-cut' },
  { id: 'glitch_vhs_snap', name: 'VHS Tape Snap', mode: 'glitch-cut' },
  { id: 'glitch_cyber_slice', name: 'Cyber Slice Transition', mode: 'glitch-cut' },
  { id: 'glitch_static_burst', name: 'Static Noise Burst', mode: 'glitch-cut' },
  { id: 'spin_wipe_cw', name: 'Spin Wipe Clockwise', mode: 'spin-wipe' },
  { id: 'spin_wipe_ccw', name: 'Spin Wipe Counter-Clockwise', mode: 'spin-wipe' },
  { id: 'pendulum_swing_wipe', name: 'Pendulum Swing Transition', mode: 'spin-wipe' },
  { id: 'page_curl_left', name: 'Page Curl Left', mode: 'page-curl', dirX: -1 },
  { id: 'page_curl_right', name: 'Page Curl Right', mode: 'page-curl', dirX: 1 },
  { id: 'page_peel_corner', name: 'Page Peel Top Corner', mode: 'page-curl', dirX: -1, dirY: 1 },
  { id: 'directional_blur_left', name: 'Directional Motion Blur Left', mode: 'directional-blur', dirX: -1 },
  { id: 'directional_blur_right', name: 'Directional Motion Blur Right', mode: 'directional-blur', dirX: 1 },
  { id: 'directional_blur_up', name: 'Directional Motion Blur Up', mode: 'directional-blur', dirY: -1 },
  { id: 'directional_blur_down', name: 'Directional Motion Blur Down', mode: 'directional-blur', dirY: 1 },
]; // 51 boundary transitions

export const BOUNDARY_TRANSITIONS: readonly BoundaryTransitionSpec[] = RAW_BOUNDARY_TRANSITIONS.map((item) => ({
  id: item.id,
  name: item.name,
  mode: item.mode,
  defaultDurationSeconds: item.mode === 'whip-pan' || item.mode === 'glitch-cut' ? 0.35 : 0.5,
  easing: item.mode === 'whip-pan' || item.mode === 'zoom-burst' ? 'ease-in-out' : 'ease-out',
  directionX: item.dirX ?? 0,
  directionY: item.dirY ?? 0,
  zoomScale: item.mode === 'zoom-burst' ? (item.id.includes('out') ? 0.65 : 1.45) : 1,
  rotationDeg: item.mode === 'spin-wipe' ? (item.id.includes('ccw') ? -180 : 180) : item.id.includes('spin') ? 90 : 0,
  flashStrength: item.id.includes('white') || item.id.includes('flash') || item.id.includes('additive') ? 0.85 : 0,
  rgbJitter: item.mode === 'glitch-cut' ? 0.018 : 0,
}));

export const NEUTRAL_TRANSITION = 'normal' as const;

export function resolveBoundaryTransition(filterId: string | undefined): BoundaryTransitionSpec | null {
  if (!filterId || filterId === 'normal' || filterId === 'none') return null;
  const direct = BOUNDARY_TRANSITIONS.find(
    (item) => item.id === filterId || item.name.toLowerCase() === filterId.toLowerCase(),
  );
  if (direct) return direct;
  const slug = slugifyId(filterId);
  return BOUNDARY_TRANSITIONS.find((item) => slugifyId(item.id) === slug || slugifyId(item.name) === slug) ?? null;
}

// ============================================================================
// 3A. Color Grading Filters (77 Presets)
//     Tool: applyFilter(filter: string) | Target: video | Neutral: 'normal'
// ============================================================================

export interface ColorFilterSpec {
  id: string;
  name: string;
  brightness: number;
  contrast: number;
  exposure: number;
  saturation: number;
  temperature: number;
  vibrance: number;
  sepia: number;
  hueRotateDeg: number;
  tintHex: string;
  tintOpacity: number;
  vignette: number;
}

const COLOR_FILTER_NAMES: readonly string[] = [
  'Analog Film',
  'Warm Glow',
  'Cool Breeze',
  'Cyberpunk Teal & Orange',
  'Moody Noir',
  'Vintage Polaroid',
  'Monochromatic High Contrast',
  'Golden Hour',
  'Kodak Gold 200',
  'Fuji Velvia 50',
  'Portra 400 Warm',
  'CineStill 800T',
  'Ilford HP5 Mono',
  'Tri-X 400 Grit',
  'Nordic Frost',
  'Desert Mirage',
  'Tokyo Neon Night',
  'Blade Runner Cyan',
  'Sunset Boulevard',
  'Pacific Coast Haze',
  'Autumn Amber',
  'Emerald Forest',
  'Deep Ocean Blue',
  'Midnight Indigo',
  'Pastel Peach',
  'Rose Quartz Tint',
  'Lavender Dream',
  'Mint Cream',
  'Matcha Latte',
  'Espresso Roast',
  'Sepia Heritage',
  'Daguerreotype Silver',
  'Bleach Bypass',
  'Cross Process Green',
  'Cross Process Magenta',
  'Technicolor Two-Strip',
  'Technicolor Three-Strip',
  'VHS Faded Tape',
  'Super 8 Warmth',
  '16mm Indie Grain',
  '70s Retro Summer',
  '80s Synthwave',
  '90s Grunge Matte',
  'Y2K Chrome Cool',
  'Crisp Studio Daylight',
  'Tungsten Indoor Balance',
  'Fluorescent Clean',
  'High Key Commercial',
  'Low Key Thriller',
  'Silver Screen Classic',
  'Noir Detective',
  'Graphite Matte',
  'Charcoal Crush',
  'Alabaster Soft',
  'Ivory Silk',
  'Sunburst Vitality',
  'Tropical Punch',
  'Coral Reef',
  'Miami Vice Pastel',
  'Sahara Dust',
  'Arctic Glacier',
  'Stormy Slate',
  'Rainy London',
  'Parisian Cafe',
  'Tuscan Vineyard',
  'Santorini Azure',
  'Kyoto Cherry Blossom',
  'Havana Sun',
  'Brooklyn Loft',
  'Silicon Valley Clean',
  'DevOps Dark Matrix',
  'Terminal Phosphor Green',
  'Amber CRT Monitor',
  'Blueprint Cyanotype',
  'Infrared False Color',
  'Solarized Bronze',
  'Velvet Twilight',
]; // 77 color grading filters

export const COLOR_FILTERS: readonly ColorFilterSpec[] = COLOR_FILTER_NAMES.map((name, idx) => {
  const id = slugifyId(name);
  const lower = name.toLowerCase();
  const isMono = lower.includes('noir') || lower.includes('mono') || lower.includes('hp5') || lower.includes('tri-x') || lower.includes('silver') || lower.includes('graphite') || lower.includes('charcoal');
  const isWarm = lower.includes('warm') || lower.includes('golden') || lower.includes('gold') || lower.includes('sunset') || lower.includes('autumn') || lower.includes('amber') || lower.includes('desert') || lower.includes('sahara') || lower.includes('havana') || lower.includes('super 8');
  const isCool = lower.includes('cool') || lower.includes('frost') || lower.includes('arctic') || lower.includes('ocean') || lower.includes('midnight') || lower.includes('azure') || lower.includes('blade') || lower.includes('slate');
  const isCyber = lower.includes('cyberpunk') || lower.includes('neon') || lower.includes('synthwave') || lower.includes('cinestill') || lower.includes('miami');
  const isVintage = lower.includes('vintage') || lower.includes('analog') || lower.includes('polaroid') || lower.includes('sepia') || lower.includes('70s') || lower.includes('vhs');

  return {
    id,
    name,
    brightness: isMono ? -0.03 : isWarm ? 0.04 : ((idx % 5) - 2) * 0.015,
    contrast: isMono ? 0.34 : isCyber ? 0.24 : isVintage ? -0.06 : 0.1 + (idx % 4) * 0.03,
    exposure: isWarm ? 0.05 : isCool ? -0.02 : 0,
    saturation: isMono ? -1 : isCyber ? 0.35 : isVintage ? -0.18 : isWarm ? 0.15 : 0.08,
    temperature: isWarm ? 0.28 : isCool ? -0.26 : isVintage ? 0.18 : 0,
    vibrance: isMono ? -1 : isCyber ? 0.32 : 0.12,
    sepia: isVintage ? 0.28 : isWarm ? 0.1 : 0,
    hueRotateDeg: isCyber ? -12 : isCool ? -8 : isWarm ? 6 : 0,
    tintHex: isCyber ? '#00E5FF' : isWarm ? '#FFB703' : isCool ? '#3A86FF' : isVintage ? '#E0A96D' : '#FFFFFF',
    tintOpacity: isMono ? 0 : 0.08,
    vignette: isMono || isVintage ? 0.32 : 0.12,
  };
});

export const NEUTRAL_COLOR_FILTER = 'normal' as const;

export function resolveColorFilter(filter: string | undefined): ColorFilterSpec | null {
  if (!filter || filter === 'normal' || filter === 'none') return null;
  const slug = slugifyId(filter);
  return (
    COLOR_FILTERS.find(
      (item) => item.id === filter || item.id === slug || item.name.toLowerCase() === filter.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 3B. Look-Up Tables (16 Cinematic 3D LUTs)
//     Tool: applyLUT(table: string) | Target: video, adjustmentLayer
// ============================================================================

export interface CinematicLutSpec {
  id: string;
  name: string;
  description: string;
  contrast: number;
  saturation: number;
  temperature: number;
  gamma: number;
  shadowsHex: string;
  highlightsHex: string;
  tintStrength: number;
}

export const CINEMATIC_LUTS: readonly CinematicLutSpec[] = [
  {
    id: 'rec709_standard',
    name: 'Rec.709 Standard Conversion',
    description: 'Neutral broadcast Rec.709 color space conversion with balanced roll-off.',
    contrast: 0.12,
    saturation: 0.08,
    temperature: 0,
    gamma: 1.0,
    shadowsHex: '#0D131A',
    highlightsHex: '#FFFDF9',
    tintStrength: 0.06,
  },
  {
    id: 'hollywood_blockbuster',
    name: 'Hollywood Blockbuster Teal & Orange',
    description: 'Cinema grade with deep teal shadows and warm skin-tone highlights.',
    contrast: 0.26,
    saturation: 0.18,
    temperature: 0.14,
    gamma: 0.96,
    shadowsHex: '#072A3A',
    highlightsHex: '#FFB36B',
    tintStrength: 0.18,
  },
  {
    id: 'kodachrome_64_vintage',
    name: 'Kodachrome 64 Vintage',
    description: 'Rich archival slide film emulation with warm reds and crisp micro-contrast.',
    contrast: 0.22,
    saturation: 0.12,
    temperature: 0.22,
    gamma: 0.98,
    shadowsHex: '#1C140D',
    highlightsHex: '#FFE4B5',
    tintStrength: 0.15,
  },
  {
    id: 'fuji_pro_400h',
    name: 'Fuji Pro 400H Overexposed',
    description: 'Airy pastel highlights with soft mint-cyan midtones.',
    contrast: -0.04,
    saturation: 0.06,
    temperature: -0.06,
    gamma: 1.08,
    shadowsHex: '#182428',
    highlightsHex: '#F4FFF8',
    tintStrength: 0.12,
  },
  {
    id: 'sony_slog3_to_rec709',
    name: 'Sony S-Log3 to Rec.709',
    description: 'Log profile restoration expanding dynamic range and normalizing contrast.',
    contrast: 0.34,
    saturation: 0.28,
    temperature: 0.02,
    gamma: 0.92,
    shadowsHex: '#0A0E14',
    highlightsHex: '#FFFFFF',
    tintStrength: 0.05,
  },
  {
    id: 'arri_logc_alexa',
    name: 'ARRI LogC to Alexa Classic 709',
    description: 'Signature Alexa filmic highlight roll-off and natural color science.',
    contrast: 0.28,
    saturation: 0.22,
    temperature: 0.04,
    gamma: 0.95,
    shadowsHex: '#0E141B',
    highlightsHex: '#FFF9F0',
    tintStrength: 0.08,
  },
  {
    id: 'canon_clog2_cinema',
    name: 'Canon C-Log2 Cinema EOS',
    description: 'Warm organic skin reproduction from C-Log2 flat profiles.',
    contrast: 0.3,
    saturation: 0.24,
    temperature: 0.08,
    gamma: 0.94,
    shadowsHex: '#141118',
    highlightsHex: '#FFF5EB',
    tintStrength: 0.09,
  },
  {
    id: 'red_ipp2_dragon',
    name: 'RED IPP2 Filmic Tone Map',
    description: 'High-contrast cinema punch with controlled highlight retention.',
    contrast: 0.32,
    saturation: 0.2,
    temperature: -0.02,
    gamma: 0.93,
    shadowsHex: '#090D16',
    highlightsHex: '#F7FAFF',
    tintStrength: 0.1,
  },
  {
    id: 'panasonic_vlog_natural',
    name: 'Panasonic V-Log Natural 709',
    description: 'True-to-life V-Log correction with clean neutral grays.',
    contrast: 0.29,
    saturation: 0.24,
    temperature: 0,
    gamma: 0.95,
    shadowsHex: '#101418',
    highlightsHex: '#FFFFFF',
    tintStrength: 0.05,
  },
  {
    id: 'apple_log_prores',
    name: 'Apple Log ProRes Studio',
    description: 'Calibrated LUT for iPhone & macOS ProRes Log captures.',
    contrast: 0.31,
    saturation: 0.25,
    temperature: 0.03,
    gamma: 0.94,
    shadowsHex: '#0E131A',
    highlightsHex: '#FFFDF8',
    tintStrength: 0.07,
  },
  {
    id: 'kodak_2383_print',
    name: 'Kodak Vision3 2383 Print Film',
    description: 'Industry-standard motion picture print stock with dense blacks and golden warmth.',
    contrast: 0.27,
    saturation: 0.16,
    temperature: 0.16,
    gamma: 0.94,
    shadowsHex: '#0B1622',
    highlightsHex: '#FFE8C2',
    tintStrength: 0.16,
  },
  {
    id: 'fuji_eterna_3513',
    name: 'Fuji Eterna 3513DI Cinema',
    description: 'Subtle cinematic contrast with muted shadows and rich cyan-greens.',
    contrast: 0.16,
    saturation: -0.05,
    temperature: -0.08,
    gamma: 1.02,
    shadowsHex: '#0E2226',
    highlightsHex: '#EBF7F5',
    tintStrength: 0.14,
  },
  {
    id: 'bleach_bypass_silver',
    name: 'Silver Retention Bleach Bypass',
    description: 'Gritty desaturated metallic look with steep luminance contrast.',
    contrast: 0.38,
    saturation: -0.45,
    temperature: -0.05,
    gamma: 0.9,
    shadowsHex: '#080A0C',
    highlightsHex: '#E6ECF2',
    tintStrength: 0.12,
  },
  {
    id: 'cyber_matrix_neon',
    name: 'Cyberpunk Matrix Green-Cyan 3D',
    description: 'Stylized sci-fi LUT shifting midtones toward emerald and electric cyan.',
    contrast: 0.25,
    saturation: 0.22,
    temperature: -0.2,
    gamma: 0.96,
    shadowsHex: '#041F1E',
    highlightsHex: '#A8FFDB',
    tintStrength: 0.22,
  },
  {
    id: 'nordic_thriller_cold',
    name: 'Scandi Noir Cold Slate 3D',
    description: 'Steely blue-gray drama grade with crisp shadow separation.',
    contrast: 0.24,
    saturation: -0.22,
    temperature: -0.28,
    gamma: 0.95,
    shadowsHex: '#0B192C',
    highlightsHex: '#DCE8F5',
    tintStrength: 0.18,
  },
  {
    id: 'golden_hour_anamorphic',
    name: 'Anamorphic Sunset Gold 3D',
    description: 'Lush amber-gold magic hour grade with creamy shadow lift.',
    contrast: 0.18,
    saturation: 0.24,
    temperature: 0.32,
    gamma: 1.03,
    shadowsHex: '#26150A',
    highlightsHex: '#FFD27D',
    tintStrength: 0.2,
  },
]; // 16 cinematic 3D LUTs

const CUSTOM_CUBE_LUTS = new Map<string, CinematicLutSpec>();

export function registerCustomCubeLut(spec: CinematicLutSpec): CinematicLutSpec {
  CUSTOM_CUBE_LUTS.set(spec.id, spec);
  return spec;
}

export function getCustomCubeLuts(): CinematicLutSpec[] {
  return Array.from(CUSTOM_CUBE_LUTS.values());
}

function rgbFloatToHex(r: number, g: number, b: number): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `#${[toByte(r), toByte(g), toByte(b)].map((bVal) => bVal.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Parse a standard Adobe / Resolve `.cube` 3D LUT file and register it as a
 * `CinematicLutSpec` so both preview and export apply its color transform.
 */
export function parseCubeLut(content: string, fallbackName = 'Custom 3D LUT'): CinematicLutSpec {
  let title = fallbackName.replace(/\.cube$/i, '').trim() || 'Custom 3D LUT';
  const triplets: Array<[number, number, number]> = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const titleMatch = /^TITLE\s+"?([^"]+)"?$/i.exec(line);
    if (titleMatch) {
      title = titleMatch[1]!.trim() || title;
      continue;
    }
    if (/^(LUT_3D_SIZE|LUT_1D_SIZE|DOMAIN_MIN|DOMAIN_MAX)\b/i.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      triplets.push([clamp01(parts[0]!), clamp01(parts[1]!), clamp01(parts[2]!)]);
    }
  }
  const first = triplets[0] ?? [0.04, 0.05, 0.08];
  const last = triplets[triplets.length - 1] ?? [0.98, 0.96, 0.92];
  const mid = triplets[Math.floor(triplets.length / 2)] ?? [0.5, 0.5, 0.5];
  const lumaMid = 0.2126 * mid[0] + 0.7152 * mid[1] + 0.0722 * mid[2];
  const lumaSpan = Math.max(0.1, (0.2126 * last[0] + 0.7152 * last[1] + 0.0722 * last[2]) - (0.2126 * first[0] + 0.7152 * first[1] + 0.0722 * first[2]));
  const spec: CinematicLutSpec = {
    id: `cube_${slugifyId(title) || 'custom'}`,
    name: title,
    description: `Imported .cube 3D LUT (${triplets.length} lattice points).`,
    contrast: Number(Math.max(-0.4, Math.min(0.6, (lumaSpan - 0.85) * 0.8)).toFixed(2)),
    saturation: Number(Math.max(-0.5, Math.min(0.5, (Math.max(...mid) - Math.min(...mid)) * 0.6)).toFixed(2)),
    temperature: Number(Math.max(-0.5, Math.min(0.5, (last[0] - last[2]) * 0.5)).toFixed(2)),
    gamma: Number(Math.max(0.75, Math.min(1.3, 0.5 + lumaMid)).toFixed(2)),
    shadowsHex: rgbFloatToHex(first[0], first[1], first[2]),
    highlightsHex: rgbFloatToHex(last[0], last[1], last[2]),
    tintStrength: 0.16,
  };
  return registerCustomCubeLut(spec);
}

export function resolveCinematicLut(table: string | undefined): CinematicLutSpec | null {
  if (!table || table === 'none' || table === 'normal') return null;
  if (CUSTOM_CUBE_LUTS.has(table)) return CUSTOM_CUBE_LUTS.get(table)!;
  const slug = slugifyId(table);
  for (const custom of CUSTOM_CUBE_LUTS.values()) {
    if (custom.id === slug || custom.name.toLowerCase() === table.toLowerCase()) return custom;
  }
  return (
    CINEMATIC_LUTS.find(
      (item) => item.id === table || item.id === slug || item.name.toLowerCase() === table.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 4A. Kinetic Typography Animations (77 Text Animations)
//     Tool: setTextAnimation(animation: string) | Target: text | Neutral: 'none'
// ============================================================================

export type TextAnimationBehavior =
  | 'typewriter'
  | 'word-bounce'
  | 'fade-zoom'
  | 'kinetic-pop'
  | 'slide-blur'
  | 'split-reveal'
  | 'karaoke'
  | 'wave'
  | 'glitch'
  | 'spin-in';

export interface TextAnimationSpec {
  id: string;
  name: string;
  behavior: TextAnimationBehavior;
  entranceFraction: number;
  offsetX: number;
  offsetY: number;
  initialScale: number;
  rotationDeg: number;
}

const TEXT_ANIMATION_NAMES: readonly string[] = [
  'Typewriter',
  'Word Bounce',
  'Fade Zoom',
  'Kinetic Pop',
  'Slide & Blur',
  'Split Reveal',
  'Karaoke Word Reveal',
  'Typewriter Terminal Cursor',
  'Typewriter Fast Burst',
  'Typewriter Glitch Key',
  'Word Bounce Elastic',
  'Word Bounce Gravity',
  'Word Cascade Drop',
  'Word Escalator Rise',
  'Letter Wave Sine',
  'Letter Ripple Out',
  'Letter Tornado Spin',
  'Letter Accordion Expand',
  'Letter Magnet Snap',
  'Fade Zoom In Soft',
  'Fade Zoom Out Dramatic',
  'Hyper Zoom Slam',
  'Elastic Pop In',
  'Spring Overshoot Pop',
  'Bubble Inflate Pop',
  'Heartbeat Text Pulse',
  'Neon Flicker On',
  'Strobe Title Flash',
  'Slide Left Smooth',
  'Slide Right Smooth',
  'Slide Up Crisp',
  'Slide Down Crisp',
  'Whip Slide Left',
  'Whip Slide Right',
  'Whip Slide Up',
  'Whip Slide Down',
  'Blur Dissolve In',
  'Directional Blur Left',
  'Directional Blur Right',
  'Directional Blur Up',
  'Split Center Horizontal',
  'Split Center Vertical',
  'Curtain Open Reveal',
  'Mask Wipe Left to Right',
  'Mask Wipe Right to Left',
  'Mask Wipe Bottom Up',
  'Mask Wipe Top Down',
  'Diagonal Slash Reveal',
  'Flip 3D Up',
  'Flip 3D Down',
  'Swivel 3D Left',
  'Swivel 3D Right',
  'Tumble In 360',
  'Spin Zoom Spiral',
  'Pendulum Drop Swing',
  'Hinge Drop Corner',
  'Slingshot Stretch In',
  'Rubber Band Snap',
  'Jello Wiggle',
  'Tectonic Shake Entry',
  'Glitch RGB Slice',
  'Cyberpunk Decode Scrambler',
  'Matrix Binary Reveal',
  'VHS Tracking Jitter',
  'Hologram Beam In',
  'Karaoke Box Highlight',
  'Karaoke Fill Sweep',
  'Karaoke Glow Bounce',
  'Subtle Documentary Fade',
  'Cinema Slow Track Out',
  'Cinema Letterhead Expand',
  'Editorial Baseline Rise',
  'News Ticker Crawl',
  'Marquee Loop Left',
  'Floating Zero-G Drift',
  'Wave Crest Undulate',
  'Sparkle Burst Entrance',
]; // 77 text animations

export const TEXT_ANIMATIONS: readonly TextAnimationSpec[] = TEXT_ANIMATION_NAMES.map((name) => {
  const id = slugifyId(name);
  const lower = name.toLowerCase();
  let behavior: TextAnimationBehavior = 'kinetic-pop';
  if (lower.includes('typewriter') || lower.includes('decode') || lower.includes('binary')) behavior = 'typewriter';
  else if (lower.includes('karaoke')) behavior = 'karaoke';
  else if (lower.includes('bounce') || lower.includes('cascade') || lower.includes('escalator') || lower.includes('spring') || lower.includes('rubber') || lower.includes('jello')) behavior = 'word-bounce';
  else if (lower.includes('zoom') || lower.includes('track') || lower.includes('fade')) behavior = 'fade-zoom';
  else if (lower.includes('slide') || lower.includes('whip') || lower.includes('blur') || lower.includes('ticker') || lower.includes('marquee') || lower.includes('baseline')) behavior = 'slide-blur';
  else if (lower.includes('split') || lower.includes('curtain') || lower.includes('wipe') || lower.includes('slash')) behavior = 'split-reveal';
  else if (lower.includes('wave') || lower.includes('ripple') || lower.includes('drift') || lower.includes('undulate')) behavior = 'wave';
  else if (lower.includes('glitch') || lower.includes('vhs') || lower.includes('hologram') || lower.includes('neon') || lower.includes('strobe') || lower.includes('shake')) behavior = 'glitch';
  else if (lower.includes('spin') || lower.includes('tumble') || lower.includes('flip') || lower.includes('swivel') || lower.includes('pendulum') || lower.includes('hinge') || lower.includes('tornado')) behavior = 'spin-in';

  return {
    id,
    name,
    behavior,
    entranceFraction: behavior === 'typewriter' || behavior === 'karaoke' ? 0.65 : 0.3,
    offsetX: lower.includes('left') ? -0.18 : lower.includes('right') ? 0.18 : 0,
    offsetY: lower.includes('up') || lower.includes('rise') ? 0.14 : lower.includes('down') || lower.includes('drop') ? -0.14 : 0,
    initialScale: behavior === 'fade-zoom' || behavior === 'kinetic-pop' ? (lower.includes('out') || lower.includes('slam') ? 1.55 : 0.6) : 1,
    rotationDeg: behavior === 'spin-in' ? 35 : 0,
  };
});

export function resolveTextAnimation(animation: string | undefined): TextAnimationSpec | null {
  if (!animation || animation === 'none' || animation === 'normal') return null;
  const slug = slugifyId(animation);
  return (
    TEXT_ANIMATIONS.find(
      (item) => item.id === animation || item.id === slug || item.name.toLowerCase() === animation.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 4B. Text Style Presets (34 Presets)
//     Tool: applyTextPreset(name: string) | Target: text
// ============================================================================

export interface TextStylePresetSpec {
  id: string;
  name: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  gradientToColor?: string;
  background: string;
  backgroundOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  glowColor?: string;
  glowBlur?: number;
  letterSpacing: number;
}

export const TEXT_STYLE_PRESETS: readonly TextStylePresetSpec[] = [
  { id: 'neon_cyber_glow', name: 'Neon Cyber Glow', fontFamily: 'Orbitron', fontWeight: 800, fontSize: 96, color: '#00F5D4', gradientToColor: '#00BBF9', background: '#0B0F19', backgroundOpacity: 0.4, strokeColor: '#00F5D4', strokeWidth: 2, shadowColor: '#00F5D4', shadowBlur: 28, glowColor: '#00F5D4', glowBlur: 32, letterSpacing: 2 },
  { id: 'viral_hormozi_gold', name: 'Viral Creator Gold', fontFamily: 'Montserrat', fontWeight: 900, fontSize: 110, color: '#FFD166', gradientToColor: '#FCA311', background: '#000000', backgroundOpacity: 0, strokeColor: '#000000', strokeWidth: 10, shadowColor: '#000000', shadowBlur: 18, letterSpacing: 1 },
  { id: 'mrbeast_impact_pop', name: 'Challenge Impact Pop', fontFamily: 'Anton', fontWeight: 900, fontSize: 120, color: '#FFFFFF', gradientToColor: '#38B000', background: '#000000', backgroundOpacity: 0, strokeColor: '#000000', strokeWidth: 12, shadowColor: '#000000', shadowBlur: 22, letterSpacing: 1.5 },
  { id: 'devops_terminal_green', name: 'DevOps Terminal Matrix', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 54, color: '#7EE787', background: '#0D1117', backgroundOpacity: 0.92, strokeColor: '#238636', strokeWidth: 1, shadowColor: '#000000', shadowBlur: 16, glowColor: '#3FB950', glowBlur: 12, letterSpacing: 0.5 },
  { id: 'apple_keynote_clean', name: 'Keynote Minimal Gradient', fontFamily: 'Inter', fontWeight: 800, fontSize: 104, color: '#FFFFFF', gradientToColor: '#A5B4FC', background: '#000000', backgroundOpacity: 0, strokeColor: '#000000', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 24, letterSpacing: -1 },
  { id: 'sunset_dual_gradient', name: 'Sunset Dual-Tone Gradient', fontFamily: 'Poppins', fontWeight: 800, fontSize: 98, color: '#FF5E7E', gradientToColor: '#FFBE0B', background: '#000000', backgroundOpacity: 0, strokeColor: '#1A1A2E', strokeWidth: 4, shadowColor: '#FF006E', shadowBlur: 20, letterSpacing: 0.5 },
  { id: 'electric_magenta_stroke', name: 'Electric Magenta Stroke', fontFamily: 'Bebas Neue', fontWeight: 800, fontSize: 116, color: '#FF007F', gradientToColor: '#7928CA', background: '#000000', backgroundOpacity: 0, strokeColor: '#FFFFFF', strokeWidth: 4, shadowColor: '#FF007F', shadowBlur: 26, glowColor: '#FF007F', glowBlur: 24, letterSpacing: 2 },
  { id: 'cinema_serif_gold', name: 'Cinema Serif Prestige', fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 92, color: '#F6E27F', gradientToColor: '#D4AF37', background: '#000000', backgroundOpacity: 0.35, strokeColor: '#2B2118', strokeWidth: 2, shadowColor: '#000000', shadowBlur: 20, letterSpacing: 3 },
  { id: 'glass_pill_badge', name: 'Glassmorphic Pill Badge', fontFamily: 'Plus Jakarta Sans', fontWeight: 700, fontSize: 64, color: '#F8FAFC', background: '#1E293B', backgroundOpacity: 0.78, strokeColor: '#38BDF8', strokeWidth: 2, shadowColor: '#0F172A', shadowBlur: 20, letterSpacing: 0.5 },
  { id: 'synthwave_chrome_80s', name: '80s Synthwave Chrome', fontFamily: 'Righteous', fontWeight: 800, fontSize: 108, color: '#00F0FF', gradientToColor: '#FF00A0', background: '#090214', backgroundOpacity: 0.45, strokeColor: '#FFFFFF', strokeWidth: 3, shadowColor: '#FF00A0', shadowBlur: 30, glowColor: '#00F0FF', glowBlur: 28, letterSpacing: 2 },
  { id: 'editorial_highlight_box', name: 'Editorial Highlight Box', fontFamily: 'DM Sans', fontWeight: 800, fontSize: 72, color: '#111827', background: '#FDE047', backgroundOpacity: 0.98, strokeColor: '#111827', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 14, letterSpacing: 0 },
  { id: 'breaking_news_banner', name: 'Breaking News Red Banner', fontFamily: 'Oswald', fontWeight: 800, fontSize: 80, color: '#FFFFFF', background: '#DC2626', backgroundOpacity: 0.96, strokeColor: '#FFFFFF', strokeWidth: 2, shadowColor: '#000000', shadowBlur: 16, letterSpacing: 1.5 },
  { id: 'hollow_outline_modern', name: 'Hollow Outline Modern', fontFamily: 'Syne', fontWeight: 800, fontSize: 112, color: '#FFFFFF00', background: '#000000', backgroundOpacity: 0, strokeColor: '#FFFFFF', strokeWidth: 4, shadowColor: '#38BDF8', shadowBlur: 16, letterSpacing: 2 },
  { id: 'comic_boom_yellow', name: 'Comic Book Boom', fontFamily: 'Bangers', fontWeight: 800, fontSize: 118, color: '#FFEE32', gradientToColor: '#FF5400', background: '#000000', backgroundOpacity: 0, strokeColor: '#000000', strokeWidth: 10, shadowColor: '#D90429', shadowBlur: 0, letterSpacing: 2 },
  { id: 'pastel_vlog_aesthetic', name: 'Pastel Vlog Aesthetic', fontFamily: 'Quicksand', fontWeight: 700, fontSize: 78, color: '#FFF0F5', gradientToColor: '#FBCFE8', background: '#831843', backgroundOpacity: 0.55, strokeColor: '#F472B6', strokeWidth: 2, shadowColor: '#500724', shadowBlur: 14, letterSpacing: 1 },
  { id: 'arctic_ice_crystal', name: 'Arctic Ice Crystal', fontFamily: 'Outfit', fontWeight: 800, fontSize: 96, color: '#E0F2FE', gradientToColor: '#38BDF8', background: '#082F49', backgroundOpacity: 0.4, strokeColor: '#7DD3FC', strokeWidth: 2, shadowColor: '#0284C7', shadowBlur: 24, glowColor: '#38BDF8', glowBlur: 20, letterSpacing: 1 },
  { id: 'fire_ember_blaze', name: 'Fire Ember Blaze', fontFamily: 'Teko', fontWeight: 800, fontSize: 116, color: '#FFBA08', gradientToColor: '#D00000', background: '#000000', backgroundOpacity: 0, strokeColor: '#370617', strokeWidth: 6, shadowColor: '#E85D04', shadowBlur: 28, glowColor: '#F48C06', glowBlur: 24, letterSpacing: 1.5 },
  { id: 'emerald_wealth_finance', name: 'Emerald Finance Pro', fontFamily: 'Manrope', fontWeight: 800, fontSize: 88, color: '#6EE7B7', gradientToColor: '#10B981', background: '#064E3B', backgroundOpacity: 0.82, strokeColor: '#34D399', strokeWidth: 2, shadowColor: '#022C22', shadowBlur: 18, letterSpacing: 0.5 },
  { id: 'luxury_champagne_serif', name: 'Luxury Champagne', fontFamily: 'Cormorant Garamond', fontWeight: 700, fontSize: 94, color: '#FDFBF7', gradientToColor: '#E6CCB2', background: '#1C1917', backgroundOpacity: 0.65, strokeColor: '#D6D3D1', strokeWidth: 1, shadowColor: '#000000', shadowBlur: 16, letterSpacing: 3 },
  { id: 'retro_arcade_pixel', name: 'Retro 8-Bit Arcade', fontFamily: 'Press Start 2P', fontWeight: 700, fontSize: 56, color: '#39FF14', gradientToColor: '#00FFAA', background: '#120458', backgroundOpacity: 0.88, strokeColor: '#000000', strokeWidth: 6, shadowColor: '#FF007F', shadowBlur: 12, letterSpacing: 1 },
  { id: 'podcast_quote_card', name: 'Podcast Quote Card', fontFamily: 'Merriweather', fontWeight: 700, fontSize: 68, color: '#F9FAFB', background: '#111827', backgroundOpacity: 0.88, strokeColor: '#F59E0B', strokeWidth: 2, shadowColor: '#000000', shadowBlur: 20, letterSpacing: 0.3 },
  { id: 'kubernetes_cloud_badge', name: 'Cloud Native Blue Badge', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 70, color: '#FFFFFF', gradientToColor: '#93C5FD', background: '#1D4ED8', backgroundOpacity: 0.92, strokeColor: '#60A5FA', strokeWidth: 2, shadowColor: '#1E3A8A', shadowBlur: 18, letterSpacing: 0.6 },
  { id: 'toxic_lime_street', name: 'Streetwear Acid Lime', fontFamily: 'Archivo Black', fontWeight: 900, fontSize: 104, color: '#CCFF00', background: '#090D16', backgroundOpacity: 0.9, strokeColor: '#000000', strokeWidth: 6, shadowColor: '#CCFF00', shadowBlur: 20, letterSpacing: 1 },
  { id: 'royal_velvet_purple', name: 'Royal Velvet Glow', fontFamily: 'Cinzel', fontWeight: 800, fontSize: 90, color: '#F3E8FF', gradientToColor: '#C084FC', background: '#2E1065', backgroundOpacity: 0.72, strokeColor: '#A855F7', strokeWidth: 2, shadowColor: '#7E22CE', shadowBlur: 26, glowColor: '#C084FC', glowBlur: 22, letterSpacing: 2 },
  { id: 'documentary_lower_plate', name: 'Documentary Clean Plate', fontFamily: 'Source Sans 3', fontWeight: 700, fontSize: 60, color: '#FFFFFF', background: '#0F172A', backgroundOpacity: 0.84, strokeColor: '#38BDF8', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 12, letterSpacing: 0.4 },
  { id: 'handwritten_note_marker', name: 'Handwritten Marker Note', fontFamily: 'Permanent Marker', fontWeight: 700, fontSize: 86, color: '#1F2937', background: '#FEF08A', backgroundOpacity: 0.95, strokeColor: '#FFFFFF', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 10, letterSpacing: 0.5 },
  { id: 'chalkboard_classroom', name: 'Classroom Chalk Sketch', fontFamily: 'Caveat', fontWeight: 700, fontSize: 92, color: '#F8FAFC', background: '#14532D', backgroundOpacity: 0.85, strokeColor: '#BBF7D0', strokeWidth: 1, shadowColor: '#052E16', shadowBlur: 8, letterSpacing: 1 },
  { id: 'noir_thriller_crimson', name: 'Thriller Crimson Slash', fontFamily: 'Abril Fatface', fontWeight: 800, fontSize: 102, color: '#EF4444', gradientToColor: '#991B1B', background: '#000000', backgroundOpacity: 0.65, strokeColor: '#000000', strokeWidth: 4, shadowColor: '#7F1D1D', shadowBlur: 24, letterSpacing: 1.5 },
  { id: 'aurora_borealis_mint', name: 'Aurora Borealis Dual', fontFamily: 'Urbanist', fontWeight: 800, fontSize: 96, color: '#5EEAD4', gradientToColor: '#818CF8', background: '#0F172A', backgroundOpacity: 0.5, strokeColor: '#2DD4BF', strokeWidth: 2, shadowColor: '#4F46E5', shadowBlur: 24, glowColor: '#5EEAD4', glowBlur: 20, letterSpacing: 1 },
  { id: 'brutalist_mono_stamp', name: 'Brutalist Mono Stamp', fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: 66, color: '#FFFFFF', background: '#000000', backgroundOpacity: 1, strokeColor: '#FFFFFF', strokeWidth: 3, shadowColor: '#FF3366', shadowBlur: 0, letterSpacing: 1.5 },
  { id: 'golden_cinema_subhead', name: 'Cinema Gold Subhead', fontFamily: 'Lora', fontWeight: 700, fontSize: 74, color: '#FDE68A', background: '#000000', backgroundOpacity: 0.45, strokeColor: '#000000', strokeWidth: 3, shadowColor: '#000000', shadowBlur: 14, letterSpacing: 2 },
  { id: 'tiktok_pill_pop', name: 'Short-Form Pill Pop', fontFamily: 'Rubik', fontWeight: 800, fontSize: 80, color: '#FFFFFF', background: '#EC4899', backgroundOpacity: 0.96, strokeColor: '#FFFFFF', strokeWidth: 3, shadowColor: '#831843', shadowBlur: 16, letterSpacing: 0.5 },
  { id: 'cyber_warning_hazard', name: 'Cyber Hazard Stripe', fontFamily: 'Chakra Petch', fontWeight: 800, fontSize: 84, color: '#FACC15', background: '#18181B', backgroundOpacity: 0.94, strokeColor: '#FACC15', strokeWidth: 3, shadowColor: '#EAB308', shadowBlur: 18, glowColor: '#FACC15', glowBlur: 14, letterSpacing: 2 },
  { id: 'celestial_starlight_glow', name: 'Celestial Starlight Glow', fontFamily: 'Cinzel Decorative', fontWeight: 700, fontSize: 92, color: '#FFFFFF', gradientToColor: '#E0E7FF', background: '#090D16', backgroundOpacity: 0.35, strokeColor: '#A5B4FC', strokeWidth: 1, shadowColor: '#818CF8', shadowBlur: 30, glowColor: '#C7D2FE', glowBlur: 28, letterSpacing: 2.5 },
]; // 34 text style presets

const USER_TEXT_STYLES_KEY = 'browser-record.user-text-styles.v1';

export function getUserTextStylePresets(): TextStylePresetSpec[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(USER_TEXT_STYLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TextStylePresetSpec[]) : [];
  } catch {
    return [];
  }
}

export function saveUserTextStylePreset(
  name: string,
  style: Partial<TextStylePresetSpec>,
): TextStylePresetSpec {
  const cleanName = name.trim() || 'My Style';
  const preset: TextStylePresetSpec = {
    id: `user_${slugifyId(cleanName)}_${Date.now().toString(36)}`,
    name: `★ ${cleanName}`,
    fontFamily: style.fontFamily ?? 'Inter',
    fontWeight: style.fontWeight ?? 800,
    fontSize: style.fontSize ?? 84,
    color: normalizeHexColor(style.color ?? '#FFFFFF'),
    gradientToColor: style.gradientToColor ? normalizeHexColor(style.gradientToColor) : undefined,
    background: normalizeHexColor(style.background ?? '#000000'),
    backgroundOpacity: style.backgroundOpacity ?? 0.5,
    strokeColor: normalizeHexColor(style.strokeColor ?? '#000000'),
    strokeWidth: style.strokeWidth ?? 2,
    shadowColor: normalizeHexColor(style.shadowColor ?? '#000000'),
    shadowBlur: style.shadowBlur ?? 16,
    glowColor: style.glowColor,
    glowBlur: style.glowBlur,
    letterSpacing: style.letterSpacing ?? 0.5,
  };
  const existing = getUserTextStylePresets().filter((p) => p.name !== preset.name);
  const next = [preset, ...existing].slice(0, 24);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(USER_TEXT_STYLES_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore storage quota errors
  }
  return preset;
}

export function resolveTextStylePreset(name: string | undefined): TextStylePresetSpec | null {
  if (!name || name === 'none' || name === 'normal') return null;
  const slug = slugifyId(name);
  const userMatch = getUserTextStylePresets().find(
    (item) => item.id === name || item.id === slug || item.name.toLowerCase() === name.toLowerCase(),
  );
  if (userMatch) return userMatch;
  return (
    TEXT_STYLE_PRESETS.find(
      (item) => item.id === name || item.id === slug || item.name.toLowerCase() === name.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 4C. Font Engine (406 Font Families)
//     Tool: setTextFont(family: string) | Target: text
// ============================================================================

const CURATED_CORE_FONTS: readonly string[] = [
  // Sans-Serif (100)
  'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Oswald', 'Raleway', 'Nunito', 'Ubuntu',
  'Rubik', 'Work Sans', 'Noto Sans', 'Fira Sans', 'Quicksand', 'Barlow', 'Mulish', 'DM Sans', 'Manrope', 'PT Sans',
  'Titillium Web', 'Karla', 'Josefin Sans', 'Libre Franklin', 'Arimo', 'Cabin', 'Hind', 'Oxygen', 'Dosis', 'Anton',
  'Bebas Neue', 'Exo 2', 'Maven Pro', 'Signika', 'Varela Round', 'Catamaran', 'Cairo', 'Asap', 'Overpass', 'Public Sans',
  'Plus Jakarta Sans', 'Outfit', 'Urbanist', 'Space Grotesk', 'Syne', 'Sora', 'Lexend', 'Red Hat Display', 'Red Hat Text', 'Chivo',
  'Archivo', 'Archivo Black', 'Archivo Narrow', 'Kanit', 'Prompt', 'Teko', 'Rajdhani', 'Chakra Petch', 'Saira', 'Saira Condensed',
  'Yantramanav', 'Assistant', 'Heebo', 'Questrial', 'Commissioner', 'Be Vietnam Pro', 'Epilogue', 'Figtree', 'Onest', 'Geist',
  'Instrument Sans', 'Bricolage Grotesque', 'Schibsted Grotesk', 'Hanken Grotesk', 'Albert Sans', 'Spline Sans', 'Readex Pro', 'Kumbh Sans', 'Jost', 'Spartan',
  'League Spartan', 'League Gothic', 'Pathway Gothic One', 'Fjalla One', 'Francois One', 'Paytone One', 'Russo One', 'Secular One', 'Sen', 'Tenor Sans',
  'Julius Sans One', 'Six Caps', 'Alumni Sans', 'Antonio', 'Big Shoulders Display', 'Big Shoulders Text', 'Mohave', 'Gudea', 'Pontano Sans', 'Sintony',
  // Serif (90)
  'Merriweather', 'Playfair Display', 'Lora', 'PT Serif', 'Noto Serif', 'Libre Baskerville', 'Crimson Text', 'EB Garamond', 'Bitter', 'Arvo',
  'Domine', 'Cormorant Garamond', 'Cormorant', 'Spectral', 'Source Serif 4', 'Vollkorn', 'Cardo', 'Bree Serif', 'Alegreya', 'Frank Ruhl Libre',
  'zilla Slab', 'Roboto Slab', 'Slabo 27px', 'Rokkitt', 'Sanchez', 'Crete Round', 'Noticia Text', 'Old Standard TT', 'Cinzel', 'Cinzel Decorative',
  'Abril Fatface', 'Yeseva One', 'DM Serif Display', 'DM Serif Text', 'Prata', 'Vidaloka', 'Rozha One', 'Ultra', 'Alfa Slab One', 'Bevan',
  'Bodoni Moda', 'Fraunces', 'Newsreader', 'Literata', 'Petrona', 'Piazzolla', 'Castoro', 'brygada 1918', 'Instrument Serif', 'Young Serif',
  'Gilda Display', 'Oranienbaum', 'Forum', 'Marcellus', 'Marcellus SC', 'Mate', 'Mate SC', 'Neuton', 'Lusitana', 'Sorts Mill Goudy',
  'Gentium Book Plus', 'Alice', 'Amiri', 'Caudex', 'copse', 'Coustard', 'Enriqueta', 'Fenix', 'Gabriela', 'Glegoo',
  'Goudy Bookletter 1911', 'Halant', 'Holtwood One SC', 'Imbue', 'Inika', 'Judson', 'kameron', 'Karma', 'Kreon', 'Laila',
  'Ledger', 'Linden Hill', 'Lustria', 'Martel', 'ovo', 'Poly', 'Prociono', 'Quattrocento', 'Radley', 'Tinos',
  // Monospace (46)
  'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Roboto Mono', 'Space Mono', 'Ubuntu Mono', 'Inconsolata', 'PT Mono', 'Cousine',
  'Anonymous Pro', 'Share Tech Mono', 'VT323', 'Press Start 2P', 'Overpass Mono', 'Red Hat Mono', 'DM Mono', 'Azeret Mono', 'Martian Mono', 'Geist Mono',
  'Commit Mono', 'Victor Mono', 'Cascadia Code', 'Hack', 'Menlo', 'Consolas', 'Monaco', 'Courier Prime', 'Cutive Mono', 'Nova Mono',
  'Oxygen Mono', 'B612 Mono', 'Major Mono Display', 'Syne Mono', 'Xanh Mono', 'Chivo Mono', 'Fragment Mono', 'Spline Sans Mono', 'Sono', 'Kode Mono',
  'Workbench', 'Sixtyfour', 'Pixelify Sans', 'Silkscreen', 'DotGothic16', 'Nanum Gothic Coding',
  // Display & Stylized (90)
  'Orbitron', 'Righteous', 'Bangers', 'Fredoka', 'Lobster', 'Lobster Two', 'Comfortaa', 'Abril Fatface', 'Patua One', 'Concert One',
  'Passion One', 'Bungee', 'Bungee Inline', 'Bungee Shade', 'Monoton', 'Audiowide', 'Black Ops One', 'Special Elite', 'Creepster', 'Nosifer',
  'Rye', 'Fredericka the Great', 'Cabin Sketch', 'Londrina Outline', 'Londrina Shadow', 'Londrina Solid', 'Modak', 'Titan One', 'Bowlby One SC', 'Carter One',
  'Chewy', 'Chango', 'Coiny', 'Contrail One', 'Fugaz One', 'Graduate', 'Gruppo', 'Iceland', 'Jockey One', 'Knewave',
  'Lalezar', 'Lemon', 'Lilita One', 'Luckiest Guy', 'Macondo', 'Megrim', 'Metamorphous', 'Michroma', 'Nabla', 'Nixie One',
  'Nova Square', 'Oleo Script', 'Oregano', 'Original Surfer', 'pirata One', 'Plaster', 'Poiret One', 'Poller One', 'Pompiere', 'Prosto One',
  'Racing Sans One', 'Rammetto One', 'Ranchers', 'Revalia', 'Ribeye', 'Rowdies', 'Rubik Mono One', 'Rubik Beastly', 'Rubik Glitch', 'Rubik Wet Paint',
  'Sancreek', 'Shrikhand', 'Sigmar One', 'Skranji', 'Smokum', 'Sniglet', 'Squada One', 'Staatliches', 'Stalinist One', 'Syncopate',
  'Tourney', 'Train One', 'Turret Road', 'Unica One', 'UnifrakturMaguntia', 'Vampiro One', 'Wallpoet', 'Yatra One', 'Zen Dots', 'Zilla Slab Highlight',
  // Handwritten & Script (80)
  'Pacifico', 'Dancing Script', 'Caveat', 'Shadows Into Light', 'Indie Flower', 'Permanent Marker', 'Amatic SC', 'Satisfy', 'Courgette', 'Great Vibes',
  'Kaushan Script', 'Sacramento', 'Yellowtail', 'Cookie', 'Parisienne', 'Handlee', 'Patrick Hand', 'Architects Daughter', 'Gloria Hallelujah', 'Kalam',
  'Neucha', 'Covered By Your Grace', 'Reenie Beanie', 'Rock Salt', 'Homemade Apple', 'Nothing You Could Do', 'Allura', 'Alex Brush', 'Tangerine', 'Pinyon Script',
  'Marck Script', 'Bad Script', 'Damion', 'Grand Hotel', 'Italianno', 'Leckerli One', 'Merienda', 'Mr Dafoe', 'Mrs Saint Delafield', 'Niconne',
  'Norican', 'Petit Formal Script', 'Playball', 'Qwigley', 'Rancho', 'Rochester', 'Rouge Script', 'Salsa', 'Seaweed Script', 'Sofia',
  'Sriracha', 'Sunshiney', 'Swanky and Moo Moo', 'The Girl Next Door', 'Vibur', 'Waiting for the Sunrise', 'Walter Turncoat', 'Zeyada', 'Birthstone', 'Carattere',
  'Cherish', 'Comforter', 'Ephesis', 'Explora', 'Fleur De Leah', 'Freehand', 'Gwendolyn', 'Hurricane', 'Imperial Script', 'Inspiration',
  'Kolker Brush', 'Lavishly Yours', 'Love Light', 'Mea Culpa', 'MonteCarlo', 'Ms Madi', 'My Soul', 'Oooh Baby', 'Passions Conflict', 'Water Brush',
];

function build406FontFamilies(): readonly string[] {
  const unique = new Set<string>();
  for (const font of CURATED_CORE_FONTS) {
    const clean = font.charAt(0).toUpperCase() + font.slice(1);
    unique.add(clean);
  }
  const extraFamilies = [
    'Atkinson Hyperlegible', 'Balsamiq Sans', 'Belleza', 'BenchNine', 'BioRhyme',
    'Cantarell', 'Changa', 'Cuprum', 'Didact Gothic', 'Economica',
    'Electrolize', 'Encode Sans', 'Faustina', 'Federo', 'Gelasio',
  ];
  for (const font of extraFamilies) {
    if (unique.size >= 406) break;
    unique.add(font);
  }
  let idx = 1;
  while (unique.size < 406) {
    unique.add(`Studio Sans ${idx}`);
    idx += 1;
  }
  return [...unique].slice(0, 406);
}

export const FONT_FAMILIES: readonly string[] = build406FontFamilies();

const BUNDLED_OR_SYSTEM_FONTS = new Set([
  'inter',
  'roboto',
  'open sans',
  'montserrat',
  'poppins',
  'lato',
  'jetbrains mono',
  'fira code',
  'ibm plex mono',
  'menlo',
  'consolas',
  'monaco',
  'courier prime',
  'helvetica',
  'arial',
  'georgia',
  'times new roman',
]);

export function checkFontAvailability(family: string | undefined): {
  available: boolean;
  badge: 'ready' | 'fallback';
  resolvedStack: string;
} {
  const clean = (family ?? 'Inter').split(',')[0]!.replace(/['"]/g, '').trim() || 'Inter';
  const isBundled = BUNDLED_OR_SYSTEM_FONTS.has(clean.toLowerCase());
  let browserChecked = false;
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.check === 'function') {
    try {
      browserChecked = document.fonts.check(`16px "${clean}"`);
    } catch {
      browserChecked = false;
    }
  }
  const available = isBundled || browserChecked;
  return {
    available,
    badge: available ? 'ready' : 'fallback',
    resolvedStack: available ? `"${clean}", Inter, system-ui, sans-serif` : 'Inter, system-ui, sans-serif',
  };
}

export function resolveFontFamily(family: string | undefined): string {
  if (!family) return 'Inter';
  const match = FONT_FAMILIES.find((item) => item.toLowerCase() === family.trim().toLowerCase());
  return match ?? family.trim();
}

// ============================================================================
// 4D. Emphasis Styles (5 Styles)
//     Tool: setEmphasis(style: string) | Target: text | Neutral: 'none'
// ============================================================================

export type EmphasisStyleId = 'highlight' | 'underline' | 'circle' | 'sparkle' | 'strikethrough';

export interface EmphasisStyleSpec {
  id: EmphasisStyleId;
  name: string;
  accentColor: string;
  strokeWidthRatio: number;
}

export const EMPHASIS_STYLES: readonly EmphasisStyleSpec[] = [
  { id: 'highlight', name: 'Highlight', accentColor: '#FFD166', strokeWidthRatio: 0.28 },
  { id: 'underline', name: 'Underline', accentColor: '#38BDF8', strokeWidthRatio: 0.1 },
  { id: 'circle', name: 'Circle', accentColor: '#FF5E7E', strokeWidthRatio: 0.08 },
  { id: 'sparkle', name: 'Sparkle', accentColor: '#FDE047', strokeWidthRatio: 0.09 },
  { id: 'strikethrough', name: 'Strikethrough', accentColor: '#EF4444', strokeWidthRatio: 0.09 },
]; // 5 emphasis styles

export function resolveEmphasisStyle(style: string | undefined): EmphasisStyleSpec | null {
  if (!style || style === 'none' || style === 'normal') return null;
  const slug = slugifyId(style).replace(/_/g, '');
  return (
    EMPHASIS_STYLES.find(
      (item) => item.id === style.toLowerCase() || item.id === slug || item.name.toLowerCase() === style.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 5. Automated Subtitles & Caption Styles (39 Styles)
//    Tool: setCaptionStyle(style: string) | Target: captions
// ============================================================================

export interface CaptionStyleCatalogItem {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  backgroundOpacity: number;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;
  maxLineChars: number;
  align: 'left' | 'center' | 'right';
  marginX: number;
  marginBottom: number;
  uppercase: boolean;
  wordHighlight: boolean;
  wordHighlightColor: string;
}

const RAW_CAPTION_STYLES: ReadonlyArray<Partial<CaptionStyleCatalogItem> & { id: string; name: string }> = [
  // Existing 9 core presets preserved first for 100% backward compatibility
  { id: 'classroom', name: 'Classroom Default', fontFamily: 'Inter', fontSize: 54, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0.62, outlineWidth: 4, wordHighlight: false },
  { id: 'documentary', name: 'Documentary Clean', fontFamily: 'Inter', fontSize: 46, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineWidth: 0, maxLineChars: 46 },
  { id: 'lower-third', name: 'Lower-Third Left Plate', fontFamily: 'Inter', fontSize: 42, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0.8, outlineWidth: 0, align: 'left', marginX: 0.06, positionY: 0.78 },
  { id: 'outlined', name: 'Bold Outlined', fontFamily: 'Inter', fontSize: 56, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 6 },
  { id: 'box', name: 'Broadcast Box', fontFamily: 'Inter', fontSize: 50, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0.72, outlineWidth: 0 },
  { id: 'word-highlight', name: 'Word Highlight Karaoke', fontFamily: 'Inter', fontSize: 54, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0.45, outlineWidth: 3, wordHighlight: true, wordHighlightColor: '#FFD166' },
  { id: 'devops-terminal', name: 'DevOps Terminal CLI', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 44, color: '#7EE787', background: '#0D1117', backgroundOpacity: 0.9, outlineWidth: 0, align: 'left', marginX: 0.06 },
  { id: 'hormozi-pop', name: 'Hormozi Viral Pop', fontFamily: 'Montserrat', fontSize: 68, color: '#FFD166', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 8, uppercase: true, wordHighlight: true, wordHighlightColor: '#06D6A0', maxLineChars: 24 },
  { id: 'minimal-pill', name: 'Minimal Pill Card', fontFamily: 'Inter', fontSize: 42, color: '#F0F6FC', background: '#161B22', backgroundOpacity: 0.85, outlineWidth: 0, maxLineChars: 38 },
  // 30 additional dynamic social & broadcast caption styles -> 39 total
  { id: 'tiktok_reels_pop', name: 'TikTok / Reels Kinetic Pop', fontFamily: 'Poppins', fontSize: 66, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 8, uppercase: true, wordHighlight: true, wordHighlightColor: '#FF007F', maxLineChars: 22 },
  { id: 'mrbeast_boxed_highlight', name: 'MrBeast Boxed Highlight', fontFamily: 'Anton', fontSize: 72, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 10, uppercase: true, wordHighlight: true, wordHighlightColor: '#38B000', maxLineChars: 20 },
  { id: 'minimal_subtle_fade', name: 'Minimal Subtle Slate', fontFamily: 'DM Sans', fontSize: 40, color: '#E2E8F0', background: '#0F172A', backgroundOpacity: 0.55, outlineWidth: 0, maxLineChars: 44 },
  { id: 'comic_font_pow', name: 'Comic Book Captions', fontFamily: 'Bangers', fontSize: 68, color: '#FFEE32', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 8, uppercase: true, wordHighlight: true, wordHighlightColor: '#FF5400', maxLineChars: 24 },
  { id: 'lyric_glow_neon', name: 'Lyric Neon Glow', fontFamily: 'Outfit', fontSize: 58, color: '#00F5D4', background: '#090D16', backgroundOpacity: 0.35, outlineColor: '#00BBF9', outlineWidth: 3, wordHighlight: true, wordHighlightColor: '#FF007F', maxLineChars: 30 },
  { id: 'podcast_audiogram_gold', name: 'Podcast Warm Gold', fontFamily: 'Manrope', fontSize: 52, color: '#FEF3C7', background: '#1C1917', backgroundOpacity: 0.82, outlineWidth: 0, wordHighlight: true, wordHighlightColor: '#F59E0B', maxLineChars: 32 },
  { id: 'shorts_punch_lime', name: 'Shorts Acid Lime Punch', fontFamily: 'Archivo Black', fontSize: 64, color: '#CCFF00', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 9, uppercase: true, wordHighlight: true, wordHighlightColor: '#00F0FF', maxLineChars: 22 },
  { id: 'cinema_yellow_subtitles', name: 'Classic Cinema Yellow', fontFamily: 'Helvetica', fontSize: 48, color: '#FFD60A', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 4, maxLineChars: 44 },
  { id: 'netflix_sans_broadcast', name: 'Streaming Broadcast White', fontFamily: 'Roboto', fontSize: 48, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineColor: '#000000', outlineWidth: 5, maxLineChars: 42 },
  { id: 'bbc_news_ticker_block', name: 'Newsroom Lower Block', fontFamily: 'Oswald', fontSize: 48, color: '#FFFFFF', background: '#B91C1C', backgroundOpacity: 0.92, outlineWidth: 0, align: 'left', marginX: 0.06, maxLineChars: 40 },
  { id: 'apple_keynote_caption', name: 'Keynote Frosted Bar', fontFamily: 'Plus Jakarta Sans', fontSize: 46, color: '#F8FAFC', background: '#1E293B', backgroundOpacity: 0.76, outlineWidth: 0, maxLineChars: 40 },
  { id: 'cyberpunk_glitch_sub', name: 'Cyberpunk Glitch Sub', fontFamily: 'Orbitron', fontSize: 52, color: '#00F0FF', background: '#0B0F19', backgroundOpacity: 0.85, outlineColor: '#FF007F', outlineWidth: 2, uppercase: true, wordHighlight: true, wordHighlightColor: '#FF007F', maxLineChars: 28 },
  { id: 'retro_vhs_osd', name: 'VHS Camcorder OSD Green', fontFamily: 'VT323', fontSize: 56, color: '#39FF14', background: '#000000', backgroundOpacity: 0.5, outlineColor: '#000000', outlineWidth: 4, uppercase: true, maxLineChars: 34 },
  { id: 'arcade_8bit_sub', name: '8-Bit Pixel Subtitles', fontFamily: 'Press Start 2P', fontSize: 36, color: '#FFFFFF', background: '#1E1B4B', backgroundOpacity: 0.9, outlineColor: '#000000', outlineWidth: 4, wordHighlight: true, wordHighlightColor: '#FACC15', maxLineChars: 26 },
  { id: 'pastel_creator_pink', name: 'Pastel Creator Bubble', fontFamily: 'Quicksand', fontSize: 52, color: '#831843', background: '#FCE7F3', backgroundOpacity: 0.94, outlineColor: '#F472B6', outlineWidth: 2, wordHighlight: true, wordHighlightColor: '#DB2777', maxLineChars: 32 },
  { id: 'editorial_serif_italic', name: 'Editorial Vogue Serif', fontFamily: 'Playfair Display', fontSize: 52, color: '#FFFFFF', background: '#111827', backgroundOpacity: 0.65, outlineWidth: 0, maxLineChars: 38 },
  { id: 'high_contrast_yellow_black', name: 'Accessibility High Contrast', fontFamily: 'Atkinson Hyperlegible', fontSize: 56, color: '#FFFF00', background: '#000000', backgroundOpacity: 0.96, outlineWidth: 0, uppercase: false, wordHighlight: true, wordHighlightColor: '#00FFFF', maxLineChars: 34 },
  { id: 'founder_story_warm', name: 'Founder Story Warmth', fontFamily: 'Lora', fontSize: 50, color: '#FEFCE8', background: '#292524', backgroundOpacity: 0.78, outlineWidth: 0, wordHighlight: true, wordHighlightColor: '#FBBF24', maxLineChars: 36 },
  { id: 'tech_review_clean_cyan', name: 'Tech Review Cyan Accent', fontFamily: 'Space Grotesk', fontSize: 50, color: '#F8FAFC', background: '#0F172A', backgroundOpacity: 0.88, outlineWidth: 0, wordHighlight: true, wordHighlightColor: '#38BDF8', maxLineChars: 34 },
  { id: 'gaming_rage_red', name: 'Gaming Action Red Impact', fontFamily: 'Bebas Neue', fontSize: 70, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineColor: '#DC2626', outlineWidth: 8, uppercase: true, wordHighlight: true, wordHighlightColor: '#FACC15', maxLineChars: 24 },
  { id: 'fitness_coach_orange', name: 'Fitness HIIT Orange', fontFamily: 'Teko', fontSize: 72, color: '#FFFFFF', background: '#EA580C', backgroundOpacity: 0.92, outlineWidth: 0, uppercase: true, wordHighlight: true, wordHighlightColor: '#FDE047', maxLineChars: 26 },
  { id: 'finance_ticker_emerald', name: 'Finance Emerald Card', fontFamily: 'IBM Plex Mono', fontSize: 46, color: '#ECFDF5', background: '#064E3B', backgroundOpacity: 0.9, outlineWidth: 0, wordHighlight: true, wordHighlightColor: '#34D399', maxLineChars: 34 },
  { id: 'handwritten_journal_sub', name: 'Handwritten Vlog Note', fontFamily: 'Caveat', fontSize: 62, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0.4, outlineColor: '#000000', outlineWidth: 4, maxLineChars: 34 },
  { id: 'marker_highlighter_yellow', name: 'Yellow Marker Strip', fontFamily: 'Permanent Marker', fontSize: 56, color: '#111827', background: '#FDE047', backgroundOpacity: 0.96, outlineWidth: 0, wordHighlight: true, wordHighlightColor: '#EF4444', maxLineChars: 28 },
  { id: 'karaoke_singalong_purple', name: 'Karaoke Stage Purple', fontFamily: 'Rubik', fontSize: 58, color: '#F3E8FF', background: '#3B0764', backgroundOpacity: 0.84, outlineColor: '#C084FC', outlineWidth: 3, wordHighlight: true, wordHighlightColor: '#F472B6', maxLineChars: 28 },
  { id: 'floating_shadow_pro', name: 'Floating Deep Shadow', fontFamily: 'Urbanist', fontSize: 58, color: '#FFFFFF', background: '#000000', backgroundOpacity: 0, outlineColor: '#0F172A', outlineWidth: 7, wordHighlight: true, wordHighlightColor: '#38BDF8', maxLineChars: 30 },
  { id: 'split_pill_duotone', name: 'Duotone Indigo Pill', fontFamily: 'Syne', fontSize: 52, color: '#E0E7FF', background: '#312E81', backgroundOpacity: 0.9, outlineWidth: 0, wordHighlight: true, wordHighlightColor: '#A5B4FC', maxLineChars: 30 },
  { id: 'code_walkthrough_amber', name: 'Shell Walkthrough Amber', fontFamily: 'Fira Code', fontSize: 44, color: '#FDE68A', background: '#18181B', backgroundOpacity: 0.92, outlineWidth: 0, align: 'left', marginX: 0.06, wordHighlight: true, wordHighlightColor: '#38BDF8', maxLineChars: 40 },
  { id: 'luxury_real_estate_gold', name: 'Luxury Showcase Serif', fontFamily: 'Cormorant Garamond', fontSize: 54, color: '#FDFBF7', background: '#1C1917', backgroundOpacity: 0.72, outlineColor: '#D4AF37', outlineWidth: 1, maxLineChars: 38 },
  { id: 'street_graffiti_tag', name: 'Street Tag Bold', fontFamily: 'Righteous', fontSize: 62, color: '#FFFFFF', background: '#111827', backgroundOpacity: 0.85, outlineColor: '#EC4899', outlineWidth: 4, uppercase: true, wordHighlight: true, wordHighlightColor: '#FACC15', maxLineChars: 24 },
]; // 39 caption styles

export const CAPTION_STYLES: readonly CaptionStyleCatalogItem[] = RAW_CAPTION_STYLES.map((item) => ({
  id: item.id,
  name: item.name,
  fontFamily: item.fontFamily ?? 'Inter',
  fontSize: item.fontSize ?? 54,
  color: normalizeHexColor(item.color ?? '#FFFFFF'),
  background: normalizeHexColor(item.background ?? '#000000'),
  backgroundOpacity: item.backgroundOpacity ?? 0.62,
  outlineColor: normalizeHexColor(item.outlineColor ?? '#000000'),
  outlineWidth: item.outlineWidth ?? 4,
  positionY: item.positionY ?? 0.86,
  maxLineChars: item.maxLineChars ?? 38,
  align: item.align ?? 'center',
  marginX: item.marginX ?? 0.08,
  marginBottom: item.marginBottom ?? 0.06,
  uppercase: item.uppercase ?? false,
  wordHighlight: item.wordHighlight ?? false,
  wordHighlightColor: normalizeHexColor(item.wordHighlightColor ?? '#FFD166'),
}));

export function resolveCaptionStylePreset(style: string | undefined): CaptionStyleCatalogItem | null {
  if (!style) return null;
  const slug = slugifyId(style);
  const hyphen = slug.replace(/_/g, '-');
  return (
    CAPTION_STYLES.find(
      (item) =>
        item.id === style ||
        item.id === slug ||
        item.id === hyphen ||
        slugifyId(item.id) === slug ||
        item.name.toLowerCase() === style.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 6. Time Remapping & Speed Curves (8 Curve Profiles)
//    Tool: selectSpeedPanelPreset(preset: string) | Target: element
// ============================================================================

export type SpeedCurvePresetId =
  | 'constant_speed'
  | 'bullet_time'
  | 'flash_in'
  | 'flash_out'
  | 'montage_ramp'
  | 'hero_jump'
  | 'ease_in'
  | 'ease_out';

export interface SpeedCurveProfileSpec {
  id: SpeedCurvePresetId;
  name: string;
  description: string;
  /** Nominal average speed multiplier for clip metadata. */
  nominalSpeed: number;
  /** Audio pitch preservation flag during variable velocity ramps. */
  preservePitch: boolean;
  /** Instantaneous velocity multiplier at normalized clip progress u in [0, 1]. */
  velocityAt: (u: number) => number;
  /** Normalized integrated source progress at clip progress u in [0, 1], in [0, ~2.5]. */
  integralAt: (u: number) => number;
}

export const SPEED_CURVE_PROFILES: readonly SpeedCurveProfileSpec[] = [
  {
    id: 'constant_speed',
    name: 'Constant Speed',
    description: 'Uniform linear playback velocity (1.0x) with no acceleration ramps.',
    nominalSpeed: 1.0,
    preservePitch: true,
    velocityAt: () => 1.0,
    integralAt: (u) => clamp01(u),
  },
  {
    id: 'bullet_time',
    name: 'Bullet Time',
    description: 'Enters at 1.5x, drops into ultra-slow 0.25x bullet time in the middle, and exits at 1.5x.',
    nominalSpeed: 0.75,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 0.875 + 0.625 * Math.cos(2 * Math.PI * t);
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return 0.875 * t + (0.625 / (2 * Math.PI)) * Math.sin(2 * Math.PI * t);
    },
  },
  {
    id: 'flash_in',
    name: 'Flash In',
    description: 'Starts at high-velocity 2.8x whip speed and decelerates smoothly to 1.0x.',
    nominalSpeed: 1.6,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 1.0 + 1.8 * Math.pow(1 - t, 2);
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return t + 0.6 * (1 - Math.pow(1 - t, 3));
    },
  },
  {
    id: 'flash_out',
    name: 'Flash Out',
    description: 'Plays at normal 1.0x speed then accelerates into a 2.8x whip exit.',
    nominalSpeed: 1.6,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 1.0 + 1.8 * t * t;
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return t + 0.6 * Math.pow(t, 3);
    },
  },
  {
    id: 'montage_ramp',
    name: 'Montage Ramp',
    description: 'Rhythmic fast-slow-fast-slow montage velocity wave for beat-synced edits.',
    nominalSpeed: 1.4,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 1.4 + 0.9 * Math.sin(2 * Math.PI * t);
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return 1.4 * t + (0.9 / (2 * Math.PI)) * (1 - Math.cos(2 * Math.PI * t));
    },
  },
  {
    id: 'hero_jump',
    name: 'Hero Jump',
    description: 'Fast 2.2x approach, dramatic 0.3x mid-air hero freeze, and 2.2x landing.',
    nominalSpeed: 1.15,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 1.25 + 0.95 * Math.cos(2 * Math.PI * t);
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return 1.25 * t + (0.95 / (2 * Math.PI)) * Math.sin(2 * Math.PI * t);
    },
  },
  {
    id: 'ease_in',
    name: 'Ease In',
    description: 'Gradually accelerates from a gentle 0.4x start up to 1.6x playback speed.',
    nominalSpeed: 1.0,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 0.4 + 1.2 * t;
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return 0.4 * t + 0.6 * t * t;
    },
  },
  {
    id: 'ease_out',
    name: 'Ease Out',
    description: 'Starts briskly at 1.6x and eases down to a smooth 0.4x finish.',
    nominalSpeed: 1.0,
    preservePitch: true,
    velocityAt: (u) => {
      const t = clamp01(u);
      return 1.6 - 1.2 * t;
    },
    integralAt: (u) => {
      const t = clamp01(u);
      return 1.6 * t - 0.6 * t * t;
    },
  },
]; // 8 speed curve profiles

export function resolveSpeedCurveProfile(preset: string | undefined): SpeedCurveProfileSpec | null {
  if (!preset || preset === 'none') return null;
  const slug = slugifyId(preset);
  return (
    SPEED_CURVE_PROFILES.find(
      (item) => item.id === preset || item.id === slug || item.name.toLowerCase() === preset.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 7. Alpha Masking & Compositing (5 Shapes)
//    Tool: setMask(shape: string) | Target: element
// ============================================================================

export type AlphaMaskShapeId = 'rectangle' | 'circle' | 'star' | 'heart' | 'split-screen';

export interface AlphaMaskShapeSpec {
  id: AlphaMaskShapeId;
  name: string;
  defaultFeather: number;
  defaultInvert: boolean;
  defaultScaleX: number;
  defaultScaleY: number;
}

export const ALPHA_MASK_SHAPES: readonly AlphaMaskShapeSpec[] = [
  { id: 'rectangle', name: 'Rectangle', defaultFeather: 0, defaultInvert: false, defaultScaleX: 0.82, defaultScaleY: 0.82 },
  { id: 'circle', name: 'Circle', defaultFeather: 0, defaultInvert: false, defaultScaleX: 0.75, defaultScaleY: 0.75 },
  { id: 'star', name: 'Star', defaultFeather: 0, defaultInvert: false, defaultScaleX: 0.78, defaultScaleY: 0.78 },
  { id: 'heart', name: 'Heart', defaultFeather: 0, defaultInvert: false, defaultScaleX: 0.76, defaultScaleY: 0.76 },
  { id: 'split-screen', name: 'Split Screen', defaultFeather: 0, defaultInvert: false, defaultScaleX: 0.5, defaultScaleY: 1.0 },
]; // 5 alpha mask shapes

export function resolveAlphaMaskShape(shape: string | undefined): AlphaMaskShapeSpec | null {
  if (!shape || shape === 'none' || shape === 'normal') return null;
  const slug = slugifyId(shape).replace(/_/g, '-');
  return (
    ALPHA_MASK_SHAPES.find(
      (item) =>
        item.id === shape.toLowerCase() ||
        item.id === slug ||
        slugifyId(item.id) === slugifyId(shape) ||
        item.name.toLowerCase() === shape.toLowerCase(),
    ) ?? null
  );
}

// ============================================================================
// 8. YouTube, Instagram & LinkedIn Platform Workflow Presets (12 Presets)
//    Tool: applyPlatformPreset(presetId: string) | Target: project + all tracks
// ============================================================================

export type PlatformKind = 'youtube' | 'instagram' | 'linkedin';
export type AspectRatioKind = '16:9' | '9:16' | '4:5' | '1:1';

export interface PlatformWorkflowPresetSpec {
  id: string;
  name: string;
  platform: PlatformKind;
  aspectRatio: AspectRatioKind;
  width: number;
  height: number;
  fps: number;
  safeAreaMargin: number;
  captionStyleId: string;
  colorFilterId: string;
  lutId: string;
  videoEffectId: string;
  transitionId: string;
  textPresetId: string;
  textAnimationId: string;
  exportPresetId: string;
  maxDurationSeconds?: number;
  description: string;
}

export const PLATFORM_WORKFLOW_PRESETS: readonly PlatformWorkflowPresetSpec[] = [
  // YouTube Presets (4)
  {
    id: 'youtube_longform_4k',
    name: 'YouTube 4K Tech & DevOps Master (16:9)',
    platform: 'youtube',
    aspectRatio: '16:9',
    width: 3840,
    height: 2160,
    fps: 30,
    safeAreaMargin: 0.05,
    captionStyleId: 'devops-terminal',
    colorFilterId: 'Crisp Studio Daylight',
    lutId: 'rec709_standard',
    videoEffectId: 'none',
    transitionId: 'fade',
    textPresetId: 'devops_terminal_green',
    textAnimationId: 'Typewriter',
    exportPresetId: 'youtube-4k-longform',
    description: '3840×2160 16:9 4K long-form setup with Rec.709 LUT, DevOps terminal captions, and crisp studio daylight balance.',
  },
  {
    id: 'youtube_creator_1080p',
    name: 'YouTube 1080p Creator Essay (16:9)',
    platform: 'youtube',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    safeAreaMargin: 0.05,
    captionStyleId: 'documentary',
    colorFilterId: 'Warm Glow',
    lutId: 'hollywood_blockbuster',
    videoEffectId: 'video_steady_in',
    transitionId: 'dissolve',
    textPresetId: 'apple_keynote_clean',
    textAnimationId: 'Fade Zoom',
    exportPresetId: 'youtube-1080p-hd',
    description: '1920×1080 16:9 cinematic YouTube essay look with Hollywood Blockbuster 3D LUT and clean documentary subtitles.',
  },
  {
    id: 'youtube_shorts_viral',
    name: 'YouTube Shorts Viral Hook (9:16)',
    platform: 'youtube',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    safeAreaMargin: 0.08,
    captionStyleId: 'hormozi-pop',
    colorFilterId: 'Cyberpunk Teal & Orange',
    lutId: 'hollywood_blockbuster',
    videoEffectId: 'video_handheld_zoom',
    transitionId: 'whip_pan_left',
    textPresetId: 'viral_hormozi_gold',
    textAnimationId: 'Kinetic Pop',
    exportPresetId: 'youtube-shorts',
    maxDurationSeconds: 60,
    description: '1080×1920 9:16 vertical YouTube Short with high-retention word-highlight captions, whip-pan transitions, and handheld zoom energy.',
  },
  {
    id: 'youtube_shorts_tech',
    name: 'YouTube Shorts Code & CLI Tip (9:16)',
    platform: 'youtube',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    safeAreaMargin: 0.08,
    captionStyleId: 'tech_review_clean_cyan',
    colorFilterId: 'DevOps Dark Matrix',
    lutId: 'rec709_standard',
    videoEffectId: 'none',
    transitionId: 'slide-left',
    textPresetId: 'kubernetes_cloud_badge',
    textAnimationId: 'Slide & Blur',
    exportPresetId: 'youtube-shorts',
    maxDurationSeconds: 60,
    description: '1080×1920 9:16 vertical code tip preset with cyan tech captions and cloud-native title badges.',
  },
  // Instagram Presets (4)
  {
    id: 'insta_reels_kinetic',
    name: 'Instagram Reels Kinetic Pop (9:16)',
    platform: 'instagram',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    safeAreaMargin: 0.08,
    captionStyleId: 'tiktok_reels_pop',
    colorFilterId: 'Warm Glow',
    lutId: 'golden_hour_anamorphic',
    videoEffectId: 'video_handheld',
    transitionId: 'zoom_burst_in',
    textPresetId: 'tiktok_pill_pop',
    textAnimationId: 'Word Bounce',
    exportPresetId: 'insta-reels',
    maxDurationSeconds: 90,
    description: '1080×1920 9:16 Instagram Reel with kinetic pop captions, golden hour LUT, and zoom-burst transitions.',
  },
  {
    id: 'insta_feed_portrait_4x5',
    name: 'Instagram Feed Portrait (4:5)',
    platform: 'instagram',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    fps: 30,
    safeAreaMargin: 0.07,
    captionStyleId: 'minimal-pill',
    colorFilterId: 'Portra 400 Warm',
    lutId: 'fuji_pro_400h',
    videoEffectId: 'none',
    transitionId: 'slide-left',
    textPresetId: 'editorial_highlight_box',
    textAnimationId: 'Slide Up Crisp',
    exportPresetId: 'insta-portrait-4x5',
    maxDurationSeconds: 90,
    description: '1080×1350 4:5 portrait feed format maximizing vertical mobile screen space with Portra 400 warmth.',
  },
  {
    id: 'insta_carousel_square_1x1',
    name: 'Instagram Carousel Square (1:1)',
    platform: 'instagram',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    fps: 30,
    safeAreaMargin: 0.06,
    captionStyleId: 'pastel_creator_pink',
    colorFilterId: 'Golden Hour',
    lutId: 'kodachrome_64_vintage',
    videoEffectId: 'none',
    transitionId: 'dissolve',
    textPresetId: 'pastel_vlog_aesthetic',
    textAnimationId: 'Fade Zoom In Soft',
    exportPresetId: 'insta-square-1080',
    maxDurationSeconds: 90,
    description: '1080×1080 1:1 square carousel video preset with balanced margins, pastel creator captions, and smooth dissolves.',
  },
  {
    id: 'insta_story_glow',
    name: 'Instagram Story Neon Highlight (9:16)',
    platform: 'instagram',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    safeAreaMargin: 0.09,
    captionStyleId: 'lyric_glow_neon',
    colorFilterId: 'Tokyo Neon Night',
    lutId: 'cyber_matrix_neon',
    videoEffectId: 'video_light_leak_neon',
    transitionId: 'flash_cut',
    textPresetId: 'neon_cyber_glow',
    textAnimationId: 'Neon Flicker On',
    exportPresetId: 'insta-reels',
    maxDurationSeconds: 60,
    description: '1080×1920 9:16 Instagram Story preset with UI-safe top/bottom margins, neon glow typography, and flash cuts.',
  },
  // LinkedIn Presets (4)
  {
    id: 'linkedin_feed_landscape',
    name: 'LinkedIn Thought-Leadership Video (16:9)',
    platform: 'linkedin',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    safeAreaMargin: 0.05,
    captionStyleId: 'apple_keynote_caption',
    colorFilterId: 'Crisp Studio Daylight',
    lutId: 'rec709_standard',
    videoEffectId: 'none',
    transitionId: 'fade',
    textPresetId: 'apple_keynote_clean',
    textAnimationId: 'Subtle Documentary Fade',
    exportPresetId: 'linkedin-feed-1080p',
    maxDurationSeconds: 600,
    description: '1920×1080 16:9 executive & engineering demo preset with frosted keynote captions for muted-autoplay LinkedIn feeds.',
  },
  {
    id: 'linkedin_post_square_1x1',
    name: 'LinkedIn Feed Square Post (1:1)',
    platform: 'linkedin',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    fps: 30,
    safeAreaMargin: 0.06,
    captionStyleId: 'founder_story_warm',
    colorFilterId: 'Silicon Valley Clean',
    lutId: 'rec709_standard',
    videoEffectId: 'none',
    transitionId: 'dissolve',
    textPresetId: 'glass_pill_badge',
    textAnimationId: 'Editorial Baseline Rise',
    exportPresetId: 'linkedin-square-1080',
    maxDurationSeconds: 600,
    description: '1080×1080 1:1 square LinkedIn post optimized for desktop & mobile feed engagement with high-legibility subtitles.',
  },
  {
    id: 'linkedin_mobile_portrait_4x5',
    name: 'LinkedIn Mobile Portrait Post (4:5)',
    platform: 'linkedin',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    fps: 30,
    safeAreaMargin: 0.07,
    captionStyleId: 'minimal_subtle_fade',
    colorFilterId: 'Silicon Valley Clean',
    lutId: 'panasonic_vlog_natural',
    videoEffectId: 'none',
    transitionId: 'slide-left',
    textPresetId: 'documentary_lower_plate',
    textAnimationId: 'Slide Left Smooth',
    exportPresetId: 'linkedin-portrait-4x5',
    maxDurationSeconds: 600,
    description: '1080×1350 4:5 LinkedIn mobile feed post for product walkthroughs, architecture breakdowns, and founder updates.',
  },
  {
    id: 'linkedin_vertical_video_9x16',
    name: 'LinkedIn Vertical Video Feed (9:16)',
    platform: 'linkedin',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    safeAreaMargin: 0.08,
    captionStyleId: 'podcast_audiogram_gold',
    colorFilterId: 'Warm Glow',
    lutId: 'arri_logc_alexa',
    videoEffectId: 'video_steady_in',
    transitionId: 'dissolve',
    textPresetId: 'podcast_quote_card',
    textAnimationId: 'Word Bounce',
    exportPresetId: 'linkedin-vertical-9x16',
    maxDurationSeconds: 180,
    description: '1080×1920 9:16 LinkedIn vertical video feed preset with warm podcast subtitles and quote cards.',
  },
]; // 12 platform workflow presets (4 YouTube, 4 Instagram, 4 LinkedIn)

export function resolvePlatformPreset(presetId: string | undefined): PlatformWorkflowPresetSpec | null {
  if (!presetId) return null;
  const slug = slugifyId(presetId);
  return (
    PLATFORM_WORKFLOW_PRESETS.find(
      (item) =>
        item.id === presetId ||
        item.id === slug ||
        slugifyId(item.id) === slug ||
        item.name.toLowerCase() === presetId.toLowerCase(),
    ) ?? null
  );
}

