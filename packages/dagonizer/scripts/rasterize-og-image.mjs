#!/usr/bin/env node
/**
 * Rasterize docs/public/og-image.svg → docs/public/og-image.png via rsvg-convert.
 *
 * Run after stamp-version.mjs has written the versioned SVG:
 *   node scripts/stamp-version.mjs && node scripts/rasterize-og-image.mjs
 *
 * Tolerant of rsvg-convert absence: exits 0 and keeps the committed PNG when
 * librsvg is not installed.
 *
 * Install rsvg-convert:
 *   brew install librsvg          (macOS)
 *   apt-get install librsvg2-bin  (Debian/Ubuntu)
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_OUT = join(ROOT, 'docs', 'public', 'og-image.svg');
const PNG_OUT = join(ROOT, 'docs', 'public', 'og-image.png');

const result = spawnSync(
  'rsvg-convert',
  ['-w', '1200', '-h', '630', SVG_OUT, '-o', PNG_OUT],
  { stdio: 'inherit' },
);

if (result.error || result.status !== 0) {
  if (existsSync(PNG_OUT)) {
    const why = result.error ? `not found (${result.error.message})` : `exited ${result.status}`;
    console.log(`rasterize-og-image: rsvg-convert ${why}; keeping committed ${PNG_OUT}`);
    process.exit(0);
  }
  if (result.error) {
    console.error('rasterize-og-image: rsvg-convert not found:', result.error.message);
    console.error('Install via: brew install librsvg (macOS) or apt-get install librsvg2-bin (Debian/Ubuntu).');
  } else {
    console.error(`rasterize-og-image: rsvg-convert exited with status ${result.status}`);
  }
  process.exit(result.status ?? 1);
}

console.log(`rasterize-og-image: wrote ${PNG_OUT}`);
