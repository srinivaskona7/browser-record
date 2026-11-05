import type { Project } from './types';

export interface SecretMatch {
  kind: string;
  preview: string;
  line: number;
}

export interface SecretTextFinding extends SecretMatch {
  source: 'caption' | 'clip' | 'notes';
  id: string;
}

export interface SecretRegionCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
}

const SECRET_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  { kind: 'AWS Access Key', regex: /\b(AKIA[0-9A-Z]{16})\b/g },
  { kind: 'GitHub Token', regex: /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'Slack Token', regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
  { kind: 'JWT / Bearer Token', regex: /\b(eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?)\b/g },
  { kind: 'Private Key Block', regex: /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)/g },
  {
    kind: 'Credential Assignment',
    regex: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]?([A-Za-z0-9/+._=-]{10,})['"]?/gi,
  },
];

function maskPreview(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}•••`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-3)}`;
}

/**
 * Heuristic local scanner for common DevOps tokens, keys and password assignments
 * in text blocks. Experimental: helps catch accidental leaks in titles/captions,
 * but is never a redaction guarantee.
 */
export function scanTextForSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index]!;
    for (const { kind, regex } of SECRET_PATTERNS) {
      const localRegex = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = localRegex.exec(lineText)) !== null) {
        const token = match[1] ?? match[0];
        matches.push({
          kind,
          preview: maskPreview(token),
          line: index + 1,
        });
      }
    }
  }
  return matches;
}

/** Scan every title/code/terminal clip, caption cue and project note for secret patterns. */
export function scanProjectTextSecrets(project: Project): SecretTextFinding[] {
  const findings: SecretTextFinding[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.text?.text) {
        for (const item of scanTextForSecrets(clip.text.text)) {
          findings.push({ ...item, source: 'clip', id: clip.id });
        }
      }
    }
  }
  for (const cue of project.captions) {
    for (const item of scanTextForSecrets(cue.text)) {
      findings.push({ ...item, source: 'caption', id: cue.id });
    }
  }
  if (project.notes) {
    for (const item of scanTextForSecrets(project.notes)) {
      findings.push({ ...item, source: 'notes', id: project.id });
    }
  }
  return findings;
}

/**
 * Local pixel-row contrast scanner for terminal/IDE frames. Looks for compact
 * horizontal bands with high character-edge density (typical of long hex/base64
 * credential lines) and returns candidate normalized mask rects.
 *
 * Experimental only: does not guarantee secret redaction. Always inspect masks manually.
 */
export function scanFrameForSecretRegions(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}): SecretRegionCandidate[] {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return [];

  const bands = 20;
  const bandHeight = Math.max(1, Math.floor(height / bands));
  const candidates: SecretRegionCandidate[] = [];

  for (let b = 0; b < bands; b += 1) {
    const yStart = b * bandHeight;
    const yEnd = Math.min(height, yStart + bandHeight);
    let transitions = 0;
    let minEdgeX = width;
    let maxEdgeX = 0;
    const sampleY = Math.min(height - 1, Math.floor((yStart + yEnd) / 2));

    let prevLuma = pixelLuma(data, (sampleY * width) * 4);
    for (let x = 1; x < width; x += 1) {
      const luma = pixelLuma(data, (sampleY * width + x) * 4);
      if (Math.abs(luma - prevLuma) > 65) {
        transitions += 1;
        if (x < minEdgeX) minEdgeX = x;
        if (x > maxEdgeX) maxEdgeX = x;
      }
      prevLuma = luma;
    }

    const density = transitions / width;
    if (transitions >= 12 && density >= 0.12 && maxEdgeX > minEdgeX) {
      const padX = Math.round(width * 0.02);
      const rx = Math.max(0, minEdgeX - padX) / width;
      const rw = Math.min(1 - rx, (maxEdgeX - minEdgeX + padX * 2) / width);
      candidates.push({
        x: Number(rx.toFixed(3)),
        y: Number((yStart / height).toFixed(3)),
        width: Number(Math.max(0.12, rw).toFixed(3)),
        height: Number(Math.max(0.05, (yEnd - yStart) / height).toFixed(3)),
        reason: 'High-density character row (experimental heuristic)',
      });
    }
  }

  return candidates.slice(0, 4);
}

function pixelLuma(data: Uint8ClampedArray | number[], offset: number): number {
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
