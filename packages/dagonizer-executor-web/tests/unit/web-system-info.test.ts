/**
 * web-system-info.test.ts
 *
 * Unit tests for WebSystemInfo.recommendedWorkerCount clamp semantics.
 *
 * Formula: clamp(hardwareConcurrency − mainThreadReservation, minimumWorkerCount, maximumWorkers)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RecommendedWorkerCountConfigType } from '@studnicky/dagonizer/entities';

import { WebSystemInfo } from '../../src/WebSystemInfo.js';

// ---------------------------------------------------------------------------
// WorkerCountConfig: default config with optional overrides
// ---------------------------------------------------------------------------

class WorkerCountConfig {
  private constructor() {}

  static of(overrides: Partial<RecommendedWorkerCountConfigType> = {}): RecommendedWorkerCountConfigType {
    return {
      'maximumWorkers': 8,
      'mainThreadReservation': 1,
      'minimumWorkerCount': 1,
      'memoryPerWorkerBytes': null,
      ...overrides,
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('WebSystemInfo', () => {

  // ── recommendedWorkerCount clamp ───────────────────────────────────────────

  void it('returns hardwareConcurrency − mainThreadReservation for a normal 8-core machine', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 8 });
    const count = info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 16, 'mainThreadReservation': 1, 'minimumWorkerCount': 1 }));
    assert.strictEqual(count, 7);
  });

  void it('clamps to maximumWorkers when raw count exceeds it', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 32 });
    const count = info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 4, 'mainThreadReservation': 1, 'minimumWorkerCount': 1 }));
    assert.strictEqual(count, 4);
  });

  void it('returns minimumWorkerCount when raw count is zero (single-core minus reservation)', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 1 });
    const count = info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 8, 'mainThreadReservation': 1, 'minimumWorkerCount': 2 }));
    // raw = 1 − 1 = 0; minimum = 2; max(0, 2) = 2
    assert.strictEqual(count, 2);
  });

  void it('returns minimumWorkerCount when raw count is negative', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 1 });
    const count = info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 8, 'mainThreadReservation': 2, 'minimumWorkerCount': 1 }));
    // raw = 1 − 2 = −1; minimum = 1; max(−1, 1) = 1
    assert.strictEqual(count, 1);
  });

  void it('handles mainThreadReservation of 0 — uses full concurrency', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 4 });
    const count = info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'minimumWorkerCount': 1 }));
    assert.strictEqual(count, 4);
  });

  // ── Safe defaults for missing / bad probes ────────────────────────────────

  void it('treats absent, zero, and negative concurrency probes as hardwareConcurrency=1', () => {
    // Each unusable probe normalizes to 1; with reservation=0 → raw=1; min(1,8)=1.
    // Construction styles covered: no-arg, empty probe object, explicit bad values.
    const minimumConfig = WorkerCountConfig.of({ 'maximumWorkers': 8, 'mainThreadReservation': 0, 'minimumWorkerCount': 1 });

    assert.strictEqual(
      new WebSystemInfo().recommendedWorkerCount(minimumConfig),
      1,
      'no-arg constructor defaults hardwareConcurrency to 1',
    );
    assert.strictEqual(
      new WebSystemInfo({}).recommendedWorkerCount(minimumConfig),
      1,
      'empty probe object uses hardwareConcurrency=1',
    );
    assert.strictEqual(
      new WebSystemInfo({ 'hardwareConcurrency': 0 }).recommendedWorkerCount(minimumConfig),
      1,
      'zero probe uses hardwareConcurrency=1',
    );
    assert.strictEqual(
      new WebSystemInfo({ 'hardwareConcurrency': -4 }).recommendedWorkerCount(minimumConfig),
      1,
      'negative probe uses hardwareConcurrency=1',
    );
  });

  // ── memoryPerWorkerBytes is ignored (no memory API in browsers) ────────────

  void it('memoryPerWorkerBytes in config does not throw and result is unchanged', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 4 });
    const countWithout = info.recommendedWorkerCount(WorkerCountConfig.of({ 'memoryPerWorkerBytes': null }));
    const countWith = info.recommendedWorkerCount(WorkerCountConfig.of({ 'memoryPerWorkerBytes': 512 * 1024 * 1024 }));
    // Memory-based clamping is not implemented for browsers; both return same value.
    assert.strictEqual(countWithout, countWith);
  });

  // ── Edge: maximumWorkers = 1 (single-worker pool) ─────────────────────────

  void it('respects maximumWorkers=1 regardless of concurrency', () => {
    const info = new WebSystemInfo({ 'hardwareConcurrency': 16 });
    const count = info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 1, 'mainThreadReservation': 1, 'minimumWorkerCount': 1 }));
    assert.strictEqual(count, 1);
  });

  // ── Quadrascope clamp semantics: result is always ≥ minimum and ≤ max ─────

  void it('result is always between minimumWorkerCount and maximumWorkers (fuzz sample)', () => {
    for (const concurrency of [1, 2, 4, 8, 16, 32]) {
      for (const reservation of [0, 1, 2]) {
        for (const minimum of [1, 2]) {
          for (const maximum of [1, 2, 4, 8]) {
            const info = new WebSystemInfo({ 'hardwareConcurrency': concurrency });
            const result = info.recommendedWorkerCount(WorkerCountConfig.of({
              'maximumWorkers': maximum,
              'mainThreadReservation': reservation,
              'minimumWorkerCount': minimum,
            }));
            // maximumWorkers is a hard cap: when minimum > maximum, maximum wins.
            assert.ok(result >= Math.min(minimum, maximum), `result ${result} < min(minimum ${minimum}, maximum ${maximum}) for concurrency=${concurrency}`);
            assert.ok(result <= maximum, `result ${result} > maximum ${maximum} for concurrency=${concurrency}`);
          }
        }
      }
    }
  });
});
