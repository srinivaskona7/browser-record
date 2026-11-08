import type { FrameRate, Tick } from '../core/time';

/** Bump when the persisted project shape changes; migrations.ts must cover it. */
export const PROJECT_SCHEMA_VERSION = 3;

export type AssetKind = 'video' | 'audio' | 'image';
export type TrackKind = 'video' | 'audio' | 'caption';
export type ClipKind =
  | 'media'
  | 'title'
  | 'solid'
  | 'arrow'
  | 'sticker'
  | 'contact'
  | 'keystroke'
  | 'endscreen'
  | 'progressbar'
  | 'pulse'
  | 'countdown'
  | 'adjustment';

export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay';

export type PipPreset =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'floating-center'
  | 'cinema-bar';

export type ShadowGlowPreset = 'none' | 'soft-card' | 'deep-studio' | 'neon-cyan' | 'neon-amber';

export type ColorLookPreset =
  | 'neutral'
  | 'cinema-teal'
  | 'warm-creator'
  | 'high-contrast-terminal'
  | 'crisp-daylight'
  | 'noir-mono'
  | 'vibrant-reel';

export type VoicePreset = 'podcast-warm' | 'crisp-tech' | 'broadcast-punch' | 'de-reverb-tight' | 'flat';

export type AlertBannerTone = 'warning' | 'danger' | 'tip' | 'note';

export type SocialPlatform = 'youtube' | 'instagram' | 'github' | 'linkedin' | 'x';

export type ContactStyle = 'glass' | 'gradient' | 'solid' | 'accent';

export type StickerKind = 'subscribe' | 'like' | 'bell';

export type CaptionPreset =
  | 'classroom'
  | 'documentary'
  | 'lower-third'
  | 'outlined'
  | 'box'
  | 'word-highlight'
  | 'devops-terminal'
  | 'hormozi-pop'
  | 'minimal-pill'
  | (string & {});

/** Personal branding reused by header and footer bars. Stored with the project only. */
export interface BrandKit {
  name: string;
  role: string;
  email: string;
  linkedin: string;
  /** Contact bar look. Absent on older projects; treated as 'glass'. */
  style?: ContactStyle;
  /** Accent colour for the LinkedIn badge and gradient/accent styles. */
  accent?: string;
}

/** Contact bar content, copied from the brand kit when the bar is added. */
export interface ContactProps {
  name: string;
  role: string;
  email: string;
  linkedin: string;
  style: ContactStyle;
  accent: string;
}

export interface AssetSegment {
  /** Path relative to the project directory. */
  path: string;
  /** Committed byte length; a crash may leave the next segment unwritten. */
  bytes: number;
  startTicks: Tick;
  durationTicks: Tick;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Path relative to the workspace project folder. Absolute paths are never stored. */
  path: string;
  durationTicks: Tick;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  /** Low-resolution stand-in used for editing previews. */
  proxyPath?: string;
  thumbnailPath?: string;
  waveformPath?: string;
  /** Recorded in bounded segments, so the file can be reconstructed/verified. */
  segments?: AssetSegment[];
  /** Where the media came from, for the "recorded vs imported" distinction. */
  origin: 'recorded' | 'imported' | 'generated';
  /** Original container MIME when known, e.g. video/webm;codecs=vp9. */
  mimeType?: string;
  /** True when this asset still needs to be relinked by the user. */
  missing?: boolean;
  createdAt: string;
}

export interface CropRect {
  /** Fractional crop of the source: 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  /** Position of the clip centre, in canvas fractions (0.5 = centred). */
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  fit: 'contain' | 'cover' | 'fill';
  crop: CropRect;
  /** Corner radius in canvas pixels. */
  radius: number;
  shadow: number;
  borderWidth: number;
  borderColor: string;
  /** Layer composite blend mode. Defaults to 'normal'. */
  blendMode?: BlendMode;
  /** Horizontal mirror flip. */
  flipX?: boolean;
  /** Vertical mirror flip. */
  flipY?: boolean;
}

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export type KeyframeTarget =
  | 'x'
  | 'y'
  | 'scale'
  | 'rotationDeg'
  | 'opacity'
  | 'volume'
  | 'zoom'
  | 'panX'
  | 'panY';

export interface Keyframe {
  id: string;
  /** Offset from the clip start, in ticks. */
  atTicks: Tick;
  value: number;
  easing: Easing;
}

export interface KeyframeTrack {
  target: KeyframeTarget;
  keyframes: Keyframe[];
}

export interface AudioProps {
  /** Linear gain, 0..4. */
  gain: number;
  muted: boolean;
  fadeInTicks: Tick;
  fadeOutTicks: Tick;
  /** Route through the narration processing chain (HPF/EQ/compressor/limiter). */
  processed: boolean;
  pan: number;
  duckUnderVoice?: boolean;
  /** Preserve audio pitch during variable velocity speed ramps. */
  preservePitch?: boolean;
}

export type EmphasisStyle = 'none' | 'highlight' | 'underline' | 'circle' | 'sparkle' | 'strikethrough';

export interface TextProps {
  text: string;
  /** Reveal the text one character at a time over its first 60 % (terminal look). */
  typewriter?: boolean;
  /** 1-based line numbers highlighted with an accent bar inside code/terminal callouts. */
  highlightLines?: number[];
  /** Render lines starting with $ / # / > as shell prompts and dim output lines. */
  cliMode?: boolean;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  /** Optional secondary color for dual-tone linear gradients. */
  gradientToColor?: string;
  background: string;
  backgroundOpacity: number;
  align: 'left' | 'center' | 'right';
  maxWidth: number;
  letterSpacing: number;
  lineHeight: number;
  /** Kinetic typography animation ID (77 animations, neutral: 'none'). */
  animation?: string;
  /** Pre-styled typography preset ID (34 presets). */
  stylePreset?: string;
  /** Emphasis decoration style (5 styles: highlight, underline, circle, sparkle, strikethrough). */
  emphasis?: EmphasisStyle;
  /** Stroke border styling for typography presets. */
  strokeColor?: string;
  strokeWidth?: number;
  /** Calibrated drop-shadow & glow shader parameters. */
  shadowColor?: string;
  shadowBlur?: number;
  glowColor?: string;
  glowBlur?: number;
}

/** Keyboard shortcut chord rendered as keycaps for shell and IDE walkthroughs. */
export interface KeystrokeProps {
  keys: string[];
  label?: string;
  style: 'dark' | 'light';
}

/** Auto end-screen card with optional subscribe badge and two video placeholder slots. */
export interface EndScreenProps {
  heading: string;
  leftTitle: string;
  rightTitle: string;
  showSubscribe: boolean;
  accent: string;
}

/** A call-to-action pill drawn over the picture. Scales in and out at each end. */
export interface StickerProps {
  kind: StickerKind;
  color: string;
  textColor: string;
}

/** A straight arrow drawn over the picture. Points are 0..1 of the frame. */
export interface ArrowProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  /** Stroke width as a fraction of frame height. */
  width: number;
}

export interface PresenterProps {
  /** How the camera clip is presented when composited onto the screen. */
  layout: 'bubble' | 'side-by-side' | 'full' | 'screen-only';
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Diameter as a fraction of canvas height when layout is 'bubble'. */
  size: number;
  margin: number;
  /** 'portrait' is a 3:4 rounded card; 'pill' is a 4:3 stadium pill; 'hexagon' is a 6-sided polygon; others are 1:1. */
  shape: 'circle' | 'rounded' | 'square' | 'portrait' | 'pill' | 'hexagon';
  /** Optional custom center position in normalized canvas coordinates (0..1) set by canvas drag. */
  x?: number;
  y?: number;
  mirror: boolean;
  chromaKey: boolean;
  shadow: number;
  /** Outline width in composition pixels; 0 disables the ring. */
  border: number;
  borderColor: string;
  /** Whether the presenter overlay is visible in preview and export (default true). */
  visible?: boolean;
}

export interface MaskKeyframe {
  id: string;
  /** Offset from the clip start, in ticks. */
  atTicks: Tick;
  x: number;
  y: number;
  width: number;
  height: number;
  easing?: Easing;
}

export interface MaskProps {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: 'blur' | 'pixelate' | 'solid' | 'spotlight';
  strength: number;
  /** Soft-edge feathering radius in normalized units (0..0.5). */
  feather?: number;
  /** Redaction fill color when mode === 'solid' (default '#000000'). */
  color?: string;
  /** Optional clip-local start tick (inclusive). */
  startTicks?: Tick;
  /** Optional clip-local end tick (inclusive). */
  endTicks?: Tick;
  /** Optional spatial keyframes for tracking moving secrets across a clip. */
  keyframes?: MaskKeyframe[];
}

export interface ProgressBarProps {
  position: 'top' | 'bottom';
  /** Height as fraction of canvas height (e.g. 0.008). */
  height: number;
  color: string;
  backgroundColor: string;
}

export interface PulseProps {
  /** Normalized 0..1 coordinates on canvas. */
  x: number;
  y: number;
  color: string;
  rings: number;
}

export interface CountdownProps {
  seconds: number;
  label?: string;
  color: string;
}

export interface ColorWheelValue {
  /** Hue angle in degrees (0..360). */
  hueDeg: number;
  /** Saturation / chroma shift (0..1). */
  sat: number;
  /** Luminance lift/gamma/gain offset (-1..1). */
  luma: number;
}

export interface ColorWheelsProps {
  global?: ColorWheelValue;
  shadows?: ColorWheelValue;
  midtones?: ColorWheelValue;
  highlights?: ColorWheelValue;
}

export type HslColorBand =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'aqua'
  | 'blue'
  | 'purple'
  | 'magenta';

export interface HslBandAdjustment {
  /** Hue shift in degrees (-180..180). */
  hue: number;
  /** Saturation delta (-1..1). */
  sat: number;
  /** Luminance delta (-1..1). */
  luma: number;
}

export interface ToneCurvePoint {
  /** Normalized input level (0..1). */
  x: number;
  /** Normalized output level (0..1). */
  y: number;
}

export interface ToneCurvesProps {
  rgb?: ToneCurvePoint[];
  red?: ToneCurvePoint[];
  green?: ToneCurvePoint[];
  blue?: ToneCurvePoint[];
}

export interface CustomLutData {
  id: string;
  name: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** Flattened RGB triplets of length size^3 * 3. */
  lattice: number[];
}

export interface ClipEffects {
  brightness: number;
  contrast: number;
  exposure: number;
  saturation: number;
  temperature: number;
  vibrance: number;
  highlights?: number;
  shadows?: number;
  tint?: number;
  sharpen?: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Radial darkening around frame edges, 0..1. */
  vignette?: number;
  /** Screen Studio style inset padding fraction (0..0.18). */
  backdropPadding?: number;
  backdropColor?: string;
  /** When > 1, progressively reveals a diagram clip in discrete steps across its duration. */
  revealSteps?: number;
  revealDirection?: 'left-to-right' | 'top-to-bottom';
  /** Active dynamic motion or shader video effect ID (148 effects, neutral: 'none'). */
  videoEffect?: string;
  /** Active color grading filter ID (77 presets, neutral: 'normal'). */
  colorFilter?: string;
  /** Active 3D Look-Up Table ID (16 cinematic LUTs or imported .cube LUT, neutral: 'none'). */
  lut?: string;
  /** Blend of the active LUT with the original pixels (0 = off, 1 = full). */
  lutStrength?: number;
  /** Persisted 3D .cube LUT lattice so imported custom LUTs survive project reload. */
  customLutData?: CustomLutData;
  /** 4-way Color Wheels (Global, Shadows, Midtones, Highlights). */
  colorWheels?: ColorWheelsProps;
  /** 8-band per-color HSL adjustments (Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta). */
  hslBands?: Partial<Record<HslColorBand, HslBandAdjustment>>;
  /** RGB and per-channel Tone Curves. */
  toneCurves?: ToneCurvesProps;
}

export type TransitionType =
  | 'none'
  | 'normal'
  | 'fade'
  | 'dissolve'
  | 'slide-left'
  | 'slide-right'
  | 'wipe'
  | (string & {});

export interface TransitionProps {
  type: TransitionType;
  durationTicks: Tick;
  easing?: Easing;
}

export type AlphaMaskShape = 'none' | 'rectangle' | 'circle' | 'star' | 'heart' | 'split-screen';

export interface AlphaMaskProps {
  shape: AlphaMaskShape;
  /** Soft-edge feathering radius in normalized units (0..1). */
  feather: number;
  /** Inverted mask toggle (true masks inside, false clips to inside). */
  invert: boolean;
  /** Center X in normalized canvas coordinates (0..1). */
  x: number;
  /** Center Y in normalized canvas coordinates (0..1). */
  y: number;
  /** Scale X (0..2). */
  scaleX: number;
  /** Scale Y (0..2). */
  scaleY: number;
  /** Rotation in clockwise degrees (0..360). */
  rotationDeg?: number;
}

export interface Clip {
  id: string;
  kind: ClipKind;
  /** Absent for title/solid clips. */
  assetId?: string;
  /** Timeline start. */
  startTicks: Tick;
  durationTicks: Tick;
  /** Offset into the source media. */
  inTicks: Tick;
  /** When set, the clip shows this source frame for its whole length (a hold). */
  freezeAt?: Tick;
  /** Playback speed; 1 = real time. Rendered frames are sourced at in + local*speed. */
  speed: number;
  /** Play source frames and audio in reverse from end of clip trim back to inTicks. */
  reverse?: boolean;
  /** Active velocity remapping curve preset (8 curves, e.g. 'constant_speed', 'bullet_time'). */
  speedCurve?: string;
  /** Clips sharing a linkId are cut/moved together. */
  linkId?: string;
  label?: string;
  transform: Transform;
  effects: ClipEffects;
  audio: AudioProps;
  text?: TextProps;
  arrow?: ArrowProps;
  sticker?: StickerProps;
  contact?: ContactProps;
  keystroke?: KeystrokeProps;
  endScreen?: EndScreenProps;
  progressBar?: ProgressBarProps;
  pulse?: PulseProps;
  countdown?: CountdownProps;
  presenter?: PresenterProps;
  masks: MaskProps[];
  /** Geometric alpha compositing mask ('rectangle' | 'circle' | 'star' | 'heart' | 'split-screen'). */
  alphaMask?: AlphaMaskProps;
  transitionIn: TransitionProps;
  transitionOut: TransitionProps;
  keyframes: KeyframeTrack[];
  /** Caption cues are stored on the project, not the clip, but a caption clip can scope a range. */
  captionCueId?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  muted: boolean;
  /** When any track of the same kind has solo === true, non-soloed tracks of that kind are silenced. */
  solo?: boolean;
  hidden: boolean;
  locked: boolean;
  /** 0..1 */
  volume: number;
  height: number;
}

export type CustomFontFormat = 'woff2' | 'woff' | 'ttf' | 'otf';

export interface CustomFontDescriptor {
  id: string;
  family: string;
  fileName: string;
  format: CustomFontFormat;
  /** Base64-encoded font binary persisted with the project and backups. */
  dataBase64: string;
  byteLength: number;
  uploadedAt: string;
}

export interface StoryboardItem {
  id: string;
  title: string;
  notes?: string;
  durationSeconds?: number;
  done: boolean;
}

export interface Marker {
  id: string;
  atTicks: Tick;
  label: string;
  color: string;
}

export interface CaptionCue {
  id: string;
  startTicks: Tick;
  endTicks: Tick;
  text: string;
  /** Optional word-level timings, only present when a model produced them. */
  words?: CaptionWord[];
  speaker?: string;
}

export interface CaptionWord {
  startTicks: Tick;
  endTicks: Tick;
  text: string;
  confidence?: number;
}

export interface CaptionStyle {
  preset: CaptionPreset;
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

export interface CanvasSettings {
  width: number;
  height: number;
  fps: FrameRate;
  background: string;
  safeMargin: number;
}

export interface ProjectSettings {
  /** Recording segment commit interval. Measured tradeoff, 10s is the default. */
  segmentSeconds: number;
  /** Preferred proxy height for editing. 0 disables proxy generation. */
  proxyHeight: number;
  /** Audio sample rate used for offline mixdown. */
  sampleRate: number;
  /** Directory naming is fixed; this only records the chosen layout version. */
  workspaceLayoutVersion: number;
  autoTranscribeOnImport: boolean;
  duckingEnabled?: boolean;
  duckingAmountDb?: number;
  glossary: Record<string, string>;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvas: CanvasSettings;
  tracks: Track[];
  assets: Asset[];
  markers: Marker[];
  captions: CaptionCue[];
  captionStyle: CaptionStyle;
  settings: ProjectSettings;
  /** Optional; absent on projects saved before the brand kit existed. */
  brand?: BrandKit;
  /** Uploaded local fonts (WOFF2, WOFF, TTF, OTF) persisted with the project and backups. */
  customFonts?: CustomFontDescriptor[];
  /** Shot list / storyboard checklist for planning and share handoff. */
  storyboard?: StoryboardItem[];
  /** Editable social post caption for manual publish handoff. */
  socialCaption?: string;
  /** Selected cover frame timestamp in ticks. */
  coverTimeTicks?: Tick;
  /** Duration of the last known timeline, kept for quick listing without recompute. */
  durationTicks: Tick;
  notes: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  durationTicks: Tick;
  folder: string;
}
