/** Parametric EQ band settings, in the Web Audio biquad model. */
export interface EqBand {
  frequency: number;
  gainDb: number;
  q: number;
  type: 'peaking' | 'lowshelf' | 'highshelf';
}

export interface ProcessingChainOptions {
  highPassHz: number;
  eq: EqBand[];
  compressor: { thresholdDb: number; ratio: number; attack: number; release: number; knee: number };
  limiter: { thresholdDb: number; ceilingDb: number };
  enabled: boolean;
}

export const DEFAULT_CHAIN: ProcessingChainOptions = {
  highPassHz: 85,
  eq: [
    { frequency: 220, gainDb: -1.5, q: 0.9, type: 'peaking' },
    { frequency: 2400, gainDb: 1.5, q: 1.1, type: 'peaking' },
    { frequency: 7000, gainDb: 1.0, q: 0.8, type: 'highshelf' },
  ],
  compressor: { thresholdDb: -20, ratio: 3, attack: 0.006, release: 0.18, knee: 6 },
  limiter: { thresholdDb: -3, ceilingDb: -1 },
  enabled: true,
};

export interface ChainNodes {
  input: AudioNode;
  output: AudioNode;
  cleanup: () => void;
}

/**
 * Build the narration chain. The same graph is used by live monitoring and by
 * the offline mixdown, so preview and export cannot drift apart.
 */
export function buildProcessingChain(ctx: BaseAudioContext, options: ProcessingChainOptions = DEFAULT_CHAIN): ChainNodes {
  const input = ctx.createGain();
  const output = ctx.createGain();
  if (!options.enabled) {
    input.connect(output);
    return { input, output, cleanup: () => input.disconnect() };
  }

  const highPass = ctx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = options.highPassHz;
  highPass.Q.value = 0.707;

  const bands = options.eq.map((band) => {
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.frequency;
    filter.gain.value = band.gainDb;
    filter.Q.value = band.q;
    return filter;
  });

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = options.compressor.thresholdDb;
  compressor.ratio.value = options.compressor.ratio;
  compressor.attack.value = options.compressor.attack;
  compressor.release.value = options.compressor.release;
  compressor.knee.value = options.compressor.knee;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = options.limiter.thresholdDb;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;
  limiter.knee.value = 0;

  input.connect(highPass);
  let last: AudioNode = highPass;
  for (const band of bands) {
    last.connect(band);
    last = band;
  }
  last.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(output);

  return {
    input,
    output,
    cleanup: () => {
      input.disconnect();
      highPass.disconnect();
      for (const band of bands) band.disconnect();
      compressor.disconnect();
      limiter.disconnect();
      output.disconnect();
    },
  };
}

export interface LevelReport {
  peakDb: number;
  rmsDb: number;
  clipping: boolean;
}

/** Peak/RMS of a buffer. This is a real meter, not an integrated LUFS reading. */
export function measureLevel(buffer: AudioBuffer): LevelReport {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const sample = data[i]!;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
      count += 1;
    }
  }
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return {
    peakDb: linearToDb(peak),
    rmsDb: linearToDb(rms),
    clipping: peak >= 0.999,
  };
}

export function linearToDb(value: number): number {
  if (value <= 0) return -Infinity;
  return 20 * Math.log10(value);
}

export function dbToLinear(db: number): number {
  if (db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

/**
 * True peak is not measurable from a sample-peak scan alone; the label in the
 * UI says "sample peak" whenever oversampling is unavailable.
 */
export function meterLabel(): string {
  return 'Sample peak / RMS (not integrated LUFS)';
}
