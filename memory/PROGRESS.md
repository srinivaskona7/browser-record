# Browser Record — P0–V Master Implementation Progress

Resume at the first unticked `- [ ]` phase in order:
`P0 → R → B → E1 → E2 → E3 → E4 → E5 → E6 → E7 → X → V`

- [x] **P0 — Reality Audit** (`ce80000`): Audited commit `60de839`, recorded `docs/reference/MANIFEST.md`, `docs/reference/NEEDED.md`, `docs/APP_AUDIT.md`, and `docs/INVENTORY.md`, and un-ticked phases `R` through `V` where gaps were identified.
- [x] **R — Recorder (Cap-style)**: Fixed P0 recorder gaps — implemented `Instant` / `Studio` / `Screenshot` mode switcher, hideable `.rec-dock` controls (`Hide controls ▾` / `Show controls ▴` + `H`), tab-title `"● 00:00:12 Recording"` indicator while recording, and redesigned `ProjectsPage.tsx`.
- [x] **B — Floating Camera Bubble + Controls**: Copied page stylesheets/tokens into Document PiP, added auto-layout across `square` (`180×180`, `400×400`), `tall` (`240×320`), and `wide` (`320×120`) sizes on resize, state ring (red recording / amber paused / grey idle), S/M/L/XL `resizeToPreset` support, applied `cameraLayerRule.compositeInExport` directly in `insertTake`, and documented `docs/FLOATING_BUBBLE_QA.md`.
- [ ] **E1 — Selection + Command System**: Build `src/editor/selection.ts` (`none | clips | range | caption`), `src/editor/actions.ts` command registry with `isEligible(selection, project)` and 200-step undo history, identical scope chip across Inspector / Floating Toolbar / Context Menu, range operations (`I`/`O` shortcuts, range split/delete/ripple-delete/speed/adjustment-layer/export-range with locked-track protection), and on-canvas text/handle support.
- [ ] **E2 — Timeline Editing**: `[` and `]` trim-to-playhead shortcuts, `J`/`K`/`L` transport stepping, `⌥←/→` 1-frame clip nudge, ruler drag range selection, and drag-and-drop track insertion rules.
- [ ] **E3 — Drawers + Effects, Transitions, Filters, LUTs**: Collapsible rail drawers (`Esc` / repeat click closes while preserving selection/playhead/zoom), real rendered shader tiles, and `.cube` 3D LUT file import.
- [ ] **E4 — Text & Typography**: Bundled OFL + Local Font Access verification (`FontFace.load()` / fallback badge), `"My styles"` reusable presets, and `document.fonts.ready` export synchronization.
- [ ] **E5 — Captions**: Local Whisper WebGPU/WASM worker with OPFS caching, word-level karaoke editor, and SRT/VTT import/export.
- [ ] **E6 — Audio & Voiceover**: Keyframed gain, clip fade handles, WebAudio voice enhance (HPF + compressor + gate), ducking, and ±0.5 dB preview/export mixdown parity.
- [ ] **E7 — Colour, Keyframes, Speed**: Double-click slider reset, before/after toggle, diamond keyframe buttons (`linear`, `ease-in`, `ease-out`, `ease-in-out`, `hold`), and `0.1×–10×` constant speed + time-remap curves.
- [ ] **X — Export (Editor Modal + Post-Record Quick Export)**: Export modal over `EditPage.tsx` with locked `in`/`out` range support, WebCodecs + single-thread fallback, and `<video>` decoded duration verification.
- [ ] **V — Final Parity + Verification**: Playwright `1440×900` screenshot pairs (`docs/reference/ours/<name>.png`), VISUAL + FUNCTIONAL tables in `docs/UI_PARITY_REPORT.md`, and responsive pass (`390`, `768`, `1024`, `1440`, `1728` px).
