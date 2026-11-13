import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../project/types';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import { Dialog, Button, Field, Select, ProgressBar, Badge } from './components';
import { CAPTION_LANGUAGES } from '../captions/glossary';
import { TRANSCRIPTION_MODELS, segmentsToCues, transcribeInWorker } from '../captions/transcribe';
import { prepareMonoAudio } from '../audio/prepare';
import { ensureAssetFile } from '../app/actions';

export function TranscribeDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const [modelId, setModelId] = useState(TRANSCRIPTION_MODELS[1]!.id);
  const [language, setLanguage] = useState('en');
  const [device, setDevice] = useState<'webgpu' | 'wasm'>('wasm');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const apply = useEditor((state) => state.apply);
  const toast = useSession((state) => state.pushToast);
  const model = useMemo(() => TRANSCRIPTION_MODELS.find((m) => m.id === modelId)!, [modelId]);
  const hasWebGpu = useSession((state) => state.features.webGpu);

  // Closing resets the dialog during render (no effect-driven second pass) and cancels any run;
  // the cancelled run sees it is no longer current and leaves the reset state alone.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setPhase('idle');
      setProgress(0);
      setError(null);
      setDetail('');
    }
  }
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  const run = async () => {
    setPhase('preparing');
    setError(null);
    setProgress(0.01);
    setDetail('Mixing narration for recognition');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resolver = {
        getBuffer: async (assetId: string) => {
          const asset = project.assets.find((a) => a.id === assetId);
          if (!asset) return null;
          const file = await ensureAssetFile(asset.path);
          const context = new AudioContext({ sampleRate: project.settings.sampleRate });
          try {
            return await context.decodeAudioData(await file.arrayBuffer());
          } finally {
            void context.close();
          }
        },
      };
      const audio = await prepareMonoAudio(project, resolver);
      if (audio.samples.length === 0) throw new Error('There is no audio on the timeline to transcribe.');
      setPhase('running');
      const result = await transcribeInWorker(
        {
          type: 'transcribe',
          audio: audio.samples,
          sampleRate: audio.sampleRate,
          modelId,
          language,
          device,
        },
        {
          modelId,
          language,
          signal: controller.signal,
          onProgress: (value, label) => {
            setProgress(value);
            setDetail(label);
          },
        },
      );
      const cues = segmentsToCues(result.segments, audio.offsetSeconds, project.settings.glossary);
      if (cues.length === 0) throw new Error('The model returned no speech. Check that narration is audible.');
      apply('Transcribe audio', (p) => ({
        ...p,
        captions: replaceExisting ? cues : [...p.captions, ...cues].sort((a, b) => a.startTicks - b.startTicks),
      }));
      setPhase('done');
      setProgress(1);
      setDetail(`Added ${cues.length} captions.`);
      toast(`Transcription added ${cues.length} captions. Review the glossary suggestions.`, 'success');
    } catch (err) {
      if (abortRef.current !== controller) return;
      const message = (err as Error).message;
      setPhase('error');
      setError(message);
      toast(`Transcription failed: ${message}`, 'error');
    }
  };

  const busy = phase === 'preparing' || phase === 'running';

  return (
    <Dialog
      open={open}
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      title="Transcribe locally"
      footer={
        <>
          {busy ? (
            <Button variant="danger" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
          <Button variant="primary" onClick={run} disabled={busy}>
            {phase === 'done' ? 'Re-run transcription' : 'Download model & transcribe'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="hint-card">
          Speech recognition runs in your browser with Whisper. The model is downloaded from the Hugging Face Hub
          once, cached locally, and never uploaded anywhere. Audio stays on this machine.
        </div>
        <Field label="Model" hint={model.notes}>
          <Select
            value={modelId}
            onChange={setModelId}
            disabled={busy}
            options={TRANSCRIPTION_MODELS.map((item) => ({
              value: item.id,
              label: `${item.label} · ~${item.sizeMB} MB`,
            }))}
          />
        </Field>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Field label="Language" hint={model.multilingual ? 'Required for multilingual checkpoints.' : 'English-only model.'}>
              <Select
                value={language}
                onChange={setLanguage}
                disabled={busy || !model.multilingual}
                options={CAPTION_LANGUAGES.map((item) => ({ value: item.code, label: item.label }))}
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Compute" hint={hasWebGpu ? 'WebGPU is faster when available.' : 'WebGPU is unavailable here; WASM is used.'}>
              <Select
                value={device}
                onChange={setDevice}
                disabled={busy || !hasWebGpu}
                options={[
                  { value: 'wasm', label: 'CPU (WASM)' },
                  { value: 'webgpu', label: 'WebGPU', disabled: !hasWebGpu },
                ]}
              />
            </Field>
          </div>
        </div>
        <Field label="Existing captions">
          <Select
            value={replaceExisting ? 'replace' : 'append'}
            onChange={(value) => setReplaceExisting(value === 'replace')}
            disabled={busy}
            options={[
              { value: 'replace', label: 'Replace existing captions' },
              { value: 'append', label: 'Keep and append' },
            ]}
          />
        </Field>
        {busy && (
          <div className="stack" style={{ gap: 6 }}>
            <ProgressBar value={progress} label="Transcription progress" />
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--token-font-sm)', color: 'var(--text-2)' }}>
              <span>{detail}</span>
              <span className="mono">{Math.round(progress * 100)}%</span>
            </div>
            <div className="field-hint">
              Transcription is faster than real time on most machines but can take minutes for a long lesson. Keep
              this tab open; the model downloads in chunks.
            </div>
          </div>
        )}
        {error && <div className="danger-card">{error}</div>}
        <div className="field-hint">
          Word-level karaoke highlighting is only enabled when a model returns real word timings. Whisper segment
          timings are reliable; word timings are not, so they are not invented.
        </div>
        {phase === 'done' && <Badge tone="ok">Captions added</Badge>}
      </div>
    </Dialog>
  );
}

/** Small utility so other panels can build the same resolver. */
export function buildProjectAudioResolver(project: Project) {
  return {
    getBuffer: async (assetId: string) => {
      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) return null;
      const file = await ensureAssetFile(asset.path);
      const context = new AudioContext({ sampleRate: project.settings.sampleRate });
      try {
        return await context.decodeAudioData(await file.arrayBuffer());
      } finally {
        void context.close();
      }
    },
  };
}
