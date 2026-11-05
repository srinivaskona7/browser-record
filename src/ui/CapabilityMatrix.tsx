import { Badge } from './components';

export type CapabilityStatus = 'implemented' | 'experimental' | 'unavailable';

export interface CapabilityRow {
  area: string;
  capability: string;
  status: CapabilityStatus;
  detail: string;
}

/**
 * One honest list, used by the diagnostics page and kept in step with the
 * shipped code. "Experimental" means it runs but has known limits; "unavailable"
 * always names the missing platform capability.
 */
export const CAPABILITY_ROWS: CapabilityRow[] = [
  {
    area: 'Capture',
    capability: 'Screen / window capture',
    status: 'implemented',
    detail: 'getDisplayMedia with user-picked surface. Delivered size and frame rate are reported from the track, never assumed.',
  },
  {
    area: 'Capture',
    capability: 'Surface choice (entire screen / window / tab)',
    status: 'implemented',
    detail: 'displaySurface is a picker preference, like Meet or Teams: the browser still asks, and the page reports the surface actually shared and warns when it differs.',
  },
  {
    area: 'Capture',
    capability: 'Camera capture',
    status: 'implemented',
    detail: 'Separate track and file. Requested size is clamped by the device; the applied settings are shown.',
  },
  {
    area: 'Recording UX',
    capability: 'Live camera preview with the presenter shape',
    status: 'implemented',
    detail: 'Preview camera opens the device locally and shows it in the chosen shape, corner, size, shadow, outline and mirror. The preview is never written to disk; the take reuses the same stream.',
  },
  {
    area: 'Recording UX',
    capability: 'Bubble-over-screen recording',
    status: 'implemented',
    detail: 'Screen and camera record together as separate files; the camera clip carries the presenter settings, so preview and export composite the bubble over the screen. Shape, corner, size, shadow, outline and mirror are adjustable. Proven with synthetic streams; the real surface picker is not automated.',
  },
  {
    area: 'Capture',
    capability: 'Microphone capture',
    status: 'implemented',
    detail: 'Mono 48 kHz preferred, with echo cancellation, noise suppression and AGC requested from the browser.',
  },
  {
    area: 'Capture',
    capability: 'System / tab audio',
    status: 'implemented',
    detail: 'Only when the browser returns an audio track from the picker. Chrome omits it for whole-screen capture on many systems; the UI says so rather than claiming success.',
  },
  {
    area: 'Capture',
    capability: 'True 4K recording',
    status: 'experimental',
    detail: 'Native only when the source surface is 3840×2160. Smaller displays are upscaled and labelled as scaled; a 1080p source is never called 4K.',
  },
  {
    area: 'Capture',
    capability: '60 fps recording',
    status: 'experimental',
    detail: 'Available, but only trustworthy after the encoder benchmark sustains it on that machine.',
  },
  {
    area: 'Capture',
    capability: 'Segmented disk writing with recovery',
    status: 'implemented',
    detail: 'MediaRecorder timeslices are committed to disk every 5–30 s. Committed bytes survive a crash; the open segment is lost and the loss window is reported.',
  },
  {
    area: 'Capture',
    capability: 'OS-wide cursor telemetry',
    status: 'unavailable',
    detail: 'A web page cannot read pointer events outside its own surface. Zoom is manual/keyframed; nothing is fabricated.',
  },
  {
    area: 'Recording UX',
    capability: 'Countdown, pause, stop, discard, markers, stats',
    status: 'implemented',
    detail: 'Countdown before start, pause keeps the clock, discard abandons only the new take, markers are stored on the recording. A finished take offers Discard (delete that take only), Exit (keep the files) or Edit timeline (insert and open the editor).',
  },
  {
    area: 'Recording UX',
    capability: 'Live recording bar with a pinned stop control',
    status: 'implemented',
    detail: 'While a take runs, a bar stays pinned at the top: REC state and elapsed time, live microphone level, bytes written per source, and Pause / Marker / Discard / Stop & keep. The countdown covers the monitor and a REC tag sits on the preview.',
  },
  {
    area: 'Workspace',
    capability: 'Folder-backed projects (File System Access)',
    status: 'implemented',
    detail: 'Readable directory layout: media/originals, proxies, captions, recordings, exports, plus a versioned project.json with relative paths.',
  },
  {
    area: 'Workspace',
    capability: 'OPFS fallback',
    status: 'implemented',
    detail: 'Browser-managed storage when folder access is missing. Quota-checked and labelled as not a long-term archive.',
  },
  {
    area: 'Workspace',
    capability: 'Delete a project and its recordings',
    status: 'implemented',
    detail: 'Removes only the project folder (manifest, takes, originals, proxies, captions). Sibling projects and exports saved elsewhere are untouched, and the confirmation dialog says so.',
  },
  {
    area: 'Workspace',
    capability: 'Schema migrations and relinking',
    status: 'implemented',
    detail: 'v1→v2→v3 migrations run on load; missing originals can be relinked without touching the edit.',
  },
  {
    area: 'Edit',
    capability: 'Multitrack timeline with linked cuts',
    status: 'implemented',
    detail: 'Split, trim, ripple delete, insert/overwrite, move, duplicate, group/ungroup, lock/hide/mute, markers, undo/redo, frame stepping.',
  },
  {
    area: 'Edit',
    capability: 'Presenter layouts, transforms and keyframes',
    status: 'implemented',
    detail: 'Bubble, rounded, square and custom layouts; manual zoom/pan keyframes for arbitrary apps; safe areas for 16:9, 9:16 and 1:1.',
  },
  {
    area: 'Edit',
    capability: 'Automatic chroma key / person segmentation',
    status: 'experimental',
    detail: 'Background removal is capability-gated and off by default. Manual masks always work; no automatic redaction guarantee exists.',
  },
  {
    area: 'Edit',
    capability: 'Heuristic secret scanner & candidate blur masks',
    status: 'experimental',
    detail: 'Scans project text/captions for token patterns (AWS, GitHub, Slack, JWT, private keys) and high-density terminal rows to suggest blur masks. Never a redaction guarantee; manual mask review is mandatory.',
  },
  {
    area: 'Edit',
    capability: 'DevOps overlays (CLI prompt, code line highlights, keystrokes, diagram step reveal, B-roll PiP, before/after split, auto end screen)',
    status: 'implemented',
    detail: 'Shared Canvas 2D compositor renders CLI $ prompts + dimmed output, 1-based highlighted code lines, 3D keycap chords, N-step diagram reveals, B-roll PiP cards, side-by-side before/after comparisons, and 20s end-screen slots + guide.',
  },
  {
    area: 'Edit',
    capability: 'Silence jump-cuts & idle speed-ramps',
    status: 'implemented',
    detail: 'Detects silent/idle spans from the mixdown and either ripple-deletes them (jump cuts) or accelerates them (e.g. 2.5× speed ramp) across unlocked tracks.',
  },
  {
    area: 'Edit',
    capability: '9:16 vertical reframe & presenter-following panX',
    status: 'implemented',
    detail: 'Switches composition to 1080×1920, places screen above portrait presenter card, and optionally keyframes horizontal panX to follow the presenter.',
  },
  {
    area: 'Export',
    capability: 'Shorts / Reels 9:16 preset, marker segment picker & 1280×720 thumbnail PNG',
    status: 'implemented',
    detail: '1080×1920 MP4 preset with 60 s cap and 60 MB ceiling warnings, marker-to-marker segment extraction for Shorts, and one-click 1280×720 YouTube thumbnail PNG export.',
  },
  {
    area: 'Audio',
    capability: 'Voiceover, punch-in takes, processing chain',
    status: 'implemented',
    detail: 'Record against playback, keep every take, then high-pass, EQ, compress, limit and duck music under narration. Preview and export share one chain.',
  },
  {
    area: 'Audio',
    capability: 'Loudness metering in LUFS',
    status: 'unavailable',
    detail: 'The build reports sample peak and RMS only. Labelling those as LUFS would be wrong, so it does not.',
  },
  {
    area: 'Captions',
    capability: 'Local Whisper transcription',
    status: 'implemented',
    detail: 'Transformers.js runs in a module worker on this machine. Model download size is disclosed before the first run and cached afterwards.',
  },
  {
    area: 'Captions',
    capability: 'Word-level highlighting',
    status: 'experimental',
    detail: 'Only with real word timings from the model. Without them, no fake highlight animation is produced.',
  },
  {
    area: 'Captions',
    capability: 'SRT/VTT import, export and retiming',
    status: 'implemented',
    detail: 'Round-trip parsing with issue reporting, find/replace, glossary, line rebalancing, silence-based cuts, burned-in or sidecar.',
  },
  {
    area: 'Export',
    capability: 'Deterministic offline render',
    status: 'implemented',
    detail: 'Every frame is composed at an integer timestamp from original media; preview and export run the same scene model.',
  },
  {
    area: 'Export',
    capability: 'H.264 MP4 delivery',
    status: 'implemented',
    detail: 'Hardware or software H.264 through WebCodecs, muxed by Mediabunny. Falls back to VP9/WebM only when probed unsupported, and says so.',
  },
  {
    area: 'Export',
    capability: 'VP9 / AV1 / HEVC delivery',
    status: 'experimental',
    detail: 'Each is capability-gated. HEVC is never offered where the encoder is absent; AV1 software encoding may be far slower than real time.',
  },
  {
    area: 'Export',
    capability: 'Exact target file size',
    status: 'unavailable',
    detail: 'The budget calculator gives a derived bitrate and a warning set. VBR output lands near the estimate, not exactly on it.',
  },
  {
    area: 'Deployment',
    capability: 'GitHub Pages without COOP/COEP headers',
    status: 'implemented',
    detail: 'The baseline build needs no SharedArrayBuffer, so it runs on Pages. FFmpeg.wasm is an optional, bounded fallback rather than a dependency.',
  },
];

export function CapabilityMatrix({ rows = CAPABILITY_ROWS }: { rows?: CapabilityRow[] }) {
  const counts = rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { implemented: 0, experimental: 0, unavailable: 0 } as Record<CapabilityStatus, number>,
  );
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="ok">{counts.implemented} implemented</Badge>
        <Badge tone="warn">{counts.experimental} experimental</Badge>
        <Badge tone="neutral">{counts.unavailable} unavailable</Badge>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Area</th>
            <th>Capability</th>
            <th>Status</th>
            <th>What that actually means</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.area}-${row.capability}`}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>{row.area}</td>
              <td>{row.capability}</td>
              <td>
                <Badge tone={row.status === 'implemented' ? 'ok' : row.status === 'experimental' ? 'warn' : 'neutral'}>{row.status}</Badge>
              </td>
              <td className="field-hint" style={{ maxWidth: 520 }}>
                {row.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
