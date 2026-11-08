# Additional Reference Captures Needed (`docs/reference/edits/`)

Where live native GUI automation of `/Applications/Edits.app` is gated by macOS TCC Screen Recording / Accessibility permissions or Meta account login, the following granular states are marked **Inferred** from the existing reference captures (`docs/reference/edits-editor.png`, `/tmp/edits-rea-window.png`, `docs/EDITS_PARITY.md`) until captured directly into `docs/reference/edits/<name>.png`:

1. `docs/reference/edits/empty-project.png` — Empty timeline state before media import (Inferred).
2. `docs/reference/edits/clip-selected-video.png` — Video clip selected on timeline with right inspector open (Observed in `edits-editor.png`).
3. `docs/reference/edits/clip-selected-text.png` — Text overlay clip selected with typography inspector sections (Inferred).
4. `docs/reference/edits/clip-selected-audio.png` — Audio clip selected with Volume, Fade, Enhance, and Ducking inspector (Inferred).
5. `docs/reference/edits/clip-selected-adjustment-layer.png` — Adjustment layer selected with Adjust, Filters, and Effects sections (Inferred).
6. `docs/reference/edits/multi-select.png` — Multiple timeline clips selected showing shared inspector fields (`"Mixed"`) and Group toolbar action (Inferred).
7. `docs/reference/edits/range-selected.png` — Timeline range `[start, end]` band selected across unlocked tracks (Inferred / not in base reference).
8. `docs/reference/edits/context-menu-clip.png` — Right-click / `Shift+F10` context menu on a selected clip (Inferred).
9. `docs/reference/edits/context-menu-empty-track.png` — Right-click context menu on an empty track (`Paste`, `Add text`, `Add adjustment layer`, `Import`) (Inferred).
10. `docs/reference/edits/context-menu-ruler.png` — Right-click context menu on the timeline ruler (`Add marker`, `Set in`, `Set out`) (Inferred).
11. `docs/reference/edits/text-editing-on-canvas.png` — Double-click inline text editing on the preview canvas (Inferred).
12. `docs/reference/edits/canvas-handles.png` — Bounding box, corner scale handles, and rotation handle on canvas (Inferred).
13. `docs/reference/edits/rail-drawers.png` — Individual slide-out drawers for `media`, `audio`, `text`, `captions`, `voiceover`, `effects`, `transitions`, `filters`, `adjust`, `sound-fx` (Partially observed in `edits-editor.png`, remaining drawers Inferred).
14. `docs/reference/edits/speed-panel.png` & `docs/reference/edits/keyframes-on-clip.png` — Speed curve selector and diamond keyframe indicators on timeline clips (Inferred).
15. `docs/reference/edits/export-dialog.png` — Export modal over the editor workspace (Inferred).
