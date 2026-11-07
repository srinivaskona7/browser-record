import { Button } from './components';

export function RecordingActions({ paused, openEditor, onPause, onStop }: {
  paused: boolean;
  openEditor: boolean;
  onPause: () => void;
  onStop: () => void;
}) {
  return <div className="recording-primary-actions">
    <Button size="sm" onClick={onPause} title="Shortcut: P" aria-label={paused ? 'Resume recording' : 'Pause recording'}>
      <span aria-hidden>{paused ? '▶' : 'Ⅱ'}</span> {paused ? 'Resume' : 'Pause'}
    </Button>
    <Button size="sm" variant="danger" onClick={onStop} title="Shortcut: S">
      <span aria-hidden>■</span> {openEditor ? 'Stop & edit' : 'Stop & review'}
    </Button>
  </div>;
}
