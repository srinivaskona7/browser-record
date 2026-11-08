# Browser Record — 6-Phase Implementation Progress

Read this file at the start of every session and resume from the first unchecked `- [ ]` phase.

- [x] **Phase 1**: Home / recorder panel (`cap-panel.png` spec), redesigned `ProjectsPage.tsx`, shared design tokens (`src/styles/tokens.css`), `Instant` / `Studio` / `Screenshot` mode switcher, 2×2 source tiles, clean device rows, `"New blank edit"` link, and Settings modal with zero clutter on the main panel.
- [x] **Phase 2**: Single-source-of-truth recording state machine (`src/capture/stateMachine.ts`), Ready confirmation overlay (`cap-ready-overlay.png`), and Cap-style floating control bar (`cap-control-bar.png`) with collapsible/hideable controls toggle and keyboard shortcuts (`Space`, `⌘/Ctrl+Shift+S`, `M`, `K`, `H`, `Esc`).
- [x] **Phase 3**: Floating camera bubble + controls inside Document Picture-in-Picture (`src/capture/floatingCamera.ts`) with S/M/L size, shape, mirror, border colour, `"Reopen floating controls"` when closed, and the 3-case **Camera-Duplication Rule** (`baked-in-screen` vs `separate-layer` vs `Browser tab` so export contains the camera once).
- [x] **Phase 4**: Post-record sheet (`postRecord` stage) with **Export now (Quick Export)**, **Open in editor**, **Record another take (append)**, and **Discard**, plus multi-file drag-and-drop import with per-file progress and partial-failure handling.
- [x] **Phase 5**: Clean Instagram Edits desktop editor (`edits-editor.png` at `1440×900`) with collapsible left tool library, persistent `localStorage` panel layout state, fuzzy tool/inspector search, and responsive bottom rail/sheet below `1024px`.
- [x] **Phase 6**: Direct Export modal over the editor + Quick Export verification, `docs/CLEANUP_LOG.md`, `docs/UI_PARITY_REPORT.md`, `docs/KNOWN_LIMITATIONS.md` browser PiP matrix, and full Vitest + build + smoke verification.
