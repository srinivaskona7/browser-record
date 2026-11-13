# UI & Motion pass — inventory, changes, verification

Living record of the 2026-11-11 repository-wide UI/motion pass. Update it with the code;
the invariants listed here are enforced by `tests/designInvariants.test.ts`.

## 1. Page inventory

Routes come from `ROUTES` in `src/app/session.ts` (hash routing, `#/<id>`), rendered by
`src/App.tsx`. Record stays mounted on every route (`data-route-hidden` when off-tab).

| Route | Source | Layout | Key components | Interaction states |
|---|---|---|---|---|
| App chrome | `src/App.tsx` | One-row top bar; ≤860px collapses to brand + drawer toggle | Nav tabs, session/save badges, Save, app Menu (Diagnostics, Refresh cache, About, theme) | Drawer open/closed, unsaved-changes dot on the toggle, save error |
| Projects | `src/ui/ProjectsPage.tsx` | Header panel + collapsible storage/storyboard + workspace project list | New recording (magnetic), Import video, More ▾ (Blank project, Load sample lesson, Restore backup), storyboard checklist | No workspace / temporary (OPFS) / saved folder; empty list; rename inline; delete dialog; shot done/undone |
| Record | `src/ui/RecordPage.tsx`, `CameraBubble.tsx` | Compact recorder card: mode switcher, source grid, device cards, footer | Instant/Studio/Screenshot, Entire screen/Window/Area/Camera/Audio tiles (hover-lift), mic meter, Start recording (magnetic), take dock, draggable camera bubble | `idle` → `requesting-permission` → `ready` → `countdown` → `recording` ⇄ `paused` → `stopping` → `saved` / `recovering` / `failed`; area selection; review take |
| Edit | `src/ui/EditPage.tsx`, `EditStart.tsx`, `Timeline.tsx`, `Inspector.tsx`, `EditorTools.tsx` | No project → EditStart; else toolbar, tool rail, preview + clip bar + transport, timeline, inspector | Project ▾ menu, clip More ▾, M/H/L track toggles, ruler + playhead, manipulation handles | No project; no selection / clip / multi-select; playing/paused; focus mode; inspector hidden ≤1180px, side rail hidden ≤780px |
| Export | `src/ui/ExportPage.tsx` | Section tabs; preset cards + options column; summary + action column; Encoder diagnostics | Delivery preset cards (hover-lift), range/captions/speed/size options, Export video (magnetic), progress meter, codec table, benchmark | No workspace; empty timeline; exporting (progress); done (download); failed |
| Diagnostics | `src/ui/DiagnosticsPanel.tsx` | Capability matrix, codec tables, storage meter | Codec/MediaRecorder tables (scroll horizontally ≤640px), quota meter | Probing; supported/unsupported rows |

## 2. What changed

| Area | Before | After |
|---|---|---|
| App Menu, Projects More, Edit Project popovers | Always opened upward / right-aligned: app Menu was off-screen on every page, Blank project unreachable, Edit menu cut off on the left | `src/ui/popoverPlacement.ts` measures on open (`data-placement`, `data-align`); `.topbar` lost the `overflow-x: auto` that clipped it |
| Mobile/tablet chrome | Top bar wrapped to 125–191px | ≤860px: 61px bar, `#app-drawer` side sheet (`role=dialog`, focus moves in, Tab trapped, Esc/scrim/✕ close, `main` inert while open, `inert` when closed) |
| Motion rule | 10 transitions animated background/color/border/box-shadow/border-radius/width/height; meters and progress animated `width`; playhead `left` per frame; bubble drag `left/top` | Only `transform`/`opacity`. Meters/progress `scaleX`; playhead and dragged bubble `translate3d` |
| Entry motion | — (first attempt used fill `both`: broke the dock, bubble and dialogs) | 200ms opacity fade on route roots, `backwards` fill, `.cap-recorder` excluded; 140ms popover-in |
| Micro-interactions | Press nudge only | Magnetic pull on one hero CTA per page (`src/ui/magnetic.ts`, mouse + fine pointer only, ≤5px, rAF-throttled); selectable cards lift 2px with a pre-painted shadow layer that only fades; press scale |
| Reduced motion | Per-rule `animation: none` | Global: 0.01ms, one iteration (no 1ms infinite flicker) |
| Touch (`pointer: coarse`) | Nav tabs 32px, summaries 24px, icon buttons 32px wide, bare storyboard checkboxes 22px | 44px min height on buttons/tabs/selects/inputs/summaries, 44px min width on buttons, checkbox rows are `<label>` hit areas |
| Type | 19 literal sizes 9–30px, `--token-font-xs` used but undefined | `--token-font-2xs…4xl` ramp (10/11/12/13/14/16/18/22/26/30px) in `tokens.css`; every CSS `font-size` and every inline `fontSize` in `src/ui` uses it (the 48px voiceover countdown numeral is the one exception) |
| Spacing | 229 `gap`/`padding`/`margin` declarations, 1 of them on a token | Every one resolves to a `--token-space-*` step (1px hairline, 2px rhythm to 24px, then 4px steps); `auto` and unitless `0` stay, `inset` is positioning |
| Contrast | Muted text 3.1–4.3:1 in places; light primary button 3.3:1 | Every text token ≥4.5:1 on every surface in both themes; primary ink on primary ≥5:1 (hover included); the area-capture label and the drawer attention dot are checked as rendered |
| Clipping | Export benchmark row overflowed at 375px; codec tables cut off | Rows wrap; tables scroll inside themselves |

## 3. Verification (re-run after any UI change)

- `npm run check` — typecheck, lint (0 errors, 0 warnings), 273 tests in 27 files, build. `npm run smoke`.
- Browser audit, real Chromium against `npm run dev`, localhost only: 5 routes × 375 (touch),
  768 (touch), 1024, 1440; empty state, sample-lesson state and light theme. Each pass opens
  every `<details>`, opens each popover alone and hit-tests every item, measures element
  rects (document `scrollWidth` lies below 640px because `.page` hides x-overflow), and
  counts touch targets under 44px. Content of closed `<details>` still reports a size in
  Chrome, so the audit filters with `checkVisibility()`.

| Route | 375 | 768 | 1024 | 1440 |
|---|---|---|---|---|
| Projects | pass | pass | pass | pass |
| Record | pass | pass | pass | pass |
| Edit | pass | pass | pass | pass |
| Export | pass | pass | pass | pass |
| Diagnostics | pass | pass | pass | pass |

"Pass" = 0 clipped elements, 0 unreachable popover items, 0 targets under 44px (touch
viewports), 0 page errors, and at ≤860px the drawer opens, takes focus, makes `main` inert,
closes on Esc and navigates.

## 4. Deliberately not done

- No layout or copy rewrite: the audit found no gradient hero, icon-card rows or fake
  metrics in use (`.projects-hero` CSS exists but nothing renders it; `.grid-3` is a live
  Projects grid); copy is specific.
- Hover colour changes now snap instead of fading — that is the transform/opacity rule.
- Camera bubble size/shape changes snap (no width/height/border-radius animation).
- Static positioning from data stays as `left`/`width` (timeline clips, markers, keyframes,
  manipulation handles); only per-frame motion (playhead, bubble drag) moved to transforms.
- The 48px voiceover countdown numeral is a display size outside the ramp.
- `src/capture/floatingCamera.ts` still sizes the PiP window with 9 literal pixel values: it
  is outside `src/ui`, and the ramp is a chrome contract.
- The workspace name is hidden between 861px and 1180px (`.topbar-workspace`), where the
  session badge already says where the session lives.

## 5. Review round 1 (2026-11-11) — findings and their fixes

Reviewers: correctness, a11y/edge-case, spec-compliance. The audit in §3 only measured each
route's first screen; these needed state. Every row is closed and re-verified in §6.

| # | Finding | Fix |
|---|---|---|
| 1 | Drawer Tab trap leaks: `offsetParent` keeps the closed app-Menu buttons, so `last` is unfocusable | `src/ui/focusTrap.ts` filters with `checkVisibility()`, so a closed `<details>`'s buttons are not tabbable |
| 2 | Esc/Tab handled on the drawer element only: focus drops to `<body>` (Save disables itself, header click) and the drawer can't be closed by key | `App.tsx` listens on `document` in the capture phase, so the keys are seen even when focus is on `<body>` |
| 3 | Drawer reopens by itself after widening past 860px and narrowing again (`drawerRequested` never reset) | `App.tsx` forgets the request when the viewport leaves the compact range |
| 4 | Focus lost to `<body>` after drawer nav / About (focused element goes inert); opening focuses Projects, not the current tab | `leaveDrawer()` hands focus to the toggle first; opening focuses the tab with `aria-current="page"` |
| 5 | Toggle's accessible name is only the route label; attention dot 1.89:1 in light | `aria-label` states the route and the attention ("unsaved changes" / "save failed"); the dot uses `--warn` (6.0:1 in light, 8.8:1 in dark) |
| 6 | Editor shortcuts (Space/End/Delete/s) fire behind the open drawer and on a focused `<summary>` | `EditPage.tsx` ignores keys when `.app-main[inert]` or a `.topbar`/`[inert]` ancestor has focus, and skips `BUTTON`/`A`/`SUMMARY` targets |
| 7 | Five drags still write left/top/width/height per pointermove: timeline move/trim + hover line, manipulation box, colour-wheel knob, area-capture rect | All five preview through `transform`; `tests/designInvariants.test.ts` fails the build if a drag piece writes a layout key |
| 8 | Touch targets <44px in non-default states: manipulation handles 12px, `.clip-handle` 7px and invisible on touch, ruler 28px, `input[type=color]` 27px, `.toast` button 42px | The `pointer: coarse` block gives every control a 44px hit area, shows 44px trim handles on the selected clip only, and grows the ruler, colour input and area handles |
| 9 | Fake metric: "4× Faster Turbo Export", "4× Smaller", "4× smaller VBR" — nothing measures them | The copy now states what the code does: "Faster export pipeline" (how much faster depends on the machine; the progress line shows the measured rate), "Quarter-bitrate compact encode" (¼ bitrate is the actual `bitsPerPixel` ratio), and the export page reports measured `× real time` |
| 10 | Light `.btn-primary:hover` 4.19:1; test checked unused tokens; area-capture overlay label 3.55:1 | `.btn-primary:hover` uses its own `--accent-hover` token, checked against `--accent-ink`; the area label paints `--surface-1` under `--accent` text (5.3:1 light, 14.9:1 dark) |
| 11 | Spacing not on a scale (1 of 229 declarations uses a token) | Every `gap`, `padding` and `margin` in `src/styles.css` resolves to a `--token-space-*` step (1px hairline, 2px rhythm to 24px, then 4px steps); `auto` and unitless `0` stay, and `inset` is positioning |
| 12 | Code ids + emoji as labels (podcast-warm, cinema-teal…), off-topic sample copy ("--dry-run=client", "Deploy in") | `src/ui/labels.ts` maps colour-look, PiP and shadow/glow ids to their names, `src/audio/chain.ts` does the same for voice presets, and the buttons and the undo/redo entries use the same words. The `🎨`/`⚙` glyphs are gone (the settings button uses the SVG `settings` icon) |
| 13 | Motion coverage uneven: no magnetic CTA in open editor/Diagnostics, `.project-card` never lifts, Record has no entry motion | Magnetic CTAs on Projects, Record, Export, EditStart and Diagnostics; `.project-card` lifts with the other cards; the Record card fades in |
| 14 | Record grows to 480px at 375 during a take (take-status table) | The take-status table is gone; the Record card is a fixed, scrollable page and the floating dock holds the state |
| 15 | 22 lint warnings (set-state-in-effect, exhaustive-deps, immutability, memoization) | All fixed: `npm run lint` reports 0 errors and 0 warnings |
| 16 | Doc errors: Edit inspector claim, "all inline sizes" (floatingCamera.ts has 9 literals), `.topbar-workspace` hidden 861–1180px not mentioned, dead `.projects-hero` / `grid-3` | Corrected in this file: the inspector is collapsible (hidden ≤1180px), `grid-3` is a live Projects grid, and the inline-size claim now names the ramp and its one exception |

## 6. Verification after review round 1

- `npm run typecheck`, `npm run lint` (0/0), `npm test` (27 files / 273 tests), `npm run build`, `npm run smoke`.
- Browser audit in Chromium against `npm run dev`, localhost only: 5 routes × 375 (touch),
  768 (touch), 1024, 1440. 0 page errors, 0 interactive targets under 44px on touch, 0 clipped
  elements outside a scroll container.
- Drawer state machine checked by hand at 375px: open → focus moves to the current tab; 12 × Tab
  stay inside the drawer; Escape closes the app Menu first, then the drawer, and returns focus to
  the toggle; a drawer navigation keeps focus on the toggle; widening past 860px and narrowing
  again does not reopen the drawer; Space in the editor does nothing while the drawer is open.
- Measured in the browser (both themes): area-capture label 14.9:1 (dark) / 5.3:1 (light);
  drawer attention dot 8.8:1 (dark) / 6.0:1 (light).

