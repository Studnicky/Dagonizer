#!/usr/bin/env node
/**
 * build-version-badge.mjs — emits a self-hosted version badge SVG.
 *
 * Output: docs/public/version-badge.svg
 *   A small pill badge (196×28 px) showing the current package.json version.
 *   Style: dark label half (#0a0e1a) + cyan value half (#22e8ff), white text.
 *   No external fonts or dependencies — uses system monospace stack.
 *
 * Reference in README via the raw.githubusercontent.com URL:
 *   https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/version-badge.svg
 *
 * Idempotent: re-running with the same package.json version produces an
 * identical file; git shows no diff when the version has not changed.
 *
 * Run via:  npm run docs:version-badge
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE      = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const PKG       = resolve(REPO_ROOT, 'package.json');
const BADGE_OUT = resolve(REPO_ROOT, 'docs', 'public', 'version-badge.svg');

// ── 1. Read version ──────────────────────────────────────────────────────────
const { version } = JSON.parse(readFileSync(PKG, 'utf8'));
const versionLabel = `v${version}`;

// ── 2. Compute dimensions ────────────────────────────────────────────────────
// Monospace char width at font-size 13 is approximately 7.8px.
// Label "version" = 7 chars × 7.8 ≈ 55px; add 16px padding each side → 87px.
// Value e.g. "v0.5.0" = 6 chars × 7.8 ≈ 47px; add 12px padding each side → 71px.
// Total width = labelW + valueW. Height = 28px.

const CHAR_W    = 7.8;
const PAD_LABEL = 10;  // left+right padding on label half
const PAD_VALUE = 12;  // left+right padding on value half
const HEIGHT    = 28;
const FONT_SIZE = 13;
const RADIUS    = 6;

const LABEL_TEXT = 'version';
const labelW = Math.ceil(LABEL_TEXT.length * CHAR_W) + PAD_LABEL * 2;
const valueW = Math.ceil(versionLabel.length * CHAR_W) + PAD_VALUE * 2;
const totalW = labelW + valueW;

const labelCx = labelW / 2;
const valueCx = labelW + valueW / 2;
const textY   = Math.round(HEIGHT / 2 + FONT_SIZE * 0.35);

// ── 3. Build SVG ─────────────────────────────────────────────────────────────
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${HEIGHT}" role="img" aria-label="${LABEL_TEXT}: ${versionLabel}">
  <title>${LABEL_TEXT}: ${versionLabel}</title>
  <linearGradient id="bg-label" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#141a2e"/>
    <stop offset="1" stop-color="#0a0e1a"/>
  </linearGradient>
  <linearGradient id="bg-value" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1bd4ef"/>
    <stop offset="1" stop-color="#12a8c4"/>
  </linearGradient>
  <!-- pill outline -->
  <rect x="0" y="0" width="${totalW}" height="${HEIGHT}" rx="${RADIUS}" ry="${RADIUS}" fill="url(#bg-label)"/>
  <!-- value half overlaps to fill right side cleanly -->
  <rect x="${labelW}" y="0" width="${valueW}" height="${HEIGHT}" rx="${RADIUS}" ry="${RADIUS}" fill="url(#bg-value)"/>
  <rect x="${labelW}" y="0" width="${RADIUS}" height="${HEIGHT}" fill="url(#bg-value)"/>
  <!-- label text -->
  <text
    x="${labelCx}"
    y="${textY}"
    font-family="ui-monospace,'SF Mono',Menlo,Consolas,monospace"
    font-size="${FONT_SIZE}"
    font-weight="600"
    fill="#a0bfd4"
    text-anchor="middle"
    xml:space="preserve"
  >${LABEL_TEXT}</text>
  <!-- value text -->
  <text
    x="${valueCx}"
    y="${textY}"
    font-family="ui-monospace,'SF Mono',Menlo,Consolas,monospace"
    font-size="${FONT_SIZE}"
    font-weight="700"
    fill="#0a0e1a"
    text-anchor="middle"
    xml:space="preserve"
  >${versionLabel}</text>
</svg>
`;

// ── 4. Write badge ───────────────────────────────────────────────────────────
writeFileSync(BADGE_OUT, svg, 'utf8');
console.log(`build-version-badge: wrote ${BADGE_OUT} (${versionLabel})`);
