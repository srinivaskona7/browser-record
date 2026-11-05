import { TICKS_PER_SECOND, type Tick } from '../core/time';
import type { BrandKit, Marker } from './types';

/** YouTube chapter list: one "m:ss Label" line per marker, in time order. */
export function formatChapters(markers: Marker[]): string {
  return [...markers]
    .sort((a, b) => a.atTicks - b.atTicks)
    .map((marker) => `${formatChapterTime(marker.atTicks)} ${marker.label}`)
    .join('\n');
}

export function formatChapterTime(ticks: Tick): string {
  const total = Math.max(0, Math.floor(ticks / TICKS_PER_SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * Video description: chapter lines (YouTube needs a 0:00 first chapter, so an
 * "Intro" line is added when the first marker is later) plus the brand contact lines.
 */
export function formatDescription(markers: Marker[], brand?: BrandKit): string {
  const sorted = [...markers].sort((a, b) => a.atTicks - b.atTicks);
  const lines = sorted.length > 0 && sorted[0]!.atTicks > 0 ? [`0:00 Intro`] : [];
  const chapters = [...lines, formatChapters(sorted)].filter(Boolean).join('\n');
  const contact = brand
    ? [`${brand.name}${brand.role ? ` · ${brand.role}` : ''}`, brand.email, brand.linkedin].filter(Boolean).join('\n')
    : '';
  return [chapters, contact].filter(Boolean).join('\n\n');
}
