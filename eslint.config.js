import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  indexedDB: 'readonly',
  caches: 'readonly',
  crypto: 'readonly',
  performance: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  Image: 'readonly',
  AudioContext: 'readonly',
  OfflineAudioContext: 'readonly',
  OffscreenCanvas: 'readonly',
  MediaRecorder: 'readonly',
  VideoEncoder: 'readonly',
  VideoDecoder: 'readonly',
  AudioEncoder: 'readonly',
  AudioDecoder: 'readonly',
  VideoFrame: 'readonly',
  AudioData: 'readonly',
  Worker: 'readonly',
  MessageChannel: 'readonly',
  DOMException: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  HTMLElement: 'readonly',
  HTMLVideoElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  KeyboardEvent: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  CompressionStream: 'readonly',
  DecompressionStream: 'readonly',
  TransformStream: 'readonly',
  ReadableStream: 'readonly',
  WritableStream: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  URLSearchParams: 'readonly',
  DOMParser: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  self: 'readonly',
  postMessage: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: browserGlobals,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler rules from eslint-plugin-react-hooks 7 assume the
      // compiler is running. This app is not compiled, and these fire on
      // deliberate patterns (measured setState in effects, ref-held meters).
      // Kept visible as warnings rather than silenced or hidden by an ignore.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '*.config.js', '*.config.ts'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
);
