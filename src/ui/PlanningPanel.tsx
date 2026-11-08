import { useEffect, useState } from 'react';
import { formatClock, TICKS_PER_SECOND } from '../core/time';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import * as ops from '../project/ops';
import type { Project } from '../project/types';
import { downloadBlob, ensureAssetFile, serializeProject } from '../app/actions';
import { toSrt, toVtt } from '../captions/subtitles';
import { encodeWav, mixdownTimeline } from '../audio/mixdown';
import { decodeAudioForExport } from '../audio/prepare';
import { snapshotThumbnail } from './Preview';
import { Badge, Button, Field, Panel, Slider } from './components';

function canBrowserShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    const probe = new File(['probe'], 'probe.txt', { type: 'text/plain' });
    return Boolean(nav.canShare({ files: [probe] }));
  } catch {
    return false;
  }
}

export function PlanningPanel({ project }: { project: Project }) {
  const apply = useEditor((s) => s.apply);
  const softUpdate = useEditor((s) => s.softUpdate);
  const playheadTicks = useEditor((s) => s.playheadTicks);
  const pushToast = useSession((s) => s.pushToast);

  const [shotTitle, setShotTitle] = useState('');
  const [shotDuration, setShotDuration] = useState('3');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [wavBusy, setWavBusy] = useState(false);

  const coverTicks = project.coverTimeTicks ?? playheadTicks;
  const shareSupported = canBrowserSectionsShare();

  useEffect(() => {
    let cancelled = false;
    void snapshotThumbnail(project, null, coverTicks, true)
      .then((blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        setCoverUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, coverTicks]);

  useEffect(() => {
    return () => {
      if (coverUrl) URL.revokeObjectURL(coverUrl);
    };
  }, [coverUrl]);

  const baseSlug = project.name.replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lesson';

  const handleCopyText = async (label: string, text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        pushToast(`Copied ${label} to clipboard.`, 'success');
      } else {
        pushToast(`Clipboard API unavailable in this context.`, 'error');
      }
    } catch (err) {
      pushToast(`Could not copy ${label}: ${(err as Error).message}`, 'error');
    }
  };

  const handleDownloadCover = async () => {
    const blob = await snapshotThumbnail(project, null, coverTicks, true);
    if (!blob) {
      pushToast('Could not render cover frame.', 'error');
      return;
    }
    downloadBlob(blob, `${baseSlug}-cover-1280x720.png`);
    pushToast('Downloaded PNG cover frame.', 'success');
  };

  const handleDownloadSubtitles = (format: 'srt' | 'vtt') => {
    const text = format === 'srt' ? toSrt(project.captions) : toVtt(project.captions);
    const mime = format === 'srt' ? 'application/x-subrip' : 'text/vtt';
    downloadBlob(new Blob([text], { type: mime }), `${baseSlug}.${format}`);
    pushToast(`Downloaded .${format.toUpperCase()} subtitle sidecar.`, 'success');
  };

  const handleDownloadWav = async () => {
    setWavBusy(true);
    try {
      const decoded = await decodeAudioForExport(project, (path) => ensureAssetFile(path));
      const mix = await mixdownTimeline({
        project,
        decoded,
        sampleRate: project.settings.sampleRate || 48_000,
      });
      const wavBytes = encodeWav(mix.channels, mix.sampleRate);
      const copy = new Uint8Array(wavBytes.byteLength);
      copy.set(wavBytes);
      downloadBlob(new Blob([copy.buffer], { type: 'audio/wav' }), `${baseSlug}-mixdown.wav`);
      pushToast('Downloaded WAV audio mixdown.', 'success');
    } catch (err) {
      pushToast(`WAV export failed: ${(err as Error).message}`, 'error');
    } finally {
      setWavBusy(false);
    }
  };

  const handleDownloadBundle = () => {
    const json = serializeProject(project);
    downloadBlob(new Blob([json], { type: 'application/json' }), `${baseSlug}-project-bundle.json`);
    pushToast('Downloaded restorable project bundle JSON.', 'success');
  };

  const handleNativeShare = async () => {
    const blob = await snapshotThumbnail(project, null, coverTicks, true);
    const files: File[] = [];
    if (blob) {
      files.push(new File([blob], `${baseSlug}-cover.png`, { type: 'image/png' }));
    }
    const srtText = toSrt(project.captions);
    if (project.captions.length > 0) {
      files.push(new File([srtText], `${baseSlug}.srt`, { type: 'text/plain' }));
    }
    try {
      await navigator.share({
        title: project.name,
        text: project.socialCaption || project.notes || project.name,
        ...(files.length > 0 ? { files } : {}),
      });
    } catch (err) {
      if (!/abort/i.test((err as Error).message)) {
        pushToast(`Native share failed: ${(err as Error).message}`, 'error');
      }
    }
  };

  const shots = project.storyboard ?? [];
  const doneCount = shots.filter((s) => s.done).length;

  return (
    <div className="stack" style={{ gap: 12 }} data-testid="planning-share-panel">
      <Panel
        title="11 · Planning & Share Handoff"
        subtitle="Shot list, session notes, social caption, selected cover frame, and local handoff downloads."
        actions={
          <Badge tone={doneCount === shots.length && shots.length > 0 ? 'ok' : 'default'}>
            {doneCount}/{shots.length} shots complete
          </Badge>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Shot list / Storyboard checklist">
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                placeholder="Shot title (e.g. 01 Cluster preflight)…"
                aria-label="Storyboard shot title"
                value={shotTitle}
                onChange={(e) => setShotTitle(e.target.value)}
              />
              <input
                className="input mono"
                type="number"
                min={1}
                max={600}
                style={{ width: 68 }}
                aria-label="Shot target seconds"
                value={shotDuration}
                onChange={(e) => setShotDuration(e.target.value)}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (!shotTitle.trim()) return;
                  apply('Add storyboard shot', (p) =>
                    ops.addStoryboardItem(p, {
                      title: shotTitle,
                      durationSeconds: Math.max(1, Number(shotDuration) || 3),
                    }),
                  );
                  setShotTitle('');
                }}
              >
                + Add
              </Button>
            </div>
            {shots.length === 0 ? (
              <div className="field-hint">No shots in the storyboard yet. Add shots above to track recording coverage.</div>
            ) : (
              <div className="storyboard-list" style={{ marginTop: 6 }}>
                {shots.map((shot) => (
                  <div key={shot.id} className={`storyboard-item ${shot.done ? 'done' : ''}`}>
                    <input
                      type="checkbox"
                      checked={shot.done}
                      aria-label={`Complete ${shot.title}`}
                      onChange={() => apply('Toggle shot', (p) => ops.toggleStoryboardItem(p, shot.id))}
                    />
                    <span className="storyboard-text" style={{ flex: 1 }}>
                      {shot.title}
                    </span>
                    {shot.durationSeconds && <Badge>{shot.durationSeconds}s</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => apply('Remove shot', (p) => ops.removeStoryboardItem(p, shot.id))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field label="Project & production notes">
            <textarea
              className="textarea"
              aria-label="Planning notes"
              value={project.notes}
              placeholder="Technical commands, talking points, or edit handoff notes…"
              onChange={(e) => softUpdate((p) => ops.setProjectNotes(p, e.target.value))}
            />
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <Button size="sm" variant="ghost" onClick={() => void handleCopyText('notes', project.notes)}>
                Copy notes
              </Button>
            </div>
          </Field>

          <Field
            label="Social post caption (manual publish handoff)"
            hint="Instagram, YouTube, and TikTok account publishing are manual local handoffs — no cloud or OAuth account upload leaves this browser."
          >
            <textarea
              className="textarea"
              aria-label="Social post caption"
              value={project.socialCaption ?? ''}
              placeholder="Write your caption and hashtags for manual handoff…"
              onChange={(e) => softUpdate((p) => ops.setSocialCaption(p, e.target.value))}
            />
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
              <span className="field-hint mono">{(project.socialCaption ?? '').length} chars</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleCopyText('social caption', project.socialCaption ?? '')}
              >
                Copy social caption
              </Button>
            </div>
          </Field>

          <Field label={`Selected cover frame (${formatClock(coverTicks)})`}>
            <Slider
              label="Cover timestamp"
              min={0}
              max={Math.max(1, project.durationTicks / TICKS_PER_SECOND)}
              step={0.1}
              value={coverTicks / TICKS_PER_SECOND}
              format={(v) => `${v.toFixed(1)}s`}
              onChange={(sec) =>
                apply('Select cover timestamp', (p) => ops.setCoverTimeTicks(p, Math.round(sec * TICKS_PER_SECOND)))
              }
            />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => apply('Use playhead as cover', (p) => ops.setCoverTimeTicks(p, playheadTicks))}
              >
                Use current playhead ({formatClock(playheadTicks)})
              </Button>
              <Button size="sm" variant="primary" onClick={() => void handleDownloadCover()}>
                Download cover PNG
              </Button>
            </div>
            {coverUrl && (
              <img
                src={coverUrl}
                alt="Selected cover preview"
                style={{
                  width: '100%',
                  maxHeight: 160,
                  objectFit: 'contain',
                  background: '#111018',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  marginTop: 6,
                }}
              />
            )}
          </Field>

          <Field label="Handoff asset downloads">
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Button size="sm" onClick={() => handleDownloadSubtitles('srt')}>
                Download .SRT
              </Button>
              <Button size="sm" onClick={() => handleDownloadSubtitles('vtt')}>
                Download .VTT
              </Button>
              <Button size="sm" disabled={wavBusy} onClick={() => void handleDownloadWav()}>
                {wavBusy ? 'Mixing WAV…' : 'Download WAV audio'}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDownloadBundle}>
                Download project JSON
              </Button>
              {shareSupported && (
                <Button size="sm" variant="primary" onClick={() => void handleNativeShare()}>
                  Share files…
                </Button>
              )}
            </div>
          </Field>
        </div>
      </Panel>
    </div>
  );
}

function canBrowserSectionsShare(): boolean {
  return canBrowserShareFiles();
}
