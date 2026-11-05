export interface DeviceChoice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  groupId?: string;
}

export interface DeviceList {
  microphones: DeviceChoice[];
  cameras: DeviceChoice[];
  speakers: DeviceChoice[];
  /** True until the user grants permission, when labels are blank. */
  labelsAvailable: boolean;
  error?: string;
}

export async function enumerateDevices(): Promise<DeviceList> {
  const list: DeviceList = { microphones: [], cameras: [], speakers: [], labelsAvailable: false };
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { ...list, error: 'Media devices are unavailable in this browser.' };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const device of devices) {
      const choice: DeviceChoice = {
        deviceId: device.deviceId,
        label: device.label || `${device.kind} (label hidden until permission is granted)`,
        kind: device.kind as DeviceChoice['kind'],
        groupId: device.groupId,
      };
      if (device.kind === 'audioinput') list.microphones.push(choice);
      else if (device.kind === 'videoinput') list.cameras.push(choice);
      else if (device.kind === 'audiooutput') list.speakers.push(choice);
    }
    list.labelsAvailable = devices.some((d) => Boolean(d.label));
  } catch (error) {
    list.error = (error as Error).message;
  }
  return list;
}

export function onDeviceChange(listener: () => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => undefined;
  navigator.mediaDevices.addEventListener('devicechange', listener);
  return () => navigator.mediaDevices.removeEventListener('devicechange', listener);
}

export interface PermissionReport {
  microphone: PermissionState | 'unknown';
  camera: PermissionState | 'unknown';
  screen: 'prompt' | 'unknown';
}

export async function queryPermissions(): Promise<PermissionReport> {
  const query = async (name: PermissionName): Promise<PermissionState | 'unknown'> => {
    try {
      if (!navigator.permissions?.query) return 'unknown';
      const status = await navigator.permissions.query({ name } as PermissionDescriptor);
      return status.state;
    } catch {
      return 'unknown';
    }
  };
  return {
    microphone: await query('microphone' as PermissionName),
    camera: await query('camera' as PermissionName),
    screen: 'prompt',
  };
}

export interface AudioConstraintsChoice {
  deviceId?: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  sampleRate: number;
  channelCount: number;
}

export async function openMicrophone(choice: AudioConstraintsChoice): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    ...(choice.deviceId ? { deviceId: { exact: choice.deviceId } } : {}),
    echoCancellation: choice.echoCancellation,
    noiseSuppression: choice.noiseSuppression,
    autoGainControl: choice.autoGainControl,
    sampleRate: choice.sampleRate,
    channelCount: choice.channelCount,
  };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

export async function openCamera(deviceId: string | undefined, width: number, height: number, fps: number): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: fps },
  };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export interface AppliedSettings {
  requested: Record<string, unknown>;
  applied: MediaTrackSettings;
  /** Fields the browser could not honor, with the reason. */
  mismatches: Array<{ field: string; requested: number | undefined; applied: number | undefined }>;
}

export function compareSettings(requested: Record<string, number | undefined>, applied: MediaTrackSettings): AppliedSettings {
  const mismatches: AppliedSettings['mismatches'] = [];
  for (const [field, value] of Object.entries(requested)) {
    if (value === undefined) continue;
    const actual = (applied as unknown as Record<string, number | undefined>)[field];
    if (typeof actual === 'number' && Math.abs(actual - value) > Math.max(1, value * 0.05)) {
      mismatches.push({ field, requested: value, applied: actual });
    }
  }
  return { requested, applied, mismatches };
}

/** Stop every track and release the hardware. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function trackInfo(stream: MediaStream, kind: 'video' | 'audio') {
  return kind === 'video' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
}
