# Cap recording UI audit

Observed directly in the running `/Applications/Cap.app` on 2026-11-07. Settings identifies version 0.6.2. Scope: the main recording window, source/device selectors, preflight overlays, recording-related settings and teleprompter. This is a UI observation, not proof of recording-engine behavior.

## Main window

The observed window is a compact rounded card, approximately 660 × 870 screenshot pixels. It uses a light neutral background, large rounded controls and blue selection/on indicators. The top strip contains Help & Tour, Settings, Screenshots, Recordings, Teleprompter and Changelog. The content header contains the Cap mark, Personal workspace badge and an icon-only three-way mode control with a text mode label below it. An adjacent information button opens mode explanations.

The screen has two explicit groups: capture source and camera/microphone. Capture sources form a 2×2 grid: Display and Window on top, Area and Camera Only below. Display/Window are split controls with a separate selector chevron. Camera, microphone and system audio are full-width rows with icons, current device names and explicit On/Off indicators. The enabled microphone row also contains a blue live input-level fill. There is no large preview or engineering diagnostic table in this initial window.

## Modes

| Mode | Observed UI description | Verification boundary |
| --- | --- | --- |
| Studio | Full quality local recording; built-in editor/effects; backgrounds/padding; export/share later | Mode screen and local preflight observed; no recording made |
| Instant | Shareable link, background uploading, AI transcription/summary, browser playback | Advertised in app; no upload or AI operation tested |
| Screenshot | Separate third mode | Main mode affordance observed; screenshot workflow outside this recording audit |

Studio was the initial mode and was restored after inspecting Instant.

## Sources and preflight

- **Display selector:** Back, Search and a thumbnail card with display name and refresh rate. This machine offered Built-in Retina Display at 120 Hz.
- **Display selected:** full-screen blue-tinted confirmation overlay, display name and reported `3456×2234 · 120FPS`, cancel button, Start Recording button labelled Studio Mode, mode chevron, countdown control, and camera/microphone rows. Reported display characteristics do not certify encoded output frame rate.
- **Countdown:** observed menu offers Off, 3 seconds, 5 seconds and 10 seconds. Existing selection was 3 seconds.
- **Window selector:** Back, Search and window thumbnail cards including title, owning application, dimensions and refresh rate. Only one eligible window card was offered during this inspection; do not generalize that to a system limitation.
- **Area:** full-screen dimmed overlay instructs the user to drag an area or click a window to fit it. Top toolbar offers Free, 16:9, 4:3, 1:1 and 9:16, plus overlapping-rectangle, reset-arrow, corner-frame and lock icons. These four icons' precise actions were not exercised and must not be assigned invented semantics.
- **Camera Only:** visible source choice; not activated because no camera capture was needed for this inspection.
- Escape cancelled preflight/area selection and returned to the main window. No Start Recording action was invoked.

## Devices

- **Camera row:** opens a chooser with Back/Search, No Camera (checked) and FaceTime HD Camera, reporting available `1552×1552 @ 30fps`. A sliders/settings affordance appears beside the physical camera. Its detail panel was not successfully opened. Camera remained off.
- **Microphone row:** opens Back/Search, No Microphone, MacBook Pro Microphone (checked, `48kHz Mono`, live horizontal level meter), and Microsoft Teams Audio (available `48kHz Mono`). Sliders/settings affordances appear beside devices. Those subpanels were not verified.
- **System audio row:** clicking switches directly between No System Audio and Record System Audio. It is a toggle, not a device chooser. It was returned to Off. No recording occurred.
- On/off state is expressed in words as well as colour, and unavailable/available device metadata appears in secondary text.

## Recording-related settings

General settings expose:

- Appearance: System, Light, Dark; application language.
- Dock icon and notifications.
- Countdown and confirmation before recording without an available microphone.
- Studio Sound on new recordings (UI says microphone cleanup can be disabled per recording in the editor).
- Delete Instant recordings after upload.
- Crash-recoverable recording.
- Custom cursor capture for Studio; auto zoom on clicks; keyboard-press capture; drawing the MacBook notch.
- Anonymous telemetry.

These settings were inspected, not changed. Their labels/current states are observations; processing quality and crash recovery were not tested.

Recording quality separates Studio and Instant:

- Studio: Balanced (recommended), Smaller files, Maximum detail. Maximum detail was selected. Descriptions explain detail versus disk usage. Studio export size is chosen later in the editor.
- Instant: maximum-resolution choices 720p, 1080p, 1440p, 4K. The observed plan allowed 720p and showed locks for higher sizes. This is an observed account UI, not a universal entitlement statement.
- Open share links automatically toggle.

Shortcuts settings expose configurable actions for starting Studio/Instant, recording area/window/display, opening the recorder, cycling modes, stopping, pausing/resuming and restarting. Fields said Record shortcut; no particular key chord was configured/verified in the inspected views.

Post-recording behavior is configurable:

| Studio | Instant |
| --- | --- |
| Open editor (selected), Show Cap, Do nothing/save to library | Open link (selected), Show Cap, Copy link only |

The Instant panel says the share link is always copied. These are settings observations, not a completed stop/upload test.

## Teleprompter

A separate window has an empty script editor, play control, speed slider showing 150 wpm, a layered/opacity-looking slider, text-size minus/value/plus showing 30, and a settings icon. A banner says the window is hidden from Cap recordings. Blue side chevrons flank the reading area. No script was entered; playback, slider semantics, the settings subpanel and exclusion from actual recordings remain untested.

## Implications for Browser Record

1. Use a compact recorder setup with a 2×2 capture-source grid and full-width camera/mic/system-audio rows; show the chosen source and explicit On/Off states.
2. Distinguish a source-selection action from Start Recording. Present a dedicated ready state with source summary, countdown and one primary action.
3. Keep quality, cursor behavior and post-recording preferences in settings; keep advanced diagnostics out of the initial capture screen.
4. Reuse browser-supported display/window/tab pickers. Area capture requires a real crop implementation and should not be offered as a cosmetic button.
5. Keep our existing local Studio behavior; do not add fake Instant cloud sharing or claim OS-global keyboard/cursor access from a webpage.
6. Provide a deliberate post-stop choice: open editor, return to recorder, or keep in library. Preserve recovery/download choices for browser storage.
7. Add device metadata and live microphone feedback close to the device choice. Mirror cap-style compact rows without requiring camera/mic activation just to view the UI.

## Coverage and remaining unknowns

Observed: main layout, mode information, display/window/device selection, display and area preflight, countdown menu, general/quality/shortcut settings and teleprompter surface. Initial Studio mode, camera off, existing microphone selection and system audio off were restored; Cap was left on its main recorder window.

Not tested: a real take, floating controls during a take, stop-to-editor execution, encode quality, upload, transcription, camera-only recording, device-specific settings subpanels, area-toolbar icon actions, teleprompter playback/settings and screenshot mode. Do not describe this as complete runtime validation of Cap.
