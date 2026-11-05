import { beforeEach, describe, expect, it } from 'vitest';
import { readLastSession, writeLastSession, clearLastSession } from '../src/app/prefs';
import { useEditor } from '../src/project/store';
import { createClip, createProject } from '../src/project/factory';

describe('session preferences', () => {
  beforeEach(() => clearLastSession());

  it('round-trips the storage mode and last project folder', () => {
    writeLastSession({ mode: 'opfs', projectFolder: 'projects/p_1' });
    expect(readLastSession()).toEqual({ mode: 'opfs', projectFolder: 'projects/p_1' });
  });

  it('patches one field without dropping the other', () => {
    writeLastSession({ mode: 'opfs', projectFolder: 'projects/p_1' });
    writeLastSession({ projectFolder: 'projects/p_2' });
    expect(readLastSession()).toEqual({ mode: 'opfs', projectFolder: 'projects/p_2' });
  });

  it('returns null when nothing was stored or the value is corrupt', () => {
    expect(readLastSession()).toBeNull();
    localStorage.setItem('browser-record-last-session', '{not json');
    expect(readLastSession()).toBeNull();
  });
});

describe('revision-safe save marker', () => {
  it('marks clean only for the revision that was written', () => {
    const project = createProject({ name: 'Save marker', width: 1920, height: 1080 });
    useEditor.getState().loadProject(project);
    useEditor
      .getState()
      .apply('add clip', (current) => ({
        ...current,
        tracks: current.tracks.map((track) =>
          track.clips.length > 0 ? track : { ...track, clips: [createClip({ assetId: 'a', startTicks: 0, durationTicks: 1000 })] },
        ),
      }));
    const saved = useEditor.getState().revision;
    expect(useEditor.getState().dirty).toBe(true);

    useEditor.getState().markSaved(saved, project.id);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it('keeps the project dirty when an edit landed during the save', () => {
    const project = createProject({ name: 'Save marker', width: 1920, height: 1080 });
    useEditor.getState().loadProject(project);
    const savedRevision = useEditor.getState().revision;
    useEditor.getState().apply('rename', (current) => ({ ...current, name: 'Renamed while saving' }));

    useEditor.getState().markSaved(savedRevision, project.id);
    expect(useEditor.getState().dirty).toBe(true);
  });

  it('keeps a newly opened project dirty when another project save finishes', () => {
    const first = createProject({ name: 'First', width: 1920, height: 1080 });
    useEditor.getState().loadProject(first);
    const savedRevision = useEditor.getState().revision;
    const second = createProject({ name: 'Second', width: 1920, height: 1080 });
    useEditor.getState().loadProject(second);
    useEditor.getState().apply('rename', (current) => ({ ...current, name: 'Second edited' }));

    useEditor.getState().markSaved(savedRevision, first.id);
    expect(useEditor.getState().dirty).toBe(true);
  });
});
