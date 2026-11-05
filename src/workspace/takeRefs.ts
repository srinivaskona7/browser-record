import type { Project } from '../project/types';

/**
 * Take ids referenced by any asset of this project, including segment paths.
 *
 * Asset paths are stored relative to the project folder, so `recordings/<id>/`
 * is normally at the start of the string; a leading slash only appears on
 * paths normalised elsewhere. Matching only `/recordings/` made every take look
 * unreferenced, which lets the cleaner delete media the timeline is using.
 */
export function takeIdsOf(project: Pick<Project, 'assets'>): string[] {
  const ids = new Set<string>();
  for (const asset of project.assets) {
    for (const path of [asset.path, ...(asset.segments ?? []).map((segment) => segment.path)]) {
      const match = /(?:^|\/)recordings\/([^/]+)\//.exec(path);
      if (match?.[1]) ids.add(match[1]);
    }
  }
  return [...ids];
}
