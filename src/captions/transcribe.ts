import type { CaptionCue } from '../project/types';
import { TICKS_PER_SECOND } from '../core/time';
import { applyGlossary, suggestGlossaryFixes } from './glossary';
import { dedupeSegments, planChunks, type ChunkPlan, type TimedSegment, type TranscriptionSegment } from './chunking';

export { planChunks, dedupeSegments };
export type { ChunkPlan, TimedSegment, TranscriptionSegment };

export interface TranscriptionModel {
  id: string;
  label: string;
  /** Approximate download size. Shown before anything is downloaded. */
  sizeMB: number;
  multilingual: boolean;
  englishOnly?: boolean;
  notes: string;
}

/**
 * Whisper checkpoints that run in the browser through Transformers.js. Sizes are
 * approximate download weights (quantised ONNX), not RAM use.
 */
export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
  {
    id: 'onnx-community/whisper-tiny.en',
    label: 'Whisper Tiny (English)',
    sizeMB: 42,
    multilingual: false,
    englishOnly: true,
    notes: 'Fastest, lowest accuracy. Good for a first pass on clean narration.',
  },
  {
    id: 'onnx-community/whisper-base.en',
    label: 'Whisper Base (English)',
    sizeMB: 78,
    multilingual: false,
    englishOnly: true,
    notes: 'Balanced speed and accuracy for technical English.',
  },
  {
    id: 'onnx-community/whisper-small.en',
    label: 'Whisper Small (English)',
    sizeMB: 250,
    multilingual: false,
    englishOnly: true,
    notes: 'Better with accents and jargon; slower on CPU.',
  },
  {
    id: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny (multilingual)',
    sizeMB: 45,
    multilingual: true,
    notes: 'Language must be selected explicitly.',
  },
  {
    id: 'onnx-community/whisper-base',
    label: 'Whisper Base (multilingual)',
    sizeMB: 82,
    multilingual: true,
    notes: 'Language must be selected explicitly.',
  },
];

export interface TranscribeOptions {
  modelId: string;
  language: string;
  /** Called with 0..1 progress plus a phase label. */
  onProgress?: (progress: number, phase: string) => void;
  signal?: AbortSignal;
  device?: 'webgpu' | 'wasm';
}

export function segmentsToCues(
  segments: TranscriptionSegment[],
  offsetSeconds: number,
  glossary: Record<string, string>,
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const cleaned = applyGlossary(text, glossary).text;
    const startTicks = Math.round((segment.start + offsetSeconds) * TICKS_PER_SECOND);
    const endTicks = Math.max(startTicks + 1, Math.round((segment.end + offsetSeconds) * TICKS_PER_SECOND));
    cues.push({
      id: `cue_${startTicks}_${cues.length}`,
      startTicks,
      endTicks,
      text: cleaned,
    });
  }
  return cues;
}

/** Suggestions are returned, never applied silently. */
export function glossarySuggestionsForCues(cues: CaptionCue[], glossary: Record<string, string>) {
  return cues.flatMap((cue) => suggestGlossaryFixes(cue.text, glossary).map((s) => ({ ...s, cueId: cue.id })));
}

export interface TranscriptionProgress {
  phase: 'download' | 'transcribe' | 'postprocess' | 'done';
  progress: number;
  detail?: string;
}

export interface TranscriptionRequest {
  type: 'transcribe';
  audio: Float32Array;
  sampleRate: number;
  modelId: string;
  language: string;
  device: 'webgpu' | 'wasm';
}

export type TranscriptionResponse =
  | { type: 'progress'; phase: TranscriptionProgress['phase']; progress: number; detail?: string }
  | { type: 'result'; segments: TranscriptionSegment[]; wordsSupported: boolean }
  | { type: 'error'; message: string };

/**
 * Runs Whisper in a worker. The models are downloaded from the Hugging Face
 * Hub only after the user confirms the size shown in the UI, then cached by the
 * browser (Cache API). Nothing is uploaded.
 */
export async function transcribeInWorker(
  request: TranscriptionRequest,
  options: TranscribeOptions,
): Promise<{ segments: TranscriptionSegment[]; wordsSupported: boolean }> {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are unavailable in this browser.');
  }
  const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const abort = () => {
        worker.terminate();
        reject(new DOMException('Transcription cancelled', 'AbortError'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<TranscriptionResponse>) => {
        const message = event.data;
        if (message.type === 'progress') {
          options.onProgress?.(message.progress, message.detail ?? message.phase);
        } else if (message.type === 'result') {
          options.onProgress?.(1, 'done');
          resolve({ segments: message.segments, wordsSupported: message.wordsSupported });
        } else if (message.type === 'error') {
          reject(new Error(message.message));
        }
      };
      worker.onerror = (event) => reject(new Error(event.message || 'Transcription worker crashed.'));
      worker.postMessage(request, [request.audio.buffer]);
    });
  } finally {
    worker.terminate();
    options.signal?.removeEventListener('abort', () => undefined);
  }
}
