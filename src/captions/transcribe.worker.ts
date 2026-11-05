/// <reference lib="webworker" />
import { dedupeSegments, planChunks, sliceAudio, type TimedSegment } from './chunking';
import type { TranscriptionRequest, TranscriptionResponse } from './transcribe';

interface WhisperOutput {
  text: string;
  chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
}

type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<WhisperOutput>;

let activeModelId: string | null = null;
let transcriber: Transcriber | null = null;

const post = (message: TranscriptionResponse) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

async function loadPipeline(modelId: string, device: 'webgpu' | 'wasm'): Promise<Transcriber> {
  if (transcriber && activeModelId === modelId) return transcriber;
  const transformers = await import('@huggingface/transformers');
  const env = transformers.env;
  env.allowLocalModels = false;
  // Models are downloaded once and cached by the browser; nothing is uploaded.
  env.useBrowserCache = true;
  const { pipeline } = transformers;
  post({ type: 'progress', phase: 'download', progress: 0.02, detail: 'Loading model from cache or hub…' });
  const created = await pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    device,
    progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
      if (info.status === 'progress' && typeof info.progress === 'number') {
        post({
          type: 'progress',
          phase: 'download',
          progress: Math.min(0.45, 0.02 + (info.progress / 100) * 0.43),
          detail: info.file ? `Downloading ${info.file}` : 'Downloading model',
        });
      }
    },
  });
  transcriber = created as unknown as Transcriber;
  activeModelId = modelId;
  return transcriber;
}

self.onmessage = async (event: MessageEvent<TranscriptionRequest>) => {
  const request = event.data;
  if (request?.type !== 'transcribe') return;
  try {
    const model = await loadPipeline(request.modelId, request.device);
    const plans = planChunks(request.audio.length / request.sampleRate, 25, 2);
    const segments: TimedSegment[] = [];
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index]!;
      const chunk = sliceAudio(request.audio, request.sampleRate, plan);
      const result = await model(chunk, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        language: request.language,
        task: 'transcribe',
        // Without this the model may hallucinate on silence.
        condition_on_previous_text: false,
      });
      const produced = result.chunks?.length
        ? result.chunks
            .filter((c) => typeof c.timestamp[1] === 'number')
            .map((c) => ({
              start: c.timestamp[0] + plan.startSeconds,
              end: Math.min(plan.endSeconds, (c.timestamp[1] as number) + plan.startSeconds),
              text: c.text,
              chunkStart: plan.startSeconds,
            }))
        : result.text.trim()
          ? [{ start: plan.startSeconds, end: plan.endSeconds, text: result.text, chunkStart: plan.startSeconds }]
          : [];
      segments.push(...produced);
      post({
        type: 'progress',
        phase: 'transcribe',
        progress: 0.45 + ((index + 1) / plans.length) * 0.5,
        detail: `Transcribed ${index + 1} of ${plans.length} chunks`,
      });
    }
    const merged = dedupeSegments(segments).map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
    }));
    post({ type: 'progress', phase: 'postprocess', progress: 0.98 });
    // Word-level timings are only reported when the model actually returns them.
    post({ type: 'result', segments: merged, wordsSupported: false });
  } catch (error) {
    post({ type: 'error', message: (error as Error).message || 'Transcription failed.' });
  }
};

export {};
