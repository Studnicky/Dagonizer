/**
 * system-info.test.ts
 *
 * Unit tests for SystemInfo.recommendedWorkerCount — the canonical worker-
 * count clamp shared by the node and web executor packages.
 *
 * Tests cover:
 *   1. Base clamp: parallelism minus mainThreadReservation, bounded by
 *      [fallbackWorkerCount, maximumWorkers], floored at 1.
 *   2. Memory clamp: applied when memoryPerWorkerBytes and freeMemoryBytes
 *      are both non-null and positive.
 *   3. Memory clamp skipped when freeMemoryBytes is null (browser path).
 *   4. Memory clamp skipped when memoryPerWorkerBytes is null.
 *   5. Edge cases: single-core host, zero reservation, max cap.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RecommendedWorkerCountConfigType } from '../../src/entities/executor/RecommendedWorkerCountConfig.js';
import { SystemInfo } from '../../src/entities/executor/SystemInfo.js';
import type { SystemInfoProbesType } from '../../src/entities/executor/SystemInfo.js';

// Helper: build a config with sensible defaults, override as needed.
function cfg(overrides: Partial<RecommendedWorkerCountConfigType> = {}): RecommendedWorkerCountConfigType {
  return {
    'maximumWorkers': 16,
    'mainThreadReservation': 1,
    'fallbackWorkerCount': 1,
    'memoryPerWorkerBytes': null,
    ...overrides,
  };
}

// Helper: build probes.
function probes(parallelism: number, freeMemoryBytes: number | null = null): SystemInfoProbesType {
  return { parallelism, freeMemoryBytes };
}

void describe('SystemInfo.recommendedWorkerCount — base clamp', () => {
  void it('4-core host, 1 reserved → 3 workers', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(cfg(), probes(4)),
      3,
    );
  });

  void it('8-core host, 1 reserved, cap 16 → 7 workers', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(cfg({ 'maximumWorkers': 16 }), probes(8)),
      7,
    );
  });

  void it('maximumWorkers caps: 32-core host, cap 4 → 4 workers', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(cfg({ 'maximumWorkers': 4 }), probes(32)),
      4,
    );
  });

  void it('fallbackWorkerCount floor: 1-core host → min 1 worker', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        cfg({ 'fallbackWorkerCount': 1, 'mainThreadReservation': 1 }),
        probes(1),
      ),
      1,
    );
  });

  void it('parallelism - reservation goes negative → still floored at 1', () => {
    // 1 core, 2 reserved → raw = -1; fallback = 1; max(1, min(16, max(1, -1))) = 1
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        cfg({ 'mainThreadReservation': 2, 'fallbackWorkerCount': 1 }),
        probes(1),
      ),
      1,
    );
  });

  void it('fallbackWorkerCount > (parallelism - reservation) → fallback wins', () => {
    // 4-core, 1 reserved → raw=3; fallback=5; min(16, max(5, 3)) = 5
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        cfg({ 'fallbackWorkerCount': 5 }),
        probes(4),
      ),
      5,
    );
  });

  void it('zero mainThreadReservation → all cores usable', () => {
    // 4 cores, 0 reserved → raw=4; min(16, max(1, 4)) = 4
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        cfg({ 'mainThreadReservation': 0 }),
        probes(4),
      ),
      4,
    );
  });
});

void describe('SystemInfo.recommendedWorkerCount — memory clamp', () => {
  void it('memory clamp reduces base when memory is constrained', () => {
    // base = min(16, max(1, 8-1)) = 7
    // memoryBased = floor(512MB / 128MB) = 4
    // final = max(1, min(7, max(1, 4))) = 4
    const result = SystemInfo.recommendedWorkerCount(
      cfg({ 'memoryPerWorkerBytes': 128 * 1024 * 1024 }),
      probes(8, 512 * 1024 * 1024),
    );
    assert.equal(result, 4);
  });

  void it('memory clamp does not increase beyond base', () => {
    // base = min(16, max(1, 8-1)) = 7
    // memoryBased = floor(8GB / 128MB) = 64
    // final = max(1, min(7, max(1, 64))) = 7  (base wins, memory is abundant)
    const result = SystemInfo.recommendedWorkerCount(
      cfg({ 'memoryPerWorkerBytes': 128 * 1024 * 1024 }),
      probes(8, 8 * 1024 * 1024 * 1024),
    );
    assert.equal(result, 7);
  });

  void it('memory clamp is skipped when freeMemoryBytes is null (browser path)', () => {
    // Would be memory-clamped if freeMemoryBytes were provided, but it is null.
    const result = SystemInfo.recommendedWorkerCount(
      cfg({ 'memoryPerWorkerBytes': 1 }),  // tiny per-worker budget
      probes(8, null),
    );
    // base = 7; memory clamp skipped → 7
    assert.equal(result, 7);
  });

  void it('memory clamp is skipped when memoryPerWorkerBytes is null', () => {
    const result = SystemInfo.recommendedWorkerCount(
      cfg({ 'memoryPerWorkerBytes': null }),
      probes(8, 512 * 1024 * 1024),
    );
    // base = 7; no memory clamp → 7
    assert.equal(result, 7);
  });

  void it('memory clamp respects fallbackWorkerCount floor', () => {
    // base = 7; memoryBased = floor(64MB / 256MB) = 0
    // final = max(1, min(7, max(2, 0))) = 2  (fallback=2 wins over 0)
    const result = SystemInfo.recommendedWorkerCount(
      cfg({ 'memoryPerWorkerBytes': 256 * 1024 * 1024, 'fallbackWorkerCount': 2 }),
      probes(8, 64 * 1024 * 1024),
    );
    assert.equal(result, 2);
  });

  void it('memory clamp floors at 1 even when fallbackWorkerCount is 0', () => {
    // This is a guard against misconfigured fallback; result can never be < 1.
    const result = SystemInfo.recommendedWorkerCount(
      cfg({ 'memoryPerWorkerBytes': 256 * 1024 * 1024, 'fallbackWorkerCount': 0 }),
      probes(8, 64 * 1024 * 1024),
    );
    assert.equal(result, 1);
  });
});
