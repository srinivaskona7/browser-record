import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../project/store';
import { useSession } from '../app/session';
import { Dialog, Button, Field, Toggle, Select, Badge } from './components';
import { enumerateDevices, openMicrophone, stopStream, type DeviceChoice } from '../capture/devices';
import { InputMeter, meterPosition, type MeterReading } from '../capture/audioMeter';
import { chooseRecorderMime } from '../capabilities/codecs';
import { ensureAssetFile } from '../app/actions';
import { WORKSPACE_LAYOUT } from '../workspace/types';
import { projectPath, writeBinary } from '../workspace/workspace';
import { probeMediaFile, assetFromFile } from '../media/probe';
import * as ops from '../project/ops';
import { createTrack } from '../project/factory';
import { TICKS_PER_SECOND } from '../core/time';
import type { PreviewPlayer } from './player';

export function VoiceoverDialog({
  open,
  onClose,
  player,
}: {
  open: boolean;
  onClose: () => void;
  player: PreviewPlayer | null;
}) {
  const [devices, setDevices] = useState<DeviceChoice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [level, setLevel] = useState<MeterReading | null>(null);
  const [monitor, setMonitor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<InputMeter | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTicksRef = useRef(0);
  /** Bumped by cleanup so a countdown or a stale mic request cannot finish later. */
  const runRef = useRef(0);
  const micRequestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useSession((state) => state.pushToast);
  const apply = useEditor((state) => state.apply);
  const playhead = useEditor((state) => state.playheadTicks);

  // Teardown reads the player through a ref so it fires only on close/unmount, never
  // because the editor swapped its player while the dialog was shut.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  /** Releases the mic, meter, timer, countdown and any pending mic request. Refs only: stable. */
  const releaseCapture = useCallback(() => {
    runRef.current += 1;
    micRequestRef.current += 1;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    meterRef.current?.stop();
    meterRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    playerRef.current?.pause();
  }, []);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const list = await enumerateDevices();
      setDevices(list.microphones);
      if (list.microphones[0] && !deviceId) setDeviceId(list.microphones[0].deviceId);
    })();
  }, [open, deviceId]);

  // Closing resets the visible state during render; the effect releases the hardware.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setCountdown(0);
      setStarting(false);
      setReady(false);
      setRecording(false);
      setElapsed(0);
      setLevel(null);
      setError(null);
    }
  }
  useEffect(() => {
    if (!open) releaseCapture();
  }, [open, releaseCapture]);

  useEffect(() => releaseCapture, [releaseCapture]);

  const attachMic = async () => {
    const request = ++micRequestRef.current;
    setError(null);
    setReady(false);
    try {
      stopStream(streamRef.current);
      streamRef.current = null;
      meterRef.current?.stop();
      meterRef.current = null;
      const stream = await openMicrophone({
        ...(deviceId ? { deviceId } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48_000,
        channelCount: 1,
      });
      // A second click, or a device change while this request was pending,
      // must not hand the dialog a stream it has already replaced.
      if (request !== micRequestRef.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      const meter = new InputMeter(stream);
      meterRef.current = meter;
      meter.start(setLevel);
      setReady(true);
    } catch (err) {
      if (request !== micRequestRef.current) return;
      setError(`Microphone unavailable: ${(err as Error).message}`);
      setReady(false);
    }
  };

  const start = async () => {
    if (!ready || !streamRef.current || recorderRef.current || starting) return;
    const stream = streamRef.current;
    const run = ++runRef.current;
    setStarting(true);
    setError(null);
    try {
      const mimeType = chooseRecorderMime('audio', false) || 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 160_000 });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        const message = (event as unknown as { error?: Error }).error?.message ?? 'recording stopped unexpectedly';
        setError(`Microphone recording failed: ${message}`);
        setRecording(false);
      };
      recorderRef.current = recorder;
      startTicksRef.current = useEditor.getState().playheadTicks;
      for (let i = 3; i > 0; i -= 1) {
        if (run !== runRef.current) return;
        setCountdown(i);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (run !== runRef.current) return;
      // The dialog may have been closed, or the mic released, during the
      // countdown. Recording a dead track would produce a silent take.
      if (streamRef.current !== stream || !stream.active) {
        throw new Error('The microphone was released during the countdown. Enable the mic and try again.');
      }
      setCountdown(0);
      recorder.start(1000);
      setRecording(true);
      const startedAt = performance.now();
      timerRef.current = setInterval(() => {
        setElapsed((performance.now() - startedAt) / 1000);
      }, 200);
      player?.setMuted(!monitor);
      player?.seek(startTicksRef.current);
      player?.play(startTicksRef.current);
    } catch (err) {
      recorderRef.current = null;
      setCountdown(0);
      setError(`Could not start recording: ${(err as Error).message}`);
    } finally {
      setStarting(false);
    }
  };

  const stopAndSave = async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false);
      recorderRef.current = null;
      return;
    }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    player?.pause();
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });
    recorderRef.current = null;
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
    chunksRef.current = [];
    if (blob.size === 0) {
      toast('Nothing was recorded.', 'error');
      return;
    }
    setSaving(true);
    try {
      const session = useSession.getState();
      const workspace = session.workspace;
      const folder = session.projectFolder;
      if (!workspace) throw new Error('Connect a workspace first.');
      if (!folder) throw new Error('Save the project before recording a voiceover.');
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const file = new File([blob], `voiceover-${stamp}.webm`, { type: blob.type });
      const info = await probeMediaFile(file);
      const path = `${WORKSPACE_LAYOUT.originals}/voiceover-${stamp}.webm`;
      await writeBinary(workspace.root, projectPath(folder, path), new Uint8Array(await file.arrayBuffer()));
      const asset = assetFromFile({ file, info, path, origin: 'recorded', name: `Voiceover ${new Date().toLocaleTimeString()}` });
      apply('Add voiceover', (p) => {
        let working = { ...p, assets: [...p.assets, asset] };
        let track = working.tracks.find((t) => t.kind === 'audio' && /narration|voice/i.test(t.name));
        if (!track) {
          track = working.tracks.find((t) => t.kind === 'audio');
        }
        if (!track) {
          track = createTrack('audio', 'Narration');
          working = ops.addTrack(working, track);
        }
        working = ops.addAssetClip(working, track.id, asset.id, startTicksRef.current, { mode: 'overwrite' }).project;
        return working;
      });
      toast('Voiceover saved and added at the playhead.', 'success');
      setElapsed(0);
    } catch (err) {
      toast(`Could not save voiceover: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (recording) void stopAndSave().then(onClose);
        else onClose();
      }}
      title="Record voiceover"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={recording || saving}>
            Cancel
          </Button>
          {!recording ? (
            <Button variant="primary" onClick={start} disabled={!ready || saving || starting || countdown > 0}>
              {saving ? 'Saving…' : starting || countdown > 0 ? 'Starting…' : `Record from ${(playhead / TICKS_PER_SECOND).toFixed(2)}s`}
            </Button>
          ) : (
            <Button variant="danger" onClick={stopAndSave}>
              Stop & save
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="hint-card">
          Recording starts at the playhead and the timeline plays underneath. Monitoring through headphones is off by
          default so the microphone cannot pick up the speakers.
        </div>
        <Field label="Microphone">
          <div className="row">
            <Select
              value={deviceId}
              onChange={(value) => {
                setDeviceId(value);
                setReady(false);
              }}
              disabled={recording}
              options={devices.length > 0 ? devices.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: '', label: 'No microphone found' }]}
            />
            <Button size="sm" onClick={attachMic} disabled={recording}>
              {ready ? 'Re-test' : 'Enable mic'}
            </Button>
          </div>
        </Field>
        <div className="meter" aria-label="Microphone level">
          <div className="meter-fill" style={{ transform: `scaleX(${meterPosition(level?.peakDb ?? -Infinity).toFixed(3)})` }} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 'var(--token-font-sm)', color: 'var(--text-3)' }}>
          <span className="mono">{level ? `${level.peakDb.toFixed(1)} dBFS` : 'no signal'}</span>
          {level?.clipping && <Badge tone="danger">clipping</Badge>}
          <span>{ready ? 'Mic active' : 'Mic idle'}</span>
        </div>
        <Toggle label="Monitor through headphones (off by default)" checked={monitor} onChange={setMonitor} disabled={recording} />
        {countdown > 0 && <div style={{ fontSize: 48, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{countdown}</div>}
        {recording && (
          <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
            <span className="dot" style={{ background: 'var(--danger)', width: 10, height: 10 }} />
            <span className="timecode">REC {elapsed.toFixed(1)}s</span>
          </div>
        )}
        {error && <div className="danger-card">{error}</div>}
        <div className="field-hint">
          Each voiceover is kept as its own take in <span className="mono">media/originals/</span>. Re-record as often
          as you like — earlier takes are never overwritten automatically.
        </div>
      </div>
    </Dialog>
  );
}

export { ensureAssetFile };
