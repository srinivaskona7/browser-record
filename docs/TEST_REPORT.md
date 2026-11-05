# Test report

Run on 2026-11-03 in this workspace (macOS, Node 26, jsdom environment).

## Commands and results

```
$ npm run typecheck     # tsc --noEmit, strict, noUncheckedIndexedAccess
(no output, exit 0)

$ npm run lint          # eslint .
0 errors, 15 warnings (React Compiler advisory rules + exhaustive-deps)

$ npm test              # vitest run
Test Files  15 passed (15)
     Tests  123 passed (123)

$ npm run build && npm run smoke
vite v8 build, ✓ built
smoke: 6 asset(s) verified under base "/" in …/dist

$ BASE_PATH=/research/ npm run build && npm run smoke
vite v8 build, ✓ built
smoke: 6 asset(s) verified under base "/research/" in …/dist

$ npm run build:cloudflare
9 files checked, largest 6.32 MiB (under the 25 MiB Pages limit),
wasm gzip-prepared, _headers written
```

## What each file covers

| File | Tests | Covers |
|---|---|---|
| `tests/time.test.ts` | 7 | Integer timebase: exact frame boundaries at 24/25/30/50/60, one-hour round trip, 29.97 rational rounding, quantize, 44.1/48 kHz, timecode round trip and malformed rejection |
| `tests/ops.test.ts` | 9 | Split, linked A/V split, ripple delete, overwrite, insert, locked tracks, frame count, relink repairing an asset without moving clips |
| `tests/serialize.test.ts` | 5 | Round trip, v1→v3 migration defaults, newer-schema rejection, malformed JSON, missing canvas |
| `tests/subtitles.test.ts` | 11 | SRT/VTT parsing with issue reporting, format detection, millisecond-exact serialization, word-timed VTT, retime/scale/rebalance/merge/find-replace/punctuation |
| `tests/captions.test.ts` | 7 | Chunk planning and coverage, dedupe of overlaps, stereo→mono, glossary apply/suggest, filler detection/removal |
| `tests/presets.test.ts` | 6 | 1 hour × 4 Mbps ≈ 1.8 GB, target-size → bitrate, audio larger than target, bits/pixel warning, decimal units, 4K preset range, sample window inside project |
| `tests/layout.test.ts` | 15 | Contain letterbox/pillarbox, cover, zoom/pan, crop-before-fit, rotation, presenter bubble in every corner and clamped sizes, square vs rounded corners, 3:4 portrait card, side-by-side, `fitInside`, safe area, easing |
| `tests/workspace.test.ts` | 23 | Layout creation, save/reopen/list, atomic write, SegmentWriter committed-vs-appended accounting, recovery gap, multi-commit append, an append during a closing commit (the "closing writable stream" crash), binary write, legacy media repair, missing-asset flagging, take deletion (including a second delete), whole-project deletion (including takes, sibling projects and refusal of names the app does not own), a read-only existence check never recreating a deleted folder, cleaning unreferenced takes while keeping referenced ones and unmanaged folders, cross-root `copyFile`, whole-take `copyTree` (including a take not yet on the timeline), a missing `recordings/` directory detected without creating it, and `takeIdsOf` resolving relative, absolute and segment asset paths |
| `tests/benchmark.test.ts` | 3 | Every encoded chunk is decoded back with the encoder's own decoder configuration, so the benchmark is a real round trip; an encoder error is reported instead of thrown from the callback; missing WebCodecs is stated |
| `tests/bootstrap.test.ts` | 14 | Project metadata is persisted before the call returns, one creation promise is shared by concurrent callers, a remembered folder or open project is reused, an unsupported import creates nothing, route parsing, temporary-vs-saved session wording, canvas→capture-target and 1080p-below-4K bitrate defaults, timeline append point, stable folder name |
| `tests/codecs.test.ts` | 2 | WebCodecs video strings map to the mediabunny families, and AAC-LC maps to the audio family the muxer accepts |
| `tests/media.test.ts` | 2 | A still image gets a usable timeline duration (5 s) instead of zero ticks; a video keeps its real duration |
| `tests/recorder.test.ts` | 6 | Interrupted take listing, committed/uncommitted byte accounting, loss window, recovery status persistence, missing media warning, asset rebuild |
| `tests/session.test.ts` | 6 | Last-session preference round trip, partial patch, corrupt value, revision-safe `markSaved` (clean only for the revision written, still dirty after an edit during save, and not marked clean by another project's save) |
| `tests/sources.test.ts` | 3 | `prepareFrameSources` returns resolved sources, names undecodable assets, and treats a throwing resolver as missing instead of aborting the frame |

Two real defects were found by these tests and fixed:

1. WebVTT timing lines with spaces around `-->` produced an empty end timestamp
   (the parser split on a literal space before trimming), so valid VTT was
   rejected. Fixed in `src/captions/subtitles.ts`.
2. `SegmentWriter.committed` returned the number of bytes *appended*, not the
   number flushed by `close()`, overstating durable data between commits. It now
   tracks committed and appended offsets separately.

A third fix: the in-memory filesystem used `instanceof Uint8Array`, which is
false across realms (jsdom), so writes failed in tests and would fail in a
worker-like realm. It now uses `ArrayBuffer.isView`.

## Browser verification (Chromium, 2026-11-02)

Driven through the DevTools protocol against the production build served at
`http://localhost:4173/`:

- All five routes render; codec probes return real per-codec results.
- Connect to browser storage → create/open a project → reload: the workspace
  chip, the project and the Edit route all come back, and Record/Edit/Export
  are enabled (defect 1 below).
- Full page navigation to `#/export` → reload stays on Export with the project
  loaded, so a deep link is not hijacked by the restore path.
- Record page at 1512 px and 390 px wide: the share-surface select, the camera
  style panel and the live preview overlay all render without clipping. Setting
  the shape select to each of the four values was read back from computed style:
  circle `border-radius: 50%`, rounded `10px`, square `0px`, portrait `3 / 4`
  with radius `14px` and a 0.75 width/height ratio — the same branch
  `presenterBubble` uses for export.
- **Real takes were recorded in Chromium and checked on disk.** A screen +
  camera + microphone take (3840×2160 composition, 3340×2160 screen, 1080×1920
  camera) wrote `screen.webm` 13.0 MB, `camera.webm` 72.5 MB and
  `microphone.webm` 706 KB; a camera + microphone take wrote 35.7 MB / 350 KB.
  Reading `camera.webm` back through a `<video>` decoded 1080×1920 and a frame
  with mean luma 117 (not black). The editor preview at 2 s draws that screen
  frame with the presenter bubble composited in the corner. The screen picker
  itself was answered by the user, not by the automation.
- **The live recording bar** was observed during a 70 s take: red REC, running
  timer, live mic level (−41 dBFS with a moving meter), per-source byte chips,
  and Pause / Marker / Discard / **Stop & keep** pinned at the top of the page.
  The take crossed seven 10 s commit boundaries with both assets still
  `recording` and no error, then finalized to `00:01:42 · 2 assets · 218 MB`.
  (This run predates the 2026-11-03 floating dock; the bar now sits at the
  bottom and the per-source figures live in the Take panel. See the synthetic
  capture section below.)
- **Discard deletes the take's files.** After discarding an abandoned take the
  folder was gone and browser storage dropped from 1993 MB to 276 MB.

### Edit page, voiceover and clean-up (2026-11-02, later run)

All of the following were driven through the DevTools protocol against the
production build served at `http://localhost:4173/`:

- **Editor preview repaints after load.** On a reload at t=0 the preview canvas
  read back 625 distinct colours within 352 ms, with all 11 assets at
  `readyState 4` and no media errors. Before the fix the same readback was a
  single background colour.
- **The playhead on the project end holds the last frame.** Jumping to
  `00:01:02:09` (exactly `durationTicks`) now draws 748 distinct colours instead
  of the bare background, because clip lookup is end-exclusive.
- **Voiceover round trip.** Enabled the built-in microphone from the dialog,
  recorded 1.6 s, pressed **Stop & save**: `media/originals/voiceover-<stamp>.webm`
  (33,945 bytes) appeared in OPFS, the asset gained a 1,166,400-tick duration, and
  a clip was placed on the `Narration` track, extending the project to 63.92 s.
- **Clean all unused recordings.** With every take referenced the dialog reads
  "Every take under recordings/ is used by the current timeline" and the delete
  button is disabled. This run is what exposed the `takeIdsOf` bug below: before
  the fix it reported 0 of 4 takes referenced and would have deleted live media.

Still not verifiable from the DevTools protocol: the native surface picker and
the camera permission prompt. The picker was answered by the user during the
run above; nothing here claims automation can select a surface.

## Defects fixed after review (2026-11-02)

1. **Reload lost the session.** Only File System Access handles were restored;
   OPFS workspaces and the open project folder were never persisted. Now the
   last storage mode and project folder are stored, OPFS is reopened when it was
   the last mode, and a deep-linked route is preserved.
2. **Autosave could claim a save it did not make.** `markSaved()` cleared
   `dirty` for edits made while the save was in flight. It now takes the
   revision that was written and keeps the project dirty otherwise, and a new
   autosave is scheduled.
3. **A failed decode produced a silent blank export.** Unresolvable assets are
   now collected per frame and reported as a named warning (frames affected and
   reason), and a throwing resolver is treated as missing rather than aborting
   the frame.

Smaller honesty fixes in the same pass: duplicate-project reports media files it
could not copy, a cancelled export says so when the partial file could not be
removed, and a failed `.bak` write aborts the overwrite instead of being
reported as "no previous file".

## Defects found while recording for real (2026-11-02)

1. **A take died mid-recording with "Cannot write to a closing writable
   stream".** `SegmentWriter.commit()` closed the writable while a
   `MediaRecorder` data event could still be appending. Every append/commit/
   abort now runs through one queue and the handle is released before `close()`
   is awaited. Regression test in `tests/workspace.test.ts`.
2. **Take media was written outside the project folder.** The recorder wrote
   `<folder>/recordings/…` at the workspace root while the project read
   `projects/<folder>/recordings/…`, so a recorded take was unusable and
   Discard deleted only the manifest. `projectBase()` in `src/capture/recorder.ts`
   now writes where the project reads.
3. **Imports, relinks and voiceovers had the same path bug.** They wrote to the
   workspace-root `media/originals` while every reader resolves
   `projects/<folder>/<path>`. All three now write through
   `projectPath(folder, path)`.
4. **Existing takes stayed broken after the path fix.** `loadProject()` now runs
   `repairProjectMedia()`: media found at a legacy location is copied into the
   project folder, and anything genuinely absent is marked `missing` so the
   media bin stops presenting it as present. This recovered all three earlier
   takes in the test project, including a 72 MB camera file.
5. **Discarding a take left its files on disk.** `CaptureSession.discard()`
   aborts the writers but never deletes the folder, and the Record page did not
   either — a long camera take left 1.7 GB behind. The page now calls
   `deleteTake()` and reports a failure instead of dropping it silently.
6. **Still images became zero-length clips.** `assetFromFile` copied the probe's
   `durationSeconds: 0`, so an imported image never appeared in preview or
   export. Images now get a 5 s default (`DEFAULT_IMAGE_DURATION_SECONDS`),
   applied on import and on relink.
7. **No live feedback while recording.** The Record page now has a pinned
   recording bar (REC dot, timer, mic level, per-source bytes, Pause / Marker /
   Discard / Stop & keep), a countdown over the monitor, and a REC tag on the
   monitor. The microphone meter now also runs during the take, not only after
   "Test microphone".
8. **Clean all unused recordings would have deleted live media.** `takeIdsOf`
   matched `/recordings/<id>/` with a leading slash, but asset paths are stored
   relative to the project folder (`recordings/take_x/screen.webm`), so it
   reported zero references for every project. The Record page read that as
   "all four takes unused". Fixed to `(?:^|/)recordings/<id>/` and moved to
   `src/workspace/takeRefs.ts`; three tests cover relative, absolute and
   segment paths. Verified failing against the old regex before being accepted.
9. **The editor preview stayed black until the playhead was dragged.** Loading
   attached media but never sought or waited for a drawable frame, so the first
   paint had nothing to draw. `PreviewPlayer.load()` now settles the active clips
   and raises `onReady`, which bumps a `revision` prop on the canvas. The player
   also takes `updateProject()` so trims and mutes apply without a reload, and
   the preview holds the last frame when the playhead sits on the project end.

## Defects found while exercising Record and Delete (2026-11-03)

10. **Start recording did nothing in development.** Under React StrictMode the
    mount effect ran mount → cleanup → mount; the cleanup set `mountedRef.current
    = false` and the effect body never set it back, so `start()` aborted silently
    after acquiring all sources. The ref is now re-armed in the effect body.
11. **`navigator.wakeLock.request()` could stall the take forever.** The promise
    was awaited with no bound; where the API is present but never settles,
    `start()` hung after the streams opened. It now races a 1.5 s timeout and a
    missing lock is a warning, not a failure.
12. **The take panel kept reporting a dead take.** After Stop & keep the last
    live stats stayed on screen (REC, 0 B committed). Stats are now cleared when
    a take finishes.
13. **Deleting a project could resurrect it as an "unreadable" row.**
    `fileExists()` went through `resolveFile()`, which created parent
    directories as a side effect, so the editor's next asset check re-created
    the folder it had just deleted. Parent directories are now created only when
    the caller asked for a writable file; a regression test asserts that a
    missing-file check leaves the project list empty.
14. **A save could undo a delete.** The delete waited for an in-flight save, but
    that save re-armed the debounce timer afterwards, so a second autosave could
    fire while the folder was being removed and write `project.json` back into
    it. Autosave is now blocked for the duration of the delete and resumed (for
    unsaved edits) afterwards.
15. **The project card swallowed Enter on its Delete button.** The card was a
    `role="button"` containing the Delete button, so keydown bubbled and opened
    the project instead of the dialog. The card now uses an explicit **Open**
    button, which also removes the nested-interactive markup.
16. **"Import project" opened the media picker** when a workspace was connected,
    because only the no-workspace branch was pointed at the bundle input. JSON
    bundles are reachable again.
17. **A late wake-lock request leaked.** If the 1.5 s timeout won and the
    request resolved later, nobody held or released the sentinel. A generation
    counter now releases a sentinel that arrives after its take ended.

## UI defects found by design review (2026-11-04)

18. **The take-complete dialog clipped its own actions.** Five buttons in a
    fixed 560 px, non-wrapping footer put "Discard this take" and "Record
    another take" outside the dialog at every width, and three actions off-screen
    at 390 px. Dialog footers now wrap; measured at 390 px with the delete
    dialog, both actions are inside the viewport.
19. **Start was ~700 px below the fold and the countdown played off-screen.**
    Start is now a fixed dock (full-width on narrow screens) and the countdown
    covers the viewport instead of the scrolled-away monitor.
20. **Disabled capture selects looked enabled**, and quality/frame rate stayed
    editable mid-take. Selects dim when disabled, and both are locked once the
    stage leaves idle.
21. **Smaller readability fixes:** helper text raised to WCAG AA contrast; the
    camera's frame-rate mismatch no longer appears in the Audio column; both
    Record tables scroll horizontally instead of overflowing; all seven selects
    have accessible names; the monitor explains its black state; the topbar and
    recording bar no longer overflow or wrap into five rows at 390 px.
22. **"Save to a folder…" wrote into the source workspace, not the chosen
    folder.** `copyFile` took a single root, so the destination root argument was
    ignored and the media was copied onto itself; only `project.json` reached the
    new folder. Exporting that copy reported "file could not be found" for every
    frame and a missing microphone track. `copyFile` now takes separate source
    and destination roots, and the whole `recordings/` tree is copied so a take
    that finished but was not inserted yet moves with the project. Two tests
    cover a cross-root file copy and a take tree copy.
23. **An import-only project reported a copy failure that never happened.** Such
    a project has no `projects/<folder>/recordings/`, so `copyTree` threw
    `NotFoundError` and the user saw "Could not copy the recordings folder" next
    to the success toast. The copy now checks `directoryExists` first and skips
    a folder that was never created. A failed recordings copy also aborts the
    switch now: the app stays in the original workspace and says so, instead of
    pointing the session at a destination whose media is missing.
24. **Choosing a folder left `project.json` behind.** `chooseFolderWorkspace`
    switched the session to the new folder but never saved the open draft, so a
    reload could not find the project that owned the take. It now writes the
    draft into the chosen folder before returning, and refuses to switch at all
    when the project already has media (which must be copied, not abandoned).
25. **The folder button could strand a finished take.** "Choose a folder for
    this session…" only checked for timeline assets, so after "Record another
    take" it switched workspaces while the kept take stayed in the old one. It
    is now hidden whenever takes exist or a finished take is awaiting a choice.
26. **The dock dropped Discard and its dialog became unreachable.** Removing the
    button left `setDiscardOpen(true)` with no caller, so a running take could
    only be saved and deleted afterwards. Discard is back in the dock; the
    dialog and `discard()` are reachable again.
27. **The dock's live region announced the timer every second.** `role="status"`
    wrapped the full status row, so a ten-minute take queued ~600 polite
    announcements and delayed REC/PAUSED/SAVING. Only the state word is a live
    region now; the timer is `aria-hidden` (still visible, still tabular).
28. **At 390 px the dock hid the state word.** `.rec-state` and `.field-hint`
    were `display:none` under 640 px, so PAUSED and SAVING were invisible and
    unannounced during the flush. The state word stays at every width; only the
    explanatory hint is hidden on narrow screens.
29. **Mute announced contradictory state.** `aria-pressed` plus a Mute/Unmute
    label produced "Unmute, pressed" for a muted mic. The label and `aria-label`
    now name the action ("Mute the microphone" / "Unmute the microphone").
30. **A toast could cover the dock's Stop button.** `.toast-stack` is fixed at
    the bottom with a higher z-index; a save warning raised during a take sat on
    top of the controls. Toasts now lift above the dock (104 px desktop,
    118 px mobile) while a take runs.
31. **The dock's chip and Stop styling failed contrast.** Stop was an outlined
    red button inside a red-bordered bar (2.5:1 edges) and Marker/Mute were bare
    text between chipped siblings. Every action is now the same chip and Stop is
    the only filled red button; the dock border is neutral. Touch targets are
    44 px at ≤640 px (they were 30 px).

## Feature added in the same pass: delete a project

The user asked for deletion after editing. `deleteProject(folder)` removes the
whole `projects/<folder>` tree and accepts only folder names the workspace
actually lists, so `..`, `../media` and names that do not exist are refused
before anything is touched. It is reachable from two places with the same
confirmation dialog (`DeleteProjectDialog`): the project card in the project
list and the editor's Project settings tab. If the deleted project was open, the
session closes it, clears it from the last-session preference and returns to the
project list. Exports saved outside the folder are untouched, and the dialog
says so.

## Browser verification, synthetic capture (2026-11-03/04)

A Playwright context with `getDisplayMedia`, `getUserMedia` and
`enumerateDevices` replaced by `canvas.captureStream(30)` / oscillator streams
exercised the whole path without a native picker:

- REC → PAUSE → RESUME → Stop & keep produced a finished take (10 s, 3 assets,
  521 KB) and "Edit recording" placed three clips on Screen, Camera and
  Narration, sharing one `linkId`.
- The editor preview composited the presenter bubble over the screen: the
  canvas centre read the screen's blue and the bottom-right read the camera's
  maroon, and the screenshot showed a round bubble over the screen frame.
- Delete was exercised from the project card and from Project settings; both
  removed the folder and its takes and left sibling projects alone.
- During a live take the monitor showed the shared screen with the camera bubble
  composited on top (red CANVAS bubble bottom-right over the blue screen), plus
  the REC tag and running timer; both the screen `<video>` and the bubble
  `<video>` had live `srcObject` streams.
- The Record page prints the raw-footage path
  (`<workspace>/projects/<folder>/recordings/<take>/`) and offers "Choose a
  folder for this session…" / "Save recordings to a folder…", disabled during a
  take.
- The in-monitor camera bubble preview is in the document for the entire
  countdown → recording → paused → finishing lifecycle whenever Camera is on
  (and only then).
- A second, viewport-fixed self-view (`.rec-selfview`, 148 px desktop / 96 px
  mobile, same shape, corner radius, border and mirror setting) shows the same
  camera stream during a take. Scrolling the Monitor out of sight left the
  self-view on screen with a live `srcObject` (640×360, playing).
- The recording controls are a floating dock (`role="group"`
  "Recording controls"): REC dot, live timer, Pause/Resume, Marker, Discard,
  Mute/Unmute and Stop & keep, all rendered as the same chip and Stop as the one
  filled red button. At 1280×800 it was one 532×48 px pill at the bottom centre;
  at 390×844 it wrapped to two rows with every control inside the viewport
  (44 px tall, Stop right edge 373 px, no horizontal scroll).
- Mute toggled the microphone track's `enabled` flag (recording continues, that
  span is silent) and relabelled the button Mute ↔ Unmute with a matching
  `aria-label`.
- The dock's live region wraps only the state word (REC / PAUSED / SAVING), so
  the per-second timer does not queue screen-reader announcements; a toast
  during a take is lifted above the dock instead of covering Stop.

**What this does not prove:** the stub satisfies the browser API but not the
real picker. Selecting an actual screen, window or tab, the delivered resolution
and frame rate, and system-audio presence on a real surface remain unverified
here. See "Not covered" below.

## Not covered by the automated suite

These require a real browser on real hardware; no result is claimed for them:

- **The real `getDisplayMedia` picker** — choosing a screen, window or tab, the
  delivered resolution/frame rate, and whether the surface returns a system
  audio track. The 2026-11-02 run had the user answer the picker; nothing here
  claims automation can select a surface.
- Camera and microphone permission prompts on a new profile.
- `MediaRecorder` segment sizes and the actual loss window after killing a tab.
- WebCodecs encode/decode round trips on the user's GPU; the in-app benchmark is
  the measuring instrument and its result is device-specific.
- File System Access folder picking, permission persistence and relinking in a
  fresh profile.
- Transformers.js model download, transcription accuracy and timings.
- Playwright UI tests are not in the repository. Browser checks above were
  driven ad hoc through the DevTools protocol; CI runs typecheck, lint, unit
  tests and the build only.

## Measured samples

- **H.264/MP4 export round trip (2026-11-03).** A 2 s sample export produced
  `.mp4`: H.264 640×360, 60 frames, duration 2.000000 s, AAC 48 kHz stereo
  2.025 s, 1.27 MB. Frame 30 decoded to the real bars with burned-in timecode;
  no black frames and no muxer warnings. This is a small synthetic composition,
  not a 4K lesson; it proves the pipeline, not a 4K encode rate.
