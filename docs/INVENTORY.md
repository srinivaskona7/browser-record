# Feature & Catalog Inventory (`docs/INVENTORY.md`)

Per Global Rule **G2 (Inventory, not quotas)**, this ledger tracks working vs. fallback vs. hidden items across every tool family, along with preview and export test coverage.

## 1. Summary Counts (Working / Reference Target)

| Tool Family | Working Count | Fallback / Partial | Hidden (Not in Pass) | Preview Test | Export / Compositor Test |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Recorder Modes** (`Instant`, `Studio`, `Screenshot`) | `3 / 3` | `0` | `0` (`Area` crop hidden until OS region crop exists) | `tests/recordingFlow.test.tsx` | `tests/recordingFlow.test.tsx` |
| **Boundary Transitions** | `51 / 51` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Color Grading Filters** | `77 / 77` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Cinematic 3D LUTs & Adjustment Layers** | `16 / 16` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Dynamic Video Effects** | `148 / 148` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Text Style Presets** | `34 / 34` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Kinetic Text Animations** | `77 / 77` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Font Families** | `18 web/system + 388 local/fallback` (`406` listed) | `388` (require host OS font or fallback stack) | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Text Emphasis Styles** (`highlight`, `underline`, `circle`, `sparkle`, `strikethrough`) | `5 / 5` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Caption Styles** | `39 / 39` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/captions.test.ts` |
| **Speed Remap Curves** | `8 / 8` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Alpha Mask Shapes** (`rectangle`, `circle`, `star`, `heart`, `split-screen`) | `5 / 5` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/effectsCatalogSuite.test.ts` |
| **Platform Workflow Presets** (YouTube, Instagram, LinkedIn) | `12 / 12` | `0` | `0` | `tests/effectsCatalogSuite.test.ts` | `tests/presets.test.ts` |

## 2. Explicitly Hidden / Out-of-Scope Features (Rule G1)

The following items are **hidden** (never shown as fake or decorative controls) because they require external cloud APIs, licensed media catalogs, or unbundled neural segmentation models:
- AI background cutout / person segmentation (`hidden`)
- Planar / point motion tracking (`hidden`)
- Beauty / face retouching (`hidden`)
- Cloud stock video & licensed commercial music library (`hidden` — users import local audio or use procedural WebAudio SFX)
- Cloud translation / multi-language dubbing (`hidden` — local Whisper transcription + SRT/VTT import/export are used)
- Text-to-speech synthesis (`hidden` — local microphone Voiceover recording is used)
- Direct Instagram / Facebook / YouTube OAuth upload & cloud share links (`hidden` — local MP4/WebM file export is used)
