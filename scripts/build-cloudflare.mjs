#!/usr/bin/env node
/**
 * Cloudflare Pages preparation.
 *
 * Cloudflare Pages rejects any single asset above 25 MiB. The on-device
 * transcription runtime ships a ~26.9 MB WASM binary, which is larger than that
 * before compression. This script:
 *
 *   1. finds every emitted .wasm file under dist (no content hash is hard-coded),
 *   2. gzips it in place and proves that gunzip reproduces the original bytes,
 *   3. writes matching `_headers` rules (Content-Type + Content-Encoding),
 *   4. checks that every asset in dist is now under the per-file limit.
 *
 * It is idempotent: a file that already carries the gzip magic is verified,
 * not compressed twice. Ordinary local builds are untouched — this only runs
 * through `npm run build:cloudflare` (or `npm run verify:cloudflare`).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const DIST = resolve(process.argv[2] ?? 'dist');
const LIMIT = 25 * 1024 * 1024;
const BEGIN = '# BEGIN browser-record wasm compression';
const END = '# END browser-record wasm compression';
const GZIP_MAGIC = [0x1f, 0x8b];

function fail(message) {
  console.error(`cloudflare: ${message}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function urlFor(path) {
  return `/${relative(DIST, path).split(sep).join('/')}`;
}

function isGzip(bytes) {
  return bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

if (!existsSync(join(DIST, 'index.html'))) {
  fail(`no build at ${DIST}. Run "npm run build" first.`);
}

const files = walk(DIST);
const wasmFiles = files.filter((path) => path.endsWith('.wasm'));
if (wasmFiles.length === 0) {
  console.warn('cloudflare: no .wasm assets were emitted; nothing to compress.');
}

const rules = [];
const prepared = [];
for (const path of wasmFiles) {
  const bytes = readFileSync(path);
  let compressed;
  if (isGzip(bytes)) {
    // Already prepared by an earlier run: decompress and verify rather than
    // gzipping the gzip stream into an unreadable file.
    try {
      compressed = bytes;
      const restored = gunzipSync(bytes);
      if (!(restored.length >= 4 && restored[0] === 0x00 && restored[1] === 0x61 && restored[2] === 0x73 && restored[3] === 0x6d)) {
        fail(`${urlFor(path)} is gzip but does not decompress to a wasm module.`);
      }
    } catch (error) {
      fail(`${urlFor(path)} is gzip but could not be decompressed: ${error.message}`);
    }
  } else {
    compressed = gzipSync(bytes, { level: 9 });
    const restored = gunzipSync(compressed);
    if (!restored.equals(bytes)) {
      fail(`${urlFor(path)} does not survive a gzip round trip.`);
    }
    writeFileSync(path, compressed);
  }
  rules.push(urlFor(path));
  prepared.push({ url: urlFor(path), original: gunzipSync(compressed).length, compressed: compressed.length });
}

function stripManaged(text) {
  const start = text.indexOf(BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(END, start);
  if (end === -1) return text.slice(0, start);
  return `${text.slice(0, start)}${text.slice(end + END.length)}`.trim();
}

function removeRule(text, url) {
  const lines = text.split('\n');
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === url) {
      // Skip this rule and its indented header lines.
      index += 1;
      while (index < lines.length && /^\s+\S/.test(lines[index])) index += 1;
      index -= 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

const headersPath = join(DIST, '_headers');
let headers = existsSync(headersPath) ? stripManaged(readFileSync(headersPath, 'utf8')) : '';
for (const rule of rules) headers = removeRule(headers, rule);
headers = headers.trim();

if (rules.length > 0) {
  const block = [
    BEGIN,
    '# These WASM files are stored gzipped on disk so each stays under the',
    '# Cloudflare Pages 25 MiB per-file limit. The headers below are what make',
    '# the compressed bytes load as a normal application/wasm response.',
    ...rules.flatMap((rule) => [rule, '  Content-Type: application/wasm', '  Content-Encoding: gzip']),
    END,
  ].join('\n');
  headers = headers ? `${headers}\n\n${block}` : block;
}

if (headers) writeFileSync(headersPath, `${headers}\n`);

const oversized = files
  .map((path) => ({ path, size: statSync(path).size }))
  .filter((entry) => entry.size > LIMIT);
if (oversized.length > 0) {
  const detail = oversized
    .map((entry) => `${urlFor(entry.path)} ${(entry.size / (1024 * 1024)).toFixed(2)} MiB`)
    .join('\n  ');
  fail(`assets exceed the 25 MiB Cloudflare Pages per-file limit:\n  ${detail}`);
}

for (const entry of prepared) {
  console.log(
    `cloudflare: ${entry.url} ${(entry.original / 1e6).toFixed(2)} MB → ${(entry.compressed / 1e6).toFixed(2)} MB gzip`,
  );
}
console.log(
  `cloudflare: ${prepared.length} wasm asset(s) prepared, ${files.length} file(s) checked, ` +
    `largest ${(Math.max(0, ...files.map((path) => statSync(path).size)) / (1024 * 1024)).toFixed(2)} MiB, headers at ${urlFor(headersPath)}`,
);
