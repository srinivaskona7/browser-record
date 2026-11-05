/**
 * Procedural zero-dependency creator sound effects synthesizer.
 * Generates 16-bit mono PCM WAV bytes and Float32 sample arrays locally in the
 * browser for transitions, stickers, callouts and terminal walkthroughs.
 */

export type SfxKind = 'whoosh' | 'pop' | 'ding' | 'keyclick' | 'riser' | 'success-chime';

export interface SfxPresetInfo {
  id: SfxKind;
  label: string;
  durationSeconds: number;
  description: string;
}

export const SFX_PRESETS: SfxPresetInfo[] = [
  { id: 'whoosh', label: 'Transition Whoosh', durationSeconds: 0.35, description: 'Filtered noise sweep for whip pans, punch-ins and slide cuts.' },
  { id: 'pop', label: 'Sticker Pop', durationSeconds: 0.14, description: 'Crisp pitch-drop bubble pop for callouts and subscribe stickers.' },
  { id: 'ding', label: 'Notification Ding', durationSeconds: 0.55, description: 'Harmonic bell chime for key metrics and pro-tips.' },
  { id: 'keyclick', label: 'Mechanical Key Click', durationSeconds: 0.08, description: 'Tactile switch click for CLI and IDE keystroke overlays.' },
  { id: 'riser', label: 'Suspense Riser', durationSeconds: 0.9, description: 'Upward pitch + amplitude sweep leading into a reveal or hook.' },
  { id: 'success-chime', label: 'Deploy Success', durationSeconds: 0.65, description: 'Two-note major fifth chime for green builds and rollouts.' },
];

export function synthesizeSfxSamples(kind: SfxKind, sampleRate = 48_000): Float32Array {
  const spec = SFX_PRESETS.find((item) => item.id === kind) ?? SFX_PRESETS[0]!;
  const totalSamples = Math.max(1, Math.round(spec.durationSeconds * sampleRate));
  const out = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const progress = i / totalSamples;
    let sample = 0;

    if (kind === 'whoosh') {
      const env = Math.sin(Math.PI * progress);
      const freq = 180 + 920 * Math.sin(Math.PI * progress);
      // Deterministic pseudo-noise modulated by a swept carrier
      const noise = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const white = (noise - Math.floor(noise)) * 2 - 1;
      sample = (white * 0.55 + Math.sin(2 * Math.PI * freq * t) * 0.45) * env * 0.6;
    } else if (kind === 'pop') {
      const env = Math.exp(-progress * 9);
      const freq = 520 - 360 * progress;
      sample = Math.sin(2 * Math.PI * freq * t) * env * 0.75;
    } else if (kind === 'ding') {
      const env = Math.exp(-progress * 5.5);
      sample =
        (Math.sin(2 * Math.PI * 1046.5 * t) * 0.65 +
          Math.sin(2 * Math.PI * 2093 * t) * 0.25 +
          Math.sin(2 * Math.PI * 3139.5 * t) * 0.1) *
        env *
        0.7;
    } else if (kind === 'keyclick') {
      const env = Math.exp(-progress * 22);
      const click = Math.sin(2 * Math.PI * 1800 * t) + Math.sin(2 * Math.PI * 420 * t) * 0.6;
      sample = click * env * 0.55;
    } else if (kind === 'riser') {
      const env = progress * progress * (1 - Math.pow(progress, 8));
      const phase = 2 * Math.PI * (140 * t + 480 * progress * t);
      sample = Math.sin(phase) * env * 0.65;
    } else if (kind === 'success-chime') {
      const noteFreq = progress < 0.42 ? 523.25 : 783.99; // C5 -> G5
      const localProgress = progress < 0.42 ? progress / 0.42 : (progress - 0.42) / 0.58;
      const env = Math.exp(-localProgress * 4.2);
      sample = (Math.sin(2 * Math.PI * noteFreq * t) * 0.75 + Math.sin(2 * Math.PI * noteFreq * 2 * t) * 0.25) * env * 0.65;
    }

    out[i] = Math.max(-1, Math.min(1, sample));
  }

  return out;
}

/** Encode mono Float32 samples into a standard 16-bit PCM RIFF WAV Uint8Array. */
export function encodeWavMono(samples: Float32Array, sampleRate = 48_000): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    const pcm = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(44 + i * 2, pcm, true);
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
