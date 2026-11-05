# Known limitations and follow-ups

## Limits

1. **Display capture is a request.** A 4K target on a 1080p display captures
   1080p and is labelled scaled. The UI reports the track's applied settings.
2. **System audio is browser- and platform-dependent.** Chrome commonly omits
   it for whole-screen capture; the app only claims audio when a track exists.
3. **Crash loss window equals the segment interval** (5–30 s). Committed bytes
   survive; the open segment is lost. This is stated in the recovery dialog.
4. **No cursor telemetry outside the page.** Zooms are manual or keyframed.
5. **Segmentation/chroma key is experimental** and capability-gated; manual
   masks are the reliable path and there is no redaction guarantee.
6. **Loudness is peak/RMS only.** No LUFS number is displayed.
7. **Target size is an estimate.** VBR output can land above or below it.
8. **AV1/HEVC availability varies.** AV1 software encoding can be slower than
   real time; HEVC is not offered when the encoder is absent.
9. **Transcription accuracy and language coverage** depend on the model chosen
   and the audio; word timings exist only when the model returns them.
10. **OPFS is not an archive.** The browser may evict it; persistent storage is
    merely requested.
11. **Initial transcription assets are heavy** (worker chunk ~591 kB plus a
    ~27 MB WASM file, gzip ~6.8 MB), loaded only when transcription starts.
12. **Deleting a project is permanent.** There is no trash and no undo; the
    confirmation dialog names what is inside the folder and what is not
    (exports saved elsewhere). Files can only be recovered if the workspace is
    a folder that has an external backup.
13. **Automated capture verification uses synthetic streams.** The record →
    edit → export path was driven with stubbed `getDisplayMedia`/`getUserMedia`.
    Choosing a real screen, window or tab, the delivered capture settings, and a
    real "save to a chosen folder" round trip remain unverified by automation.
14. **Entire-screen sharing captures this page too.** The camera bubble is
    composited over the shared surface for the whole take, but when the shared
    surface is the whole monitor the Record page (including the Monitor preview
    and the floating self-view) is inside the captured pixels. Share a window or
    a browser tab to keep the app out of the recording; the UI states this next
    to "What to share".

## Prioritised follow-ups

1. Add a Playwright end-to-end test with fake media devices
   (`--use-fake-device-for-media-stream`) covering record → edit → export and
   asserting the output decodes.
2. Add a real exported fixture decoded in CI (WebCodecs in headless Chrome) so
   A/V timestamp correctness is proven, not just unit-tested.
3. Measure and publish a longer export (a real lesson at 1080p/4K) from a named
   device and browser. The 2 s sample is measured; a 4K encode rate is not.
4. Add a long-session memory test (30+ minute recording) that samples heap and
   the encoder queue.
5. Server-side-free project import from a zip, with the same migrations.
6. Per-clip caption styling controls beyond the project-level preset.
7. Optional FFmpeg.wasm fallback for containers the browser cannot mux, kept
   behind an explicit download and a size warning.
