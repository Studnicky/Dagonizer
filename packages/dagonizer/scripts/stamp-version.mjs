#!/usr/bin/env node
/**
 * Stamp the current package version into versioned SVG assets.
 *
 * Reads `package.json` for the canonical version, then for each
 * `.svg.template` under `docs/public/`, writes a sibling `.svg` with every
 * `__VERSION__` placeholder replaced by `v<version>`.
 *
 * Designed to be run before release commits so the SVG referenced by the
 * README and GitHub release notes always carries the released version.
 *
 * Usage:
 *   node scripts/stamp-version.mjs           # stamp + write
 *   node scripts/stamp-version.mjs --check   # exit non-zero if any output is stale
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Script lives at packages/dagonizer/scripts/. Walk up twice to reach the workspace root,
// where docs/public lives.
const PKG_ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = join(PKG_ROOT, '..', '..');
const PKG_PATH       = join(PKG_ROOT, 'package.json');
const PUBLIC_DIR     = join(WORKSPACE_ROOT, 'docs/public');

const pkg     = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const version = pkg.version;
const tag     = `v${version}`;

const templates = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.svg.template'));
if (templates.length === 0) {
  console.error('stamp-version: no .svg.template files under docs/public/');
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');
let drift       = false;

for (const tmpl of templates) {
  const templatePath = join(PUBLIC_DIR, tmpl);
  const outputPath   = join(PUBLIC_DIR, basename(tmpl, '.template'));
  const stamped      = readFileSync(templatePath, 'utf8').replaceAll('__VERSION__', tag);

  if (checkOnly) {
    let existing = '';
    try { existing = readFileSync(outputPath, 'utf8'); } catch { /* missing */ }
    if (existing !== stamped) {
      console.error(`stamp-version: ${basename(outputPath)} is stale (expected version ${tag})`);
      drift = true;
    }
    continue;
  }

  writeFileSync(outputPath, stamped);
  console.log(`stamp-version: wrote ${basename(outputPath)} (${tag})`);
}

if (checkOnly && drift) {
  console.error('stamp-version: run `node scripts/stamp-version.mjs` to regenerate');
  process.exit(1);
}
