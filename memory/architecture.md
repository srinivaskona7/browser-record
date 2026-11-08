# Repository map and invariants

## Exact source tree

```text
src/App.tsx
src/app/actions.ts
src/app/bootstrap.ts
src/app/handleStore.ts
src/app/prefs.ts
src/app/session.ts
src/audio/chain.ts
src/audio/mixdown.ts
src/audio/prepare.ts
src/audio/sfx.ts
src/capabilities/benchmark.ts
src/capabilities/codecs.ts
src/capabilities/detect.ts
src/captions/chunking.ts
src/captions/glossary.ts
src/captions/subtitles.ts
src/captions/transcribe.ts
src/captions/transcribe.worker.ts
src/capture/audioMeter.ts
src/capture/devices.ts
src/capture/floatingCamera.ts
src/capture/quality.ts
src/capture/recorder.ts
src/capture/stateMachine.ts
src/core/ids.ts
src/core/time.ts
src/editor/actions.ts
src/editor/selection.ts
src/effects/catalog.ts
src/export/exporter.ts
src/export/presets.ts
src/main.tsx
src/media/probe.ts
src/project/chapters.ts
src/project/factory.ts
src/project/ops.ts
src/project/secretScan.ts
src/project/serialize.ts
src/project/store.ts
src/project/types.ts
src/render/compose.ts
src/render/compositorQuery.ts
src/render/gradingPass.ts
src/render/layout.ts
src/render/sources.ts
src/render/text.ts
src/styles.css
src/styles/tokens.css
src/ui/AboutDialog.tsx
src/ui/CapabilityMatrix.tsx
src/ui/CaptionsPanel.tsx
src/ui/ColorGrading.tsx
src/ui/DeleteProjectDialog.tsx
src/ui/DiagnosticsPanel.tsx
src/ui/EditPage.tsx
src/ui/EditStart.tsx
src/ui/EditorTools.tsx
src/ui/ExportPage.tsx
src/ui/ImportMediaButton.tsx
src/ui/Inspector.tsx
src/ui/ManipulationOverlay.tsx
src/ui/MediaBin.tsx
src/ui/Preview.tsx
src/ui/ProjectsPage.tsx
src/ui/RecordPage.tsx
src/ui/RecordingActions.tsx
src/ui/Timeline.tsx
src/ui/TranscribeDialog.tsx
src/ui/VoiceoverDialog.tsx
src/ui/components.tsx
src/ui/icons.tsx
src/ui/player.ts
src/workspace/memoryFs.ts
src/workspace/takeRefs.ts
src/workspace/types.ts
src/workspace/workspace.ts
```

## Core schemas and state

- `PROJECT_SCHEMA_VERSION = 3` in `src/project/types.ts`.
- Timebase: `TICKS_PER_SECOND = 720_000` in `src/core/time.ts`.
- Normalized canvas coordinates: `0.0–1.0`, top-left origin `(0, 0)`, `+y` down, `(x, y)` denotes element center; rotation is `0°–360°` clockwise; colors are `#RRGGBB` / `#RRGGBBAA`.
- `Project`: `{ schemaVersion, id, name, createdAt, updatedAt, canvas, settings, brand, assets, tracks, captions, captionStyle, markers, glossary, durationTicks, notes }`.
- `Clip`: `{ id, kind, assetId?, startTicks, durationTicks, inTicks, freezeAt?, speed, reverse?, speedCurve?, linkId?, label?, transform, effects, audio, text?, arrow?, sticker?, contact?, keystroke?, endScreen?, progressBar?, pulse?, countdown?, presenter?, masks, alphaMask?, transitionIn, transitionOut, keyframes, captionCueId? }`.
- `ClipEffects` grading fields: `lut`, `lutStrength?`, `customLutData?` (`{ id, name, size, domainMin, domainMax, lattice }`), `colorWheels?` (global/shadows/midtones/highlights), `hslBands?` (8 bands), `toneCurves?` (rgb/red/green/blue point arrays). Imported `.cube` lattices persist on the clip and are re-registered on load; uploads are capped at 8 MB.
- Store: `useEditor` in `src/project/store.ts` holds `project`, `history`, `future`, `gesture`, `playheadTicks`, `playing`, `selectedClipIds`, `selectedTrackId`, `zoomPxPerSec`, `snap`, `editMode`, `panel`, `previewScale`, and `showSafeAreas`. Every persistent edit goes through `useEditor.getState().apply(label, fn)` using pure operations from `src/project/ops.ts`, or through the gesture API `beginGesture(label)` → `updateGesture(fn)` (repeated) → `endGesture()` / `cancelGesture()` so one pointer drag produces exactly one undo entry. `endGesture` compares the stored `revision` and pushes nothing when the gesture never changed the project.
- Session store: `useSession` in `src/app/session.ts` holds `workspace`, `projectFolder`, `route`, `saveState`, `saveError`, `lastSavedAt`, `capabilities`, `theme`, `toasts`.
- Workspace layout (`WORKSPACE_LAYOUT` in `src/workspace/types.ts`): `projects/<folder>/project.json`, `recordings/<takeId>/manifest.json`, `imports/`, `exports/`, `waveforms/`, `thumbnails/`, `proxies/`, `captions/`.

## Key UI & capture invariants

- `App.tsx` keeps `<RecordPage hidden={route !== 'record'} />` mounted across routes so active recordings, the persistent `.rec-dock` control bar, and `.rec-selfview` are never abandoned when switching tabs.
- `RecordPage.tsx` separates source selection (`chooseSource()` → `stage === 'ready'`) from starting capture (`start()`), guards against duplicate start/stop (`startingRef`, `stoppingRef`), appends new takes at `nextFreeStart` without overwriting existing timeline clips, moves playhead to the new take's start, and selects the newly inserted primary clip.
- `floatingCamera.ts` implements Document Picture-in-Picture (`documentPictureInPicture`) with HTMLVideoElement Picture-in-Picture (`requestPictureInPicture`) fallback and reuses the active camera stream without opening duplicate `getUserMedia` streams.
- `EditPage.tsx` and `EditorTools.tsx` implement the Instagram Edits desktop layout: project header with inline project renaming, left tool rail with SVG icons (`src/ui/icons.tsx`), searchable tool library with real visual previews, center preview + `ClipQuickActions` + transport, collapsible/searchable right `Inspector.tsx`, and multi-track `Timeline.tsx`.

- `ManipulationOverlay.tsx` renders move/corner-scale/rotate handles over the selected media clip at the playhead, supports snapping, keyboard nudge (`←↑→↓`, `Shift` = 5%), `[`/`]` rotation, and click-to-select of the topmost visible clip. `.edits-workspace .preview-shell` must stay `overflow: visible` so edge handles are not clipped.
- `gradingPass.ts` is the WebGL2 grading engine (3D LUT trilinear, four wheels, eight HSL bands, RGB/R/G/B curves). `compose.ts` uses it first and falls back to CPU `applyPixelGradingToImageData`; the split-tone gradient is only a fallback for stylized built-in looks or unreadable canvases. Only imported `.cube` lattices are graded on pixels; the 16 built-in cinematic looks stay stylized.
- The editor History panel and Undo/Redo disabled states subscribe to `history.length` / `future.length` / `lastAction`; reading them with `useEditor.getState()` inside render leaves the panel stale after a gesture commits.

## Validation commands

- `npm run typecheck` (`tsc --noEmit`)
- `npm run lint` (`eslint .`)
- `npm test` (`vitest run`)
- `npm run build` (`tsc --noEmit && vite build`)
- `npm run smoke` (`node scripts/smoke-static.mjs`)
- `BASE_PATH=/browser-record/ npm run build && BASE_PATH=/browser-record/ npm run smoke`
- Current totals: 24 test files / 219 tests; lint has 0 errors and 16 pre-existing warnings.
- `npm run verify:cloudflare` (`node scripts/build-cloudflare.mjs`)
