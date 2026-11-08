/**
 * Minimal structural interfaces over the File System Access API so the
 * workspace layer can be exercised in Node with an in-memory implementation.
 */
export interface WritableLike {
  write(data: Uint8Array | { type: 'write'; position?: number; data: Uint8Array }): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
  /** Chrome implements move() on file handles; it is what makes atomic saves possible. */
  move?(parent: DirectoryHandleLike, name: string): Promise<void>;
}

export interface DirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterableIterator<DirectoryHandleLike | FileHandleLike>;
}

export type StorageMode = 'fsa' | 'opfs' | 'memory';

export interface WorkspaceInfo {
  name: string;
  mode: StorageMode;
  /** True when a directory was picked; false for the fallback. */
  persistent: boolean;
  quota?: { usage: number; quota: number };
}

export const WORKSPACE_LAYOUT = {
  projects: 'projects',
  originals: 'media/originals',
  proxies: 'media/proxies',
  thumbnails: 'media/thumbnails',
  waveforms: 'media/waveforms',
  captions: 'captions',
  recordings: 'recordings',
  exports: 'exports',
  backups: 'backups',
  previews: 'media/previews',
} as const;

export interface RecordingSegmentRecord {
  index: number;
  path: string;
  bytes: number;
  startedAt: string;
  endedAt?: string;
  finalized: boolean;
}

export interface RecordingAssetRecord {
  id: string;
  kind: 'screen' | 'camera' | 'microphone' | 'system-audio';
  name: string;
  path: string;
  mimeType: string;
  /** Bytes known durable (written before a successful close()). */
  committedBytes: number;
  segments: RecordingSegmentRecord[];
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  /** Wall-clock start relative to the take, in ms, from the shared clock. */
  offsetMs: number;
}

export interface RecordingManifest {
  version: 1;
  takeId: string;
  projectId: string;
  label?: string;
  startedAt: string;
  endedAt?: string;
  status: 'recording' | 'finalized' | 'recovered' | 'aborted';
  segmentSeconds: number;
  assets: RecordingAssetRecord[];
  notes?: string;
}

export interface TakeSummary {
  takeId: string;
  path: string;
  manifest: RecordingManifest;
  /** True when the manifest still says "recording" — i.e. the tab died mid-take. */
  interrupted: boolean;
}
