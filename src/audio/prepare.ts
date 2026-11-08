import type { Project } from '../project/types';
import { mixdownProject, type AudioResolver } from './mixdown';
import { toMono } from '../captions/chunking';
import type { Tick } from '../core/time';

export interface AudioPrep {
  samples: Float32Array;
  sampleRate: number;
  offsetSeconds: number;
}

/**
 * Mono mixdown of the project audio for speech recognition or silence
 * detection. Rendering the same way export does means what you see in the
 * transcript corresponds to what ships in the file.
 */
export async function prepareMonoAudio(
  project: Project,
  resolver: AudioResolver,
  options: { startTicks?: Tick; durationTicks?: Tick } = {},
): Promise<AudioPrep> {
  const sampleRate = project.settings.sampleRate;
  const startTicks = options.startTicks ?? 0;
  const durationTicks = Math.min(
    options.durationTicks ?? project.durationTicks,
    Math.max(0, project.durationTicks - startTicks),
  );
  if (durationTicks <= 0) {
    return { samples: new Float32Array(0), sampleRate, offsetSeconds: 0 };
  }
  const result = await mixdownProject(project, resolver, {
    sampleRate,
    startTicks,
    durationTicks,
    channels: 1,
    ducking: false,
  });
  const buffer = result.buffer;
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i += 1) channels.push(buffer.getChannelData(i));
  return {
    samples: toMono(channels, buffer.length),
    sampleRate: buffer.sampleRate,
    offsetSeconds: startTicks / 720_000,
  };
}

/** Build an AudioResolver for WAV or video export by decoding project audio assets on demand. */
export async function decodeAudioForExport(
  project: Project,
  getAssetFile: (assetPath: string) => Promise<File>,
  createAudioContext?: () => AudioContext,
): Promise<AudioResolver> {
  const contextFactory =
    createAudioContext ?? (() => new AudioContext({ sampleRate: project.settings.sampleRate || 48_000 }));
  let context: AudioContext | null = null;
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  return {
    getBuffer: async (assetId: string) => {
      const existing = cache.get(assetId);
      if (existing) return existing;
      const promise = (async () => {
        const asset = project.assets.find((a) => a.id === assetId);
        if (!asset) return null;
        try {
          context ??= contextFactory();
          const file = await getAssetFile(asset.path);
          const bytes = await file.arrayBuffer();
          return await context.decodeAudioData(bytes);
        } catch {
          return null;
        }
      })();
      cache.set(assetId, promise);
      return promise;
    },
  };
}

