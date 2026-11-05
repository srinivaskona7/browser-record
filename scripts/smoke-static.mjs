#!/usr/bin/env node
/**
 * Static-path smoke test for the deployed build.
 *
 * GitHub Pages serves the bundle from /<repo>/ with no server rewrites, so a
 * passing vite build is not enough: every asset the HTML references must exist
 * in dist and must be reachable under the configured base path. This catches
 * the classic "works locally, blank page on Pages" failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');

if (!existsSync(dist)) {
  console.error(`smoke: no build directory at ${dist}`);
  process.exit(1);
}

const index = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);

if (refs.length === 0) {
  console.error('smoke: index.html references no assets');
  process.exit(1);
}

// Derive the base from the build itself. Taking it from the environment made
// `npm run smoke` after `BASE_PATH=… npm run build` check the wrong prefix.
const firstAsset = refs.find((ref) => ref.includes('assets/'));
const derivedBase = firstAsset ? firstAsset.slice(0, firstAsset.indexOf('assets/')) : '/';
const base = process.env.BASE_PATH ?? derivedBase;
const normalizedBase = base.endsWith('/') ? base : `${base}/`;
if (process.env.BASE_PATH && derivedBase !== normalizedBase) {
  console.error(
    `smoke: build uses base "${derivedBase}" but BASE_PATH is "${normalizedBase}" — rebuild with the same BASE_PATH.`,
  );
  process.exit(1);
}

let checked = 0;
function fail(message) {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
}

for (const ref of refs) {
  if (/^(https?:|data:|#)/.test(ref)) continue;
  if (normalizedBase !== '/' && !ref.startsWith(normalizedBase)) {
    fail(`asset "${ref}" is not under the configured base "${normalizedBase}"`);
    continue;
  }
  const relative = ref.slice(normalizedBase.length).split(/[?#]/)[0];
  if (!relative) continue;
  const file = join(dist, relative);
  if (!existsSync(file) || !statSync(file).isFile()) {
    fail(`asset "${ref}" resolves to a missing file (${file})`);
    continue;
  }
  checked += 1;
}

if (!index.includes('id="root"')) fail('index.html has no root mount point');

// The baseline build must not depend on cross-origin isolation headers, which
// GitHub Pages cannot set. Presence of a header requirement is a hard failure.
const jsFiles = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.js'));
if (jsFiles.length === 0) fail('dist/assets contains no JavaScript bundle');
for (const name of jsFiles) {
  const source = readFileSync(join(dist, 'assets', name), 'utf8');
  if (/crossOriginIsolated\s*\?\s*[^:]*sharedArrayBuffer/i.test(source)) {
    fail(`bundle ${name} requires cross-origin isolation to use SharedArrayBuffer`);
  }
}

if (process.exitCode) {
  console.error('smoke: FAILED');
} else {
  console.log(`smoke: ${checked} asset(s) verified under base "${normalizedBase}" in ${dist}`);
}
