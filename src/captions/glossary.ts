export interface GlossaryChange {
  from: string;
  to: string;
  count: number;
}

export interface GlossaryResult {
  text: string;
  changes: GlossaryChange[];
}

/**
 * Apply a technical glossary to recognised text. Matching is whole-word and
 * case-insensitive, and the canonical spelling comes from the glossary value,
 * so "kubernetees" -> "Kubernetes" only when the user added that mapping.
 */
export function applyGlossary(text: string, glossary: Record<string, string>): GlossaryResult {
  const changes = new Map<string, GlossaryChange>();
  let result = text;
  const entries = Object.entries(glossary)
    .filter(([term, canonical]) => term.trim().length > 0 && canonical.trim().length > 0)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [term, canonical] of entries) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(term)}(?![\\p{L}\\p{N}_-])`, 'giu');
    result = result.replace(pattern, (match) => {
      if (match === canonical) return match;
      const existing = changes.get(term.toLowerCase());
      if (existing) existing.count += 1;
      else changes.set(term.toLowerCase(), { from: match, to: canonical, count: 1 });
      return canonical;
    });
  }
  return { text: result, changes: [...changes.values()] };
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface GlossarySuggestion {
  term: string;
  canonical: string;
  index: number;
  original: string;
}

/** Suggestions only — never applied without the user accepting them. */
export function suggestGlossaryFixes(text: string, glossary: Record<string, string>): GlossarySuggestion[] {
  const suggestions: GlossarySuggestion[] = [];
  for (const [term, canonical] of Object.entries(glossary)) {
    if (!term) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(term)}(?![\\p{L}\\p{N}_-])`, 'giu');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[0] !== canonical) {
        suggestions.push({ term, canonical, index: match.index, original: match[0] });
      }
    }
  }
  return suggestions;
}

/** Filler words worth flagging (never removed automatically). */
export const FILLER_WORDS = ['um', 'uh', 'erm', 'ah', 'like', 'you know', 'sort of', 'kind of', 'basically', 'actually'];

export interface FillerSuggestion {
  cueId: string;
  word: string;
  index: number;
  context: string;
}

export function findFillers(
  cues: Array<{ id: string; text: string }>,
  fillers: readonly string[] = FILLER_WORDS,
): FillerSuggestion[] {
  const suggestions: FillerSuggestion[] = [];
  for (const cue of cues) {
    for (const filler of fillers) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(filler)}(?![\\p{L}\\p{N}_-])`, 'giu');
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(cue.text))) {
        const start = Math.max(0, match.index - 20);
        suggestions.push({
          cueId: cue.id,
          word: match[0],
          index: match.index,
          context: cue.text.slice(start, match.index + match[0].length + 20),
        });
      }
    }
  }
  return suggestions.sort((a, b) => a.cueId.localeCompare(b.cueId) || a.index - b.index);
}

export function removeWordAt(cueText: string, index: number, length: number): string {
  const before = cueText.slice(0, index);
  const after = cueText.slice(index + length);
  return `${before}${after}`.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

/** Language hints exposed in the UI, with model-size honesty. */
export const CAPTION_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
] as const;
