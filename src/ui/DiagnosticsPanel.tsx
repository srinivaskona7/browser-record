import { useEffect, useState } from 'react';
import { useSession } from '../app/session';
import { Badge, Button, Panel, Select, Stat } from './components';
import { CapabilityMatrix } from './CapabilityMatrix';
import { AUDIO_CODECS, VIDEO_CODECS, probeAudioEncoder, probeVideoEncoder, probeRecorderMimeTypes, type CodecSupport } from '../capabilities/codecs';
import { runEncodeBenchmark, type BenchmarkResult } from '../capabilities/benchmark';
import { readQuota, requestPersistentStorage, storageModeLabel } from '../workspace/workspace';
import { formatBytes } from '../export/presets';
import { TICKS_PER_SECOND } from '../core/time';

export function DiagnosticsPanel() {
  const session = useSession();
  const features = session.features;
  const [codecs, setCodecs] = useState<CodecSupport[]>([]);
  const [probing, setProbing] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(session.benchmark);
  const [benchmarkSize, setBenchmarkSize] = useState<'4k' | '1080'>('1080');
  const [benchmarking, setBenchmarking] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | undefined>(undefined);
  const [storageMode, setStorageMode] = useState<string>('—');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const recorderMimes = probeRecorderMimeTypes();

  useEffect(() => {
    void (async () => {
      setQuota(await readQuota());
      if (session.workspace) setStorageMode(await storageModeLabel(session.workspace.info.mode));
    })();
  }, [session.storageMode]);

  const probe = async (width = 3840, height = 2160) => {
    setProbing(true);
    try {
      const fps = session.workspace ? 30 : 30;
      const list: CodecSupport[] = [];
      for (const codec of VIDEO_CODECS) list.push(await probeVideoEncoder(codec, width, height, fps, 10_000_000));
      for (const codec of AUDIO_CODECS) list.push(await probeAudioEncoder(codec, 48_000, 2, 128_000));
      setCodecs(list);
      session.setCodecSupport(list);
      return list;
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    void probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runBenchmark = async () => {
    setBenchmarking(true);
    try {
      const dimensions = benchmarkSize === '4k' ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 };
      const codec = VIDEO_CODECS.find((item) => item.family === 'h264') ?? VIDEO_CODECS[0]!;
      const result = await runEncodeBenchmark({
        ...dimensions,
        fps: 30,
        frames: 45,
        codec,
        bitrate: benchmarkSize === '4k' ? 12_000_000 : 6_000_000,
      });
      setBenchmark(result);
      session.setBenchmark(result);
    } catch (error) {
      session.pushToast(`Benchmark failed: ${(error as Error).message}`, 'error');
    } finally {
      setBenchmarking(false);
    }
  };

  const featureRows: Array<[string, boolean, string]> = [
    ['Screen capture', features.screenCapture, 'getDisplayMedia'],
    ['Camera / microphone', features.camera, 'getUserMedia'],
    ['MediaRecorder', features.mediaRecorder, 'segmented capture'],
    ['WebCodecs encode', features.webCodecsEncode, 'VideoEncoder'],
    ['WebCodecs decode', features.webCodecsDecode, 'VideoDecoder'],
    ['File System Access', features.fileSystemAccess, 'folder-backed projects'],
    ['OPFS', features.opfs, 'fallback storage'],
    ['OffscreenCanvas', features.offscreenCanvas, 'worker rendering'],
    ['AudioContext', features.audioContext, 'mixdown and metering'],
    ['AudioWorklet', features.audioWorklet, 'custom meters'],
    ['SharedArrayBuffer', features.sharedArrayBuffer, 'not required by this build'],
    ['WebGL2', features.webGl2, 'colour and accelerated compositing'],
    ['WebGPU', features.webGpu, 'optional acceleration'],
    ['Wake lock', features.wakeLock, 'keep the screen awake while recording'],
    ['Persistent storage', features.persistentStorageQuery, 'eviction protection for OPFS'],
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Diagnostics</h1>
          <p className="page-subtitle">
            What this browser, this machine and this workspace can actually do. Support is probed here rather than
            assumed from a user-agent string.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void probe()}>
          {probing ? 'Probing…' : 'Re-run probes'}
        </Button>
      </header>

      <div className="stack" style={{ gap: 14, maxWidth: 1280 }}>
        <Panel title="Environment">
          <div className="row" style={{ gap: 26, flexWrap: 'wrap' }}>
            <Stat label="Browser" value={`${session.browser.name} ${session.browser.version}`} />
            <Stat label="Platform" value={session.browser.os} />
            <Stat label="Storage mode" value={session.workspace ? storageMode : 'not connected'} />
            <Stat label="Workspace" value={session.workspace?.info.name ?? 'not connected'} />
          </div>
          {quota && (
            <div className="stack" style={{ gap: 6, marginTop: 12 }}>
              <div className="meter">
                <div className="meter-fill" style={{ width: `${Math.min(100, (quota.usage / Math.max(1, quota.quota)) * 100).toFixed(1)}%` }} />
              </div>
              <div className="field-hint mono">
                {formatBytes(quota.usage)} used of {formatBytes(quota.quota)} available
              </div>
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <Button
              size="sm"
              onClick={async () => {
                const granted = await requestPersistentStorage();
                setPersisted(granted);
                session.pushToast(granted ? 'Storage marked persistent.' : 'The browser declined persistent storage.', granted ? 'success' : 'error');
              }}
            >
              Request persistent storage
            </Button>
            {persisted !== null && <Badge tone={persisted ? 'ok' : 'warn'}>{persisted ? 'persistent' : 'may be evicted'}</Badge>}
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Persistent storage matters for OPFS workspaces. A folder-backed workspace is a normal directory and is not
            subject to browser eviction.
          </div>
        </Panel>

        <Panel title="Platform features">
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Used for</th>
                <th>Present</th>
              </tr>
            </thead>
            <tbody>
              {featureRows.map(([label, present, usage]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="field-hint">{usage}</td>
                  <td>
                    <Badge tone={present ? 'ok' : 'warn'}>{present ? 'yes' : 'no'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Codec probes" action={<Button size="sm" variant="ghost" onClick={() => void probe()} disabled={probing}>Probe</Button>}>
          <table className="table">
            <thead>
              <tr>
                <th>Codec</th>
                <th>Type</th>
                <th>Encoder</th>
                <th>Decoder</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {codecs.map((item) => (
                <tr key={item.codec.codec}>
                  <td className="mono">{item.codec.label}</td>
                  <td>{item.codec.video ? 'video' : 'audio'}</td>
                  <td>
                    <Badge tone={item.encoderSupported ? 'ok' : 'warn'}>{item.encoderSupported ? 'yes' : 'no'}</Badge>
                  </td>
                  <td>
                    <Badge tone={item.decoderSupported ? 'ok' : 'neutral'}>{item.decoderSupported ? 'yes' : 'no'}</Badge>
                  </td>
                  <td className="field-hint">{item.reason ?? '—'}</td>
                </tr>
              ))}
              {codecs.length === 0 && (
                <tr>
                  <td colSpan={5} className="field-hint">
                    Probing…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="field-hint" style={{ marginTop: 8 }}>
            Configuration probes are necessary but not sufficient. The benchmark below does a real encode and decode
            round trip, which is the only honest answer to "can this machine sustain 4K".
          </div>
        </Panel>

        <Panel title="Recorder MIME support">
          <table className="table">
            <thead>
              <tr>
                <th>MIME</th>
                <th>MediaRecorder</th>
              </tr>
            </thead>
            <tbody>
              {recorderMimes.map((item) => (
                <tr key={item.mime}>
                  <td className="mono">{item.mime}</td>
                  <td>
                    <Badge tone={item.supported ? 'ok' : 'warn'}>{item.supported ? 'yes' : 'no'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Encoder benchmark"
          action={
            <div className="row" style={{ gap: 6 }}>
              <Select
                value={benchmarkSize}
                onChange={setBenchmarkSize}
                options={[
                  { value: '1080', label: '1920×1080' },
                  { value: '4k', label: '3840×2160' },
                ]}
              />
              <Button size="sm" onClick={() => void runBenchmark()} disabled={benchmarking}>
                {benchmarking ? 'Running…' : 'Run benchmark'}
              </Button>
            </div>
          }
        >
          {benchmark ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
                <Stat label="Sustained" value={`${benchmark.sustainedFps.toFixed(1)} fps`} />
                <Stat label="Encoded" value={benchmark.encodedFrames} />
                <Stat label="Decoded" value={benchmark.decodedFrames} />
                <Stat label="Avg encode" value={`${benchmark.avgEncodeMs.toFixed(1)} ms`} />
                <Stat label="Measured bitrate" value={`${(benchmark.measuredBitrate / 1e6).toFixed(2)} Mbps`} />
                <Stat label="Round trip" value={benchmark.decoderRoundTrip ? 'ok' : 'failed'} />
              </div>
              {benchmark.ok ? (
                <Badge tone={benchmark.sustainedFps >= 30 ? 'ok' : 'warn'}>
                  {benchmark.sustainedFps >= 30 ? 'sustains 30 fps for this synthetic clip' : 'below real time — use a lower target'}
                </Badge>
              ) : (
                <Badge tone="danger">{benchmark.reason ?? 'benchmark failed'}</Badge>
              )}
              <div className="field-hint">
                45 synthetic frames with a moving test pattern. It measures this device; it is not a guarantee for a
                full lesson with camera and captions composited.
              </div>
            </div>
          ) : (
            <div className="field-hint">Run the benchmark before recording a long 4K session or choosing 60 fps.</div>
          )}
        </Panel>

        <Panel title="Capability matrix">
          <CapabilityMatrix />
          <div className="field-hint" style={{ marginTop: 10 }}>
            The timeline uses a fixed integer tick base of <span className="mono">{TICKS_PER_SECOND}</span> ticks per
            second, so frame and audio-sample boundaries are exact for 24/25/30/50/60 fps at 48 kHz.
          </div>
        </Panel>
      </div>
    </div>
  );
}
