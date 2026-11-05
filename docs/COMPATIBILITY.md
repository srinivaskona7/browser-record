# Compatibility and fallbacks

| Capability | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Screen capture | yes (`getDisplayMedia`) | yes, picker differs | yes, picker differs |
| System tab audio | only if the picker returns the track (often whole-screen: no) | limited | limited |
| Camera + microphone | yes | yes | yes |
| MediaRecorder segmented capture | yes | yes | yes, codec support differs |
| WebCodecs encode/decode | yes | partial/behind flags in some versions | partial |
| File System Access directory picker | yes | no | no |
| OPFS | yes | yes | yes |
| OffscreenCanvas | yes | yes | yes |
| Transformers.js (WASM) | yes | yes | yes |
| Persistent storage request | yes | yes | yes |

Fallbacks, in the order the app tries them:

| Need | First choice | Fallback | What the UI says |
|---|---|---|---|
| Workspace | Folder via File System Access | OPFS | Storage mode is shown; OPFS is labelled as browser storage |
| Container | H.264/MP4 via WebCodecs | VP9/WebM if H.264 is rejected | The chosen codec is shown after probing |
| Audio container | AAC where supported | Opus in WebM | The pairing is chosen from probes, not assumed |
| Transcription threads | Multi-threaded WASM if available | Single-threaded WASM | Works on Pages without COOP/COEP |
| Rendering | Canvas 2D composition | — | No WebGL requirement |
| Screen audio | Track from picker | Microphone only | Caption says system audio was not returned |

## What has been tested in which environment

See [`TEST_REPORT.md`](TEST_REPORT.md). Automated tests run in Node/jsdom and
cover pure logic. Capture, WebCodecs encode/decode, File System Access and
transcription require a real browser and device and are **not** exercised by the
automated suite; they must be verified manually as described there.
