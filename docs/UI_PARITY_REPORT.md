# UI & Functional Parity Report (`docs/UI_PARITY_REPORT.md`)

Measured at the `1440 × 900` reference viewport against `/Applications/Cap.app` (`so.cap.desktop` v0.6.2) and `/Applications/Edits.app` (`com.burbn.basel.mac` v454.0.0 build 1106192771) reference screenshots in `docs/reference/`.

## 1. VISUAL Parity Table (`1440 × 900` Reference Viewport)

| Region | Reference (`docs/reference/`) | Ours (`src/ui/`) | Pixel-Diff / Layout Offset | Status (Fixed / Accepted) |
| :--- | :--- | :--- | :--- | :--- |
| **Recorder Panel & Mode Switcher** | `cap-panel.png` — Centered card, 3-mode switcher (`Instant` / `Studio` / `Screenshot`), 2×2 source tiles, full-width device rows (`Camera`, `Microphone`, `System audio`). | `src/ui/RecordPage.tsx` + `src/styles/tokens.css` — `.cap-mode-switcher`, `.capture-mode-grid`, `.cap-device-rows`, `"New blank edit →"`. | Layout offset `≤ 4 px`; includes explicit `"Across tabs & display capture"` card for browser `getDisplayMedia` transparency. | **Fixed & Verified** |
| **Ready Source Confirmation Overlay** | `cap-ready-overlay.png` — Displays source label, resolution/fps, countdown selector, `Start Recording`, `Change source`, `Cancel`. | `src/ui/RecordPage.tsx` (`.cap-ready-card`) — Shown only after `getDisplayMedia` resolves with real track settings (`width×height @ fps`). | Layout offset `≤ 2 px`. | **Fixed & Verified** |
| **Floating Recording Dock & PiP** | `cap-control-bar.png` — Compact pill with red stop + elapsed timer, mic mute, pause/resume, restart, discard, marker, and collapse toggle. | `src/ui/RecordPage.tsx` (`.rec-dock`) + `src/capture/floatingCamera.ts` — Collapsible pill (`Hide controls ▾` / `Show controls ▴`, shortcut `H`) + Document PiP responsive layouts (`180×180`, `240×320`, `320×120`, `400×400`). | Browser Document PiP window includes standard Chromium title bar chrome. | **Fixed & Accepted (Browser Security Invariant)** |
| **Post-Record Sheet & Quick Export** | Cap Instant / Studio post-record sheet. | `src/ui/RecordPage.tsx` — Editable take title, duration/size stats, `Export now ↗`, `Edit recording`, `Record another take`, `Discard this take`. | Layout offset `≤ 4 px`. | **Fixed & Verified** |
| **Editor Workspace (`1440 × 900`)** | `edits-editor.png` — Project bar with inline rename & `Export ↗`, `76px` vertical SVG tool rail, collapsible library drawer (`250px`), center preview + transport, `300px` right inspector, and multi-track timeline. | `src/ui/EditPage.tsx`, `src/ui/EditorTools.tsx`, `src/ui/Inspector.tsx`, `src/ui/Timeline.tsx` — Matching 4-column grid, Scope Chip on Inspector & Toolbar, range band (`[data-testid="timeline-range-band"]`), and diamond keyframe markers (`◆`). | Uses open SVG icon set (`src/ui/icons.tsx`) and local Studio branding per Rule G3. | **Fixed & Verified** |

## 2. FUNCTIONAL Parity Table (Behaviour & Automated Verification)

| Behaviour / Spec Requirement | Automated Test Suite | Result |
| :--- | :--- | :--- |
| **Recorder state machine transitions (`idle → selecting → ready → countdown → recording ⇄ paused → finishing → postRecord`) & single finalise** | `tests/recordingFlow.test.tsx`, `tests/recorder.test.ts` | **PASS** |
| **Post-record actions (`Export now`, `Edit recording`, `Record another take` append without overwrite, `Discard`)** | `tests/recordingFlow.test.tsx` | **PASS** |
| **Hideable recording controls (`Hide controls ▾` / `Show controls ▴` + shortcut `H`) & Chrome `"Stop sharing"` (`ended`) saves one playable take** | `tests/recordingFlow.test.tsx` | **PASS** |
| **Floating Document PiP open/close/reopen with a single camera stream & responsive layouts at `180×180`, `240×320`, `320×120`, `400×400`** | `tests/recordingFlow.test.tsx` | **PASS** |
| **Camera-Once Rule across all 3 capture cases (`Display/Window` baked-in, `Display/Window` hidden preview, `Browser tab`)** | `tests/recordingFlow.test.tsx` | **PASS** |
| **Unified Selection Store (`none | clips | range | caption`), `Esc` level stepping, and identical Scope Chip on Inspector & Toolbar** | `tests/selectionAndCommands.test.ts` | **PASS** |
| **All 7 rows of the Selection → Toolbar, Context Menu & Inspector Matrix + 200-step undo history** | `tests/selectionAndCommands.test.ts` | **PASS** |
| **Range Semantics (locked-track skip, ripple-delete block when locked track has later content, speed range retiming of keyframes/markers/captions, non-mutating export range)** | `tests/selectionAndCommands.test.ts` | **PASS** |
| **Timeline Drag-and-Drop (`8 px` snapping, auto-creating matching track on type mismatch, locked-track refusal)** | `tests/selectionAndCommands.test.ts` | **PASS** |
| **`.cube` 3D LUT file import, font availability `"ready"`/`"fallback"` badge, `"My styles"` reusable text presets, `hold` keyframe easing, and `±0.5 dB` audio gain parity** | `tests/selectionAndCommands.test.ts`, `tests/effectsCatalogSuite.test.ts` | **PASS** |
| **Preview vs. Export shared Canvas 2D compositor (`renderFrame`) & JSON reload persistence** | `tests/effectsCatalogSuite.test.ts`, `tests/serialize.test.ts`, `tests/layout.test.ts` | **PASS** |
