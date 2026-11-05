# Third-party notices

This project is MIT licensed (see `LICENSE`). It bundles or depends on the
following packages; their licences are their own.

| Package | Version | Licence | Used for |
|---|---|---|---|
| react, react-dom | 19.3.1 | MIT | UI |
| zustand | 5.0.16 | MIT | editor/session state |
| mediabunny | 1.65.0 | MPL-2.0 | MP4/WebM muxing and demuxing with WebCodecs |
| @huggingface/transformers | 4.3.2 | Apache-2.0 | local Whisper transcription |
| onnxruntime-web | 1.31.0 | MIT | WASM inference runtime, pulled in by Transformers.js |
| @huggingface/jinja | 0.5.11 | MIT | prompt templates used by Transformers.js |
| tailwindcss (@tailwindcss/vite) | 4.3.3 | MIT | styling |
| vite, @vitejs/plugin-react | 8.3.5 / 6.2.1 | MIT | build |
| typescript | 6.0.3 | Apache-2.0 | type checking |
| vitest, jsdom, @vitest/coverage-v8 | 5.0.5 / 30.1.3 | MIT | tests |
| eslint, typescript-eslint, eslint-plugin-react-hooks | 10.x / 8.72.1 / 7.1.1 | MIT | linting |

## Mediabunny (MPL-2.0)

Mediabunny is used unmodified as a dependency. MPL-2.0 is file-level copyleft:
it does not change the licence of this project's source, but if you modify
Mediabunny's own files you must publish those files under MPL-2.0.

## Models

Transcription weights are **not** bundled or committed. On first use the app
downloads the selected Whisper model from the Hugging Face CDN and the browser
caches it. Model licences are published with each model; the default Whisper
models are distributed under MIT by their upstream authors. The app discloses
the download size before starting and never uploads audio.
