# Session Plan — Browser 4K Studio P0/P1 Consolidation & Verification

- [x] **Step 1**: Baseline Browser 4K Studio implementation (`7d90762` / `39fc04b`).
- [x] **Step 2 (P0 — Record & Takes)**: Keep `Pause / Resume`, elapsed timer, and `Stop` visible in both expanded and collapsed `.rec-dock` states (including in Edit). Group secondary take actions in `RecordingsLibrary` under `More` and disable `+ Add to timeline` for takes from other projects with a clear explanation.
- [x] **Step 3 (P0/P1 — Export Presets, Output FPS, Single Active Section & Unified Config)**:
  - Add distinct YouTube `1080p30` and `1080p60` presets and explicit output FPS (`24`/`30`/`60`) used across summary, codec check, 6s sample encode, and final file (`exportProject`).
  - Use one `resolvedOutput` config so custom target size never leaks into standard presets and codec probing uses the resolved audio/video bitrates.
  - Render one active section at a time (`Video export`, `Standalone downloads`, `Planning & Share`), eliminate duplicate WAV/PNG/SRT/VTT/JSON/Planning panels, separate `Re-probe codecs` from `Run encoder benchmark`, show `Preparing → Encoding → Saving → Verifying` status, and rename `.json` download to `Project settings and edits (.json)` with media retention guidance.
- [x] **Step 4 (P1 — Edit Workspace Consolidation & ≤1200px Laptop Layout)**:
  - Remove `05–11` numeric prefixes from the 7 workspace pills and synchronize with the SVG tool rail.
  - Give open dialogs/popovers first use of `Escape`, then exit `Focus` even when a button has focus.
  - Make `Tools` drawer and `Inspector` mutually exclusive at `≤ 1200 px` with a clear `Tools / Inspector` switch, and place `History` and `Project settings` in disclosures.
- [x] **Step 5 (Verification & Live Release)**: Run typecheck, lint, unit tests, and a real Chrome DevOps lesson test (record two takes, combine them, mask a token, export a landscape lesson and a vertical chapter, verify frame rate, captions, audio, and playback), then commit, push to `origin/main`, and verify live GitHub Pages deployment.
