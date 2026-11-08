import { TICKS_PER_SECOND } from '../core/time';
import { createProject, createTrack, defaultPresenter, defaultTransform } from './factory';
import * as ops from './ops';
import type { Asset, Project } from './types';
import { encodeWavMono } from '../audio/sfx';
import { ensureWorkspace } from '../app/bootstrap';
import { projectPath, saveProject, writeBinary } from '../workspace/workspace';
import { WORKSPACE_LAYOUT } from '../workspace/types';
import { useEditor } from './store';
import { useSession } from '../app/session';
import { writeLastSession } from '../app/prefs';

/** Minimal valid 1×1 PNG fallback when running in environments without Canvas PNG encoding. */
const FALLBACK_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x64, 0x60, 0xf8, 0x5f,
  0x0f, 0x00, 0x02, 0x87, 0x01, 0x80, 0x5e, 0x6b, 0x85, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

async function synthesizeLessonImageBytes(kind: 'screen' | 'camera'): Promise<Uint8Array> {
  if (typeof document === 'undefined') return FALLBACK_PNG_BYTES;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = kind === 'screen' ? 1280 : 640;
    canvas.height = kind === 'screen' ? 720 : 640;
    const ctx = canvas.getContext('2d');
    if (!ctx) return FALLBACK_PNG_BYTES;
    if (kind === 'screen') {
      ctx.fillStyle = '#111018';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1c1927';
      ctx.fillRect(48, 48, canvas.width - 96, canvas.height - 96);
      ctx.strokeStyle = '#322d41';
      ctx.lineWidth = 2;
      ctx.strokeRect(48, 48, canvas.width - 96, canvas.height - 96);
      ctx.fillStyle = '#c3adff';
      ctx.font = '600 22px monospace';
      ctx.fillText('sre@k8s-prod-us-east ~ % kubectl get pods -n api-gateway -w', 80, 110);
      ctx.fillStyle = '#dafa9c';
      ctx.font = '500 19px monospace';
      ctx.fillText('api-gateway-7c9f8b6d4-x92lk   2/2   Running   0   4m12s', 80, 158);
      ctx.fillText('api-gateway-7c9f8b6d4-m41pq   2/2   Running   0   4m10s', 80, 192);
      ctx.fillStyle = '#f5f3fa';
      ctx.fillText('RollingUpdate: maxSurge=25%, maxUnavailable=0 · Readiness gate: 200 OK', 80, 248);
      // Simulated secret token box that the privacy mask redacts
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(80, 300, 360, 44);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('KUBE_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI', 92, 328);
    } else {
      const grad = ctx.createRadialGradient(320, 280, 40, 320, 320, 320);
      grad.addColorStop(0, '#c3adff');
      grad.addColorStop(0.55, '#463f5b');
      grad.addColorStop(1, '#1c1927');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f5f3fa';
      ctx.beginPath();
      ctx.arc(320, 250, 82, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(320, 520, 170, Math.PI, 0);
      ctx.fill();
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      canvas.toBlob((b) => resolve(b), 'image/png');
    });
    if (!blob) return FALLBACK_PNG_BYTES;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return FALLBACK_PNG_BYTES;
  }
}

function synthesizeLessonWavBytes(durationSeconds: number, freqHz: number, gain: number): Uint8Array {
  const sampleRate = 48_000;
  const frames = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / 1200) * Math.min(1, (frames - i) / 1200);
    const sample = Math.sin(2 * Math.PI * freqHz * t) * gain * envelope;
    mono[i] = sample;
  }
  return encodeWavMono(mono, sampleRate);
}

/**
 * Deterministic Sample Kubernetes Lesson project used for visual acceptance
 * baselines and end-to-end editing/export verification.
 */
export function buildSampleKubernetesProject(): Project {
  const durationSeconds = 12;
  const durationTicks = durationSeconds * TICKS_PER_SECOND;
  let project = createProject({
    name: 'Kubernetes Zero-Downtime Rollout — 4K Lesson',
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
  });

  const now = '2026-11-08T12:00:00.000Z';
  const screenAsset: Asset = {
    id: 'asset_k8s_screen',
    kind: 'image',
    name: 'k8s-terminal-rollout.png',
    path: `${WORKSPACE_LAYOUT.originals}/k8s-terminal-rollout.png`,
    durationTicks,
    width: 1920,
    height: 1080,
    origin: 'generated',
    mimeType: 'image/png',
    createdAt: now,
  };
  const cameraAsset: Asset = {
    id: 'asset_k8s_camera',
    kind: 'image',
    name: 'presenter-camera.png',
    path: `${WORKSPACE_LAYOUT.originals}/presenter-camera.png`,
    durationTicks,
    width: 640,
    height: 640,
    origin: 'recorded',
    mimeType: 'image/png',
    createdAt: now,
  };
  const narrationAsset: Asset = {
    id: 'asset_k8s_voice',
    kind: 'audio',
    name: 'narration-sre-walkthrough.wav',
    path: `${WORKSPACE_LAYOUT.originals}/narration-sre-walkthrough.wav`,
    durationTicks,
    sampleRate: 48_000,
    channels: 2,
    origin: 'recorded',
    mimeType: 'audio/wav',
    createdAt: now,
  };
  const musicAsset: Asset = {
    id: 'asset_k8s_music',
    kind: 'audio',
    name: 'ambient-synth-bed.wav',
    path: `${WORKSPACE_LAYOUT.originals}/ambient-synth-bed.wav`,
    durationTicks,
    sampleRate: 48_000,
    channels: 2,
    origin: 'imported',
    mimeType: 'audio/wav',
    createdAt: now,
  };

  project = {
    ...project,
    assets: [screenAsset, cameraAsset, narrationAsset, musicAsset],
  };

  const screenTrack = project.tracks.find((t) => t.name === 'Screen') ?? project.tracks[0]!;
  const titlesTrack = project.tracks.find((t) => t.name === 'Titles') ?? project.tracks[1]!;
  const narrationTrack = project.tracks.find((t) => t.name === 'Narration') ?? project.tracks[2]!;
  const musicTrack = project.tracks.find((t) => t.name === 'Music') ?? project.tracks[3]!;
  const cameraTrack = createTrack('video', 'Camera');

  // 1. Screen clip with privacy mask over simulated KUBE_TOKEN secret
  const placedScreen = ops.addAssetClip(project, screenTrack.id, screenAsset.id, 0, { mode: 'overwrite' });
  project = placedScreen.project;
  project = ops.updateClip(project, placedScreen.clipId, {
    durationTicks,
    label: 'Terminal: kubectl rollout status',
    masks: [
      {
        x: 0.06,
        y: 0.4,
        width: 0.3,
        height: 0.08,
        mode: 'blur',
        strength: 24,
        feather: 0.08,
      },
    ],
  });

  // 2. Camera presenter track
  project = ops.addTrack(project, cameraTrack);
  const placedCamera = ops.addAssetClip(project, cameraTrack.id, cameraAsset.id, 0, { mode: 'overwrite' });
  project = placedCamera.project;
  project = ops.updateClip(project, placedCamera.clipId, {
    durationTicks,
    label: 'Presenter Camera (Alex)',
    presenter: {
      ...defaultPresenter(),
      shape: 'circle',
      corner: 'bottom-right',
      size: 0.24,
      border: 3,
      borderColor: '#c3adff',
      visible: true,
    },
  });

  // 3. CLI callout title clip on Titles track
  const placedCli = ops.addTitleClip(
    project,
    titlesTrack.id,
    0,
    '$ kubectl rollout status deploy/api-gateway -n prod\ndeployment "api-gateway" successfully rolled out',
    'cli',
    6 * TICKS_PER_SECOND,
  );
  project = placedCli.project;
  project = ops.updateClipDeep(project, placedCli.clipId, {
    transform: { ...defaultTransform(), x: 0.5, y: 0.16, scale: 0.88 },
  });

  // 4. Narration & Music clips
  const placedVoice = ops.addAssetClip(project, narrationTrack.id, narrationAsset.id, 0, { mode: 'overwrite' });
  project = placedVoice.project;
  project = ops.updateClipDeep(project, placedVoice.clipId, {
    audio: { gain: 1.15, processed: true, muted: false, fadeInTicks: 0, fadeOutTicks: 0, pan: 0 },
  });

  const placedMusic = ops.addAssetClip(project, musicTrack.id, musicAsset.id, 0, { mode: 'overwrite' });
  project = placedMusic.project;
  project = ops.updateClipDeep(project, placedMusic.clipId, {
    audio: {
      gain: 0.35,
      processed: false,
      muted: false,
      fadeInTicks: Math.round(0.5 * TICKS_PER_SECOND),
      fadeOutTicks: Math.round(1.0 * TICKS_PER_SECOND),
      pan: 0,
      duckUnderVoice: true,
    },
  });

  // 5. Timed Kubernetes captions
  project = {
    ...project,
    captions: [
      {
        id: 'cue_k8s_1',
        startTicks: 0,
        endTicks: 3 * TICKS_PER_SECOND,
        text: 'Step 1: Inspect the active Kubernetes deployment and replica health in production.',
        speaker: 'Alex',
      },
      {
        id: 'cue_k8s_2',
        startTicks: 3 * TICKS_PER_SECOND,
        endTicks: 6 * TICKS_PER_SECOND,
        text: 'Step 2: Configure RollingUpdate with maxUnavailable set to zero so capacity never dips.',
        speaker: 'Alex',
      },
      {
        id: 'cue_k8s_3',
        startTicks: 6 * TICKS_PER_SECOND,
        endTicks: 9 * TICKS_PER_SECOND,
        text: 'Step 3: Verify HTTP readiness probes pass before terminating old pods.',
        speaker: 'Alex',
      },
      {
        id: 'cue_k8s_4',
        startTicks: 9 * TICKS_PER_SECOND,
        endTicks: 12 * TICKS_PER_SECOND,
        text: 'Step 4: Confirm zero dropped requests and export the 4K lesson with SRT captions.',
        speaker: 'Alex',
      },
    ],
    markers: [
      { id: 'mk_k8s_1', atTicks: 0, label: '01 Cluster Preflight', color: '#c3adff' },
      { id: 'mk_k8s_2', atTicks: 3 * TICKS_PER_SECOND, label: '02 RollingUpdate Strategy', color: '#dafa9c' },
      { id: 'mk_k8s_3', atTicks: 6 * TICKS_PER_SECOND, label: '03 Readiness Probe Check', color: '#34d399' },
      { id: 'mk_k8s_4', atTicks: 9 * TICKS_PER_SECOND, label: '04 Rollout Verified', color: '#f59e0b' },
    ],
    storyboard: [
      {
        id: 'shot_k8s_1',
        title: '01 Cluster Preflight — kubectl get pods -n api-gateway',
        notes: 'Show current replica count and redact KUBE_TOKEN with blur mask.',
        durationSeconds: 3,
        done: true,
      },
      {
        id: 'shot_k8s_2',
        title: '02 RollingUpdate Manifest — maxUnavailable: 0, maxSurge: 25%',
        notes: 'Highlight zero-downtime rollout spec in terminal.',
        durationSeconds: 3,
        done: true,
      },
      {
        id: 'shot_k8s_3',
        title: '03 Readiness Gate Verification — HTTP /healthz 200 OK',
        notes: 'Confirm new pods pass readiness before old pods receive SIGTERM.',
        durationSeconds: 3,
        done: true,
      },
      {
        id: 'shot_k8s_4',
        title: '04 Export 4K Master + SRT Sidecar + PNG Cover',
        notes: 'Deliver 16:9 YouTube master and 9:16 vertical short.',
        durationSeconds: 3,
        done: false,
      },
    ],
    notes:
      'Kubernetes Zero-Downtime Rollout Lesson:\n' +
      '- Always set maxUnavailable: 0 and pair readinessProbe with preStop sleep(5) so load-balancer endpoints drain cleanly.\n' +
      '- Secret token at (0.06, 0.40) is redacted via manual blur mask.',
    socialCaption:
      'Zero-downtime Kubernetes rollouts explained: combine maxUnavailable: 0 with HTTP readiness probes so pod termination never drops live traffic. #kubernetes #devops #sre #cloudnative #4kstudio',
    coverTimeTicks: 3 * TICKS_PER_SECOND,
  };

  return ops.withDuration(project);
}

/**
 * Create, populate media files in the active workspace, and load the Sample
 * Kubernetes Lesson into the editor.
 */
export async function loadSampleKubernetesLesson(navigateTo: 'edit' | 'projects' = 'edit'): Promise<Project> {
  const workspace = await ensureWorkspace();
  const project = buildSampleKubernetesProject();
  const folder = await saveProject(workspace.root, project);

  const [screenBytes, cameraBytes] = await Promise.all([
    synthesizeLessonImageBytes('screen'),
    synthesizeLessonImageBytes('camera'),
  ]);
  const voiceBytes = synthesizeLessonWavBytes(2, 220, 0.22);
  const musicBytes = synthesizeLessonWavBytes(2, 110, 0.08);

  await Promise.all([
    writeBinary(workspace.root, projectPath(folder, `${WORKSPACE_LAYOUT.originals}/k8s-terminal-rollout.png`), screenBytes),
    writeBinary(workspace.root, projectPath(folder, `${WORKSPACE_LAYOUT.originals}/presenter-camera.png`), cameraBytes),
    writeBinary(workspace.root, projectPath(folder, `${WORKSPACE_LAYOUT.originals}/narration-sre-walkthrough.wav`), voiceBytes),
    writeBinary(workspace.root, projectPath(folder, `${WORKSPACE_LAYOUT.originals}/ambient-synth-bed.wav`), musicBytes),
  ]);

  useEditor.getState().loadProject(project);
  const session = useSession.getState();
  session.setProjectFolder(folder);
  session.setSaveState('saved');
  writeLastSession({ projectFolder: folder });
  session.setRoute(navigateTo);
  session.pushToast('Loaded Sample Kubernetes 4K Lesson.', 'success');
  return project;
}
