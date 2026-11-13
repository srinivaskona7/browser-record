import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../app/session';
import { useEditor } from '../project/store';
import { downloadBlob, formatBytes } from '../app/actions';
import { openExistingProject } from '../app/bootstrap';
import { buildAssetsFromManifest, recoverInterruptedTake } from '../capture/recorder';
import { createTrack, defaultPresenter } from '../project/factory';
import * as ops from '../project/ops';
import type { Project } from '../project/types';
import { takeIdsOf } from '../workspace/takeRefs';
import type { TakeSummary } from '../workspace/types';
import {
  committedBytes,
  deleteTake,
  executeClearUnusedPlan,
  listProjectFolders,
  listTakes,
  loadProject,
  planClearUnusedRecordings,
  projectPath,
  readFile,
  renameTake,
  type ClearUnusedPlan,
  type ExecuteClearUnusedResult,
} from '../workspace/workspace';
import { Badge, Button, Dialog, EmptyState, Field, Panel, Select } from './components';

export type TakeStatusKind = 'Active' | 'Used in timeline' | 'Recoverable' | 'Saved';

export interface EnrichedTakeItem {
  projectFolder: string;
  projectName: string;
  take: TakeSummary;
  label: string;
  startedAt: string;
  durationSeconds: number;
  bytes: number;
  sourceSummary: string;
  status: TakeStatusKind;
}

function computeDurationSeconds(take: TakeSummary): number {
  const { manifest } = take;
  if (manifest.startedAt && manifest.endedAt) {
    const ms = Date.parse(manifest.endedAt) - Date.parse(manifest.startedAt);
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 100) / 10;
  }
  const segCount = Math.max(0, ...manifest.assets.map((a) => a.segments.length));
  return segCount * (manifest.segmentSeconds || 5);
}

export function RecordingsLibrary({
  activeTakeId = null,
  defaultProjectFolder = 'all',
  compact = false,
  onChanged,
}: {
  activeTakeId?: string | null;
  defaultProjectFolder?: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const workspace = useSession((s) => s.workspace);
  const currentProjectFolder = useSession((s) => s.projectFolder);
  const pushToast = useSession((s) => s.pushToast);
  const setRoute = useSession((s) => s.setRoute);
  const editorProject = useEditor((s) => s.project);
  const apply = useEditor((s) => s.apply);

  const [projectFilter, setProjectFilter] = useState<string>(defaultProjectFolder);
  const [items, setItems] = useState<EnrichedTakeItem[]>([]);
  const [projectOptions, setProjectOptions] = useState<Array<{ value: string; label: string }>>([
    { value: 'all', label: 'All projects' },
  ]);
  const [renamingTakeId, setRenamingTakeId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [playingItem, setPlayingItem] = useState<{ label: string; url: string; mimeType: string } | null>(null);

  // Clear unused recordings preview state
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearPlan, setClearPlan] = useState<ClearUnusedPlan | null>(null);
  const [selectedRecoverableIds, setSelectedRecoverableIds] = useState<Set<string>>(new Set());
  const [clearResult, setClearResult] = useState<ExecuteClearUnusedResult | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [deleteAllTakesOpen, setDeleteAllTakesOpen] = useState(false);
  const [deleteAllTakesBusy, setDeleteAllTakesBusy] = useState(false);

  const activeSet = useMemo(() => {
    const set = new Set<string>();
    if (activeTakeId) set.add(activeTakeId);
    return set;
  }, [activeTakeId]);

  const currentProjectsMap = useMemo(() => {
    const map = new Map<string, Project>();
    if (currentProjectFolder && editorProject) {
      map.set(currentProjectFolder, editorProject);
    }
    return map;
  }, [currentProjectFolder, editorProject]);

  const publishLibrary = (library: LibraryListing | null) => {
    if (!library) return;
    setProjectOptions(library.options);
    setItems(library.items);
  };

  const refresh = async () => {
    if (!workspace) return;
    publishLibrary(await collectLibrary(workspace.root, currentProjectsMap, activeSet));
  };

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void collectLibrary(workspace.root, currentProjectsMap, activeSet).then((library) => {
      if (cancelled || !library) return;
      setProjectOptions(library.options);
      setItems(library.items);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, currentProjectsMap, activeSet]);

  useEffect(() => {
    return () => {
      if (playingItem?.url) URL.revokeObjectURL(playingItem.url);
    };
  }, [playingItem]);

  const filteredItems = useMemo(() => {
    if (projectFilter === 'all') return items;
    return items.filter((item) => item.projectFolder === projectFilter);
  }, [items, projectFilter]);

  const handlePlayTake = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    const primaryAsset = item.take.manifest.assets[0];
    if (!primaryAsset) {
      pushToast('This take has no recorded media tracks.', 'error');
      return;
    }
    const file = await readFile(workspace.root, projectPath(item.projectFolder, primaryAsset.path));
    if (!file || file.size === 0) {
      pushToast('Recorded media file is empty or missing.', 'error');
      return;
    }
    if (playingItem?.url) URL.revokeObjectURL(playingItem.url);
    const slice = primaryAsset.committedBytes > 0 ? file.slice(0, primaryAsset.committedBytes, primaryAsset.mimeType) : file;
    const url = URL.createObjectURL(slice);
    setPlayingItem({ label: item.label, url, mimeType: primaryAsset.mimeType });
  };

  const handleRenameTake = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    await renameTake(workspace.root, item.projectFolder, item.take.takeId, renameDraft);
    setRenamingTakeId(null);
    await refresh();
    onChanged?.();
    pushToast(`Renamed take to "${renameDraft.trim() || item.take.takeId}".`, 'success');
  };

  const handleOpenInEditor = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    if (currentProjectFolder !== item.projectFolder) {
      await openExistingProject(item.projectFolder);
    }
    const report =
      item.status === 'Recoverable'
        ? await recoverInterruptedTake(workspace.root, item.projectFolder, item.take.takeId)
        : null;
    const builtAssets = report ? report.assets : buildAssetsFromManifest(item.take.manifest);
    let firstClipId: string | undefined;
    apply(`Open take ${item.label}`, (p) => {
      let next: Project = {
        ...p,
        tracks: [],
        assets: [...builtAssets],
        markers: [],
        captions: [],
        durationTicks: 0,
      };
      for (const asset of builtAssets) {
        const isCamera = asset.kind === 'video' && /camera|webcam/i.test(asset.name);
        const trackName =
          asset.kind === 'video'
            ? isCamera
              ? 'Camera'
              : 'Screen'
            : /mic/i.test(asset.name)
              ? 'Narration'
              : 'System Audio';
        let track = next.tracks.find((t) => t.name === trackName);
        if (!track) {
          track = createTrack(asset.kind === 'video' ? 'video' : 'audio', trackName);
          next = ops.addTrack(next, track);
        }
        const placed = ops.addAssetClip(next, track.id, asset.id, 0, { mode: 'overwrite' });
        next = isCamera
          ? ops.updateClip(placed.project, placed.clipId, { presenter: defaultPresenter() })
          : placed.project;
        if (!firstClipId) firstClipId = placed.clipId;
      }
      return next;
    });
    useEditor.getState().setPlayhead(0);
    if (firstClipId) useEditor.getState().selectClips([firstClipId]);
    setRoute('edit');
    await refresh();
    onChanged?.();
  };

  const handleAppendToTimeline = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    if (!currentProjectFolder || item.projectFolder !== currentProjectFolder) {
      pushToast(
        `Take "${item.label}" belongs to "${item.projectName}". Open "${item.projectName}" first to append to its timeline, or use Open in editor.`,
        'info',
      );
      return;
    }
    const report =
      item.status === 'Recoverable'
        ? await recoverInterruptedTake(workspace.root, item.projectFolder, item.take.takeId)
        : null;
    const manifest = report ? report.manifest : item.take.manifest;
    const builtAssets = report ? report.assets : buildAssetsFromManifest(manifest);

    let insertedAt = 0;
    let firstClipId: string | undefined;
    apply(`Add take ${item.label} to timeline`, (p) => {
      const existingTakeIds = new Set(takeIdsOf(p));
      if (existingTakeIds.has(item.take.takeId)) return p;
      let next = p;
      insertedAt = ops.nextFreeStart(p);
      for (const asset of builtAssets) {
        if (!next.assets.some((a) => a.id === asset.id || a.path === asset.path)) {
          next = ops.upsertAsset(next, asset);
        }
        const isCamera = asset.kind === 'video' && /camera|webcam/i.test(asset.name);
        const trackName =
          asset.kind === 'video'
            ? isCamera
              ? 'Camera'
              : 'Screen'
            : /mic/i.test(asset.name)
              ? 'Narration'
              : 'System Audio';
        let track = next.tracks.find((t) => t.name === trackName);
        if (!track) {
          track = createTrack(asset.kind === 'video' ? 'video' : 'audio', trackName);
          next = ops.addTrack(next, track);
        }
        const placed = ops.addAssetClip(next, track.id, asset.id, insertedAt, { mode: 'overwrite' });
        next = isCamera
          ? ops.updateClip(placed.project, placed.clipId, { presenter: defaultPresenter() })
          : placed.project;
        if (!firstClipId) firstClipId = placed.clipId;
      }
      return next;
    });
    useEditor.getState().setPlayhead(insertedAt);
    if (firstClipId) useEditor.getState().selectClips([firstClipId]);
    setRoute('edit');
    await refresh();
    onChanged?.();
  };

  const handleDownloadRaw = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    let count = 0;
    for (const rec of item.take.manifest.assets) {
      const file = await readFile(workspace.root, projectPath(item.projectFolder, rec.path));
      if (!file) continue;
      const slice = rec.committedBytes > 0 ? file.slice(0, rec.committedBytes, rec.mimeType) : file;
      downloadBlob(slice, `${item.label}-${rec.name}`);
      count += 1;
    }
    if (count === 0) pushToast('No raw media files found in this take.', 'error');
    else pushToast(`Downloaded ${count} raw track(s).`, 'success');
  };

  const handleSaveToFolder = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker;
    if (typeof picker !== 'function') {
      await handleDownloadRaw(item);
      return;
    }
    try {
      const dir = await picker({ mode: 'readwrite' });
      let saved = 0;
      for (const rec of item.take.manifest.assets) {
        const file = await readFile(workspace.root, projectPath(item.projectFolder, rec.path));
        if (!file) continue;
        const target = await dir.getFileHandle(`${item.label}-${rec.name}`, { create: true });
        const writable = await target.createWritable();
        const bytes = new Uint8Array(await file.slice(0, rec.committedBytes || file.size).arrayBuffer());
        await writable.write(bytes);
        await writable.close();
        saved += 1;
      }
      pushToast(`Saved ${saved} track(s) to selected folder.`, 'success');
    } catch (err) {
      if (!/abort/i.test((err as Error).message)) {
        pushToast(`Could not save to folder: ${(err as Error).message}`, 'error');
      }
    }
  };

  const handleDeleteSingleTake = async (item: EnrichedTakeItem) => {
    if (!workspace) return;
    if (item.status === 'Active') {
      pushToast('Active takes are pinned and protected while recording.', 'error');
      return;
    }
    const ok = await deleteTake(workspace.root, item.projectFolder, item.take.takeId);
    if (ok) {
      pushToast(`Deleted take "${item.label}".`, 'info');
      await refresh();
      onChanged?.();
    } else {
      pushToast(`Could not delete take "${item.label}".`, 'error');
    }
  };

  const openClearUnusedPreview = async (nextSelectedRecoverable = selectedRecoverableIds) => {
    if (!workspace) return;
    setClearBusy(true);
    setClearResult(null);
    try {
      const plan = await planClearUnusedRecordings(workspace.root, {
        ...(projectFilter !== 'all' ? { projectFolder: projectFilter } : {}),
        activeTakeIds: activeSet,
        selectedRecoverableTakeIds: nextSelectedRecoverable,
        currentProjects: currentProjectsMap,
      });
      setClearPlan(plan);
      setClearModalOpen(true);
    } finally {
      setClearBusy(false);
    }
  };

  const confirmClearUnused = async () => {
    if (!workspace || !clearPlan) return;
    setClearBusy(true);
    try {
      const res = await executeClearUnusedPlan(workspace.root, clearPlan, {
        currentProjects: currentProjectsMap,
        activeTakeIds: activeSet,
      });
      setClearResult(res);
      await refresh();
      onChanged?.();
      if (res.ok && !res.stale) {
        pushToast(
          `Cleared ${res.deleted.length} unused recording(s) (${formatBytes(res.reclaimedBytes)} reclaimed).`,
          'success',
        );
      }
    } finally {
      setClearBusy(false);
    }
  };

  const toggleRecoverableSelection = (takeId: string) => {
    const next = new Set(selectedRecoverableIds);
    if (next.has(takeId)) next.delete(takeId);
    else next.add(takeId);
    setSelectedRecoverableIds(next);
    void openClearUnusedPreview(next);
  };

  const canSaveToFolder =
    typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  return (
    <Panel
      title="Recordings library"
      subtitle="Raw takes stored on disk. Active takes are pinned and protected; timeline-referenced takes are guarded."
      actions={
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Select
            aria-label="Filter recordings by project"
            value={projectFilter}
            onChange={(value) => setProjectFilter(value)}
            options={projectOptions}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={clearBusy}
            onClick={() => void openClearUnusedPreview()}
            data-testid="clear-unused-takes-btn"
          >
            Clear unused recordings…
          </Button>
          {filteredItems.some((item) => item.status !== 'Active') && (
            <Button
              size="sm"
              variant="danger"
              disabled={deleteAllTakesBusy}
              onClick={() => setDeleteAllTakesOpen(true)}
              data-testid="delete-all-takes-btn"
            >
              Delete all ({filteredItems.filter((item) => item.status !== 'Active').length})…
            </Button>
          )}
        </div>
      }
    >
      {filteredItems.length === 0 ? (
        <EmptyState
          title="No recorded takes yet"
          body="Start a screen, window, tab, camera, or voiceover recording. Committed segments are saved here immediately."
        />
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {filteredItems.map((item) => {
            const isRenaming = renamingTakeId === item.take.takeId;
            const statusTone =
              item.status === 'Active'
                ? 'danger'
                : item.status === 'Used in timeline'
                  ? 'ok'
                  : item.status === 'Recoverable'
                    ? 'warn'
                    : 'default';
            return (
              <div
                key={`${item.projectFolder}/${item.take.takeId}`}
                className="project-card"
                data-testid={`recording-row-${item.take.takeId}`}
              >
                <div className="project-meta">
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {isRenaming ? (
                      <div className="row" style={{ gap: 6 }}>
                        <input
                          className="input"
                          value={renameDraft}
                          aria-label="Take name"
                          onChange={(e) => setRenameDraft(e.target.value)}
                          style={{ width: 200 }}
                        />
                        <Button size="sm" variant="primary" onClick={() => void handleRenameTake(item)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenamingTakeId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <strong>{item.label}</strong>
                    )}
                    <Badge tone={statusTone}>{item.status}</Badge>
                    <Badge>{item.sourceSummary}</Badge>
                    {!compact && <Badge>{item.projectName}</Badge>}
                  </div>
                  <div className="sub">
                    {new Date(item.startedAt).toLocaleString()} · {item.durationSeconds.toFixed(1)}s ·{' '}
                    {formatBytes(item.bytes)}
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    variant="primary"
                    title="Open a clean timeline containing only this recorded take (Undo preserves any previous edit)"
                    onClick={() => void handleOpenInEditor(item)}
                  >
                    Open in editor
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      !currentProjectFolder ||
                      item.projectFolder !== currentProjectFolder ||
                      item.status === 'Active' ||
                      item.status === 'Used in timeline'
                    }
                    title={
                      !currentProjectFolder
                        ? 'Open a project first to append takes to its timeline.'
                        : item.projectFolder !== currentProjectFolder
                          ? `This take belongs to "${item.projectName}". Open "${item.projectName}" first to append to its timeline, or use Open in editor.`
                          : item.status === 'Used in timeline'
                            ? 'This take is already on the current timeline.'
                            : 'Append this take after the existing clips on the current timeline'
                    }
                    onClick={() => void handleAppendToTimeline(item)}
                  >
                    + Add to timeline
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={item.status === 'Active'}
                    title={
                      item.status === 'Active'
                        ? 'Active takes are pinned and protected while recording.'
                        : 'Permanently delete this raw take'
                    }
                    onClick={() => void handleDeleteSingleTake(item)}
                  >
                    {item.status === 'Recoverable' ? 'Discard' : 'Delete'}
                  </Button>
                  <details className="rec-more-menu">
                    <summary className="btn btn-ghost btn-sm" aria-label={`More actions for ${item.label}`}>
                      More ▾
                    </summary>
                    <div className="rec-more-popover">
                      <Button size="sm" variant="ghost" onClick={() => void handlePlayTake(item)}>
                        Play preview
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRenamingTakeId(item.take.takeId);
                          setRenameDraft(item.label);
                        }}
                      >
                        Rename take
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleDownloadRaw(item)}>
                        Download raw
                      </Button>
                      {canSaveToFolder && (
                        <Button size="sm" variant="ghost" onClick={() => void handleSaveToFolder(item)}>
                          Save to folder
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={item.status === 'Active'}
                        title={
                          item.status === 'Active'
                            ? 'Active takes are pinned and protected while recording.'
                            : 'Permanently delete this raw take'
                        }
                        onClick={() => void handleDeleteSingleTake(item)}
                      >
                        {item.status === 'Recoverable' ? 'Discard' : 'Delete'}
                      </Button>
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={playingItem !== null}
        title={playingItem ? `Preview take — ${playingItem.label}` : 'Preview take'}
        onClose={() => setPlayingItem(null)}
        footer={
          <Button variant="primary" onClick={() => setPlayingItem(null)}>
            Close
          </Button>
        }
      >
        {playingItem && (
          <div className="stack">
            {playingItem.mimeType.startsWith('audio/') ? (
              <audio src={playingItem.url} controls autoPlay style={{ width: '100%' }} />
            ) : (
              <video
                src={playingItem.url}
                controls
                autoPlay
                playsInline
                style={{ width: '100%', maxHeight: 360, background: '#111018', borderRadius: 8 }}
              />
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={clearModalOpen}
        title="Clear unused recordings — Preview before deletion"
        onClose={() => setClearModalOpen(false)}
        footer={
          <div className="row" style={{ gap: 8 }}>
            <Button variant="ghost" onClick={() => setClearModalOpen(false)}>
              Cancel
            </Button>
            {clearResult && (!clearResult.ok || clearResult.stale) && (
              <Button variant="ghost" onClick={() => void openClearUnusedPreview()}>
                Refresh preview & retry
              </Button>
            )}
            <Button
              variant="danger"
              disabled={!clearPlan || clearPlan.candidates.length === 0 || clearBusy}
              onClick={() => void confirmClearUnused()}
            >
              Permanently delete {clearPlan?.candidates.length ?? 0} unused take(s)
            </Button>
          </div>
        }
      >
        {clearPlan && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="info-card">
              <strong>Permanent deletion vs. recoverable sessions:</strong> Confirming permanently removes the listed
              unreferenced raw take folders from local storage. Active recordings, timeline-referenced takes, imported
              media, and exported files are never touched.
            </div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <Badge tone="warn">{clearPlan.candidates.length} take(s) to delete</Badge>
              <Badge tone="ok">{clearPlan.excluded.length} protected take(s)</Badge>
              <Badge>{formatBytes(clearPlan.totalReclaimBytes)} to reclaim</Badge>
              <Badge>{clearPlan.affectedProjects.length} affected project(s)</Badge>
            </div>

            {clearPlan.affectedProjects.length > 0 && (
              <Field label="Affected projects">
                <div className="stack" style={{ gap: 4 }}>
                  {clearPlan.affectedProjects.map((proj) => (
                    <div key={proj.folder} className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--token-font-base)' }}>
                      <span>{proj.name}</span>
                      <span className="mono">
                        {proj.count} take(s) · {formatBytes(proj.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Candidate takes to permanently remove">
              {clearPlan.candidates.length === 0 ? (
                <div className="field-hint">No unused recordings found. All saved takes are referenced or protected.</div>
              ) : (
                <div className="stack" style={{ gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                  {clearPlan.candidates.map((cand) => (
                    <div
                      key={`${cand.projectFolder}/${cand.takeId}`}
                      className="row"
                      style={{ justifyContent: 'space-between', fontSize: 'var(--token-font-base)' }}
                    >
                      <span>
                        <strong>{cand.label}</strong> ({cand.projectName}) · {cand.sourceSummary}
                      </span>
                      <span className="mono">
                        {cand.durationSeconds.toFixed(1)}s · {formatBytes(cand.bytes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            {clearPlan.excluded.some((e) => e.reason === 'recoverable-unselected') && (
              <Field
                label="Protected recoverable sessions (select individually to include)"
                hint="Interrupted takes can be recovered into the timeline or explicitly selected for removal."
              >
                <div className="stack" style={{ gap: 4 }}>
                  {clearPlan.excluded
                    .filter((e) => e.reason === 'recoverable-unselected')
                    .map((exc) => (
                      <label key={exc.takeId} className="row" style={{ gap: 8, fontSize: 'var(--token-font-base)' }}>
                        <input
                          type="checkbox"
                          checked={selectedRecoverableIds.has(exc.takeId)}
                          onChange={() => toggleRecoverableSelection(exc.takeId)}
                        />
                        <span>
                          {exc.takeId} ({exc.projectName}) · {formatBytes(exc.bytes)} — Recoverable session
                        </span>
                      </label>
                    ))}
                </div>
              </Field>
            )}

            {clearResult && (
              <div className={clearResult.ok ? 'info-card' : 'warn-card'}>
                {clearResult.stale ? (
                  <div>
                    <strong>Stale plan rejected:</strong> {clearResult.error}
                  </div>
                ) : clearResult.failed.length > 0 ? (
                  <div>
                    <strong>Partial failure:</strong> Deleted {clearResult.deleted.length} take(s), failed{' '}
                    {clearResult.failed.length} ({clearResult.failed.map((f) => f.takeId).join(', ')}). Click &ldquo;Refresh
                    preview &amp; retry&rdquo; to retry.
                  </div>
                ) : (
                  <div>
                    Deleted {clearResult.deleted.length} unused take(s) and reclaimed{' '}
                    {formatBytes(clearResult.reclaimedBytes)}.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={deleteAllTakesOpen}
        title={`Delete all ${filteredItems.filter((item) => item.status !== 'Active').length} recording(s)?`}
        onClose={() => {
          if (!deleteAllTakesBusy) setDeleteAllTakesOpen(false);
        }}
        footer={
          <div className="row" style={{ gap: 8 }}>
            <Button variant="ghost" disabled={deleteAllTakesBusy} onClick={() => setDeleteAllTakesOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteAllTakesBusy}
              data-testid="confirm-delete-all-takes-btn"
              onClick={async () => {
                if (!workspace) return;
                setDeleteAllTakesBusy(true);
                try {
                  let deleted = 0;
                  for (const item of filteredItems) {
                    if (item.status === 'Active') continue;
                    const ok = await deleteTake(workspace.root, item.projectFolder, item.take.takeId);
                    if (ok) deleted += 1;
                  }
                  setDeleteAllTakesOpen(false);
                  await refresh();
                  onChanged?.();
                  pushToast(`Deleted ${deleted} recording(s).`, 'info');
                } finally {
                  setDeleteAllTakesBusy(false);
                }
              }}
            >
              {deleteAllTakesBusy
                ? 'Deleting…'
                : `Delete all ${filteredItems.filter((item) => item.status !== 'Active').length} recording(s)`}
            </Button>
          </div>
        }
      >
        <div className="stack">
          <p>
            This permanently deletes all{' '}
            <strong>{filteredItems.filter((item) => item.status !== 'Active').length}</strong> recorded take(s) in the
            current view. Any active recording in progress is never touched.
          </p>
          <div className="warn-card">This action removes the raw recording files from local storage and cannot be undone.</div>
        </div>
      </Dialog>
    </Panel>
  );
}

interface LibraryListing {
  options: Array<{ value: string; label: string }>;
  items: EnrichedTakeItem[];
}

/**
 * Every take in every project folder, Active first then newest first. Pure: no React state.
 * The open project's in-memory copy wins over its file so unsaved timeline use counts.
 */
async function collectLibrary(
  root: Parameters<typeof listProjectFolders>[0],
  currentProjectsMap: ReadonlyMap<string, Project>,
  activeSet: ReadonlySet<string>,
): Promise<LibraryListing | null> {
  if (typeof listProjectFolders !== 'function') return null;
  let folders: string[];
  try {
    folders = await listProjectFolders(root);
  } catch {
    return null;
  }
  const options: Array<{ value: string; label: string }> = [{ value: 'all', label: 'All projects' }];
  const collected: EnrichedTakeItem[] = [];

  for (const folder of folders) {
    let proj: Project | null = currentProjectsMap.get(folder) ?? null;
    if (!proj) {
      try {
        const loaded = await loadProject(root, folder);
        proj = loaded.project;
      } catch {
        proj = null;
      }
    }
    const projectName = proj?.name ?? folder;
    options.push({ value: folder, label: projectName });
    const referencedIds = new Set<string>(proj ? takeIdsOf(proj) : []);
    const takes = await listTakes(root, folder);
    for (const take of takes) {
      const isActive = activeSet.has(take.takeId);
      const isUsed = referencedIds.has(take.takeId);
      const isRecoverable = take.interrupted || take.manifest.status === 'recording';
      const status: TakeStatusKind = isActive
        ? 'Active'
        : isUsed
          ? 'Used in timeline'
          : isRecoverable
            ? 'Recoverable'
            : 'Saved';
      collected.push({
        projectFolder: folder,
        projectName,
        take,
        label: take.manifest.label || take.takeId,
        startedAt: take.manifest.startedAt,
        durationSeconds: computeDurationSeconds(take),
        bytes: committedBytes(take.manifest),
        sourceSummary: take.manifest.assets.map((a) => a.kind).join(' + ') || 'recording',
        status,
      });
    }
  }

  // Pin Active takes first, then sort newest first
  collected.sort((a, b) => {
    if (a.status === 'Active' && b.status !== 'Active') return -1;
    if (b.status === 'Active' && a.status !== 'Active') return 1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return { options, items: collected };
}
