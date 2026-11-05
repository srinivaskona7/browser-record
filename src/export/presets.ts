import type { Project } from '../project/types';

export type PresetId = '4k-compact' | '4k-balanced' | '4k-quality' | '1080p-share' | 'shorts-vertical' | 'custom';

export interface ExportPreset {
  id: PresetId;
  label: string;
  description: string;
  width: number;
  height: number;
  /** Video bitrate in bits per second. These are engineering starting points. */
  videoBitrate: number;
  audioBitrate: number;
  container: 'mp4' | 'webm';
  /** Preferred codec family order; the first supported wins. */
  codecPreference: Array<'h264' | 'vp9' | 'av1' | 'hevc'>;
  /** Optional platform duration cap in seconds (e.g. 60s for Shorts/Reels). */
  maxDurationSeconds?: number;
  /** Optional platform file size ceiling in bytes. */
  maxBytes?: number;
}

export const PRESETS: ExportPreset[] = [
  {
    id: '4k-compact',
    label: '4K teaching compact',
    description: 'Static screens and terminal text at 4K. Smallest files; motion may soften.',
    width: 3840,
    height: 2160,
    videoBitrate: 6_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9', 'av1'],
  },
  {
    id: '4k-balanced',
    label: '4K balanced',
    description: 'Default. Keeps terminal text crisp through scrolling and cursor motion.',
    width: 3840,
    height: 2160,
    videoBitrate: 10_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9', 'av1'],
  },
  {
    id: '4k-quality',
    label: '4K high quality',
    description: 'Camera-heavy lessons, whiteboard strokes, or heavy motion.',
    width: 3840,
    height: 2160,
    videoBitrate: 18_000_000,
    audioBitrate: 192_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9', 'av1'],
  },
  {
    id: '1080p-share',
    label: '1080p sharing',
    description: 'Fast uploads and course platforms; 4K source stays on disk.',
    width: 1920,
    height: 1080,
    videoBitrate: 5_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
  },
  {
    id: 'shorts-vertical',
    label: 'Shorts / Reels (9:16)',
    description: '1080×1920 vertical MP4 for YouTube Shorts and Instagram Reels (60 s cap, 60 MB size check).',
    width: 1080,
    height: 1920,
    videoBitrate: 6_000_000,
    audioBitrate: 128_000,
    container: 'mp4',
    codecPreference: ['h264', 'vp9'],
    maxDurationSeconds: 60,
    maxBytes: 60_000_000,
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
  // Three 4K presets share one size; "balanced" is the documented default.
  const preferred = matches.find((preset) => preset.id === '4k-balanced') ?? matches[0];
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

  // Below ~0.02 bits/pixel/second, small text and UI edges start to smear.
  const threshold = params.height >= 2000 ? 0.02 : 0.015;
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
