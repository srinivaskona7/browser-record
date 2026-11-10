import type { Project } from '../project/types';

export type PresetId =
  | '4k-compact'
  | '4k-balanced'
  | '4k-quality'
  | '4k60-master'
  | '1080p-share'
  | 'youtube-1080p30'
  | 'youtube-1080p60'
  | 'shorts-vertical'
  | 'insta-square-1080'
  | 'insta-portrait-4x5'
  | 'youtube-4k-longform'
  | 'youtube-1080p-hd'
  | 'youtube-shorts'
  | 'insta-reels'
  | 'linkedin-feed-1080p'
  | 'linkedin-square-1080'
  | 'linkedin-portrait-4x5'
  | 'linkedin-vertical-9x16'
  | 'custom';

export interface ExportPreset {
  id: PresetId;
  label: string;
  description: string;
  width: number;
  height: number;
  /** Explicit output frame rate when specified by the preset (e.g. 30 vs 60 fps). */
  fps?: number;
  /** Video bitrate in bits per second. These are engineering starting points. */
  videoBitrate: number;
  audioBitrate: number;
  container: 'mp4' | 'webm';
  /** Preferred codec family order; the first supported wins. */
  codecPreference: Array<'h264' | 'vp9' | 'av1' | 'hevc'>;
  /** Optional target platform tag ('youtube' | 'instagram' | 'linkedin' | 'universal'). */
  platform?: 'youtube' | 'instagram' | 'linkedin' | 'universal';
  /** Optional platform duration cap in seconds (e.g. 60s for Shorts/Reels). */
  maxDurationSeconds?: number;
  /** Optional platform file size ceiling in bytes. */
  maxBytes?: number;
}

export const PRESETS: ExportPreset[] = [
  {
    id: '4k-compact',
    label: '4K Ultra-Compact (4.2 Mbps · Smallest 4K)',
    description: 'Razor-sharp 3840×2160 terminal & slide text in ~32 MB/min (~1.9 GB/hr) using high-efficiency VBR.',
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrate: 4_200_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['hevc', 'av1', 'h264', 'vp9'],
  },
  {
    id: '4k-balanced',
    label: '4K Crisp (5.5 Mbps · Recommended)',
    description: 'Default 4K. Keeps 3840×2160 terminal text & camera bubble crystal-clear in ~42 MB/min (~2.5 GB/hr).',
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrate: 5_500_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['hevc', 'av1', 'h264', 'vp9'],
  },
  {
    id: '4k-quality',
    label: '4K High Motion (9.5 Mbps)',
    description: 'Camera-heavy lessons, whiteboard strokes, or fast full-screen motion in compact VBR.',
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrate: 9_500_000,
    audioBitrate: 160_000,
    container: 'mp4',
    codecPreference: ['hevc', 'av1', 'h264', 'vp9'],
  },
  {
    id: '1080p-share',
    label: '1080p sharing (5 Mbps)',
    description: 'Fast uploads and course platforms; 4K source stays on disk.',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
  },
  {
    id: 'shorts-vertical',
    label: 'Shorts / Reels (9:16 · 6 Mbps)',
    description: '1080×1920 vertical MP4 for YouTube Shorts and Instagram Reels (60 s cap, 60 MB size check).',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: 6_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    maxDurationSeconds: 60,
    maxBytes: 60_000_000,
  },
  {
    id: 'insta-portrait-4x5',
    label: 'Instagram / LinkedIn Portrait (4:5)',
    description: '1080×1350 portrait feed MP4 for maximum mobile feed height on Instagram and LinkedIn.',
    width: 1080,
    height: 1350,
    videoBitrate: 5_500_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    maxDurationSeconds: 90,
    maxBytes: 100_000_000,
  },
  {
    id: 'insta-square-1080',
    label: 'Instagram / Carousel Square (1:1)',
    description: '1080×1080 square MP4 for social carousels, embeds and documentation feeds.',
    width: 1080,
    height: 1080,
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    maxDurationSeconds: 90,
    maxBytes: 100_000_000,
  },
  {
    id: '4k60-master',
    label: '4K Studio Master (60 fps · 18 Mbps)',
    description: 'High-bitrate 3840×2160 60 fps archival master for fast terminal motion and YouTube 4K60 uploads.',
    width: 3840,
    height: 2160,
    fps: 60,
    videoBitrate: 18_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9', 'av1'],
    platform: 'youtube',
  },
  {
    id: 'youtube-4k-longform',
    label: 'YouTube 4K Long-Form (16:9 · 30 fps)',
    description: '3840×2160 16:9 MP4 tuned for YouTube 4K tutorials, coding walkthroughs, and deep-dives.',
    width: 3840,
    height: 2160,
    fps: 30,
    videoBitrate: 14_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9', 'av1'],
    platform: 'youtube',
  },
  {
    id: 'youtube-1080p30',
    label: 'YouTube 1080p (8 Mbps · 30 fps)',
    description: '1920×1080 30 fps MP4 with crisp 8 Mbps video and 192 kbps stereo audio for technical lessons.',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'youtube',
  },
  {
    id: 'youtube-1080p60',
    label: 'YouTube 1080p60 (16:9 · 60 fps)',
    description: '1920×1080 60 fps MP4 with 12 Mbps video for smooth terminal scrolling, cursor motion, and UI demos.',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrate: 12_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'youtube',
  },
  {
    id: 'youtube-1080p-hd',
    label: 'YouTube 1080p Full HD (16:9)',
    description: '1920×1080 16:9 MP4 with crisp 8 Mbps video and 192 kbps stereo audio for standard YouTube uploads.',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'youtube',
  },
  {
    id: 'youtube-shorts',
    label: 'YouTube Shorts Vertical (9:16)',
    description: '1080×1920 9:16 vertical MP4 for YouTube Shorts (60s cap, 60 MB ceiling).',
    width: 1080,
    height: 1920,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'youtube',
    maxDurationSeconds: 60,
    maxBytes: 60_000_000,
  },
  {
    id: 'insta-reels',
    label: 'Instagram Reels & Stories (9:16)',
    description: '1080×1920 9:16 vertical MP4 for Instagram Reels and Stories (90s cap, 100 MB ceiling).',
    width: 1080,
    height: 1920,
    videoBitrate: 7_000_000,
    audioBitrate: 160_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'instagram',
    maxDurationSeconds: 90,
    maxBytes: 100_000_000,
  },
  {
    id: 'linkedin-feed-1080p',
    label: 'LinkedIn Feed Landscape (16:9)',
    description: '1920×1080 16:9 MP4 for LinkedIn engineering demos and thought-leadership posts (10 min cap, 200 MB ceiling).',
    width: 1920,
    height: 1080,
    videoBitrate: 6_000_000,
    audioBitrate: 160_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'linkedin',
    maxDurationSeconds: 600,
    maxBytes: 200_000_000,
  },
  {
    id: 'linkedin-square-1080',
    label: 'LinkedIn Feed Square Post (1:1)',
    description: '1080×1080 1:1 square MP4 for LinkedIn desktop and mobile feed posts (10 min cap, 200 MB ceiling).',
    width: 1080,
    height: 1080,
    videoBitrate: 5_000_000,
    audioBitrate: 160_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'linkedin',
    maxDurationSeconds: 600,
    maxBytes: 200_000_000,
  },
  {
    id: 'linkedin-portrait-4x5',
    label: 'LinkedIn Mobile Portrait Post (4:5)',
    description: '1080×1350 4:5 portrait MP4 for maximum LinkedIn mobile feed real estate (10 min cap, 200 MB ceiling).',
    width: 1080,
    height: 1350,
    videoBitrate: 5_500_000,
    audioBitrate: 160_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'linkedin',
    maxDurationSeconds: 600,
    maxBytes: 200_000_000,
  },
  {
    id: 'linkedin-vertical-9x16',
    label: 'LinkedIn Vertical Video (9:16)',
    description: '1080×1920 9:16 vertical MP4 for LinkedIn vertical video feeds (3 min cap, 200 MB ceiling).',
    width: 1080,
    height: 1920,
    videoBitrate: 6_000_000,
    audioBitrate: 160_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    platform: 'linkedin',
    maxDurationSeconds: 180,
    maxBytes: 200_000_000,
  },
];

export function presetById(id: PresetId): ExportPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/**
 * The delivery default for a composition. It must never start above the
 * capture size: a 1920×1080 project defaulting to a 3840×2160 preset would
 * produce an upscaled file labelled 4K. Only an exact match reuses a general
 * preset; duration-capped social presets are chosen explicitly.
 */
export function defaultPresetId(canvas: { width: number; height: number }): PresetId {
  const matches = PRESETS.filter(
    (preset) => !preset.maxDurationSeconds && preset.width === canvas.width && preset.height === canvas.height,
  );
  // Three 4K presets share one size; "balanced" is the documented default, and "1080p-share" for 1080p.
  const preferred =
    matches.find((preset) => preset.id === '4k-balanced') ??
    matches.find((preset) => preset.id === '1080p-share') ??
    matches[0];
  return preferred?.id ?? 'custom';
}

export interface BitrateBudget {
  totalMbps: number;
  videoMbps: number;
  audioMbps: number;
  overheadMbps: number;
  estimatedBytes: number;
  estimatedGB: number;
  bitsPerPixel: number;
  plausible: boolean;
  warnings: string[];
}

/** MP4/WebM container overhead is small but not zero; 1% is a fair planning number. */
export const CONTAINER_OVERHEAD = 0.01;

/**
 * Computes the 4× smaller Ultra-Compact VBR video and audio bitrates for screen,
 * terminal, and presenter-bubble lessons using long-GOP (8s keyframe interval),
 * `contentHint: 'detail'`, and high-efficiency HEVC/AV1/H.264 High VBR.
 */
export function applyCompactBitrateBudget(
  videoBitrate: number,
  audioBitrate: number,
  compactSizeMode = true,
): { videoBitrate: number; audioBitrate: number } {
  if (!compactSizeMode) {
    return { videoBitrate, audioBitrate };
  }
  return {
    videoBitrate: Math.max(350_000, Math.round(videoBitrate * 0.25)),
    audioBitrate: Math.min(audioBitrate, 96_000),
  };
}

/**
 * Plan a bitrate for a duration and target size. A target size is a budget,
 * not a promise: VBR encoders land near it, not on it.
 *
 * Decimal GB ≈ total Mbps × seconds / 8000.
 */
export function planBitrate(params: {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  audioBitrate: number;
  targetBytes?: number;
  videoBitrate?: number;
  maxDurationSeconds?: number;
  maxBytes?: number;
  compactSizeMode?: boolean;
}): BitrateBudget {
  const warnings: string[] = [];
  const overheadFactor = 1 + CONTAINER_OVERHEAD;
  let videoMbps: number;
  if (params.targetBytes && params.targetBytes > 0 && params.durationSeconds > 0) {
    const budgetBits = params.targetBytes * 8;
    const totalBitsPerSecond = budgetBits / params.durationSeconds;
    const audioBits = params.audioBitrate;
    const videoBits = totalBitsPerSecond / overheadFactor - audioBits;
    videoMbps = Math.max(0, videoBits / 1_000_000);
    if (videoBits <= 0) {
      warnings.push('The target size is smaller than the audio track alone. Choose a larger target or a shorter clip.');
    }
  } else {
    videoMbps = (params.videoBitrate ?? 10_000_000) / 1_000_000;
  }
  const audioMbps = params.audioBitrate / 1_000_000;
  const overheadMbps = (videoMbps + audioMbps) * CONTAINER_OVERHEAD;
  const totalMbps = videoMbps + audioMbps + overheadMbps;
  const estimatedBytes = (totalMbps * 1_000_000 * params.durationSeconds) / 8;
  const pixelsPerSecond = params.width * params.height * params.fps;
  const bitsPerPixel = pixelsPerSecond > 0 ? (videoMbps * 1_000_000) / pixelsPerSecond : 0;

  // Below ~0.02 bits/pixel/second (or ~0.0045 in 4× Ultra-Compact long-GOP screen-detail mode),
  // small text and UI edges start to smear.
  const baseThreshold = params.height >= 2000 ? 0.02 : 0.015;
  const threshold = params.compactSizeMode ? baseThreshold * 0.22 : baseThreshold;
  if (bitsPerPixel < threshold && params.durationSeconds > 0) {
    warnings.push(
      `${videoMbps.toFixed(2)} Mbps at ${params.width}×${params.height}${params.fps} is ${bitsPerPixel.toFixed(3)} bits/pixel — likely to soften terminal text and UI edges.`,
    );
  }
  if (params.targetBytes && params.durationSeconds > 0 && videoMbps < 2) {
    warnings.push('Under 2 Mbps is not a realistic budget for readable 4K; consider 1080p or splitting the lesson.');
  }
  if (params.maxDurationSeconds && params.durationSeconds > params.maxDurationSeconds) {
    warnings.push(
      `Duration (${params.durationSeconds.toFixed(1)}s) exceeds the ${params.maxDurationSeconds}s Shorts/Reels cap. Pick a marker segment ≤ ${params.maxDurationSeconds}s or trim the timeline.`,
    );
  }
  if (params.maxBytes && estimatedBytes > params.maxBytes) {
    warnings.push(
      `Estimated file size (${formatBytes(estimatedBytes)}) exceeds the ${formatBytes(params.maxBytes)} Shorts/Reels upload ceiling.`,
    );
  }
  return {
    totalMbps,
    videoMbps,
    audioMbps,
    overheadMbps,
    estimatedBytes,
    estimatedGB: estimatedBytes / 1_000_000_000,
    bitsPerPixel,
    plausible: warnings.length === 0,
    warnings,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

export function projectDurations(project: Project): { durationTicks: number; seconds: number } {
  return { durationTicks: project.durationTicks, seconds: project.durationTicks / 720_000 };
}

/** Sample segments chosen for a quality preview: one quiet, one busy. */
export interface SamplePlan {
  quiet: { startTicks: number; durationTicks: number };
  busy: { startTicks: number; durationTicks: number };
}

export function planQualitySamples(project: Project, sampleSeconds = 8): SamplePlan {
  const total = project.durationTicks;
  const sampleTicks = Math.min(total, Math.round(sampleSeconds * 720_000));
  const gap = Math.max(0, total - sampleTicks);
  return {
    quiet: { startTicks: 0, durationTicks: sampleTicks },
    busy: { startTicks: Math.max(0, Math.round(gap * 0.6)), durationTicks: sampleTicks },
  };
}
