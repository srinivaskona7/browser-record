# Browser 4K Studio — project overview

Status as of 2026-11-05. Branch `main`.

## 1. What it is

A free, local, browser-only studio for recording and editing technical videos.
Target use: DevOps lessons for YouTube and Instagram.

Constraints (from the original spec):

- No cloud, no paid APIs, no subscriptions, no mandatory sign-in.
- Media stays on the user's disk.
- Never claim a feature works from build or unit tests alone; separate
  implemented, browser-verified, experimental and unverified.
- No silent codec or resolution substitution.
- No access to private recordings or personal folders without authorisation.

## 2. Stack

| Layer | Choice |
|---|---|
| UI | React 19, TypeScript, Vite 8 (dev port 5199) |
| State | Zustand stores (`useEditor`, `useSession`) |
| Render | Canvas 2D compositor shared by preview and export (`src/render/compose.ts`) |
| Encode | WebCodecs + Mediabunny (H.264 MP4); VP9/AV1/HEVC capability-gated |
| Storage | Folder-backed projects (File System Access) with OPFS fallback |
| Audio | Web Audio chain; silence detection in `src/audio/mixdown.ts` |
| Captions | Local Whisper via Transformers.js in a module worker |
| Tests | Vitest (164 passing across 18 test files), `tsc --noEmit`, eslint |

Key modules:

- `src/project/` — data model (`types.ts`), pure ops (`ops.ts`), validation and
  serialisation (`serialize.ts`), chapter and description text (`chapters.ts`).
- `src/render/` — shared frame composition and keyframe queries.
- `src/ui/` — pages (Record, Edit, Export, Projects, Diagnostics) and panels
  (`MediaBin`, `Inspector`, `Preview`, `AboutDialog`).
- `docs/` — `FEATURE_MATRIX.md`, `ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md`,
  `COMPATIBILITY.md`, `TEST_REPORT.md`.

## 3. What exists

### Capture and recording — implemented

- Screen, window or tab capture; camera; microphone; system or tab audio when
  the picker returns it.
- Bubble-over-screen recording with shape, corner, size, shadow, outline, mirror.
- Segmented disk writing with crash recovery (committed bytes survive).
- Countdown, pause, stop, discard, restart, markers, live dock, keyboard keys
  (P, S, M, U) while the tab has focus.
- Draggable self-view, remembered across reloads.
- Per-source downloads after a take.

### Workspace — implemented

- Media stored inside the project folder; legacy-location recovery on load.
- Delete a project and its recordings, with confirmation.
- Schema migrations v1 → v3; relinking missing originals.
- Clean unused recordings.

### Editing — implemented

- Multitrack timeline: split, trim, ripple delete, insert and overwrite, move,
  duplicate, group, lock/hide/mute/solo, markers, undo/redo, frame stepping.
- Overlay tracks: Overlays, Stickers, Header, Footer, Intro. Overlays never
  overwrite the screen recording.
- Text presets: title, lower third, callout, code, section, hook, terminal
  (typewriter), thumbnail, metric.
- Arrow annotation; Subscribe, Like and Bell stickers.
- Brand kit (name, role, email, LinkedIn) in project settings.
- Header and footer from the brand kit; one-step Intro (header, footer, hook).
- Contact bar with icons and four styles.
- Hold frame (silent, pushes later clips right).
- Blur box (manual mask), punch-in zoom, zoom highlight op, full camera for a
  hold length.
- Presenter layouts, transforms, keyframes; safe areas for 16:9, 9:16, 1:1.
- Tabbed media bin: Uploads, Add, Markers.

### Export — implemented

- Save current frame as PNG at full project resolution.
- Processing speed readout (fps, × real time, ETA).
- YouTube chapters: "Copy YouTube chapters" (m:ss, h:mm:ss past an hour).
- Copy description: chapters (with a 0:00 Intro line when needed) plus contact
  lines.
- Deterministic offline render; one composition model for preview and export.

### Audio and captions — implemented

- Voiceover and punch-in takes; HPF, EQ, compressor, limiter, ducking.
- Local Whisper transcription; SRT/VTT import, export, retiming, silence cuts.
- Word-level highlighting is experimental (needs real word timings).

### Help

- About dialog with features and walkthrough; keyboard-shortcuts dialog.

## 4. What is partial or experimental

| Item | State | Note |
|---|---|---|
| True 4K capture | experimental | Native only for a 3840×2160 surface; otherwise upscaled and labelled |
| 60 fps | experimental | Trusted only after the encoder benchmark |
| VP9 / AV1 / HEVC | experimental | Capability-gated; AV1 may be slower than real time |
| Automatic chroma key | experimental | Off by default; no redaction guarantee |
| Heuristic secret detection & blur | experimental | Local text/pixel heuristics (`src/project/secretScan.ts`); never a redaction guarantee |
| Word-level caption highlight | experimental | Needs model word timings |

## 5. Browser-verified vs unit-tested only

Browser-verified (Playwright, dev server):

- Arrow, Subscribe sticker, code callout, contact bar (glass style), header and
  footer, About dialog, Save frame PNG, Terminal clip creation.
- Intro template: header, footer and hook rendered (screenshot checked).
- Punch-in disabled with reason on a title clip.
- Blur box and Hold frame clicks run without error.

Unit-tested only (not yet browser-checked):

- Hold frame output, blur box mask, punch-in keyframes on media clips, full
  camera span, thumbnail and metric presets, zoom highlight, cut silences,
  description builder, block-reason helpers, gradient/solid/accent contact styles,
  plus all 18 DevOps/Shorts features in `tests/features18.test.ts`.

## 6. Recently implemented (18-feature DevOps & Shorts batch)

All 18 items from the YouTube/Instagram DevOps list and follow-up suggestions are now implemented and unit-tested (`tests/features18.test.ts`):

| # | Feature | Status |
|---|---|---|
| 1 | Jump cuts from silence detection (`cutSilences` wired in Add & Captions) | Implemented (unit-tested) |
| 2 | 9:16 reframe preset (`reframe9x16`) | Implemented (unit-tested) |
| 3 | End-screen 20 s zone guide (`endScreenZone` + transport toggle) | Implemented (unit-tested) |
| 4 | Code line highlight in code callouts (`highlightLines` + Inspector input) | Implemented (unit-tested) |
| 5 | Zoom-to-highlight button (`addZoomHighlight` + `zoomHighlightBlockReason`) | Implemented (unit-tested) |
| 6 | B-roll picture-in-picture (`addBrollPip` on `B-Roll` track) | Implemented (unit-tested) |
| 7 | Heuristic secret detection & candidate blur (`src/project/secretScan.ts`) | Experimental (unit-tested; not a redaction guarantee) |
| 8 | Caption style presets (`devops-terminal`, `hormozi-pop`, `minimal-pill`) | Implemented (unit-tested) |
| 9 | Speed ramp on idle sections (`speedRampRanges` at 2.5×) | Implemented (unit-tested) |
| 10 | Command-line styling (`$` prompt, dimmed output lines via `cli` preset) | Implemented (unit-tested) |
| 11 | Before/after split layout (`addBeforeAfterSplit` + `beforeAfterRegions`) | Implemented (unit-tested) |
| 12 | Thumbnail PNG export (1280×720 via `snapshotThumbnail`) | Implemented |
| 13 | Shorts/Reels export preset (`shorts-vertical` 1080×1920, 60 s cap, size check) | Implemented (unit-tested) |
| 14 | Vertical reframe that follows the presenter (`reframeFollowPresenter`) | Implemented (unit-tested) |
| 15 | Segment picker from markers for Shorts (`markerSegments` + `extractSegmentProject`) | Implemented (unit-tested) |
| 16 | Auto end screen (`addEndScreen` — Subscribe + two video slots) | Implemented (unit-tested) |
| 17 | Diagram reveal (`addDiagramReveal` + `diagramRevealProgress` step reveal) | Implemented (unit-tested) |
| 18 | Keyboard overlay for shell and IDE walkthroughs (`addKeystrokeOverlay`) | Implemented (unit-tested) |

## 7. UI status

- Dense three-column Edit layout (bin, preview and inspector, timeline).
- Done: labelled "Shortcuts" button, larger field labels and ruler text,
  visible disabled-reason text in the Add panel.
- Open: the Add panel is still one flat list of about 25 buttons. Regrouping
  into sections needs a layout decision. `design-critic` has not been run on
  the current page.

## 8. Known limits (by design)

- No global hotkeys outside the tab; no OS-wide cursor telemetry.
- No area or window-region capture; the browser picker offers screen, window or tab.
- No LUFS metering; peak and RMS only.
- No exact target file size; the budget calculator estimates bitrate.
- No automatic redaction of secrets on screen.
- Mobile width hides the media bin; desktop layout only.

## 9. Open decisions for the user

1. Add panel: flat list, or collapsible sections with one primary action each?
2. Narrow widths: keep three columns, or stack the inspector below the preview?
3. Commit and push the uncommitted batches (contact bar, terminal and presets,
   intro, description, UI fixes). Commit only on request; push needs your go-ahead.
4. Vertical (Shorts) export: where the contact bar sits, since the footer may
   cover the presenter.
5. Priority order for section 6: suggested first batch is 5, 8, 10, 12, 13, 16,
   then 1, then 2.

## 10. Verification status

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 164 passing (18 test files).
- Dev server: `npx vite --port 5199 --strictPort`.
- Review gate (CLAUDE.md): adversarial reviews run on the last two batches;
  findings fixed. The spec-compliance check is still open because it needs the
  full suggestion list pasted back.
- Not built or deployed: the user builds and deploys manually.

## 11. Rules that apply

- Never run `containerize`, image push, `helm` or `kubectl apply` for workloads.
- Public web lookups only through WebFetch, exa or research-scout, and only when asked.
- Push only with plain `git push origin <branch>`, and only when asked.
- Delete only files this session created, and only transient ones.
- Keep `docs/FEATURE_MATRIX.md` in step with each change.
