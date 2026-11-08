# Editing parity recheck — 2026-11-08

## Verdict and scope

Browser Record has broad editing feature coverage, but full Instagram Edits parity is not established. The older `EDITS_PARITY.md` uses “Completed” for implementation categories; those labels must not be read as equivalent behavior or visual fidelity.

This audit combines current repository source, the installed Edits connector's read-only `state`, `tools`, `listCatalogKinds`, and `getColor` responses, the local unit suite, and a Playwright browser run against the dev server. The reference returned an open 12-clip project and its real color model. No reference project was changed. This does not establish parity with the latest mobile release.

The 2026-11-08 release work below upgrades the biggest confirmed gaps — real color-grading controls, real 3D LUT evaluation and persistence, and direct canvas manipulation. Those upgrades are verified by unit and browser tests, not by side-by-side rendered comparisons.

## Comparison

| Area | Assessment | Evidence and remaining work |
| --- | --- | --- |
| Core timeline editing | Implemented; behavioral parity unverified | `src/project/ops.ts`, `src/ui/Timeline.tsx`, `src/ui/EditPage.tsx`: trim, split, move, delete, copy/paste, grouping, undo, track controls. Requires identical-media workflow comparison in both applications. |
| Catalog breadth | Counts match the live reference | `listCatalogKinds` returned 148 effects, 51 transitions, 77 filters, 16 LUTs, 77 text animations, 34 text presets, 39 caption styles, 8 speed curves, 406 fonts, 5 emphasis styles, 5 masks. `tests/effectsCatalogSuite.test.ts` asserts these same local counts. Counts do not establish item identity or rendered equivalence. |
| Color grading | Implemented; behavioral fidelity unverified | `src/project/types.ts` stores global/shadow/midtone/highlight wheels, eight HSL bands, and RGB/red/green/blue tone curves. `src/ui/ColorGrading.tsx` renders four wheel discs, eight band chips, and a tone-curve editor inside the `Inspector.tsx` Colour section. `src/render/gradingPass.ts` (WebGL2) and `applyPixelGradingToImageData` grade real pixels, and `src/render/compose.ts` uses the same pass for preview and export. Remaining: compare against color-chart frames to confirm perceptual match; the GPU pass falls back to CPU when WebGL2 is unavailable. |
| 3D LUTs | Imported lattices evaluated and persisted; built-in looks remain stylized | `parseCubeLut` parses `LUT_3D_SIZE`, `DOMAIN_MIN`/`DOMAIN_MAX`, and rejects files with no numeric triplets. `ops.applyCubeLutText` stores the full lattice on `clip.effects.customLutData` (8 MB upload cap) so a reopen or backup restore keeps it. `evaluate3dLutTrilinear` plus `src/render/gradingPass.ts` trilinear-sample real pixels in preview and export. The 16 built-in cinematic looks intentionally stay on the CSS-filter/split-tone path and are labelled “stylized”; they are not lattice-graded, so pixels are never double-graded. Evidence: `tests/colorGrading.test.ts`; browser run changed the preview centre from grey `[128,128,127]` to red `[191,0,0]` with a constant-red `.cube`. |
| Audio monitoring versus export | Improved; residual risk | `src/ui/player.ts` now uses per-clip media elements (`clipElements`) so simultaneous clips reusing one asset decode independently, applies `playbackRate`/`preservesPitch`, voice-triggered ducking (`0.25×`), and routes preview audio through the same `gain → pan → chain` order and `DEFAULT_CHAIN` used by `src/audio/mixdown.ts`. Remaining: preview still relies on `HTMLMediaElement` decoding rather than the offline buffer pipeline, so sample-accurate equivalence for reverse or very short clips needs a decoded-output comparison. |
| Simultaneous reuse of media | Addressed at source level; runtime comparison pending | `PreviewPlayer.getOrCreateClipElement(clip)` creates a dedicated element per clip ID when clips share an asset ID, so each clip can hold its own source timestamp. Verify with a duplicated, offset overlay in both preview and export. |
| Text and fonts | Partial | Font catalog names exist; the Inspector warns on fallback. No `FontFace` loading or font-import implementation was found in `src`; adding it requires an asset kind, storage, and schema changes. Identical typography requires actual font files, loading, and persistence. |
| Transform and keyframes | Implemented; direct manipulation added | `src/ui/ManipulationOverlay.tsx` (rendered by `Preview.tsx` in the editor) adds move, corner-scale, and rotate handles with snapping, keyboard nudge (`←↑→↓`, `Shift` = 5%), `[`/`]` rotation, click-to-select topmost clip at the playhead, and optional safe-area guides. Pointer gestures coalesce into exactly one undo entry through the store `beginGesture`/`updateGesture`/`endGesture`/`cancelGesture` API. Remaining: crop handles and interactive keyframe timing/curve editing are still Inspector-driven; timeline keyframe diamonds remain read-only. |
| Timeline visual feedback | Partial | Audio peaks are decoded, but `Waveform` receives only asset ID, not clip in-point, speed, or reverse, so it draws the whole source envelope across each clip. Video clips render labels rather than source-frame thumbnail strips in `src/ui/Timeline.tsx`. |
| Captions and voiceover | Implemented alternative; quality unverified | Local Whisper, subtitle tools, and voice recording exist. Reference lists caption generation/editor/transcript and voiceover tools. Recognition accuracy, styling fidelity, and timing need an identical-audio comparison. |
| Stock, AI and social services | Missing relative to reference capabilities | Reference tool inventory includes retouch, stickers, stock media, TTS, and other service tools. Existing ledger also records missing tracking/cutout, licensed media, and social publishing. Tool availability alone does not prove every native service currently succeeds. |
| Export | Implemented; output parity unverified | Shared visual compositor and WebCodecs/MediaBunny export exist. Codec availability, real decoded output, A/V synchronization, HDR/color handling, and long-project performance were not exercised in this audit. |

## Recommended order

1. Compare decoded output with preview using a short project containing fades, speed changes, reverse, ducking, and duplicated offset overlays.
2. Validate color wheels/HSL/curves and imported `.cube` lattices against color-chart frames rather than catalog counts.
3. Add source-aware waveforms, thumbnail strips, crop handles, and interactive keyframe timing.
4. Load and persist actual fonts; compare text/caption samples and representative effects against reference frames.
5. Treat AI, licensed catalogs, and direct publishing as separate integrations with their own service requirements.

## Release status and known limits (2026-11-08)

- **Design source of truth unavailable.** The referenced `Browser_4K_Studio_Design.html` and 12 design images were not present on disk, so no visual acceptance baselines (1440×900, 1728×1080, 1024×768, 390×844) could be captured. Layout parity is therefore unproven; do not claim pixel fidelity.
- **Desktop capture not exercised here.** Real screen/window/tab capture and OS device-permission gates cannot be run in this environment.
- **Font import still missing.** No `FontFace` loading or local font-file import exists; the 406-name catalog resolves through host fonts and fallback stacks.
- **GPU grading optional.** `src/render/gradingPass.ts` uses WebGL2. When WebGL2 or readable canvas pixels are unavailable, grading falls back to CPU; stylized built-in looks fall back to the split-tone gradient.
- **Built-in LUTs are stylized.** Only imported `.cube` files and the wheels/HSL/curves are graded on real pixels.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: 0 errors, 16 pre-existing warnings.
- `npm test -- --reporter=dot`: **24 files, 219 tests passed**.
- `BASE_PATH=/browser-record/ npm run build`: passed; `BASE_PATH=/browser-record/ npm run smoke`: 6 assets verified.
- Playwright 1.65 browser run against the dev server: imported a video and placed it, verified 4 colour wheels / 1 tone curve / 8 HSL chips render, verified a constant-red `.cube` lattice changed the preview centre from grey `[128,128,127]` to red `[191,0,0]`, verified drag/nudge/scale/rotate each add exactly one undo entry, verified undo removes one, and captured zero console errors. This validates wiring and pixel grading, not visual parity with the reference.
