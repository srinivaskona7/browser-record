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
