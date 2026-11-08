import { TICKS_PER_SECOND, type Tick } from '../core/time';
import { newId } from '../core/ids';
import type { CaptionCue, CaptionWord } from '../project/types';

export interface ParseIssue {
  line: number;
  message: string;
}

export interface ParseResult<T> {
  value: T;
  issues: ParseIssue[];
}

const TIMESTAMP = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export function parseTimestampToTicks(text: string): Tick | null {
  const match = TIMESTAMP.exec(text.trim());
  if (!match) return null;
  const [, h = '0', m = '0', s = '0', ms = '0'] = match;
  return (
    (Number(h) * 3600 + Number(m) * 60 + Number(s)) * TICKS_PER_SECOND +
    Math.round((Number(ms.padEnd(3, '0')) * TICKS_PER_SECOND) / 1000)
  );
}

export function formatSrtTime(ticks: Tick): string {
  const totalMs = Math.max(0, Math.round((ticks * 1000) / TICKS_PER_SECOND));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, '0')}`;
}

export function formatVttTime(ticks: Tick): string {
  return formatSrtTime(ticks).replace(',', '.');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Parse SRT. Malformed blocks are skipped and reported, never silently eaten. */
export function parseSrt(text: string): ParseResult<CaptionCue[]> {
  const issues: ParseIssue[] = [];
  const cues: CaptionCue[] = [];
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const blocks = normalized.split(/\n{2,}/);
  blocks.forEach((block, blockIndex) => {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;
    let index = 0;
    if (/^\d+$/.test(lines[0]!.trim())) index = 1;
    const timeLine = lines[index];
    if (!timeLine || !timeLine.includes('-->')) {
      issues.push({ line: blockIndex + 1, message: 'Block has no "start --> end" timing line.' });
      return;
    }
    const [startRaw, endRaw] = timeLine.split('-->');
    const startTicks = startRaw ? parseTimestampToTicks(startRaw) : null;
    const endTicks = endRaw ? parseTimestampToTicks(endRaw) : null;
    if (startTicks === null || endTicks === null || endTicks <= startTicks) {
      issues.push({ line: blockIndex + 1, message: `Invalid timing: "${timeLine.trim()}"` });
      return;
    }
    const cueText = lines
      .slice(index + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!cueText) {
      issues.push({ line: blockIndex + 1, message: 'Cue has no text.' });
      return;
    }
    cues.push({ id: newId('cue'), startTicks, endTicks, text: cueText });
  });
  return { value: cues.sort((a, b) => a.startTicks - b.startTicks), issues };
}

/** Parse WebVTT. Supports cue timings and NOTE/STYLE blocks being ignored. */
export function parseVtt(text: string): ParseResult<CaptionCue[]> {
  const issues: ParseIssue[] = [];
  const cues: CaptionCue[] = [];
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  if (!normalized.startsWith('WEBVTT')) {
    issues.push({ line: 1, message: 'File does not start with the WEBVTT header.' });
  }
  const blocks = normalized.split(/\n{2,}/).slice(1);
  blocks.forEach((block, blockIndex) => {
    const lines = block.split('\n');
    if (lines[0]?.startsWith('NOTE') || lines[0]?.startsWith('STYLE') || lines[0]?.startsWith('REGION')) return;
    const timeIndex = lines.findIndex((l) => l.includes('-->'));
    if (timeIndex === -1) {
      issues.push({ line: blockIndex + 2, message: 'WebVTT block has no timing line.' });
      return;
    }
    const timeLine = lines[timeIndex]!;
    const [startRaw, endRaw] = timeLine.split('-->');
    const startTicks = startRaw ? parseTimestampToTicks(startRaw) : null;
    const endTicks = endRaw ? parseTimestampToTicks(endRaw.trim().split(/\s+/)[0] ?? '') : null;
    if (startTicks === null || endTicks === null || endTicks <= startTicks) {
      issues.push({ line: blockIndex + 2, message: `Invalid timing: "${timeLine.trim()}"` });
      return;
    }
    const cueText = lines
      .slice(timeIndex + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!cueText) return;
    cues.push({ id: newId('cue'), startTicks, endTicks, text: cueText });
  });
  return { value: cues.sort((a, b) => a.startTicks - b.startTicks), issues };
}

export function parseSubtitles(text: string): ParseResult<CaptionCue[]> {
  return text.trimStart().startsWith('WEBVTT') ? parseVtt(text) : parseSrt(text);
}

export function serializeSrt(cues: readonly CaptionCue[]): string {
  return cues
    .filter((cue) => cue.text.trim().length > 0)
    .sort((a, b) => a.startTicks - b.startTicks)
    .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.startTicks)} --> ${formatSrtTime(cue.endTicks)}\n${cue.text}\n`)
    .join('\n');
}

export function serializeVtt(cues: readonly CaptionCue[], options: { wordTimings?: boolean } = {}): string {
  const header = 'WEBVTT\n\n';
  const body = cues
    .filter((cue) => cue.text.trim().length > 0)
    .sort((a, b) => a.startTicks - b.startTicks)
    .map((cue, index) => {
      const timing = `${formatVttTime(cue.startTicks)} --> ${formatVttTime(cue.endTicks)}`;
      const text =
        options.wordTimings && cue.words?.length
          ? cue.words
              .map(
                (word) =>
                  `<${formatVttTime(word.startTicks)}><c>${escapeVtt(word.text)}</c>`,
              )
              .join(' ')
          : escapeVtt(cue.text);
      return `${index + 1}\n${timing}\n${text}\n`;
    })
    .join('\n');
  return header + body;
}

function escapeVtt(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function serializeTranscript(cues: readonly CaptionCue[]): string {
  return cues.map((cue) => cue.text.trim()).join('\n\n');
}

export const toSrt = serializeSrt;
export const toVtt = serializeVtt;

/** Shift every cue and its word timings. */
export function retimeCues(cues: readonly CaptionCue[], deltaTicks: Tick): CaptionCue[] {
  return cues.map((cue) => ({
    ...cue,
    startTicks: Math.max(0, cue.startTicks + deltaTicks),
    endTicks: Math.max(1, cue.endTicks + deltaTicks),
    words: cue.words?.map((w) => ({
      ...w,
      startTicks: Math.max(0, w.startTicks + deltaTicks),
      endTicks: Math.max(1, w.endTicks + deltaTicks),
    })),
  }));
}

/** Scale cue timing around an origin, used when audio speed changes. */
export function scaleCues(cues: readonly CaptionCue[], factor: number, originTicks: Tick): CaptionCue[] {
  const scale = (value: Tick) => Math.round(originTicks + (value - originTicks) * factor);
  return cues.map((cue) => ({
    ...cue,
    startTicks: scale(cue.startTicks),
    endTicks: scale(cue.endTicks),
    words: cue.words?.map((w) => ({ ...w, startTicks: scale(w.startTicks), endTicks: scale(w.endTicks) })),
  }));
}

/**
 * Split long cues at word boundaries, and fill gaps left by splitting so the
 * new cue starts where the previous one ends.
 */
export function rebalanceCues(cues: readonly CaptionCue[], maxChars: number): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const cue of cues) {
    if (cue.text.length <= maxChars) {
      out.push(cue);
      continue;
    }
    const words = cue.text.split(/\s+/);
    const chunks: string[] = [];
    let current = '';
    for (const word of words) {
      if (!current) current = word;
      else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
      else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    const totalDuration = cue.endTicks - cue.startTicks;
    const totalWeight = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
    let cursor = cue.startTicks;
    chunks.forEach((chunk, index) => {
      const share = Math.round((totalDuration * chunk.length) / totalWeight);
      const isLast = index === chunks.length - 1;
      const end = isLast ? cue.endTicks : cursor + share;
      out.push({
        id: newId('cue'),
        startTicks: cursor,
        endTicks: Math.max(cursor + 1, end),
        text: chunk,
        ...(index === 0 && cue.words ? { words: cue.words.filter((w) => w.startTicks < end) } : {}),
      });
      cursor = end;
    });
  }
  return out;
}

/** Merge cues that are adjacent and could read as one line. */
export function mergeAdjacentCues(cues: readonly CaptionCue[], maxGapTicks: Tick = Math.round(TICKS_PER_SECOND * 0.3)): CaptionCue[] {
  const sorted = [...cues].sort((a, b) => a.startTicks - b.startTicks);
  const out: CaptionCue[] = [];
  for (const cue of sorted) {
    const last = out[out.length - 1];
    if (last && cue.startTicks - last.endTicks <= maxGapTicks && last.text.length + cue.text.length < 90) {
      out[out.length - 1] = {
        ...last,
        endTicks: cue.endTicks,
        text: `${last.text} ${cue.text}`.replace(/\s+/g, ' ').trim(),
        words: last.words && cue.words ? [...last.words, ...cue.words] : undefined,
      };
    } else {
      out.push(cue);
    }
  }
  return out;
}

export interface ReplaceResult {
  cues: CaptionCue[];
  count: number;
}

export function findAndReplace(
  cues: readonly CaptionCue[],
  find: string,
  replacement: string,
  options: { caseSensitive?: boolean; all?: boolean } = {},
): ReplaceResult {
  if (!find) return { cues: [...cues], count: 0 };
  const flags = options.caseSensitive ? 'g' : 'gi';
  const pattern = new RegExp(escapeRegExp(find), flags);
  let count = 0;
  const limit = options.all === false ? 1 : Infinity;
  const next = cues.map((cue) => {
    const matches = cue.text.match(pattern);
    if (!matches) return cue;
    const allowed = Math.min(matches.length, limit - count);
    if (allowed <= 0) return cue;
    let replaced = 0;
    const text = cue.text.replace(pattern, () => {
      replaced += 1;
      return replaced <= allowed ? replacement : matches[replaced - 1]!;
    });
    count += Math.min(replaced, allowed);
    return { ...cue, text };
  });
  return { cues: next, count };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Transcript text with cue timings preserved, for the editor list. */
export function cuesToPlainText(cues: readonly CaptionCue[]): string {
  return cues.map((cue) => `${formatSrtTime(cue.startTicks)}  ${cue.text}`).join('\n');
}

/** Normalize punctuation and sentence casing without changing meaning. */
export function normalizePunctuation(cues: readonly CaptionCue[]): CaptionCue[] {
  return cues.map((cue) => {
    let text = cue.text
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;!?])/g, '$1')
      .trim();
    if (text && !/[.!?]$/.test(text)) text = `${text}.`;
    if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
    return { ...cue, text };
  });
}

/** Assign word timings only when a model actually returned them. */
export function attachWords(cue: CaptionCue, words: CaptionWord[]): CaptionCue {
  return { ...cue, words };
}

export function cuesCoverage(cues: readonly CaptionCue[], durationTicks: Tick): number {
  if (durationTicks <= 0) return 0;
  const covered = cues.reduce((sum, cue) => sum + Math.max(0, Math.min(cue.endTicks, durationTicks) - cue.startTicks), 0);
  return Math.min(1, covered / durationTicks);
}
