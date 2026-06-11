/**
 * web-system-info.test.ts
 *
 * Unit tests for WebSystemInfo.recommendedWorkerCount clamp semantics.
 *
 * Formula: clamp(hardwareConcurrency − mainThreadReservation, fallbackWorkerCount, maximumWorkers)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RecommendedWorkerCountConfig } from '@noocodex/dagonizer/entities';

import { WebSystemInfo } from '../../src/WebSystemInfo.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function config(overrides: Partial<RecommendedWorkerCountConfig> = {}): RecommendedWorkerCountConfig {
  return {
    'maximumWorkers': 8,
    'mainThreadReservation': 1,
    'fallbackWorkerCount': 1,
    'memoryPerWorkerBytes': null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('WebSystemInfo', () => {

  // ── recommendedWorkerCount clamp ───────────────────────────────────────────

  void it('returns hardwareConcurrency − mainThreadReservation for a normal 8-core machine', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 8 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 16, 'mainThreadReservation': 1, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 7);
  });

  void it('clamps to maximumWorkers when raw count exceeds it', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 32 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 4, 'mainThreadReservation': 1, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 4);
  });

  void it('returns fallbackWorkerCount when raw count is zero (single-core minus reservation)', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 1 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 1, 'fallbackWorkerCount': 2 }));
    // raw = 1 − 1 = 0; fallback = 2; max(0, 2) = 2
    assert.strictEqual(count, 2);
  });

  void it('returns fallbackWorkerCount when raw count is negative', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 1 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 2, 'fallbackWorkerCount': 1 }));
    // raw = 1 − 2 = −1; fallback = 1; max(−1, 1) = 1
    assert.strictEqual(count, 1);
  });

  void it('handles mainThreadReservation of 0 — uses full concurrency', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 4 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 4);
  });

  // ── Safe fallbacks for missing / bad probes ────────────────────────────────

  void it('falls back to hardwareConcurrency=1 when probe is absent', () => {
    const info = new WebSystemInfo({});
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'fallbackWorkerCount': 1 }));
    // hardwareConcurrency=1, reservation=0 → raw=1; min(1,8)=1
    assert.strictEqual(count, 1);
  });

  void it('falls back to hardwareConcurrency=1 when probe is zero', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 0 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 1);
  });

  void it('falls back to hardwareConcurrency=1 when probe is negative', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': -4 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 1);
  });

  void it('defaults constructor probes to safe values when none provided', () => {
    const info = new WebSystemInfo();
    // No probes: hardwareConcurrency defaults to 1.
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 1);
  });

  // ── memoryPerWorkerBytes is ignored (no memory API in browsers) ────────────

  void it('memoryPerWorkerBytes in config does not throw and result is unchanged', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 4 });
    const countWithout = info.recommendedWorkerCount(config({ 'memoryPerWorkerBytes': null }));
    const countWith = info.recommendedWorkerCount(config({ 'memoryPerWorkerBytes': 512 * 1024 * 1024 }));
    // Memory-based clamping is not implemented for browsers; both return same value.
    assert.strictEqual(countWithout, countWith);
  });

  // ── Edge: maximumWorkers = 1 (single-worker pool) ─────────────────────────

  void it('respects maximumWorkers=1 regardless of concurrency', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 16 });
    const count = info.recommendedWorkerCount(config({ 'maximumWorkers': 1, 'mainThreadReservation': 1, 'fallbackWorkerCount': 1 }));
    assert.strictEqual(count, 1);
  });

  // ── Quadrascope clamp semantics: result is always ≥ fallback and ≤ max ─────

  void it('result is always between fallbackWorkerCount and maximumWorkers (fuzz sample)', () => {
    for (const concurrency of [1, 2, 4, 8, 16, 32]) {
      for (const reservation of [0, 1, 2]) {
        for (const fallback of [1, 2]) {
          for (const maximum of [1, 2, 4, 8]) {
            const info = new WebSystemInfo({ 'hardwareConcurrency': concurrency });
            const result = info.recommendedWorkerCount(config({
              'maximumWorkers': maximum,
              'mainThreadReservation': reservation,
              'fallbackWorkerCount': fallback,
            }));
            // maximumWorkers is a hard cap: when fallback > maximum, maximum wins.
            assert.ok(result >= Math.min(fallback, maximum), `result ${result} < min(fallback ${fallback}, maximum ${maximum}) for concurrency=${concurrency}`);
            assert.ok(result <= maximum, `result ${result} > maximum ${maximum} for concurrency=${concurrency}`);
          }
        }
      }
    }
  });
});
