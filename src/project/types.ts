import type { FrameRate, Tick } from '../core/time';

/** Bump when the persisted project shape changes; migrations.ts must cover it. */
export const PROJECT_SCHEMA_VERSION = 3;

export type AssetKind = 'video' | 'audio' | 'image';
export type TrackKind = 'video' | 'audio' | 'caption';
export type ClipKind = 'media' | 'title' | 'solid' | 'arrow' | 'sticker' | 'contact' | 'keystroke' | 'endscreen';

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
  | 'minimal-pill';

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
}

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

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
}

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
  background: string;
  backgroundOpacity: number;
  align: 'left' | 'center' | 'right';
  maxWidth: number;
  letterSpacing: number;
  lineHeight: number;
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
  layout: 'bubble' | 'side-by-side' | 'full';
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Diameter as a fraction of canvas height when layout is 'bubble'. */
  size: number;
  margin: number;
  /** 'portrait' is a 3:4 rounded card; the others are square. */
  shape: 'circle' | 'rounded' | 'square' | 'portrait';
  mirror: boolean;
  chromaKey: boolean;
  shadow: number;
  /** Outline width in composition pixels; 0 disables the ring. */
  border: number;
  borderColor: string;
}

export interface MaskProps {
  x: number;
  y: number;
  width: number;
  height: number;
  mode: 'blur' | 'pixelate';
  strength: number;
}

export interface ClipEffects {
  brightness: number;
  contrast: number;
  exposure: number;
  saturation: number;
  temperature: number;
  vibrance: number;
  zoom: number;
  panX: number;
  panY: number;
  /** When > 1, progressively reveals a diagram clip in discrete steps across its duration. */
  revealSteps?: number;
  revealDirection?: 'left-to-right' | 'top-to-bottom';
}

export interface TransitionProps {
  type: 'none' | 'fade' | 'dissolve' | 'slide-left' | 'slide-right' | 'wipe';
  durationTicks: Tick;
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
  presenter?: PresenterProps;
  masks: MaskProps[];
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
  hidden: boolean;
  locked: boolean;
  /** 0..1 */
  volume: number;
  height: number;
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
