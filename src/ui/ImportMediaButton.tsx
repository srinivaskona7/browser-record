import { useRef, useState } from 'react';
import { importMediaIntoSession } from '../app/bootstrap';
import { useSession } from '../app/session';
import { Button } from './components';

/** A direct import-to-timeline entry point shared by recorder, projects, and editor. */
export function ImportMediaButton({
  disabled = false,
  label = '＋ Import media',
  size = 'md',
  variant = 'default',
  navigateToEdit = true,
}: {
  disabled?: boolean;
  label?: string;
  size?: 'sm' | 'md' | 'icon';
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  navigateToEdit?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  return <>
    <Button size={size} variant={variant} disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : label}</Button>
    <input ref={input} hidden type="file" multiple accept="video/*,audio/*,image/*" aria-label="Import media into editor" disabled={disabled || busy} onChange={async (event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (!files.length || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const outcome = await importMediaIntoSession(files);
        if (outcome.imported.length > 0 && navigateToEdit) useSession.getState().setRoute('edit');
      } catch (error) {
        useSession.getState().pushToast(`Import failed: ${(error as Error).message}`, 'error');
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    }} />
  </>;
}
