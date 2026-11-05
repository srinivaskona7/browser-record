# Feature status matrix

This is the same list the app renders on its Diagnostics page
(`src/ui/CapabilityMatrix.tsx`). Status meanings:

- **implemented** — shipped and covered by the automated tests where the code is
  testable outside a browser.
- **experimental** — works, but depends on the device or has known limits.
- **unavailable** — the platform cannot do it; the reason is stated and no UI
  pretends otherwise.

| Area | Capability | Status | Detail |
|---|---|---|---|
| Capture | Screen / window capture | implemented | `getDisplayMedia` with user-picked surface. Delivered size/frame rate come from the track. |
| Capture | Surface choice (entire screen / window / tab) | implemented | `displaySurface` is a picker preference, like Meet or Teams. The browser still asks the user, and the page reports the surface actually shared. |
| Capture | Camera capture | implemented | Separate track and file; applied settings shown. |
| Recording UX | Live camera preview with the presenter shape | implemented | "Preview camera" opens the device locally and shows it in the chosen shape, corner, size, shadow, outline and mirror before recording. The preview is never written to disk; the take reuses the same stream. |
| Recording UX | Bubble-over-screen recording | implemented | Screen and camera record together as separate files; the camera clip carries the presenter settings, so preview and export composite the bubble over the screen. Shape (circle / rounded / square / portrait card), corner, size, shadow, outline and mirror are adjustable. Verified in-browser with synthetic streams; the real surface picker is unverified. |
| Capture | Microphone capture | implemented | Mono 48 kHz preferred; EC/NS/AGC requested from the browser. |
| Capture | System / tab audio | implemented | Only when the picker actually returns an audio track. Chrome omits it for whole-screen capture on many systems. |
| Capture | True 4K recording | experimental | Native only for a 3840×2160 surface; smaller sources are upscaled and labelled scaled. |
| Capture | 60 fps recording | experimental | Available; trustworthy only after the encoder benchmark sustains it. |
| Capture | Segmented disk writing with recovery | implemented | Commits every 5–30 s; committed bytes survive a crash, the open segment is reported as lost. |
| Capture | OS-wide cursor telemetry | unavailable | A page cannot read pointer events outside its own surface. Zooms are manual/keyframed. |
| Recording UX | Countdown, pause, stop, discard, markers, stats | implemented | Includes per-take stats and a take-complete dialog with Discard / Exit / Edit timeline. |
| Recording UX | Keyboard control during a take | implemented | P pause/resume, S stop & keep, M marker, U mute/unmute. Ignored while typing, with Ctrl/Cmd/Alt held, and outside a live take. Browser-verified (P/U/S); the marker key is pressed without error but the marker count is not shown on the page. Keys work only while the tab has focus; there are no system-wide hotkeys. |
| Recording UX | Draggable camera self-view | implemented | The floating bubble shown during a take can be dragged anywhere in the viewport (pointer and touch), is clamped to the window on resize, and is remembered across reloads in this browser. Double-click returns it to the default corner. Browser-verified: drag, reload restore and reset. |
| Recording UX | Restart take | implemented | The ↻ button in the dock asks for confirmation, discards the current take's files (same as Discard), and starts a new countdown. Browser-verified: confirm dialog, then REC again with the marker count reset. |
| Recording UX | Marker count in the dock | implemented | Shows "N markers" beside the timer while a take has markers. Browser-verified with two markers. |
| Recording UX | Per-source downloads after a take | implemented | The "Recording finished" dialog lists each source with its size and a Download button; "Download originals" still saves all of them. Browser-verified: four sources, four buttons. |
| Recording UX | Global hotkeys (outside the tab) | unavailable | A web page cannot register system-wide shortcuts. Only the keys listed above work, and only while the tab has focus. Needs a native desktop wrapper (for example Electron or Tauri). |
| Recording UX | Area or window-region capture | unavailable | The browser picker offers entire screen, a window or a tab. Cropping to a region is only possible for elements inside this page (Region Capture) and is not used. |
| Recording UX | Live recording bar (REC, timer, controls) | implemented | A floating Loom-style dock at the bottom of the screen while a take runs: state word and elapsed time, Pause / Resume, Marker, Discard, Mute / Unmute and **Stop & keep**. Live mic level and per-source written bytes are in the Microphone and Take panels. A countdown covers the monitor and a REC tag shows on the live preview; a fixed self-view shows the camera bubble even when the monitor has scrolled away. |
| Recording UX | Discarding an in-progress take deletes its files | implemented | `CaptureSession.discard()` aborts the writers and the Record page removes the take folder, so an abandoned take does not keep gigabytes in browser storage. |
| Recording UX | Clean all unused recordings | implemented | Deletes every `recordings/<take>/` folder no clip references, states how many of how many takes are unused, and disables itself at zero. Imported media, exports and captions are never touched. Take ids are matched against the relative paths assets store (`recordings/<take>/…`). |
| Workspace | Media stored inside the project folder | implemented | Recordings, imports, relinks and voiceovers write `projects/<folder>/…`; on load, media left at a legacy location by older builds is copied back and anything truly absent is flagged `missing`. |
| Workspace | Folder-backed projects | implemented | `media/originals`, `proxies`, `captions`, `recordings`, `exports`, plus versioned `project.json`. |
| Workspace | OPFS fallback | implemented | Quota-checked; labelled as browser storage, not an archive. |
| Workspace | Delete a project and its recordings | implemented | Confirmation dialog from the project card or the editor's Project settings. Removes only `projects/<folder>` (manifest, takes, originals, proxies, captions); sibling projects and exports saved elsewhere are untouched. Refuses names the workspace does not list. If the project was open, the session closes it and returns to the project list. |
| Workspace | Schema migrations and relinking | implemented | v1→v2→v3 on load; missing originals can be relinked without changing the edit. |
| Edit | Multitrack timeline with linked cuts | implemented | Split, trim, ripple delete, insert/overwrite, move, duplicate, group, lock/hide/mute/solo, markers, undo/redo, frame stepping. |
| Edit | Arrow annotation | implemented | "Arrow at playhead" (Add tab) places a 3 s arrow clip on the Overlays track. Drawn by the shared compositor, so preview and export match. Browser-verified in preview; geometry is not yet editable in the Inspector (defaults: lower-left to centre). |
| Edit | Text presets | implemented | Title, Lower third and Callout (Add tab) set placement and style on the Overlays track. Unit-tested; the look is browser-checked for the arrow only. |
| Edit | Insert image or clip at playhead | implemented | Add tab inserts the selected picture or clip on the video track at the playhead in Insert mode, so later clips move right. Not browser-tested for images yet. Still images use a default length. |
| Edit | Overlays on their own track | implemented | Titles and arrows never overwrite the screen recording. Browser-verified: the "Overlays" track is created on first use. |
| Edit | Tabbed media bin (Uploads / Add / Markers) | implemented | Import and Voiceover are on Uploads; presets and inserts on Add. Desktop layout only: the bin is hidden at phone width, as before. |
| Export | Save current frame as PNG | implemented | "Save frame" renders the playhead frame at full project resolution through the export compositor. Browser-verified: PNG bytes and filename. |
| Export | Processing speed readout | implemented | Progress shows fps, ×real time and an m:ss ETA. Helper logic is not unit-tested and no export was run in the browser during this change. |
| Edit | Brand kit (name, role, email, LinkedIn) | implemented | Project settings. Stored in the project file only; nothing is hard-coded in the app. |
| Edit | Header and footer from brand kit | implemented | Add → Brand. Two overlay tracks, "Header" and "Footer", spanning the timeline. Browser-verified: clips appear with the brand text. |
| Edit | Hold frame | implemented | Add → Hold: freezes the selected clip at the playhead for N seconds and pushes later clips right. The hold is silent. Unit-tested; not browser-tested. |
| Export | YouTube chapters from markers | implemented | Markers tab → Copy YouTube chapters. Times are m:ss, or h:mm:ss past an hour. Unit-tested. |
| Help | About dialog with features and walkthrough | implemented | "i" button in the header. Browser-verified: it opens and renders. |
| Edit | Code callout and section heading presets | implemented | Add → Text. Code uses a monospace font on a dark panel; Section is a large centred heading. Unit-tested; the code callout is browser-verified. |
| Edit | Subscribe, Like and Bell stickers | implemented | Add → Call to action. Vector icons drawn from paths, with a scale-in and scale-out over 0.35 s at each end. Placed on a Stickers track. Browser-verified: Subscribe renders. Bell and Like icons unit-tested only. |
| Edit | Contact bar with icons and styles | implemented | Footer from the brand kit: name and role on the left; email and LinkedIn with drawn icons on the right. Four styles (glass, accent gradient, solid dark, solid accent), an accent colour, and a slide-up on entry. Unit-tested; browser-verified in the glass style. Gradient, solid and accent styles are unit-tested only. |
| Edit | Hook and terminal presets | implemented | Add → Text. Hook is a large centred line; Terminal is a monospace panel whose text types in over 0.6 s. Unit-tested; terminal clip creation browser-verified, and the typewriter frame was captured at 3 s with the full line shown. |
| Edit | Thumbnail text and metric presets | implemented | Add → Text. Thumbnail is a large bold centred word; Metric is a large centred figure with no panel. Unit-tested; not browser-checked. |
| Edit | Intro template | implemented | Add → Brand. Header, footer and a hook line at the start in one step. Unit-tested; not browser-checked. |
| Edit | Blur box for on-screen secrets | implemented | Add → Selected clip. Adds a manual blur mask (default top-left) to the selected clip. Manual only: no automatic detection, so it is not a redaction guarantee. Unit-tested. |
| Edit | Punch-in zoom | implemented | Add → Selected clip. Disabled with a reason when the clip already has zoom keyframes. Keyframes zoom 1 → 1.2 over 0.3 s and back to 1 at 1.2 s. Unit-tested. |
| Edit | Full camera for hold length | implemented | Add → Camera. Playhead to playhead + hold seconds: splits at both ends and sets presenter clips inside the span to full layout; clips outside keep their layout. Unit-tested. |
| Edit | Jump cuts from silence detection | implemented | Add → Silence & idle pacing (and Captions → Silence) runs `cutSilences` across unlocked tracks and shifts captions/markers. Unit-tested. |
| Edit | Speed ramp on idle sections | implemented | `speedRampRanges` splits silent/idle spans and accelerates them (default 2.5×) while rippling subsequent clips and markers left. Unit-tested. |
| Edit | 9:16 vertical reframe & follow-presenter preset | implemented | `reframe9x16` and `reframeFollowPresenter` switch the canvas to 1080×1920, stack screen above a portrait presenter card, and keyframe horizontal `panX` to follow the presenter. Unit-tested. |
| Edit | End-screen 20 s zone guide & Auto end screen | implemented | Transport toggle draws the 20 s Subscribe + 2-video-slot guide; Add → Call to action places a 20 s `endscreen` overlay card. Unit-tested. |
| Edit | Code line highlight & CLI (`$` prompt + output) styling | implemented | `highlightLines` draws an accent bar behind 1-based line numbers; `cli` preset renders `$` / `#` / `>` prompts in green, commands in white, and output lines dimmed. Unit-tested. |
| Edit | Zoom-to-highlight button | implemented | Add → Selected clip runs `addZoomHighlight` for the hold length and shows `zoomHighlightBlockReason` when disabled. Unit-tested. |
| Edit | B-roll picture-in-picture & Before/after split | implemented | `addBrollPip` places a muted corner card on a `B-Roll` track; `addBeforeAfterSplit` places side-by-side comparison plates with `BEFORE | AFTER` labels. Unit-tested. |
| Edit | Diagram step reveal & Keyboard shortcut overlay | implemented | `addDiagramReveal` reveals architecture diagrams across N discrete steps; `addKeystrokeOverlay` renders keycap chords (`Ctrl + Shift + P`) with labels. Unit-tested. |
| Edit | Heuristic secret detection & candidate blur masks | experimental | `scanTextForSecrets`, `scanProjectTextSecrets` and `scanFrameForSecretRegions` flag common credential patterns and high-density terminal rows to add candidate blur masks. Not a redaction guarantee; manual verification is required. Unit-tested. |
| Captions | DevOps terminal, short-form pop & minimal-pill caption presets | implemented | `applyCaptionPreset` adds `devops-terminal`, `hormozi-pop` and `minimal-pill` styles in Captions → Style. Unit-tested. |
| Export | Thumbnail PNG export (1280×720) | implemented | `snapshotThumbnail` exports a 1280×720 PNG from the transport bar or Export page. |
| Export | Shorts/Reels export preset (1080×1920, 60 s cap, size check) & Marker segment picker | implemented | `shorts-vertical` preset enforces 60 s duration and 60 MB size warnings in `planBitrate`; Markers tab and Export page extract marker-to-marker segments for Shorts. Unit-tested. |
| Edit | Layer blend modes, PiP corner presets & shadow/glow presets | implemented | `setClipBlendMode` (`normal`, `screen`, `multiply`, `overlay`), `applyPipPreset` (6 placements), `applyShadowGlowPreset` (5 shadow/neon styles), `soloTrack`, `unmuteAllTracks`, `closeTrackGaps`. Unit-tested. |
| Audio | Procedural SFX generator, voice mastering presets & music-bed ducking | implemented | `src/audio/sfx.ts` synthesizes 6 PCM WAV creator SFX (`whoosh`, `pop`, `ding`, `keyclick`, `riser`, `success-chime`) locally; `applyVoicePreset`, `applyAudioFades`, `prepareMusicBedTrack`, `normalizeClipGain`. Unit-tested. |
| Edit | Colour grading looks, vignette & Screen Studio frame | implemented | `applyColorLookPreset` (7 looks), `setClipVignette`, `applyScreenStudioFrame` (inset desktop frame over studio backdrop), `addProgressBarOverlay`, `addChapterBumpersFromMarkers`. Unit-tested. |
| Edit | Batch transitions, Ken Burns drift, spotlight mask, click pulse & camera corner cycling | implemented | `applyTransitionToAllCuts`, `addKenBurnsDrift`, `addSpotlightMask`, `addClickPulse`, `cycleCameraCornersOnMarkers`. Unit-tested. |
| Edit | Step badges, alert banners, social follow pills, topic ticker & countdown overlay | implemented | `addStepBadge`, `addAlertBanner`, `addSocialFollowPill`, `addTopicTicker`, `addCountdownOverlay`. Unit-tested. |
| Export | Instagram 1:1 & 4:5 reframes, 4K60 master preset, auto markers & pacing audit | implemented | `reframe1x1` (`1080×1080`), `reframe4x5` (`1080×1350`), `insta-square-1080`, `insta-portrait-4x5`, `4k60-master` export presets, `generateMarkersFromCaptions`, `auditVideoPacing`. Unit-tested. |
| Edit | Presenter layouts, transforms and keyframes | implemented | Bubble/rounded/square/portrait-card/full, side-by-side; shadow, outline colour, mirror, experimental chroma key; manual zoom/pan; safe areas for 16:9, 9:16, 1:1. |
| Edit | Automatic chroma key / segmentation | experimental | Capability-gated and off by default. Manual masks always work; no redaction guarantee. |
| Audio | Voiceover, punch-in takes, processing chain | implemented | Record against playback, keep takes, HPF/EQ/compressor/limiter/ducking; preview and export share the chain. |
| Audio | LUFS loudness metering | unavailable | Peak and RMS only; no metric is mislabelled as LUFS. |
| Captions | Local Whisper transcription | implemented | Transformers.js in a module worker; model size disclosed and cached. |
| Captions | Word-level highlighting | experimental | Only with real word timings from the model; no synthetic highlight. |
| Captions | SRT/VTT import, export and retiming | implemented | Issue-reporting parser, find/replace, glossary, line rebalancing, silence cuts, burned-in or sidecar. |
| Export | Deterministic offline render | implemented | One composition model for preview and export; integer timestamps. |
| Export | H.264 MP4 delivery | implemented | WebCodecs + Mediabunny; VP9/WebM only when probed unsupported, and stated. |
| Export | VP9 / AV1 / HEVC delivery | experimental | Capability-gated per configuration; AV1 software encoding may be slower than real time. |
| Export | Exact target file size | unavailable | The budget calculator derives a bitrate; VBR output lands near the estimate, not on it. |
| Deployment | GitHub Pages without COOP/COEP | implemented | No SharedArrayBuffer requirement; FFmpeg.wasm is optional, not a dependency. |

## Explicit non-claims

- No "universal 4K": the target is a request, and the delivered resolution and
  frame rate are displayed from the track after capture.
- No guaranteed file sizes, no guaranteed bitrate accuracy, no guaranteed
  transcription accuracy.
- No automatic redaction of secrets on screen.
- No cloud processing, no accounts, no analytics.
