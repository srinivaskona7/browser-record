import { useState } from 'react';
import { Button, Dialog } from './components';
import { deleteProjectFolder } from '../app/actions';

/**
 * Permanent deletion of one project folder. Kept as its own dialog so the
 * wording is identical from the editor and from the project list: the user is
 * told exactly what disappears, and that saved exports are not among it.
 */
export function DeleteProjectDialog({
  folder,
  name,
  open,
  onClose,
  onDeleted,
}: {
  folder: string | null;
  name?: string;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteProjectFolder(folder);
      if (!result.ok) {
        setError(result.reason ?? 'The project folder could not be deleted.');
        return;
      }
      await onDeleted?.();
      onClose();
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={`Delete ${name ? `“${name}”` : 'this project'}?`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={busy || !folder}>
            {busy ? 'Deleting…' : 'Delete project and recordings'}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 10 }}>
        <p style={{ margin: 0 }}>
          This permanently removes the project folder{' '}
          <span className="mono">{folder ?? '—'}</span> from the workspace:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>the timeline and its autosaved <span className="mono">project.json</span></li>
          <li>every take folder under its <span className="mono">recordings/</span> directory</li>
          <li>imported originals, proxies and captions stored inside the folder</li>
        </ul>
        <div className="field-hint">
          Exports you saved outside this folder (Downloads, another drive) are not touched. This cannot be undone, and
          there is no trash to recover from.
        </div>
        {error && <div className="danger-card">{error}</div>}
      </div>
    </Dialog>
  );
}
