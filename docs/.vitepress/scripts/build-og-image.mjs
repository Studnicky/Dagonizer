#!/usr/bin/env node
/**
 * build-og-image.mjs — stamps the current package.json version into the
 * og-image SVG and renders it to a PNG via rsvg-convert.
 *
 * Source template: docs/public/og-image.svg
 *   Must contain a version placeholder text element:
 *     <text class="version-stamp" ...>v0.0.0</text>
 *   The script replaces the placeholder value in-place. On every build the
 *   SVG is rewritten with the current version; when the version has not
 *   changed the file content is identical so git shows no diff.
 *
 * Outputs:
 *   docs/public/og-image.svg  — versioned SVG (committed, crawler-friendly)
 *   docs/public/og-image.png  — 1200×630 PNG rasterized by rsvg-convert
 *
 * Run via:  npm run docs:og-image
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE      = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const PKG       = resolve(REPO_ROOT, 'package.json');
const SVG_OUT   = resolve(REPO_ROOT, 'docs', 'public', 'og-image.svg');
const PNG_OUT   = resolve(REPO_ROOT, 'docs', 'public', 'og-image.png');

// ── 1. Read version ──────────────────────────────────────────────────────────
const { version } = JSON.parse(readFileSync(PKG, 'utf8'));
const versionLabel = `v${version}`;

// ── 2. Read SVG (treat as template) ─────────────────────────────────────────
let svg = readFileSync(SVG_OUT, 'utf8');

// ── 3. Stamp version ─────────────────────────────────────────────────────────
// The version-stamp text element is identified by the "version-stamp" class.
// On first run it is injected just before </svg>. On subsequent runs the
// existing element's text content is updated in-place.
//
// A global replace handles any accidental duplicates (left by earlier runs
// before the idempotency fix): all occurrences become the current version,
// then duplicates are collapsed to a single element.

const STAMP_BLOCK_RE = /\n  <text\n    class="version-stamp meta"\n    x="52"\n    y="598"\n    font-size="15"\n  >v[\d.]+<\/text>/g;
const STAMP_INLINE_RE = /(<text[^>]*class="[^"]*version-stamp[^"]*"[^>]*>)(v[\d.]+)(<\/text>)/g;

const stampElement = [
  `\n  <text`,
  `    class="version-stamp meta"`,
  `    x="52"`,
  `    y="598"`,
  `    font-size="15"`,
  `  >${versionLabel}</text>`,
].join('\n');

if (STAMP_BLOCK_RE.test(svg) || STAMP_INLINE_RE.test(svg)) {
  // Remove ALL existing stamp elements, then inject one canonical copy.
  svg = svg.replace(STAMP_BLOCK_RE, '');
  svg = svg.replace(STAMP_INLINE_RE, '');
  svg = svg.replace('</svg>', `${stampElement}\n\n</svg>`);
} else {
  // First run: inject the version-stamp element just before </svg>.
  // Position: bottom-left corner, inside the viewport with comfortable margin.
  svg = svg.replace('</svg>', `${stampElement}\n\n</svg>`);
  console.log('build-og-image: injected version-stamp element into og-image.svg');
}

// ── 4. Write versioned SVG ───────────────────────────────────────────────────
writeFileSync(SVG_OUT, svg, 'utf8');
console.log(`build-og-image: wrote ${SVG_OUT} (${versionLabel})`);

// ── 5. Rasterize to PNG via rsvg-convert ────────────────────────────────────
const result = spawnSync(
  'rsvg-convert',
  ['-w', '1200', '-h', '630', SVG_OUT, '-o', PNG_OUT],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error('build-og-image: rsvg-convert not found —', result.error.message);
  console.error('Install via: brew install librsvg');
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`build-og-image: rsvg-convert exited with status ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log(`build-og-image: wrote ${PNG_OUT}`);
