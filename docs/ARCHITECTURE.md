# Architecture

## Shape

TypeScript + React 19 + Vite, strict mode. One project model drives both the
preview and the export; there is no separate "render for export" scene graph.

```
src/
  core/          integer timebase, ids
  project/       model, factory, ops, store (undo/redo), serialize + migrations
  workspace/     File System Access + OPFS + in-memory FS, layout, atomic saves,
                 segment writer, take manifests
  capture/       device enumeration, segmented MediaRecorder capture, meters
  audio/         offline mixdown, processing chain, asset preparation
  captions/      chunking, dedupe, glossary, SRT/VTT, Transformers.js worker
  render/        layout math, canvas composition, source decoding, text
  export/        presets and bitrate budget, Mediabunny muxing pipeline
  capabilities/  feature detection, codec probing, real encode benchmark
  ui/            Projects, Record, Edit, Export, Diagnostics, timeline, panels
  app/           session state, actions, autosave, handle persistence
```

## Time

`TICKS_PER_SECOND = 720_000`. It is divisible by 24, 25, 30, 50 and 60 fps and
by 44.1 kHz and 48 kHz sample rates, so frame and sample boundaries are exact
integers at every supported rate. Timecode parsing and frame stepping use the
same conversion functions; there is no floating-point accumulation in the
timeline.

29.97 and other rational rates use the `{num, den}` frame-rate pair and a
deliberate rounding rule tested in `tests/time.test.ts`.

## One deterministic render path

`render/compose.ts` exposes `renderFrame(project, frame, sources, target)`. It
resolves the frame's tick range, applies track order, clip transforms,
keyframes, masks, effects, presenters, captions and safe areas, and draws to a
canvas. Preview and export both call it:

- preview renders at display size on `requestAnimationFrame`;
- export computes `frameToTicks(frame, fps)`, prefetches the required source
  samples, calls the same `renderFrame`, then hands the canvas to a
  `CanvasSource`.

Because frame N is a pure function of the project at tick T, exporting the same
project twice produces the same frame sequence.

## Workspace and durability

- Folder-backed projects use the File System Access API. The project JSON is
  written atomically: temp file, then `move()` over the target where supported,
  otherwise a `.bak` copy plus an in-place write.
- Directory layout is human-readable and stable (`WORKSPACE_LAYOUT`).
- Recording writes bounded segments. `SegmentWriter` appends at an explicit
  position, closes the writable to flush, and only then advances its *committed*
  byte count and updates the take manifest. Bytes appended after the last close
  are reported as the loss window, never claimed as recoverable.
- `recoverInterruptedTake` reads the manifest, compares actual file size with
  committed bytes, rebuilds assets and marks the take `recovered`.
- OPFS is the fallback when folder access is denied. It is quota-checked and
  labelled as browser storage, not an archive.
- File handles are persisted in IndexedDB so a reload can offer to reopen the
  last workspace; permission is re-requested by the browser when needed.

## Audio

`audio/mixdown.ts` renders the whole mix with `OfflineAudioContext`, including
the processing chain and ducking, so export and preview hear the same result.
Preview plays that buffer; export feeds the same buffer to `AudioBufferSource`.
Voiceover takes are separate assets placed as clips.

## Captions

`captions/transcribe.worker.ts` runs Transformers.js in a module worker. Audio is
mono-downmixed, planned into overlapping chunks (`planChunks`), sliced, then
transcribed; `dedupeSegments` removes overlap repeats. Word timings are used only
when the model returns them. SRT/VTT parsing reports malformed blocks instead of
dropping them silently.

## Export

1. Choose codec support with `probeVideoEncoder` / `probeAudioEncoder` at the
   exact output configuration.
2. Derive bitrate from a preset or a target size
   (`bits = MB × 8000 / seconds`, decimal GB), with warnings for implausible
   budgets.
3. Create a Mediabunny `Output` to a `StreamTarget` backed by a file writable —
   no whole-recording Blob.
4. For each frame: render, add to `CanvasSource`; audio from the mixdown goes to
   `AudioBufferSource`.
5. Close the output, verify the file, and keep originals untouched. Cancel
   aborts the controller and removes the partial file.

## Deployment

- `base` comes from `BASE_PATH`, set by CI to `/<repository>/`.
- Hash routing avoids server-side rewrites.
- The baseline build does not use SharedArrayBuffer and therefore does not need
  COOP/COEP, which GitHub Pages cannot set. Transformers.js runs single-threaded
  unless the environment allows otherwise.
- `scripts/smoke-static.mjs` verifies every asset referenced by `index.html`
  exists under the configured base path and that no bundle requires
  cross-origin isolation.
