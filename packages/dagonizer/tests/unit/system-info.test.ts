/**
 * system-info.test.ts
 *
 * Unit tests for SystemInfo.recommendedWorkerCount — the canonical worker-
 * count clamp shared by the node and web executor packages.
 *
 * Tests cover:
 *   1. Base clamp: parallelism minus mainThreadReservation, bounded by
 *      [minimumWorkerCount, maximumWorkers], floored at 1.
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
class WorkerCountConfig {
  private constructor() {}

  static of(overrides: Partial<RecommendedWorkerCountConfigType> = {}): RecommendedWorkerCountConfigType {
    return {
      'maximumWorkers': 16,
      'mainThreadReservation': 1,
      'minimumWorkerCount': 1,
      'memoryPerWorkerBytes': null,
      ...overrides,
    };
  }
}

// Helper: build probes.
class SystemProbes {
  private constructor() {}

  static of(parallelism: number, freeMemoryBytes: number | null = null): SystemInfoProbesType {
    return { parallelism, freeMemoryBytes };
  }
}

void describe('SystemInfo.recommendedWorkerCount — base clamp', () => {
  void it('4-core host, 1 reserved → 3 workers', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(WorkerCountConfig.of(), SystemProbes.of(4)),
      3,
    );
  });

  void it('8-core host, 1 reserved, cap 16 → 7 workers', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 16 }), SystemProbes.of(8)),
      7,
    );
  });

  void it('maximumWorkers caps: 32-core host, cap 4 → 4 workers', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 4 }), SystemProbes.of(32)),
      4,
    );
  });

  void it('minimumWorkerCount floor: 1-core host → min 1 worker', () => {
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        WorkerCountConfig.of({ 'minimumWorkerCount': 1, 'mainThreadReservation': 1 }),
        SystemProbes.of(1),
      ),
      1,
    );
  });

  void it('parallelism - reservation goes negative → still floored at 1', () => {
    // 1 core, 2 reserved → raw = -1; minimum = 1; max(1, min(16, max(1, -1))) = 1
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        WorkerCountConfig.of({ 'mainThreadReservation': 2, 'minimumWorkerCount': 1 }),
        SystemProbes.of(1),
      ),
      1,
    );
  });

  void it('minimumWorkerCount > (parallelism - reservation) → minimum wins', () => {
    // 4-core, 1 reserved → raw=3; minimum=5; min(16, max(5, 3)) = 5
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        WorkerCountConfig.of({ 'minimumWorkerCount': 5 }),
        SystemProbes.of(4),
      ),
      5,
    );
  });

  void it('zero mainThreadReservation → all cores usable', () => {
    // 4 cores, 0 reserved → raw=4; min(16, max(1, 4)) = 4
    assert.equal(
      SystemInfo.recommendedWorkerCount(
        WorkerCountConfig.of({ 'mainThreadReservation': 0 }),
        SystemProbes.of(4),
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
      WorkerCountConfig.of({ 'memoryPerWorkerBytes': 128 * 1024 * 1024 }),
      SystemProbes.of(8, 512 * 1024 * 1024),
    );
    assert.equal(result, 4);
  });

  void it('memory clamp does not increase beyond base', () => {
    // base = min(16, max(1, 8-1)) = 7
    // memoryBased = floor(8GB / 128MB) = 64
    // final = max(1, min(7, max(1, 64))) = 7  (base wins, memory is abundant)
    const result = SystemInfo.recommendedWorkerCount(
      WorkerCountConfig.of({ 'memoryPerWorkerBytes': 128 * 1024 * 1024 }),
      SystemProbes.of(8, 8 * 1024 * 1024 * 1024),
    );
    assert.equal(result, 7);
  });

  void it('memory clamp is skipped when freeMemoryBytes is null (browser path)', () => {
    // Would be memory-clamped if freeMemoryBytes were provided, but it is null.
    const result = SystemInfo.recommendedWorkerCount(
      WorkerCountConfig.of({ 'memoryPerWorkerBytes': 1 }),  // tiny per-worker budget
      SystemProbes.of(8, null),
    );
    // base = 7; memory clamp skipped → 7
    assert.equal(result, 7);
  });

  void it('memory clamp is skipped when memoryPerWorkerBytes is null', () => {
    const result = SystemInfo.recommendedWorkerCount(
      WorkerCountConfig.of({ 'memoryPerWorkerBytes': null }),
      SystemProbes.of(8, 512 * 1024 * 1024),
    );
    // base = 7; no memory clamp → 7
    assert.equal(result, 7);
  });

  void it('memory clamp respects minimumWorkerCount floor', () => {
    // base = 7; memoryBased = floor(64MB / 256MB) = 0
    // final = max(1, min(7, max(2, 0))) = 2  (minimum=2 wins over 0)
    const result = SystemInfo.recommendedWorkerCount(
      WorkerCountConfig.of({ 'memoryPerWorkerBytes': 256 * 1024 * 1024, 'minimumWorkerCount': 2 }),
      SystemProbes.of(8, 64 * 1024 * 1024),
    );
    assert.equal(result, 2);
  });

  void it('memory clamp floors at 1 even when minimumWorkerCount is 0', () => {
    // This is a guard against misconfigured minimums; result can never be < 1.
    const result = SystemInfo.recommendedWorkerCount(
      WorkerCountConfig.of({ 'memoryPerWorkerBytes': 256 * 1024 * 1024, 'minimumWorkerCount': 0 }),
      SystemProbes.of(8, 64 * 1024 * 1024),
    );
    assert.equal(result, 1);
  });
});
