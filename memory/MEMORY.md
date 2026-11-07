# Browser Record agent instructions

Keep `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and `memory/MEMORY.md` identical. Store exact source paths, schemas and validation invariants in `memory/*.md`; start with `memory/architecture.md`, `docs/CAP_RECORDING_UI_AUDIT.md`, and `docs/EDITS_PARITY.md` before searching the repository.

- Package scripts: `npm run dev` (Vite port 5199, `host: true`, `allowedHosts: true`, `cors: true`), `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run smoke`, `npm run verify:cloudflare`.
- Git push invariant: remote `origin` is `git@github.com:srinivaskona7/browser-record.git`. Push over SSH with `git -c core.sshCommand=ssh push origin main`.
- GitHub Pages workflow (`.github/workflows/pages.yml`) pins `ubuntu-24.04`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`, builds with `BASE_PATH=/browser-record/`, and writes `dist/.nojekyll`.
- Key UI & capture modules:
  - `src/App.tsx` — Shell navigation; keeps `<RecordPage hidden={route !== 'record'} />` mounted so active takes, `.rec-dock`, and `.rec-selfview` persist across tab switches.
  - `src/ui/RecordPage.tsx`, `src/ui/RecordingActions.tsx`, `src/ui/ImportMediaButton.tsx`, `src/capture/floatingCamera.ts`, `src/capture/recorder.ts` — Cap-style recorder (`so.cap.desktop` v0.6.2 reference), source confirmation Ready state, inline Camera/Microphone device selectors, Document PiP / Video PiP floating camera, and stop-to-editor append flow.
  - `src/ui/EditPage.tsx`, `src/ui/EditorTools.tsx`, `src/ui/Inspector.tsx`, `src/ui/Timeline.tsx`, `src/ui/MediaBin.tsx`, `src/ui/CaptionsPanel.tsx`, `src/ui/icons.tsx` — Instagram Edits desktop reference (`com.burbn.basel.mac` v454.0.0 build 1106192771) with SVG tool rail, meaningful catalog previews, inline project naming, searchable inspector, and full undoable editing operations (`src/project/ops.ts`, `src/effects/catalog.ts`).
  - `src/render/compose.ts`, `src/render/compositorQuery.ts`, `src/export/exporter.ts`, `src/export/presets.ts` — Shared preview/export Canvas 2D compositor and WebCodecs/MediaBunny export pipeline.
- Preserve existing working features, honest storage warnings, and capability honesty. Consult the 7-column implementation ledger and remaining platform gaps in `docs/EDITS_PARITY.md`. Apply editing actions through `src/project/ops.ts` and `useEditor.apply`, not direct project mutation.
