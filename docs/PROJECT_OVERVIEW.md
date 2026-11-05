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
| Tests | Vitest (172 passing across 19 test files), `tsc --noEmit`, eslint |

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

### 6b. 30 Creator Editing, Layer, Sound, Look & Social Features (`tests/features30.test.ts`)

1. **Layer Blend Modes (`setClipBlendMode`)** — `normal`, `screen`, `multiply`, `overlay` compositing.
2. **PiP Placement Presets (`applyPipPreset`)** — `top-left`, `top-right`, `bottom-left`, `bottom-right`, `floating-center`, `cinema-bar`.
3. **Drop-Shadow & Neon Glow Presets (`applyShadowGlowPreset`)** — `none`, `soft-card`, `deep-studio`, `neon-cyan`, `neon-amber`.
4. **Track Solo & Unmute All (`soloTrack`, `unmuteAllTracks`)** — Multi-track layer isolation and reset.
5. **Magnetic Gap Closer (`closeTrackGaps`)** — Ripple-packs clips on unlocked tracks to eliminate black gaps.
6. **Voice EQ & Mastering Presets (`applyVoicePreset`, `voicePresetOptions`)** — `podcast-warm`, `crisp-tech`, `broadcast-punch`, `de-reverb-tight`, `flat`.
7. **Procedural Creator SFX Synthesizer (`src/audio/sfx.ts`, `addProceduralSfxClip`)** — Local 16-bit PCM WAV synthesis for `whoosh`, `pop`, `ding`, `keyclick`, `riser`, `success-chime`.
8. **Auto Audio Fades (`applyAudioFades`)** — Smooth fade-in and fade-out across clips to prevent audio clicks.
9. **Music Bed Auto-Ducking Setup (`prepareMusicBedTrack`)** — `-14 dB` music bed track with soft fades and sidechain ducking under narration.
10. **Peak Gain Normalizer (`computeNormalizeGain`, `normalizeClipGain`)** — Target peak dBFS gain calculation and clip normalization.
11. **Colour Grading Look Presets (`applyColorLookPreset`)** — `neutral`, `cinema-teal`, `warm-creator`, `high-contrast-terminal`, `crisp-daylight`, `noir-mono`, `vibrant-reel`.
12. **Radial Vignette (`setClipVignette`)** — Adjustable `0..1` edge darkening in `compose.ts`.
13. **Screen Studio Frame (`applyScreenStudioFrame`)** — Rounded inset desktop frame with studio backdrop padding.
14. **Watch-Progress Bar Overlay (`addProgressBarOverlay`)** — Top/bottom animated progress bar (`kind: 'progressbar'`).
15. **Auto Chapter Bumpers from Markers (`addChapterBumpersFromMarkers`)** — Generates numbered section title cards at every marker.
16. **Batch Cut Transitions (`applyTransitionToAllCuts`)** — Applies `dissolve` / `fade` / `slide` across all cuts on unlocked video tracks.
17. **Ken Burns Slow Drift (`addKenBurnsDrift`)** — Smooth zoom + pan keyframes for static diagrams and talking heads.
18. **Spotlight Dimmer Mask (`addSpotlightMask`)** — Darkens the frame outside a highlighted rectangle (`mode: 'spotlight'`).
19. **Animated Click-Pulse Ring (`addClickPulse`)** — Expanding concentric ripple highlight (`kind: 'pulse'`).
20. **Camera Bubble Corner Cycling (`cycleCameraCornersOnMarkers`)** — Alternates presenter bubble corners at marker boundaries.
21. **Auto-Incrementing Step Badge (`addStepBadge`)** — `STEP 1`, `STEP 2`, … badges in the upper-left corner.
22. **GitHub/DevOps Alert Banners (`addAlertBanner`)** — `warning`, `danger`, `tip`, and `note` admonition callouts.
23. **Social Handle Follow Pills (`addSocialFollowPill`)** — Branded pills for YouTube, Instagram, GitHub, LinkedIn, and X.
24. **Lower-Third Topic Ticker (`addTopicTicker`)** — Persistent monospace demo/topic bar.
25. **Live Countdown Timer Overlay (`addCountdownOverlay`)** — Real-time `MM:SS` ticking countdown (`kind: 'countdown'`).
26. **1:1 Square Reframe (`reframe1x1`)** — `1080×1080` square layout for Instagram carousels and feeds.
27. **4:5 Portrait Reframe (`reframe4x5`)** — `1080×1350` vertical feed layout for Instagram and LinkedIn.
28. **Instagram 1:1, 4:5 & 4K60 Master Export Presets (`insta-square-1080`, `insta-portrait-4x5`, `4k60-master`)** in `src/export/presets.ts`.
29. **Auto Marker Generator from Captions (`generateMarkersFromCaptions`)** — Detects steps and questions in captions to build chapter markers.
30. **Creator Pacing & Retention Audit (`auditVideoPacing`)** — 0–100 scorecard evaluating hook placement, cut frequency, overlays, and caption coverage.

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
- `npx vitest run`: 172 passing (19 test files).
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
