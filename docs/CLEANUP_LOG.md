# UI Cleanup & Consolidation Log

This file records every cluttered screen, panel, or duplicate control that was removed, merged, or moved into modals/drawers while preserving all underlying capture, project, undo/redo, compositor, storage, and export logic.

## Removed / Merged / Relocated Clutter

1. **Primary Recorder Screen (`src/ui/RecordPage.tsx`)**:
   - **Moved to Settings Modal (`⚙ Settings`)**: Quality target (1080p/4K), frame rate (30/60 fps), countdown selector, camera shape/corner/size/border/shadow/chroma-key sliders, microphone test & speech processing toggles, storage folder management, and recovery/diagnostics tables.
   - **Moved to Collapsible Monitor Drawer (`Preview & Takes`)**: The secondary live screen monitor, applied track settings engineering table, and raw takes table are tucked behind an explicit `Preview & Takes` toggle so the default Home/Recorder view is a clean `400px` Cap-style launcher card.
   - **Added Cap Mode Switcher (`Instant` / `Studio` / `Screenshot`)**: Replaces scattered post-record checkboxes on the main card with a top-level segmented 3-mode switcher.
   - **Added Hideable Floating Recording Control Bar (`.rec-dock`)**: Added a one-click `Hide controls` (`H`) collapse toggle on `.rec-dock` that shrinks the control bar into a minimal `[● REC 00:12 · Show controls]` pill during capture so it never blocks screen content.
2. **Post-Recording Flow (`src/ui/RecordPage.tsx`)**:
   - **Merged Review & Direct Export into Post-Record Sheet (`stage === 'postRecord'`)**: Replaced the raw engineering asset table dialog with a clean Post-Record Sheet offering **Export now (Quick Export)**, **Open in editor**, **Record another take**, and **Discard**.
3. **Projects View (`src/ui/ProjectsPage.tsx`)**:
   - **Redesigned Projects Launcher**: Replaced verbose storage/schema metadata paragraphs with a clean card grid showing aspect-ratio badges, duration, last-modified timestamp, one-click `Open in editor`, `Record take`, `Delete`, and a top action bar for `+ New project`, `Import media`, and `Choose folder`.
4. **Editor Export Flow (`src/ui/EditPage.tsx` & `src/ui/ExportPage.tsx`)**:
   - **Export Modal over Editor**: Clicking `Export ↗` in the editor opens the Export modal directly over the editor workspace (while preserving `#/export` route compatibility) so creators never lose their timeline context.
