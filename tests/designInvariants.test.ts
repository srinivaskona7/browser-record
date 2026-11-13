/**
 * Design invariants that otherwise live only in prose:
 *  - motion animates only transform/opacity, and never fills (`both`/`forwards`), because a
 *    filled transform/opacity on a page root re-parents every position:fixed child;
 *  - app chrome font sizes come from the --token-font-* ramp;
 *  - text and primary-button tokens meet WCAG AA (4.5:1) on every surface, both themes.
 * Each checker is also run against a known-bad input so a broken parser cannot pass silently.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { choosePlacement } from '../src/ui/popoverPlacement';
import { magneticOffset } from '../src/ui/magnetic';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const STYLES = read('src/styles.css');
const TOKENS = read('src/styles/tokens.css');
const UI_FILES = readdirSync(resolve(process.cwd(), 'src/ui'))
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, source: read(`src/ui/${name}`) }));

const COMPOSITOR_ONLY = new Set(['transform', 'opacity']);

/** Split on commas that are not inside parentheses (cubic-bezier, var). */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every transitioned or keyframed property that is not transform/opacity. */
function motionViolations(cssSource: string): string[] {
  const css = stripComments(cssSource);
  const violations: string[] = [];
  for (const match of css.matchAll(/(?<![-\w])transition(-property)?\s*:\s*([^;{}]+)/g)) {
    const value = match[2]?.trim() ?? '';
    if (value === 'none') continue;
    for (const part of splitTopLevel(value)) {
      const property = part.split(/\s+/)[0] ?? '';
      if (!COMPOSITOR_ONLY.has(property)) violations.push(`transition: ${property}`);
    }
  }
  for (const block of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) {
    for (const declaration of (block[2] ?? '').matchAll(/([\w-]+)\s*:/g)) {
      const property = declaration[1] ?? '';
      if (!COMPOSITOR_ONLY.has(property)) violations.push(`@keyframes ${block[1]}: ${property}`);
    }
  }
  for (const match of css.matchAll(/(?<![-\w])animation(-fill-mode)?\s*:\s*([^;{}]+)/g)) {
    if (/\b(both|forwards)\b/.test(match[2] ?? '')) violations.push(`animation fill: ${match[2]?.trim()}`);
  }
  return violations;
}

/** Inline React style objects that animate anything but transform/opacity. */
function inlineMotionViolations(tsx: string): string[] {
  const violations: string[] = [];
  for (const match of tsx.matchAll(/\btransition:\s*(['"`])([^'"`]+)\1/g)) {
    for (const part of splitTopLevel(match[2] ?? '')) {
      const property = part.split(/\s+/)[0] ?? '';
      if (part !== 'none' && !COMPOSITOR_ONLY.has(property)) violations.push(`inline transition: ${property}`);
    }
  }
  return violations;
}

/** The text from `start` (an opening bracket) to its matching close, skipping strings. */
function balanced(source: string, start: number): string {
  const open = source[start];
  const close = open === '{' ? '}' : open === '(' ? ')' : ']';
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === open) depth += 1;
    else if (char === close && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/**
 * JSX opening tags. A tag is never preceded by an identifier character, which rules out
 * generics (`useRef<HTMLDivElement>`); braces are balanced so `=>` and nested JSX inside an
 * attribute do not end the tag.
 */
function openingTags(tsx: string): string[] {
  const tags: string[] = [];
  for (const match of tsx.matchAll(/(?<![\w$.])<[A-Za-z][\w.]*(?=[\s/>])/g)) {
    let i = match.index;
    let quote: string | null = null;
    while (++i < tsx.length) {
      const char = tsx[i];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') i += balanced(tsx, i).length - 1;
      else if (char === '>') break;
    }
    tags.push(tsx.slice(match.index, i + 1));
  }
  return tags;
}

/** Class names written as string literals in a tag's className, with `${…}` expressions removed. */
function classTokens(tag: string): string[] {
  const at = tag.search(/\bclassName=/);
  if (at < 0) return [];
  const valueStart = at + 'className='.length;
  let text = tag[valueStart] === '{' ? balanced(tag, valueStart) : (/^"[^"]*"/.exec(tag.slice(valueStart))?.[0] ?? '');
  for (let i = text.indexOf('${'); i >= 0; i = text.indexOf('${')) text = text.slice(0, i) + text.slice(i + 1 + balanced(text, i + 1).length);
  return [...text.matchAll(/(["'`])([^"'`]*)\1/g)].flatMap((m) => (m[2] ?? '').split(/\s+/).filter(Boolean));
}

/** Top-level keys of a tag's inline `style={{ … }}`, shorthand properties included. */
function styleKeys(tag: string): string[] {
  const at = tag.search(/\bstyle=\{\{/);
  if (at < 0) return [];
  const object = balanced(tag, at + 'style={'.length).slice(1, -1);
  let flat = '';
  for (let i = 0; i < object.length; i++) {
    const char = object[i] ?? '';
    if ('"\'`{(['.includes(char)) {
      // Skip nested values; a quoted key ('--area-aspect') is a custom property and is skipped too.
      const skipped = '"\'`'.includes(char) ? (new RegExp(`^${char}(?:\\\\.|[^${char}\\\\])*${char}`).exec(object.slice(i))?.[0] ?? char) : balanced(object, i);
      i += skipped.length - 1;
      flat += '_';
    } else flat += char;
  }
  return flat
    .split(',')
    .map((part) => /^\s*([A-Za-z$][\w$]*)\s*(?::|$)/.exec(part)?.[1])
    .filter((key): key is string => Boolean(key));
}

const LAYOUT_KEYS = /^(left|top|right|bottom|width|height|inset\w*|margin\w*)$/;

/**
 * Pieces that move on every pointer frame of a drag. Each must be placed by transform alone;
 * `allow` lists layout keys that hold a committed value and do not change mid-drag.
 */
function dragPieceViolations(tsx: string, classes: readonly string[], allow: readonly string[] = []): { found: string[]; violations: string[] } {
  const found = new Set<string>();
  const violations: string[] = [];
  for (const tag of openingTags(tsx)) {
    const piece = classTokens(tag).find((token) => classes.includes(token));
    if (!piece) continue;
    found.add(piece);
    for (const key of styleKeys(tag)) if (LAYOUT_KEYS.test(key) && !allow.includes(key)) violations.push(`${piece}: ${key}`);
  }
  return { found: [...found], violations };
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** Custom properties declared directly in the first block whose selector matches. */
function themeVars(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[match[1] as string] = match[2] as string;
  return vars;
}

function contrastFailures(
  vars: Record<string, string>,
  texts: string[],
  surfaces: string[],
  pairs: Array<[string, string]> = [],
): string[] {
  const failures: string[] = [];
  const check = (fg: string, bg: string) => {
    const a = vars[fg];
    const b = vars[bg];
    if (!a || !b) {
      failures.push(`${fg} on ${bg}: missing token`);
      return;
    }
    const ratio = contrast(a, b);
    if (ratio < 4.5) failures.push(`${fg} ${a} on ${bg} ${b}: ${ratio.toFixed(2)}`);
  };
  for (const text of texts) for (const surface of surfaces) check(text, surface);
  for (const [fg, bg] of pairs) check(fg, bg);
  return failures;
}

/** Page roots and the Record card's direct children, which hold position:fixed descendants. */
const FIXED_HOST = /^\.(app-main|cap-recorder)(\s*>\s*[^\s>]+)*$/;

/**
 * Keyframe properties other than opacity animated on a fixed-overlay host. A transform, filter
 * or perspective on an ancestor becomes the containing block of its position:fixed children,
 * so the dock, self-view or area overlay would jump while the entry animation runs.
 */
function fixedHostAnimationViolations(cssSource: string): string[] {
  const css = stripComments(cssSource);
  const keyframes = new Map<string, string[]>();
  for (const block of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)) {
    keyframes.set(block[1] ?? '', [...(block[2] ?? '').matchAll(/([\w-]+)\s*:/g)].map((d) => d[1] ?? ''));
  }
  const violations: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitTopLevel(rule[1] ?? '').map((selector) => selector.trim());
    const host = selectors.find((selector) => FIXED_HOST.test(selector));
    if (!host) continue;
    for (const match of (rule[2] ?? '').matchAll(/(?<![-\w])animation(?:-name)?\s*:\s*([^;]+)/g)) {
      for (const token of splitTopLevel(match[1] ?? '').flatMap((part) => part.split(/\s+/))) {
        for (const property of keyframes.get(token) ?? []) {
          if (property !== 'opacity') violations.push(`${host} → ${token}: ${property}`);
        }
      }
    }
  }
  return violations;
}

describe('motion invariants', () => {
  it('rejects layout/paint motion and filled animations (checker self-test)', () => {
    expect(motionViolations('a { transition: width 1s ease, transform 1s; }')).toEqual(['transition: width']);
    expect(motionViolations('a { transition: background 120ms cubic-bezier(0.2, 0.7, 0.2, 1); }')).toEqual(['transition: background']);
    expect(motionViolations('@keyframes k { from { left: 0; opacity: 0; } to { left: 9px; } }')).toEqual([
      '@keyframes k: left',
      '@keyframes k: left',
    ]);
    expect(motionViolations('a { animation: k 200ms ease both; }')).toEqual(['animation fill: k 200ms ease both']);
    expect(motionViolations('a { transition: opacity 1s, transform 2s cubic-bezier(0, 0, 1, 1); animation: k 1s backwards; }')).toEqual([]);
    expect(inlineMotionViolations(`<div style={{ transition: 'height 140ms ease' }} />`)).toEqual(['inline transition: height']);
  });

  it('src/styles.css animates only transform and opacity, with no filled animations', () => {
    expect(motionViolations(STYLES)).toEqual([]);
    expect(motionViolations(TOKENS)).toEqual([]);
  });

  it('flags a transform entry animation on a fixed-overlay host (checker self-test)', () => {
    const rise = '@keyframes rise { from { opacity: 0; transform: translate3d(0, 8px, 0); } }';
    expect(fixedHostAnimationViolations(`${rise} .cap-recorder > .page-head, .x { animation: rise 200ms backwards; }`)).toEqual([
      '.cap-recorder > .page-head → rise: transform',
    ]);
    expect(fixedHostAnimationViolations(`${rise} @media (min-width: 1px) { .app-main > :not(.cap-recorder) { animation-name: rise; } }`)).toEqual([
      '.app-main > :not(.cap-recorder) → rise: transform',
    ]);
    // A leaf inside the card may move; only the hosts of fixed overlays are constrained.
    expect(fixedHostAnimationViolations(`${rise} .cap-recorder .rec-dot { animation: rise 1s; }`)).toEqual([]);
    expect(fixedHostAnimationViolations('@keyframes fade { from { opacity: 0; } } .app-main > * { animation: fade 1s; }')).toEqual([]);
  });

  it('page and Record-card entry animations are opacity-only, so fixed overlays never re-parent', () => {
    expect(fixedHostAnimationViolations(STYLES)).toEqual([]);
    // The rule must still exist: a renamed selector would pass vacuously.
    expect(STYLES).toMatch(/\.cap-recorder > \.page-head,[\s\S]*?animation: view-enter/);
  });

  it('no inline style in src/ui animates layout or paint properties', () => {
    const found = UI_FILES.flatMap(({ name, source }) => inlineMotionViolations(source).map((v) => `${name}: ${v}`));
    expect(found).toEqual([]);
  });

  it('meters, progress bars and the timeline playhead move with transform, not width/left', () => {
    for (const { name, source } of UI_FILES) {
      expect(source, name).not.toMatch(/className="(?:meter|progress)-fill"\s+style=\{\{\s*width/);
      expect(source, name).not.toMatch(/className="playhead"\s+style=\{\{\s*left/);
    }
  });

  it('finds layout writes on drag pieces in any attribute order (checker self-test)', () => {
    expect(dragPieceViolations(`<div className="area-fill" style={{ left: x, transform: t }} />`, ['area-fill'])).toEqual({
      found: ['area-fill'],
      violations: ['area-fill: left'],
    });
    expect(dragPieceViolations('<div style={{ width, height: 2 }} className={`knob ${a}`} />', ['knob']).violations).toEqual([
      'knob: width',
      'knob: height',
    ]);
    expect(
      dragPieceViolations('<Button icon={<Icon />} onClick={() => go(a > b)} className="x" style={{ marginTop: 1 }}>', ['x']).violations,
    ).toEqual(['x: marginTop']);
    expect(dragPieceViolations(`<div className="area-fill-extra" style={{ left: 1 }} />`, ['area-fill'])).toEqual({ found: [], violations: [] });
    expect(
      dragPieceViolations(
        "const r = useRef<HTMLDivElement>(null); <div className=\"clip\" style={{ width, transform: `translate3d(${a}px, 0, 0)`, '--x': f(a, b) }} />",
        ['clip'],
        ['width'],
      ),
    ).toEqual({ found: ['clip'], violations: [] });
  });

  it('drag pieces move by transform only: no left/top/width/height written per pointer frame', () => {
    const pieces: Array<{ file: string; classes: string[]; allow?: string[] }> = [
      { file: 'AreaSelector.tsx', classes: ['area-shade', 'area-fill', 'area-edge', 'area-handle', 'area-size-label'] },
      {
        file: 'ManipulationOverlay.tsx',
        classes: ['manipulation-fill', 'manipulation-edge', 'manipulation-handle', 'manipulation-rotate', 'manipulation-badge'],
      },
      { file: 'ColorGrading.tsx', classes: ['color-wheel-knob'] },
      { file: 'Timeline.tsx', classes: ['playhead', 'clip-trim-shade', 'clip-trim-ghost', 'clip-trim-edge'] },
      // A clip's width is its committed duration; move and trim drags preview through transform.
      { file: 'Timeline.tsx', classes: ['clip'], allow: ['width'] },
    ];
    for (const { file, classes, allow } of pieces) {
      const source = UI_FILES.find((entry) => entry.name === file)?.source ?? '';
      const { found, violations } = dragPieceViolations(source, classes, allow);
      expect(classes.filter((name) => !found.includes(name)), `${file}: pieces not found (renamed?)`).toEqual([]);
      expect(violations, file).toEqual([]);
    }
  });
});

describe('type ramp', () => {
  it('styles.css uses only --token-font-* sizes (clamp() display sizes excepted)', () => {
    const literals = [...stripComments(STYLES).matchAll(/font-size:\s*([^;}]+)/g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((v) => !v.startsWith('var(--token-font-') && !v.startsWith('clamp(') && v !== 'inherit');
    expect(literals).toEqual([]);
  });

  it('every --token-font-* referenced anywhere is defined', () => {
    const defined = new Set([...TOKENS.matchAll(/(--token-font-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set(
      [STYLES, ...UI_FILES.map((f) => f.source)].flatMap((source) => [...source.matchAll(/var\((--token-font-[\w-]+)\)/g)].map((m) => m[1])),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('inline style font sizes in src/ui come from the ramp (one 48px display numeral excepted)', () => {
    const found = UI_FILES.flatMap(({ name, source }) =>
      [...source.matchAll(/fontSize:\s*([0-9.]+)/g)].map((m) => `${name}: ${m[1]}`),
    );
    expect(found).toEqual(['VoiceoverDialog.tsx: 48']);
  });
});

describe('spacing scale', () => {
  /** Spacing declarations in styles.css; `inset` is positioning, not spacing. */
  const spacingDeclarations = () =>
    [...stripComments(STYLES).matchAll(/(?<![-\w])(gap|row-gap|column-gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;}]+)/g)].map(
      (match) => `${match[1]}: ${(match[2] ?? '').trim()}`,
    );

  it('every gap, padding and margin resolves to a spacing token', () => {
    // `auto` and unitless 0 are the only spacing values that may stay as they are.
    const offenders = spacingDeclarations().filter((declaration) => /[0-9]px/.test(declaration) && !declaration.includes('var(--token-space'));
    expect(offenders).toEqual([]);
  });

  it('the scale itself is a 2px rhythm up to 24px, then 4px steps', () => {
    const defined = [...TOKENS.matchAll(/--token-space-([\w-]+)\s*:\s*(\d+)px/g)].map((match) => ({
      name: match[1] ?? '',
      px: Number(match[2] ?? 0),
    }));
    expect(defined.length).toBeGreaterThan(15);
    for (const step of defined) {
      // 1px is the documented hairline step; everything else follows the rhythm.
      if (step.px === 1) continue;
      if (step.px > 24) expect(step.px % 4, step.name).toBe(0);
      else expect(step.px % 2, step.name).toBe(0);
    }
    // The steps must not skip a 2px band inside the dense range.
    const dense = defined.filter((step) => step.px > 0 && step.px <= 24).map((step) => step.px);
    expect([...dense].sort((a, b) => a - b)).toEqual([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  });

  it('every --token-space-* referenced anywhere is defined', () => {
    const defined = new Set([...TOKENS.matchAll(/(--token-space-[\w-]+)\s*:/g)].map((match) => match[1]));
    const used = new Set(
      [STYLES, ...UI_FILES.map((file) => file.source)].flatMap((source) => [
        ...source.matchAll(/var\((--token-space-[\w-]+)\)/g),
      ].map((match) => match[1])),
    );
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});

describe('contrast tokens (WCAG AA 4.5:1)', () => {
  it('flags a low-contrast pair (checker self-test)', () => {
    expect(contrast('#777777', '#888888')).toBeLessThan(4.5);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastFailures({ '--t': '#77838e', '--s': '#eef1f4' }, ['--t'], ['--s'])).toHaveLength(1);
  });

  const appTexts = ['--text-1', '--text-2', '--text-3'];
  const appSurfaces = ['--surface-0', '--surface-nav', '--surface-1', '--surface-2', '--surface-3'];
  it.each([
    ['dark', ':root'],
    ['light', ":root[data-theme='light']"],
  ])('styles.css %s theme', (_theme, selector) => {
    const vars = { ...themeVars(STYLES, ':root'), ...themeVars(STYLES, selector) };
    expect(contrastFailures(vars, appTexts, appSurfaces, [
      ['--accent-ink', '--accent'],
      // The hover fill is its own token, so it has to clear 4.5:1 on its own.
      ['--accent-ink', '--accent-hover'],
    ])).toEqual([]);
  });

  const tokenTexts = ['--token-text-primary', '--token-text-secondary', '--token-text-muted'];
  const tokenSurfaces = ['--token-bg-app', '--token-bg-nav', '--token-bg-card', '--token-bg-card-hover', '--token-bg-control'];
  it.each([
    ['dark', ':root'],
    ['light', "[data-theme='light']"],
  ])('tokens.css %s theme', (_theme, selector) => {
    const vars = { ...themeVars(TOKENS, ':root'), ...themeVars(TOKENS, selector) };
    expect(
      contrastFailures(vars, tokenTexts, tokenSurfaces, [
        ['--token-accent-primary-ink', '--token-accent-primary-action'],
        ['--token-accent-primary-ink', '--token-accent-primary-action-hover'],
      ]),
    ).toEqual([]);
  });
});

/* Status colours as rendered: text on its own color-mix() tint, composited over each surface. */
type Rgba = { rgb: [number, number, number]; alpha: number };

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r8, g8, b8]: [number, number, number]): [number, number, number] {
  const [r, g, b] = [r8, g8, b8].map((c) => toLinear(c / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255)) as [number, number, number];
}

const hexRgb = (hex: string): [number, number, number] =>
  [0, 2, 4].map((offset) => parseInt(hex.replace('#', '').slice(offset, offset + 2), 16)) as [number, number, number];

/** Resolves the colour forms styles.css uses: #hex, var(--x[, fallback]), white, transparent, color-mix(in oklab, …). */
function resolveColor(expression: string, vars: Record<string, string>): Rgba {
  const value = expression.trim();
  if (value === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  if (value === 'white') return { rgb: [255, 255, 255], alpha: 1 };
  if (/^#[0-9a-f]{6}$/i.test(value)) return { rgb: hexRgb(value), alpha: 1 };
  const variable = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value);
  if (variable) {
    const resolved = vars[variable[1] as string] ?? variable[2];
    if (!resolved) throw new Error(`unresolved ${value}`);
    return resolveColor(resolved, vars);
  }
  const mix = /^color-mix\(in oklab,\s*(.+)\)$/.exec(value);
  if (mix) {
    const [first = '', second = ''] = splitTopLevel(mix[1] as string);
    const percent = (part: string) => /\s(\d+(?:\.\d+)?)%$/.exec(part)?.[1];
    const p1 = percent(first);
    const p2 = percent(second);
    const w = p1 !== undefined ? Number(p1) / 100 : p2 !== undefined ? 1 - Number(p2) / 100 : 0.5;
    const a = resolveColor(first.replace(/\s\d+(?:\.\d+)?%$/, ''), vars);
    const b = resolveColor(second.replace(/\s\d+(?:\.\d+)?%$/, ''), vars);
    // Premultiplied interpolation: a transparent side contributes alpha only.
    const alpha = a.alpha * w + b.alpha * (1 - w);
    if (alpha === 0) return { rgb: [0, 0, 0], alpha: 0 };
    const la = toOklab(a.rgb);
    const lb = toOklab(b.rgb);
    const lab = [0, 1, 2].map((i) => ((la[i] ?? 0) * a.alpha * w + (lb[i] ?? 0) * b.alpha * (1 - w)) / alpha) as [number, number, number];
    return { rgb: fromOklab(lab), alpha };
  }
  throw new Error(`unsupported colour ${value}`);
}

/** Paints `layer` over an opaque colour the way the browser composites: in gamma-encoded sRGB. */
function over(layer: Rgba, under: [number, number, number]): [number, number, number] {
  return layer.rgb.map((c, i) => Math.round(c * layer.alpha + (under[i] ?? 0) * (1 - layer.alpha))) as [number, number, number];
}

const rgbHex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** Declarations of the first rule whose selector list is exactly `selector`. */
function ruleDecls(css: string, selector: string): Record<string, string> {
  const source = stripComments(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`no rule ${selector}`);
  return Object.fromEntries([...(match[1] ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], (m[2] ?? '').trim()]));
}

/** Text-on-tint contrast for a rule, over every surface; the text inherits when the rule sets none. */
function renderedFailures(
  vars: Record<string, string>,
  checks: Array<{ name: string; color: string; background?: string }>,
  surfaces: string[],
): string[] {
  const failures: string[] = [];
  for (const { name, color, background } of checks) {
    for (const surface of surfaces) {
      const base = hexRgb(vars[surface] ?? '#000000');
      const bg = background ? over(resolveColor(background, vars), base) : base;
      const fg = over(resolveColor(color, vars), bg);
      const ratio = contrast(rgbHex(fg), rgbHex(bg));
      if (ratio < 4.5) failures.push(`${name} on ${surface}: ${ratio.toFixed(2)}`);
    }
  }
  return failures;
}

describe('status colours as rendered (WCAG AA 4.5:1, color-mix resolved)', () => {
  const surfaces = ['--surface-0', '--surface-nav', '--surface-1', '--surface-2', '--surface-3'];
  const statusChecks = () => {
    const rule = (selector: string) => ruleDecls(STYLES, selector);
    const badge = (tone: string) => ({ name: `.badge-${tone}`, color: rule(`.badge-${tone}`).color ?? '', background: rule(`.badge-${tone}`).background });
    const dock = rule('.rec-dock-actions .btn-danger');
    const dockHover = rule('.rec-dock-actions .btn-danger:hover:not(:disabled)');
    const dangerHover = rule('.btn-danger:hover:not(:disabled)');
    return [
      badge('danger'),
      badge('ok'),
      badge('warn'),
      { name: '.btn-danger', color: rule('.btn-danger').color ?? '' },
      { name: '.btn-danger:hover', color: dangerHover.color ?? rule('.btn-danger').color ?? '', background: dangerHover.background },
      { name: 'dock Stop', color: dock.color ?? '', background: dock.background },
      { name: 'dock Stop:hover', color: dockHover.color ?? dock.color ?? '', background: dockHover.background },
    ];
  };

  it('resolves color-mix like the browser and flags the old dark --danger (checker self-test)', () => {
    // Expected values read back from Chrome (computed colour painted to a canvas), 2026-11-12.
    const near = (actual: [number, number, number], expected: string) =>
      actual.every((channel, i) => Math.abs(channel - (hexRgb(expected)[i] ?? 0)) <= 2);
    expect(near(over(resolveColor('color-mix(in oklab, #ef4444 10%, transparent)', {}), hexRgb('#231f30')), '#372232')).toBe(true);
    expect(near(resolveColor('color-mix(in oklab, #ffffff 50%, #000000)', {}).rgb, '#636363')).toBe(true);
    expect(near(resolveColor('color-mix(in oklab, #a82525 88%, #10161b)', {}).rgb, '#952726')).toBe(true);
    const darkOld = { ...themeVars(STYLES, ':root'), '--danger': '#ef4444' };
    expect(renderedFailures(darkOld, [{ name: 'old badge', color: 'var(--danger)', background: 'color-mix(in oklab, var(--danger) 10%, transparent)' }], ['--surface-2'])).toHaveLength(1);
  });

  it.each([
    ['dark', ':root'],
    ['light', ":root[data-theme='light']"],
  ])('%s theme: badges, danger buttons and the dock Stop button, including hover', (_theme, selector) => {
    const vars = { ...themeVars(STYLES, ':root'), ...themeVars(STYLES, selector) };
    expect(renderedFailures(vars, statusChecks(), surfaces)).toEqual([]);
  });
});

describe('overlay labels (WCAG AA 4.5:1)', () => {
  const label = ruleDecls(STYLES, '.area-size-label');
  it.each([
    ['dark', ':root'],
    ['light', ":root[data-theme='light']"],
  ])('%s theme: the area-capture size label', (_theme, selector) => {
    const vars = { ...themeVars(STYLES, ':root'), ...themeVars(STYLES, selector) };
    // The label sits over live screen content, so it paints its own opaque surface.
    expect(label.background).toBe('var(--surface-1)');
    expect(
      renderedFailures(vars, [{ name: '.area-size-label', color: label.color ?? '', background: label.background }], [
        '--surface-0',
        '--surface-1',
      ]),
    ).toEqual([]);
  });
});

describe('popover placement', () => {
  const viewport = { top: 0, left: 0, right: 1440, bottom: 900 };
  const size = { width: 200, height: 160 };
  it('opens below a top-bar trigger (the app Menu used to open above the viewport)', () => {
    expect(choosePlacement({ top: 12, bottom: 44, left: 1340, right: 1424 }, size, viewport)).toEqual({ placement: 'bottom', align: 'end' });
  });
  it('opens above a trigger on the bottom dock', () => {
    expect(choosePlacement({ top: 840, bottom: 880, left: 600, right: 680 }, size, viewport)).toEqual({ placement: 'top', align: 'end' });
  });
  it('aligns to the start edge when end alignment would cross the left edge (Edit "Project" menu)', () => {
    expect(choosePlacement({ top: 60, bottom: 92, left: 12, right: 96 }, size, viewport)).toEqual({ placement: 'bottom', align: 'start' });
  });
  it('respects a clip box below the top bar', () => {
    const page = { top: 60, left: 0, right: 375, bottom: 812 };
    expect(choosePlacement({ top: 120, bottom: 160, left: 200, right: 280 }, size, page).placement).toBe('bottom');
  });
});

describe('magnetic offset', () => {
  it('follows the pointer a fraction of the way and is clamped', () => {
    expect(magneticOffset(110, 100)).toBeCloseTo(2);
    expect(magneticOffset(500, 100)).toBe(5);
    expect(magneticOffset(-500, 100)).toBe(-5);
  });
});
