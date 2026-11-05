import { describe, expect, it } from 'vitest';
import { createProject } from '../src/project/factory';
import { PROJECT_SCHEMA_VERSION } from '../src/project/types';
import { ProjectParseError, parseProject, serializeProject } from '../src/project/serialize';

const NOW = '2026-02-02T10:00:00.000Z';

describe('project serialization', () => {
  it('round-trips a current project without losing fields', () => {
    const project = createProject({ name: 'Terminal basics', width: 3840, height: 2160, id: 'proj_round', now: NOW });
    const parsed = parseProject(serializeProject(project));
    expect(parsed.id).toBe('proj_round');
    expect(parsed.canvas).toEqual(project.canvas);
    expect(parsed.tracks).toHaveLength(project.tracks.length);
    expect(parsed.settings.glossary.kubectl).toBe('kubectl');
  });

  it('migrates a v1 manifest that predates caption style and track flags', () => {
    const v1 = {
      schemaVersion: 1,
      id: 'proj_v1',
      name: 'Old lesson',
      createdAt: NOW,
      updatedAt: NOW,
      canvas: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, background: '#000', safeMargin: 0.05 },
      tracks: [
        {
          id: 'track_a',
          name: 'Screen',
          clips: [
            {
              id: 'clip_a',
              kind: 'media',
              startTicks: 0,
              durationTicks: 720_000,
              inTicks: 0,
              speed: 1,
              transform: {},
              masks: [],
              keyframes: [],
            },
          ],
        },
      ],
      assets: [],
      markers: [],
      captions: [],
      durationTicks: 720_000,
      notes: '',
    };
    const parsed = parseProject(v1);
    expect(parsed.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(parsed.tracks[0]!.kind).toBe('video');
    expect(parsed.tracks[0]!.locked).toBe(false);
    expect(parsed.tracks[0]!.clips[0]!.presenter).toBeUndefined();
    expect(parsed.tracks[0]!.clips[0]!.audio).toBeDefined();
    expect(parsed.captionStyle).toBeDefined();
  });

  it('gives a camera track presenter defaults but leaves screen clips alone', () => {
    const v1 = {
      schemaVersion: 1,
      id: 'proj_cam',
      name: 'Bubble lesson',
      createdAt: NOW,
      updatedAt: NOW,
      canvas: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, background: '#000', safeMargin: 0.05 },
      tracks: [
        {
          id: 'track_screen',
          name: 'Screen',
          clips: [{ id: 'clip_s', kind: 'media', startTicks: 0, durationTicks: 720_000, inTicks: 0, speed: 1, transform: {}, masks: [], keyframes: [] }],
        },
        {
          id: 'track_cam',
          name: 'Camera',
          clips: [{ id: 'clip_c', kind: 'media', startTicks: 0, durationTicks: 720_000, inTicks: 0, speed: 1, transform: {}, masks: [], keyframes: [] }],
        },
      ],
      assets: [],
      markers: [],
      captions: [],
      durationTicks: 720_000,
      notes: '',
    };
    const parsed = parseProject(v1);
    expect(parsed.tracks[0]!.clips[0]!.presenter).toBeUndefined();
    expect(parsed.tracks[1]!.clips[0]!.presenter?.shape).toBe('circle');
  });

  it('refuses a manifest written by a newer schema instead of guessing', () => {
    expect(() => parseProject({ schemaVersion: 99 })).toThrow(ProjectParseError);
    expect(() => parseProject({ schemaVersion: 99 })).toThrow(/newer version/i);
  });

  it('rejects malformed JSON with a useful error', () => {
    expect(() => parseProject('{ not json')).toThrow(/not valid JSON/i);
  });

  it('rejects a project with a missing canvas', () => {
    const project = createProject({ name: 'Bad', now: NOW });
    const { canvas: _canvas, ...broken } = project;
    expect(() => parseProject(broken)).toThrow(/canvas/i);
  });
});
