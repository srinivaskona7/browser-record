import { Dialog } from './components';

const FEATURES: Array<[string, string]> = [
  ['Record', 'Screen, camera bubble and microphone, saved to this machine in segments. Pause, marker, restart and keyboard keys while recording.'],
  ['Edit', 'Multitrack timeline with split, trim, ripple delete, markers and undo. Titles, lower thirds, callouts and arrows.'],
  ['Media', 'Import videos, audio and images. Insert media at the playhead, and record a voiceover against the timeline.'],
  ['Captions', 'Local transcription, SRT/VTT import and export, and burned-in or sidecar captions.'],
  ['Export', 'H.264 MP4 and other codecs where the browser supports them. Progress shows speed and time left.'],
  ['Privacy', 'No account, no upload, no analytics. Media stays in the folder or browser storage you chose.'],
];

const STEPS: Array<[string, string]> = [
  ['Start a project', 'Projects → New project, or Import a video. Pick a folder to keep files on disk.'],
  ['Record (optional)', 'Record → Start recording. Choose the screen, add the camera bubble if you want it, then Stop & keep.'],
  ['Edit', 'Edit → drag clips onto the timeline. Use Add for titles, arrows and inserts, and the Inspector for the selected clip.'],
  ['Save a frame (optional)', 'Edit → Save frame to download the frame under the playhead as a PNG.'],
  ['Export', 'Export → pick a preset, then Start export. Download the result when it finishes.'],
];

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="About Browser 4K Studio" wide>
      <div className="stack" style={{ gap: 16 }}>
        <section className="stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Features</h3>
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
          <h3 style={{ margin: 0, fontSize: 14 }}>Walkthrough</h3>
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
