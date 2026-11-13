import { APP_BUILD_ID, performHardRefresh } from '../app/actions';
import { Badge, Button, Dialog } from './components';

const FEATURES: Array<[string, string]> = [
  ['Record', 'Screen, camera bubble (6 shapes + custom X/Y), and microphone saved in durable segments with Quiet Mode, Review Take trim/preview, and shared Recordings Library.'],
  ['Edit & Grade', 'Multitrack timeline with direct on-canvas move/scale/rotate handles, 3-way colour wheels, 8-band HSL, RGB/Luma curves, .cube 3D LUT import, and Original vs. Graded preview.'],
  ['Typography & Privacy', '406 font families plus custom font upload (WOFF2/WOFF/TTF/OTF), 77 text animations, and timed/feathered/keyframed privacy masks (blur, pixelate, solid).'],
  ['Captions & Audio', 'Local Whisper transcription, SRT/VTT import/export, voiceover recording, procedural SFX, ducking, and speech mastering chain.'],
  ['Planning & Export', 'Storyboard shot list, social caption handoff, H.264/HEVC/AV1 MP4 & VP9 WebM export, 16-bit PCM WAV audio mixdown, and PNG cover frames.'],
  ['Privacy', '100% local in your browser — no account, no cloud upload, no telemetry.'],
];

const STEPS: Array<[string, string]> = [
  ['Start a project', 'Projects → Load Sample Kubernetes Lesson, New Recording, or Import Video/Audio/Image.'],
  ['Record (optional)', 'Record → Choose source → Ready confirmation → Start recording → Stop & review or open in Editor.'],
  ['Edit & Grade', 'Edit → Drag handles directly on the preview canvas, grade in Adjust, or plan shots in More → Planning & Share.'],
  ['Export', 'Export → Choose MP4/WebM preset, WAV audio mixdown, PNG cover frame, or SRT/VTT subtitles.'],
];

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="About Browser 4K Studio" wide>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Badge tone="ok">Build {APP_BUILD_ID}</Badge>
          <Button size="sm" variant="ghost" onClick={() => void performHardRefresh()}>
            ↻ Hard refresh & clear cache
          </Button>
        </div>
        <section className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--token-font-md)' }}>Features</h3>
          <table className="table">
            <tbody>
              {FEATURES.map(([area, text]) => (
                <tr key={area}>
                  <th style={{ width: 110, textAlign: 'left', verticalAlign: 'top' }}>{area}</th>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--token-font-md)' }}>Walkthrough</h3>
          <ol className="stack" style={{ gap: 6, paddingLeft: 20, margin: 0 }}>
            {STEPS.map(([title, text]) => (
              <li key={title}>
                <strong>{title}.</strong> {text}
              </li>
            ))}
          </ol>
        </section>
        <div className="field-hint">Shortcuts are listed under ? in the editor. Features that a browser cannot do are marked on the Diagnostics page.</div>
      </div>
    </Dialog>
  );
}
