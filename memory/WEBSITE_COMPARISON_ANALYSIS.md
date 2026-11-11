# Website Comparison Analysis: cap.so vs screen.studio vs browser-record

**Date:** Wed Nov 11 2026  
**Sources:** https://cap.so (home, features, pricing), https://screen.studio/ (home, guide), docs/CAP_RECORDING_UI_AUDIT.md (observed Cap.app v0.6.2), AGENTS.md / SESSION_PLAN.md (browser-record project)

---

## 1. Cap (cap.so) — Overview

**Positioning:** Open-source screen recorder + async video platform ("open source alternative to Loom"). Cross-platform desktop app (macOS Apple Silicon + Intel, Windows, Linux Debian). AGPLv3 license.

### Recording Modes
| Mode | Description |
|------|-------------|
| Instant Mode | Uploads while recording; shareable Cap link after stop/processing |
| Studio Mode | Local `.cap` project for editing, local export, clipboard export, later share-link export |
| Screenshot Mode | Display, window, or selected area capture |

### Capture Sources
- Display, Window, Area, Camera Only
- Camera, microphone, system audio inputs with live level meters
- Display selector with refresh rate info (e.g., Built-in Retina 120 Hz)
- Window selector with title, app, dimensions, refresh rate
- Area capture with aspect-ratio presets (Free, 16:9, 4:3, 1:1, 9:16)

### Quality & Export
- 4K 60fps recording
- Studio quality: Balanced / Smaller files / Maximum detail
- Export: MP4, WebM, MOV, GIF; speed control 0.25x–3x
- Composite recording: camera + screen recorded separately, rendered as one video in real-time

### Editor (Studio Mode)
- Timeline changes, background styling, crop and frame controls, zooms
- Camera treatment, cursor treatment, captions, overlays, audio
- Frame-perfect timeline editing, split & trim

### AI & Cloud Features (Cap Pro)
- AI-generated titles, smart summaries, clickable chapters, automatic transcriptions
- Auto-edit (SOON), noise reduction (SOON), AI video search (SOON)
- Unlimited cloud storage, viewer analytics, team workspaces
- Password protection, custom domain, viewer comments + emoji reactions
- Bring Your Own Storage (Google Drive, S3), webhooks & API (SOON)
- Loom video importer (single links or CSV up to 500 rows)

### CLI & Integrations
- `cap record start` / `cap record stop` / `cap upload` / `cap caps context <id>` / `cap caps transcript`
- MCP server (`cap mcp serve`), REST API, `@cap/sdk-recorder`, `@cap/sdk-embed`
- SOC 2 Type II, ISO 27001, HIPAA compliant

### Pricing
- Free: personal use, 25 shareable links/month (≤5 min each), no commercial use
- Desktop License: $29/year or $58 lifetime — commercial rights, unlimited local recording
- Cap Pro: $12/user/month ($8.16 annually) — everything + cloud, AI, team

---

## 2. Screen Studio (screen.studio/) — Overview

**Positioning:** "The screen recorder for Mac that handles the hard parts: zooms, motion, sound, and framing." macOS-only native app (macOS Ventura 13.1+). Built on Apple's ScreenCaptureKit. One-time/subscription ($9/mo yearly or $29/mo monthly), all features in every plan.

### Recording
- Display, single window, or area; webcam, microphone, system audio
- Resize recorded window to exact size in one click
- Hide desktop icons, speaker notes on screen while recording
- Pause & resume mid-take; countdown before start; one global shortcut
- Crash recovery: saved to disk every 2 seconds
- iPhone & iPad recording via USB with device mockup framing

### Zoom & Motion (key differentiator)
- Records screen **without** cursor, adds cursor back in post — enables post-recording cursor effects
- **Classic zoom** and **Loupe zoom**, both animated automatically
- **Smart framing:** zooms balanced so webcam never covers cursor
- **Automatic zoom:** detects clicks, zooms on important moments
- **Manual zoom:** point at specific screen areas
- **Optics-based motion blur** for fast movement
- **Smooth cursor:** shaky movement → steady glide
- **Click effects:** circle/ripple on every click
- **Edit cursor style** after recording (size, style)
- **Loop cursor position** for seamless looped videos
- **Hides when idle:** cursor steps out of view when resting

### Camera Layouts
- Fullscreen camera, Split screen, Camera overlay, Screen only, Camera cutout
- Camera cutout: background removed on-device
- Hide during silence: camera steps aside when not talking
- Face tracking: keeps picture centered on face

### Aspect Ratios & Social
- 16:9, 1:1, 9:16 — zooms, layouts, captions auto-adjust
- **Reel mode:** Instagram/TikTok interface overlay preview so nothing gets covered

### Editing
- **Edit by transcript:** delete sentence → cuts video; shorten filler words & pauses
- Noise reduction & Podcast mode (on-device, local Whisper/Apple speech recognition)
- Captions with styles; backgrounds (wallpaper/gradient/image/Unsplash); shadow & inset
- Masks & highlights: cover sensitive data (API keys, emails) or highlight what matters
- Presets: save look, share with team

### Export & Sharing
- Shareable links: 1080p at 60fps, up to 30 min, browser playback, viewer comments on exact second
- Clipboard: copy finished video, paste into Slack/Linear/docs
- MP4 up to 4K at 60fps; GIF up to 1080p; shared projects up to 20 GB
- Hardware encoding on Mac media engine

### Privacy
- Offline first; cloud features optional; on-device transcripts, noise reduction, face tracking, cutouts, export

---

## 3. browser-record (this project) — Current State

Per AGENTS.md / SESSION_PLAN.md / docs/CAP_RECORDING_UI_AUDIT.md:

### Recorder (Cap-style, `so.cap.desktop` v0.6.2 reference)
- State machine: `idle`/`requesting-permission`/`ready`/`countdown`/`recording`/`paused`/`stopping`/`saved`/`recovering`/`failed`
- `<RecordPage hidden={route !== 'record'} />` stays mounted across tab switches
- `<CameraBubble />`: draggable, live shape (Circle/Square/Rounded/Portrait/Pill/Hexagon), effect, placement, size (S/M/L), mirror
- Stealth Mode: compact horizontal record panel + `.rec-dock` control bar, timer, Quiet mode (Normal/Compact HUD/Minimal badge)
- Document PiP / Video PiP floating camera; auto-PiP; MediaSession hardware keys
- Teleprompter with WPM (60–300), font size (14–36px), backdrop opacity (35%–95%)
- Post-stop Review take trim/preview; shared Recordings Library; Clear unused recordings

### Editor (Instagram Edits reference, `com.burbn.basel.mac` v454.0.0)
- SVG tool rail, catalog previews, inline project naming, searchable inspector
- Colour wheels/HSL/curves with Original vs. Graded preview
- Move-scale-rotate handles; custom font upload (WOFF2/WOFF/TTF/OTF)
- Storyboard & share handoff; undoable ops via `src/project/ops.ts` + `useEditor.apply`
- Gesture pattern: `beginGesture` → `updateGesture` → `endGesture`/`cancelGesture`

### Render & Export
- Canvas 2D compositor; WebGL2 grading pass with CPU fallback; WAV mixdown encoder
- WebCodecs/MediaBunny export pipeline
- Turbo export (4× faster, hardware acceleration); Ultra-compact export (4× smaller, AV1→HEVC→VP9)
- 4K recording default (3840×2160 @ 30); 4K project canvas auto-upgrade

---

## 4. Feature Gap Analysis & Improvement Suggestions

### A. Recording UX — What Cap & Screen Studio Do Better

| # | Cap / Screen Studio Feature | browser-record Gap | Suggested Improvement |
|---|-----------------------------|-------------------|----------------------|
| 1 | **Cursor recorded separately from screen** (Screen Studio) — enables post-recursor cursor smoothing, resizing, restyling | Cursor is burned into the screen capture | Separate cursor track/layer in recorder; add post-record cursor style editor (size, shape, smoothness, click effects) |
| 2 | **Automatic zoom on clicks** (Screen Studio) | Manual zoom only in editor | Add auto-zoom detection during recording: detect click positions, auto-generate zoom keyframes on timeline |
| 3 | **Loupe zoom** (Screen Studio) — magnifying-glass style zoom | Only standard zoom/crop | Add loupe/magnifier zoom effect option in CameraBubble and editor |
| 4 | **Camera cutout / background removal** (Screen Studio, on-device) | No background removal | Add virtual background / chroma-key or background blur for camera bubble |
| 5 | **Hide camera during silence** (Screen Studio) | Camera always visible | Add voice-activated camera visibility (show when speaking, hide during silence) |
| 6 | **Face tracking** (Screen Studio) | No face tracking | Add face-tracking option to keep presenter centered in camera bubble |
| 7 | **Motion blur** (Screen Studio, optics-based) | No motion blur | Add motion blur effect for fast cursor/screen movement in export pass |
| 8 | **Reel mode / social-safe preview** (Screen Studio) — Instagram/TikTok overlay preview | No social-safe preview | Add Reel mode overlay toggle in preview showing IG/TikTok safe zones |
| 9 | **Pause & resume same take** (Screen Studio) | Pause exists (state machine) | Ensure pause/resume creates a single continuous take with chapter markers at pause points |
| 10 | **Crash recovery every 2s** (Screen Studio) | Recovery state exists | Strengthen auto-save: periodic write of in-progress take to IndexedDB every 2s with recovery dialog on relaunch |
| 11 | **iPhone/iPad device mockup framing** (Screen Studio) | No device framing | Add optional device bezel overlay (iPhone/iPad/Mac) for camera or screen recordings |
| 12 | **Speaker notes on screen** (Screen Studio) | Teleprompter exists | Integrate speaker notes as a floating overlay during recording (separate from teleprompter script) |
| 13 | **Resize recorded window to exact size** (Screen Studio) | No window resizing | Add "resize capture area to preset dimensions" before recording starts |

### B. Editing — What Cap & Screen Studio Do Better

| # | Cap / Screen Studio Feature | browser-record Gap | Suggested Improvement |
|---|-----------------------------|-------------------|----------------------|
| 14 | **Edit by transcript** (Screen Studio) — delete text to cut video | No transcript-based editing | Add transcript panel with word-level timestamps; clicking text jumps to timeline; delete sentence = cut range |
| 15 | **Filler words & pauses auto-removal** (Screen Studio) | No auto-removal | Add "Remove filler words" and "Shorten pauses" buttons in editor |
| 16 | **Speed up typing segments** (Screen Studio guide) | No speed-ramp by segment | Add speed-ramp tool: select timeline range, apply 2×/4× speed for typing/silent sections |
| 17 | **Masks & highlights** (Screen Studio) | No masking tool | Add mask/highlight overlay tool: blur or dim regions, spotlight focus area |
| 18 | **Presets** (Screen Studio) — save look, share with team | No preset system | Add preset save/export/import for export settings, grading, bubble layout, aspect ratio |
| 19 | **Copy current frame as image** (Screen Studio guide) | No frame export | Add "Copy frame as PNG" and "Export frame" in Preview |
| 20 | **Cursor style editing post-record** (Screen Studio) | No post-record cursor editing | Since cursor is separate (if implemented), allow restyling cursor in editor |
| 21 | **Timeline editor frame-perfect** (Cap) | Timeline exists | Add frame-accurate snapping, zoom-to-frame, ripple edit, roll edit |

### C. Sharing, Sessions & Video Library — What Cap Does Better

| # | Cap Feature | browser-record Gap | Suggested Improvement |
|---|-------------|-------------------|----------------------|
| 22 | **Shareable links with browser playback** (Cap Instant Mode) | Local-only Recordings Library | Add optional cloud share links (upload to user's own S3/Cloudflare R2) with viewable URL |
| 23 | **Viewer comments + emoji reactions** (Cap) | No social layer | Add timestamped comments/emoji on shared videos |
| 24 | **Viewer analytics** (Cap Pro) | No analytics | Add basic view/watch-time analytics for shared links |
| 25 | **Password protection** (Cap Pro) | No access control | Add optional password protection for shared videos |
| 26 | **Team workspaces & shared projects** (Cap / Screen Studio) | Single-user local | Add project export as shareable package (like Screen Studio's 20 GB shared projects) |
| 27 | **Loom importer** (Cap) | No import from other tools | Add Loom URL/CSV import (download and convert Loom videos into project) |
| 28 | **CLI + MCP + REST API** (Cap) | No automation | Add `cap`-style CLI and MCP server for browser-record so agents can script recording/export |
| 29 | **Self-hosting** (Cap) | N/A (browser app) | Document self-host options for the browser app (Cloudflare Pages + R2) |

### D. Platform & Distribution

| # | Observation | Suggested Improvement |
|---|-------------|----------------------|
| 30 | Screen Studio is **macOS-only**; Cap is **cross-platform** desktop; browser-record is **browser-based** | Leverage browser advantage: no install, works on any OS. Emphasize "record from any browser" as differentiator |
| 31 | Cap has **CLI + MCP + API** for automation | Add programmatic access: `npm install @browser-record/sdk`, MCP server, REST API for headless recording |
| 32 | Both competitors have **documentation sites** with guides | Expand `/docs` with recording guide, editor guide, export presets reference |

---

## 5. Priority Recommendations for browser-record

### P0 (High impact, aligns with existing architecture)

1. **Separate cursor layer + post-record cursor editor** — Screen Studio's killer feature. Record cursor as data (x/y/time), not burned pixels. Add cursor style panel in EditorTools (size, shape, smoothness, click ripple, hide-when-idle).
2. **Auto-zoom on click** — During recording, log click coordinates; after stop, generate zoom keyframes on timeline. Smart framing: ensure camera bubble never covers zoomed region.
3. **Edit-by-transcript** — Add Web Speech API or local Whisper transcript panel. Click transcript word → seek timeline. Delete sentence → cut range.
4. **Shareable links** — Browser app can upload to Cloudflare R2 (already on CF Pages). Generate viewable URL with optional password/expiry. This is the biggest gap vs Cap Instant Mode.

### P1 (Medium impact)

5. **Camera cutout / background blur** — Use canvas chroma-key or blob-based segmentation for camera bubble background removal.
6. **Motion blur + smooth cursor** — Post-process export pass for motion smoothing; cursor path smoothing algorithm.
7. **Presets system** — Save/load export + grading + bubble layout presets. Share as JSON files.
8. **Crash recovery hardening** — Auto-save take every 2s to IndexedDB; recovery dialog on app relaunch.
9. **Reel/social-safe preview** — Overlay IG/TikTok safe zones in Preview; auto-adjust layout for 9:16.

### P2 (Lower impact / longer term)

10. **Face tracking** — MediaPipe face detection to keep presenter centered.
11. **iPhone/iPad mockup framing** — Device bezel overlays for mobile demos.
12. **CLI/MCP/API** — Headless recording and export automation.
13. **Loom importer** — Download Loom videos, convert to project.
14. **Viewer analytics + comments** — Social layer on shared links.

---

## 6. Specific Code-Level Suggestions (mapped to browser-record files)

### `src/capture/recorder.ts` & `src/capture/stateMachine.ts`
- Add `cursorTrack: Array<{x, y, t}>` alongside video track
- Add auto-zoom event detection on click (log screen coordinates)
- Add periodic auto-save (every 2s) to IndexedDB for crash recovery

### `src/ui/EditorTools.tsx` & `src/ui/Inspector.tsx`
- Add Cursor tool: size, shape, smoothness, click effects, hide-when-idle
- Add Mask/Highlight tool: blur region, spotlight focus
- Add Transcript panel (searchable, click-to-seek, delete-to-cut)
- Add Speed ramp tool (per-segment speed changes)

### `src/ui/Preview.tsx` & `src/ui/Timeline.tsx`
- Add Reel mode overlay (IG/TikTok safe zones)
- Add frame-accurate snapping and ripple/roll edits
- Add "Copy frame as image" action

### `src/render/compose.ts` & `src/render/gradingPass.ts`
- Add motion blur pass for fast cursor/screen movement
- Add chroma-key / background removal for camera layer

### `src/export/exporter.ts` & `src/export/presets.ts`
- Add shareable-link upload (Cloudflare R2 / S3) with URL generation
- Add preset save/export/import (JSON)
- Add password protection option for shared links

### `src/ui/RecordPage.tsx`
- Add camera cutout / background blur toggle
- Add face tracking toggle
- Add speaker notes floating overlay
- Add resize-window-before-record preset dimensions

### `src/app/actions.ts`
- Add `shareVideoToCloud` action (upload + return URL)
- Add `importLoomVideo` action (download + convert)
- Add `exportProjectPackage` action (shareable 20 GB project bundle)

---

## 7. Honest Storage & Capability Notes (per project guidelines)

- Browser storage is local (IndexedDB/localStorage) — be honest about limits; no automatic cloud sync unless user opts in
- Cannot claim OS-global shortcuts, cursor capture outside browser, or camera/mic access without user permission
- WebCodecs/MediaBunny export is client-side; large 4K exports may hit memory limits — warn users
- Preserve existing honest storage warnings in UI

---

**Evidence sources:** cap.so home/features/pricing pages (webfetch), screen.studio/ home+guide pages (webfetch), docs/CAP_RECORDING_UI_AUDIT.md (Cap.app v0.6.2 observed UI), AGENTS.md + SESSION_PLAN.md (browser-record project state)