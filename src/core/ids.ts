let counter = 0;

const randomPart = (): string => {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Stable, collision-resistant id for project entities. */
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 0x10000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}${randomPart()}`;
}

/** Deterministic id for tests and golden fixtures. */
export function makeSequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}_${n}`;
  };
}
