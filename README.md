# Browser 4K Studio

A browser-first, local-only recording and editing studio for technical
instructors: terminal lessons, Linux/DevOps walkthroughs, cloud consoles and
whiteboard talks. It records the screen, camera and audio, writes them to a
workspace you choose, and edits and exports the lesson — all on your machine.

No account, no upload, no paid API, no desktop app and no extension. Record and
Edit work from a cold start: clicking either one prepares a temporary local
session in browser storage, and importing media creates the project it needs.
The static build deploys to GitHub Pages or Cloudflare Pages and needs no
COOP/COEP headers.

- Live demo shape: a static Vite build, base path configured at build time.
- Source, tests and the GitHub Actions pipeline are in this repository.
- Honest capability list: [`src/ui/CapabilityMatrix.tsx`](src/ui/CapabilityMatrix.tsx),
  rendered on the in-app Diagnostics page and mirrored in
  [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).

## Run locally

```bash
npm ci
npm run dev          # http://localhost:5173
```

Requirements: Node 20+ (CI uses 22) and a Chromium-based browser for the full
feature set. Firefox and Safari start, but recording and export fall back as
described in [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).

```bash
npm run typecheck    # tsc --noEmit, strict
npm run lint         # eslint, 0 errors
npm test             # vitest, 191 tests
npm run build        # typecheck + vite build (ordinary local build)
npm run smoke        # verify dist asset paths (run after build)
npm run check        # all of the above except smoke
npm run build:cloudflare  # check + build + gzip WASM + verify Pages limits
```

## The workflow

1. **Start without setup** — the landing page offers *Start recording* and
   *Import a video*. Neither needs a project, a workspace or an account.
   Storage is prepared automatically: a remembered folder if its permission is
   still granted, otherwise an OPFS workspace that the UI labels as
   browser-managed and evictable. Choose a folder whenever you want a durable
   copy. The studio creates `projects/`, `media/originals/`, `media/proxies/`,
   `captions/`, `recordings/`, `exports/` and `backups/`.
2. **Record** — clicking Record opens the controls immediately. Pick screen,
   camera, microphone and system audio (each only if
   the browser actually returns a track), choose the surface to ask for (entire
   screen, a window or a browser tab — a picker preference, like Meet or Teams),
   pick devices, watch the meters, set a countdown, then record. The camera has
   a live presenter preview: round bubble, rounded square, square or 3:4
   portrait card, any corner, size, shadow, outline colour, mirror and an
   experimental chroma key. Segments are committed to disk every 5–30 s.
   While a take runs, a recording bar stays pinned at the top with the REC
   timer, the live microphone level, the bytes written per source, and Pause,
   Marker, Discard and **Stop & keep**; the countdown covers the monitor and a
   REC tag sits on the live preview. Discard during a take deletes that take's
   files. When a take ends the dialog offers **Edit recording** (insert the
   take and open the editor), **Download originals** (each source file labelled
   separately — not a composited export), **Record another take** (keep the
   files on disk without inserting them), **Save to a folder…** and **Discard
   this take** (delete only that take's files). All source clips of one take
   share a link id, so moving or splitting one keeps screen, camera and
   microphone on the same cut.
3. **Edit** — opening Edit with nothing loaded shows an import drop-in: choose a
   video/audio file, open a recent project, or start a recording. An import
   creates the project from the source metadata (1080p/30 unless the video says
   otherwise), writes the file to `media/originals/`, places it on the timeline
   and, for a video with sound, adds a linked audio companion so the sound
   survives preview and export. The timeline has frame stepping, linked A/V cuts, trim,
   ripple/insert/overwrite, markers, undo/redo, presenter layouts, manual zooms,
   colour and transforms, audio chain and voiceover takes, captions and
   transcript. The camera bubble is composited over the screen in both preview
   and export. When a lesson is finished, delete it from the project card or
   from Project settings: the dialog names the take folders and originals it will
   remove, leaves other projects and exports alone, and closes the project if it
   is open.
4. **Export** — choose a delivery preset or a target size, see a derived
   bitrate (decimal GB), run a 6-second sample, then export offline to a file in
   the workspace. Existing files are never overwritten silently.

## Local-only guarantees

- Media stays where it was recorded; originals are never deleted or rewritten.
  Moving a session to a folder copies every referenced original instead of
  moving it.
- The project manifest (`project.json`) stores **relative** paths only and is
  written before the first recording segment.
- Browser storage is never described as safely saved to disk: the top bar shows
  *Temporary session* whenever media lives in OPFS, and the Record and Export
  pages say the browser can evict it.
- Transcription runs in a module worker with Transformers.js on this machine.
  Model files are downloaded from the Hugging Face CDN on first use, with the
  size disclosed, and cached by the browser. No audio is uploaded.
- The app has no analytics and no server component.

## Deploying to Cloudflare Pages

Build command (Pages settings or CI):

```bash
npm run build:cloudflare
```

Output directory: `dist`. Nothing else is required — no environment variables
for a root deployment, no functions, no bindings.

`scripts/build-cloudflare.mjs` runs after the normal check/build and:

- discovers every emitted `dist/**/*.wasm` file (no content hash is hard-coded),
- gzips it in place (`dist/assets/ort-wasm-simd-threaded.asyncify-*.wasm` goes
  from ~26.9 MB to ~6.6 MB, under the 25 MiB per-file limit),
- decompresses each result and requires byte-for-byte equality with the original,
- writes `dist/_headers` entries for exactly those files:
  `Content-Type: application/wasm` and `Content-Encoding: gzip`, preserving any
  existing rules and replacing only its own marked block,
- fails if any file in `dist` still exceeds 25 MiB.

It is idempotent: an already-gzipped file is verified, not gzipped twice.
`npm run verify:cloudflare` runs the same preparation on an existing `dist`
(CI uses it after `npm run build`). The workflow is
[`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml);
it needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, which are
never committed. **Pushing and deploying remain manual actions for you.**

If gzip headers ever prove unreliable in front of the Pages CDN, the honest
alternative is to serve the WASM uncompressed and split the transcription model
into smaller assets; that costs the on-device transcription size budget, so the
gzip path is verified on every build instead of assumed.

## Deploying to GitHub Pages

The workflow is [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
It runs `npm ci`, a typechecked production build with
`BASE_PATH=/<repository-name>/`, the static-path smoke test, then
`upload-pages-artifact` and `deploy-pages`.

**One manual step is yours:** repository Settings → Pages → Source must be
**GitHub Actions**. Then push to `main` (or run the workflow from Actions).
Deployment is deliberately not triggered from this environment.

Routing uses hash URLs (`#/record`), so deep links and refreshes work on Pages
without server rewrites.

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Modules, timebase, determinism, storage, export pipeline |
| [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) | What is implemented, experimental or unavailable, with reasons |
| [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) | Browser support and fallbacks |
| [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) | Test commands, counts and what is *not* covered |
| [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) | Limits and prioritised follow-ups |
| [`LICENSE`](LICENSE) | MIT for this source |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Dependency licences |

## What this is not

- It cannot read OS-wide cursor position or clicks outside the page; zoom is
  manual or keyframed. No telemetry is fabricated.
- New projects start at 1080p/30. 4K is an explicit choice; capture is native
  only when the captured surface is 3840×2160, and smaller displays are
  upscaled and labelled as scaled.
- There is no automatic redaction guarantee. Masks are manual.
- There is no LUFS loudness meter; peak and RMS only.
- Target file size is an estimate from a derived bitrate, not an exact size.

## Creator workspace

The editor has a searchable tool rail, catalog tile libraries for text/effects/transitions/filters/LUTs, clip quick actions, canvas presets and a collapsible inspector. Record offers compact source cards and expandable camera, storage and quality controls. See [Edits and Cap parity](docs/EDITS_PARITY.md) for inspection evidence, implementation mapping and remaining gaps. Matching catalog counts does not imply identical rendering or complete app parity.

The compact recorder provides **Open editor** and **Import media** directly. **Open editor when recording stops** is on by default: Pause/Resume remain available during capture; **Stop & edit** finalizes and appends the take, selects it and opens the editor at its start. Turn the option off for **Stop & review**. Takes with recorder warnings stay in the review dialog. The editor toolbar also provides Import media and Record.
