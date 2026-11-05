/**
 * What to reopen when the app starts again. Deliberately tiny and
 * non-critical: a lost preference costs one click, never data.
 */
export interface LastSession {
  mode: 'fsa' | 'opfs';
  projectFolder: string | null;
}

const KEY = 'browser-record-last-session';

export function readLastSession(): LastSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSession>;
    const mode = parsed.mode === 'opfs' || parsed.mode === 'fsa' ? parsed.mode : 'fsa';
    const projectFolder = typeof parsed.projectFolder === 'string' && parsed.projectFolder ? parsed.projectFolder : null;
    return { mode, projectFolder };
  } catch {
    return null;
  }
}

export function writeLastSession(patch: Partial<LastSession>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const current = readLastSession() ?? { mode: 'fsa', projectFolder: null };
    localStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Private mode or a full quota: reopening is a convenience, not a guarantee.
  }
}

export function clearLastSession(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
