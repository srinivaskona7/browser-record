import { useRef, useState } from 'react';
import { importMediaIntoSession } from '../app/bootstrap';
import { useSession } from '../app/session';
import { Button } from './components';

/** A direct import-to-timeline entry point shared by recorder and editor. */
export function ImportMediaButton({ disabled = false }: { disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  return <>
    <Button disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : '＋ Import media'}</Button>
    <input ref={input} hidden type="file" multiple accept="video/*,audio/*,image/*" aria-label="Import media into editor" disabled={disabled || busy} onChange={async (event) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (!files.length || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        const outcome = await importMediaIntoSession(files);
        if (outcome.imported.length > 0) useSession.getState().setRoute('edit');
      } catch (error) {
        useSession.getState().pushToast(`Import failed: ${(error as Error).message}`, 'error');
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    }} />
  </>;
}
