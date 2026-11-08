# Reference Screenshot & Application Manifest

Recorded during Phase P0 Reality Audit on **2026-11-08**.

## 1. Environment & Pinned Reference Versions

- **Host OS**: macOS (`darwin`, Apple Silicon)
- **Reference Application 1 — Cap Desktop**:
  - Path: `/Applications/Cap.app`
  - Bundle Identifier: `so.cap.desktop`
  - Version: `0.6.2` (`CFBundleShortVersionString = 0.6.2`, `CFBundleVersion = 0.6.2`)
  - Window / Viewport: `660 × 870` CSS px (launcher & settings audit)
- **Reference Application 2 — Instagram Edits Desktop**:
  - Path: `/Applications/Edits.app`
  - Bundle Identifier: `com.burbn.basel.mac`
  - Version: `454.0.0` (`CFBundleShortVersionString = 454.0.0`, `CFBundleVersion = 1106192771`)
  - Reference Desktop Viewport: `1440 × 900` CSS px (1× / 2× Retina DPR)

## 2. Captured Reference Files (`docs/reference/`)

| File | Source / App | Viewport | Capture Date | State Shown | Evidence Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `docs/reference/cap-panel.png` | Cap / Local Recorder | `1440 × 900` | 2026-11-05 | Main recorder panel, source selection grid, device rows (`Camera`, `Microphone`, `System audio`). | Observed |
| `docs/reference/cap-ready-overlay.png` | Cap / Local Recorder | `1440 × 900` | 2026-11-04 | Active camera self-view bubble & pre-recording/scrolled source state. | Observed |
| `docs/reference/cap-control-bar.png` | Cap / Local Recorder | `1440 × 900` | 2026-11-04 | Floating recording control bar (`.rec-dock`) with timer, Pause, Stop, Marker, Restart, Discard, Mute. | Observed |
| `docs/reference/edits-editor.png` | Edits / Local Editor | `1440 × 900` | 2026-11-05 | Desktop 4-column editor layout: project bar, left tool rail, tool library drawer, center preview + transport, right inspector, and timeline. | Observed |
