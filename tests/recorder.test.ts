import { describe, expect, it } from 'vitest';
import { MemoryDirectoryHandle } from '../src/workspace/memoryFs';
import { buildAssetsFromManifest, recoverInterruptedTake } from '../src/capture/recorder';
import { listTakes, readTakeManifest, takeFolder, writeBinary, writeTakeManifest } from '../src/workspace/workspace';
import type { RecordingManifest } from '../src/workspace/types';
import { WORKSPACE_LAYOUT } from '../src/workspace/types';

const PROJECT = 'demo-lesson';
const TAKE = 'take-001';
const SCREEN = 'recordings/take-001/screen.webm';

function manifest(overrides: Partial<RecordingManifest> = {}): RecordingManifest {
  return {
    version: 1,
    takeId: TAKE,
    projectId: 'proj_1',
    startedAt: '2026-03-03T09:00:00.000Z',
    segmentSeconds: 10,
    status: 'recording',
    assets: [
      {
        id: 'asset_screen',
        kind: 'screen',
        name: 'screen.webm',
        path: SCREEN,
        mimeType: 'video/webm;codecs=vp9',
        committedBytes: 100,
        offsetMs: 0,
        width: 1920,
        height: 1080,
        segments: [
          {
            index: 0,
            path: SCREEN,
            bytes: 100,
            startedAt: '2026-03-03T09:00:00.000Z',
            endedAt: '2026-03-03T09:00:10.000Z',
            finalized: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function setup(): Promise<MemoryDirectoryHandle> {
  const root = new MemoryDirectoryHandle('workspace');
  await writeTakeManifest(root, PROJECT, manifest());
  await writeBinary(root, `${WORKSPACE_LAYOUT.projects}/${PROJECT}/${SCREEN}`, new Uint8Array(140));
  return root;
}

describe('interrupted take recovery', () => {
  it('lists a take still marked recording as interrupted', async () => {
    const root = await setup();
    const takes = await listTakes(root, PROJECT);
    expect(takes).toHaveLength(1);
    expect(takes[0]!.takeId).toBe(TAKE);
    expect(takes[0]!.interrupted).toBe(true);
    expect(takes[0]!.path).toBe(takeFolder(PROJECT, TAKE));
  });

  it('claims only committed bytes and reports the loss window', async () => {
    const root = await setup();
    const report = await recoverInterruptedTake(root, PROJECT, TAKE);
    expect(report).not.toBeNull();
    expect(report!.committedBytes).toBe(100);
    expect(report!.uncommittedBytes).toBe(40);
    expect(report!.lossWindowSeconds).toBe(10);
    expect(report!.warnings).toHaveLength(1);
    expect(report!.warnings[0]).toMatch(/40 bytes/);
    expect(report!.assets[0]!.path).toBe(SCREEN);
    expect(report!.assets[0]!.origin).toBe('recorded');
    expect(report!.assets[0]!.durationTicks).toBeGreaterThan(0);
  });

  it('marks the take recovered so it is no longer listed as interrupted', async () => {
    const root = await setup();
    await recoverInterruptedTake(root, PROJECT, TAKE);
    const persisted = await readTakeManifest(root, PROJECT, TAKE);
    expect(persisted!.status).toBe('recovered');
    const takes = await listTakes(root, PROJECT);
    expect(takes[0]!.interrupted).toBe(false);
  });

  it('warns instead of inventing data when the media file is gone', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    await writeTakeManifest(root, PROJECT, manifest());
    const report = await recoverInterruptedTake(root, PROJECT, TAKE);
    expect(report!.committedBytes).toBe(100);
    expect(report!.warnings.some((warning) => /missing from disk/.test(warning))).toBe(true);
  });

  it('returns null for a take with no manifest', async () => {
    const root = new MemoryDirectoryHandle('workspace');
    expect(await recoverInterruptedTake(root, PROJECT, 'nope')).toBeNull();
  });

  it('builds asset durations from the last committed segment', () => {
    const assets = buildAssetsFromManifest(manifest());
    expect(assets).toHaveLength(1);
    expect(assets[0]!.segments![0]!.bytes).toBe(100);
    expect(assets[0]!.width).toBe(1920);
  });
});
