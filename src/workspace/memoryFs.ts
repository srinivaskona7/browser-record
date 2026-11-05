import type { DirectoryHandleLike, FileHandleLike, WritableLike } from './types';

/** In-memory implementation used by tests and as a last-resort fallback. */
class MemoryWritable implements WritableLike {
  chunks: Uint8Array[] = [];
  closed = false;
  aborted = false;

  constructor(private readonly file: MemoryFile) {}

  async write(data: Uint8Array | { type: 'write'; position?: number; data: Uint8Array }): Promise<void> {
    if (this.closed) throw new Error('Writable is closed');
    // `instanceof Uint8Array` is false across realms (jsdom, workers), so use
    // the structural view check instead of trusting the constructor identity.
    const isBytes = ArrayBuffer.isView(data);
    const bytes = isBytes ? (data as Uint8Array) : (data as { data: Uint8Array }).data;
    const position = isBytes ? undefined : (data as { position?: number }).position;
    if (position === undefined) this.chunks.push(bytes.slice());
    else this.file.writeAt(position, bytes);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    for (const chunk of this.chunks) this.file.append(chunk);
    this.chunks = [];
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.chunks = [];
    this.aborted = true;
    this.closed = true;
  }
}

export class MemoryFile {
  bytes: Uint8Array = new Uint8Array(0);

  append(chunk: Uint8Array): void {
    const next = new Uint8Array(this.bytes.length + chunk.length);
    next.set(this.bytes, 0);
    next.set(chunk, this.bytes.length);
    this.bytes = next;
  }

  writeAt(position: number, chunk: Uint8Array): void {
    const needed = position + chunk.length;
    if (needed > this.bytes.length) {
      const grown = new Uint8Array(needed);
      grown.set(this.bytes, 0);
      this.bytes = grown;
    }
    this.bytes.set(chunk, position);
  }
}

export class MemoryFileHandle implements FileHandleLike {
  readonly kind = 'file' as const;
  readonly file: MemoryFile;

  constructor(public name: string, file?: MemoryFile) {
    this.file = file ?? new MemoryFile();
  }

  async getFile(): Promise<File> {
    return new File([this.file.bytes.slice()], this.name);
  }

  async createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike> {
    if (options?.keepExistingData) return new PositionalWritable(this.file);
    this.file.bytes = new Uint8Array(0);
    return new MemoryWritable(this.file);
  }

  async move(parent: DirectoryHandleLike, name: string): Promise<void> {
    if (parent instanceof MemoryDirectoryHandle) parent.__store.set(name, this);
  }
}

/** Writes that honor an explicit position, like Chrome's keepExistingData path. */
class PositionalWritable implements WritableLike {
  closed = false;
  constructor(private readonly file: MemoryFile) {}
  async write(data: Uint8Array | { type: 'write'; position?: number; data: Uint8Array }): Promise<void> {
    if (this.closed) throw new Error('Writable is closed');
    // `instanceof Uint8Array` is false across realms (jsdom, workers), so use
    // the structural view check instead of trusting the constructor identity.
    const isBytes = ArrayBuffer.isView(data);
    const bytes = isBytes ? (data as Uint8Array) : (data as { data: Uint8Array }).data;
    const position = isBytes ? undefined : (data as { position?: number }).position;
    if (position === undefined) this.file.append(bytes);
    else this.file.writeAt(position, bytes);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

export class MemoryDirectoryHandle implements DirectoryHandleLike {
  readonly kind = 'directory' as const;
  readonly __store = new Map<string, MemoryFileHandle | MemoryDirectoryHandle>();
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectoryHandle> {
    const existing = this.__store.get(name);
    if (existing instanceof MemoryDirectoryHandle) return existing;
    if (existing) throw new DOMException(`A file named ${name} exists`, 'TypeMismatchError');
    if (!options?.create) throw new DOMException(`Directory ${name} not found`, 'NotFoundError');
    const dir = new MemoryDirectoryHandle(name);
    this.__store.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    const existing = this.__store.get(name);
    if (existing instanceof MemoryFileHandle) return existing;
    if (existing) throw new DOMException(`A directory named ${name} exists`, 'TypeMismatchError');
    if (!options?.create) throw new DOMException(`File ${name} not found`, 'NotFoundError');
    const file = new MemoryFileHandle(name);
    this.__store.set(name, file);
    return file;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const entry = this.__store.get(name);
    if (!entry) throw new DOMException(`Entry ${name} not found`, 'NotFoundError');
    if (entry instanceof MemoryDirectoryHandle && !options?.recursive && entry.__store.size > 0) {
      throw new DOMException('Directory not empty', 'InvalidModificationError');
    }
    this.__store.delete(name);
  }

  async *values(): AsyncIterableIterator<MemoryDirectoryHandle | MemoryFileHandle> {
    yield* this.__store.values();
  }
}
