export interface MeterReading {
  /** Linear peak 0..1+. */
  peak: number;
  /** Linear RMS 0..1. */
  rms: number;
  peakDb: number;
  rmsDb: number;
  clipping: boolean;
}

/**
 * Live input meter driven by an AnalyserNode. This is what makes gain staging
 * visible before recording rather than after.
 */
export class InputMeter {
  private context: AudioContext;
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buffer: Float32Array;
  private peakHold = 0;
  private peakHoldUntil = 0;
  private ownsContext: boolean;
  private rafId: number | null = null;

  constructor(stream: MediaStream, options: { context?: AudioContext; fftSize?: number } = {}) {
    this.context = options.context ?? new AudioContext();
    this.ownsContext = !options.context;
    this.source = this.context.createMediaStreamSource(stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = options.fftSize ?? 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
  }

  read(now = performance.now()): MeterReading {
    this.analyser.getFloatTimeDomainData(this.buffer as Float32Array<ArrayBuffer>);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const sample = this.buffer[i]!;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / this.buffer.length);
    if (peak >= this.peakHold || now > this.peakHoldUntil) {
      this.peakHold = peak;
      this.peakHoldUntil = now + 1200;
    }
    return {
      peak: Math.max(peak, this.peakHold),
      rms,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
      clipping: peak >= 0.999,
    };
  }

  /** Poll the meter at display rate; returns a stop function. */
  start(onReading: (reading: MeterReading) => void): () => void {
    const tick = () => {
      onReading(this.read());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
    return () => this.stop();
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    try {
      this.source.disconnect();
      this.analyser.disconnect();
    } catch {
      /* already disconnected */
    }
    if (this.ownsContext) void this.context.close().catch(() => undefined);
  }
}

/** dBFS to a 0..1 bar position with a floor of -60 dB. */
export function meterPosition(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}
