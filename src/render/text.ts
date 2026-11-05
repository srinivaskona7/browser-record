export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TextLayoutOptions {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  maxWidth: number;
  lineHeight: number;
  letterSpacing?: number;
}

export function fontString(options: Pick<TextLayoutOptions, 'fontFamily' | 'fontSize' | 'fontWeight'>): string {
  return `${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
}

/**
 * Greedy word wrap. Returns the lines that fit maxWidth, never truncating
 * mid-word. Long unbroken tokens (file paths, commands) are broken by
 * character so they stay on screen.
 */
export function wrapLines(ctx: Ctx2D, text: string, options: TextLayoutOptions): string[] {
  ctx.font = fontString(options);
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= options.maxWidth || current === '') {
        current = candidate;
        // A single token wider than the box: break it by characters.
        if (ctx.measureText(current).width > options.maxWidth) {
          const broken = breakToken(ctx, current, options.maxWidth);
          lines.push(...broken.slice(0, -1));
          current = broken[broken.length - 1] ?? '';
        }
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function breakToken(ctx: Ctx2D, token: string, maxWidth: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const char of token) {
    const candidate = current + char;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      out.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Chunk caption text into display lines of at most maxChars characters. */
export function chunkCaptionText(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!word) continue;
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
