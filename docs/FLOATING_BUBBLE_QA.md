# Floating Camera Bubble & Controls QA Report (`docs/FLOATING_BUBBLE_QA.md`)

Recorded for **Phase B** on **2026-11-08**.

## 1. Document Picture-in-Picture Size × Layout Matrix

`resolvePipLayout(width, height, cameraOn, preferred)` in `src/capture/floatingCamera.ts` automatically adapts the Document PiP window contents on open and on every `resize` event:

| Window Size (CSS px) | Aspect Ratio Class | Active Layout (`data-pip-layout`) | Camera Bubble | Recording Controls Bar | Elapsed Time Badge | Verified By |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`180 × 180` (S Square)** | `square` | `bubble` | Visible (scaled to fit frame with state ring) | Compact toolbar below / hover-accessible (`≥ 28px` tap targets) | Always visible (`[data-testid="pip-elapsed-badge"]`) | `tests/recordingFlow.test.tsx` |
| **`240 × 320` (M Tall)** | `tall` | `tall` | Visible (`min(100%, 210px)`) | Full control bar below bubble (`Pause`/`Resume`, `Stop`, `Hide preview`) | Always visible | `tests/recordingFlow.test.tsx` |
| **`320 × 120` (Wide Bar)** | `wide` (`w >= 1.45 * h`) | `bar` | Hidden (bar-only layout) | Full horizontal control bar (`REC 00:12`, `Pause`, `Stop`, `Hide preview`) | Visible in bar | `tests/recordingFlow.test.tsx` |
| **`400 × 400` (XL Square)** | `square` | `bubble` | Large presenter bubble (`352 × 352` inner frame) with state ring | Visible below bubble | Always visible | `tests/recordingFlow.test.tsx` |

## 2. State Ring & Accessibility Verification

- **Recording (`stage === 'recording'` / `'countdown'`)**: `3px solid #ef4444` (red state ring).
- **Paused (`stage === 'paused'`)**: `3px solid #f59e0b` (amber state ring).
- **Idle / Ready (`stage === 'idle'` / `'ready'`)**: `3px solid #687385` (neutral state ring).
- **Tap Targets**: All buttons inside the Document PiP control bar enforce `minHeight: 28px`.
- **Stylesheet & Theme Synchronization**: `copyStylesToPipDocument` clones `<style>` and `<link rel="stylesheet">` nodes and `data-theme` into `pipWin.document`.

## 3. Cross-Tab, Cross-App & Lifecycle Behavior Matrix

| Scenario | Observed / Verified Behavior | Verification Source |
| :--- | :--- | :--- |
| **Switching Chrome tabs** | Document PiP window stays floating on top of the active Chrome tab; `document.title` on the recorder tab updates to `"● 00:12 Recording — Browser Record"`. | Automated (`tests/recordingFlow.test.tsx`) + Chromium Document PiP spec |
| **Switching to Terminal / VS Code / Finder (same desktop)** | Document PiP window remains above standard macOS desktop windows on the active Space. | Chromium Document PiP spec |
| **macOS Full-Screen Space** | Browser PiP windows are managed by the browser window server and are not guaranteed to float over a separate native macOS full-screen Space (documented in `docs/KNOWN_LIMITATIONS.md`). | Documented platform limit |
| **Closing the PiP window (`pagehide`)** | Detaches `video.srcObject` without stopping the `MediaStreamTrack` or `CaptureSession`; recording continues uninterrupted and Studio displays **`Reopen floating controls`**. | Automated (`tests/recordingFlow.test.tsx`) |
| **Camera-Once Rule (3 Cases)** | 1. `Display/Window` + visible bubble (`baked-in-screen`) → `compositeInExport = false` (no duplicate bubble in export; raw `camera.webm` kept for Studio).<br>2. `Display/Window` + `Hide floating preview` → `compositeInExport = true`.<br>3. `Browser tab` → `compositeInExport = true`. | Automated (`tests/recordingFlow.test.tsx`) |
