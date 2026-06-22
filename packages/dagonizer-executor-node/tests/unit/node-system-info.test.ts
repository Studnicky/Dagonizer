/**
 * node-system-info.test.ts: NodeSystemInfo pool sizing math tests.
 *
 * All tests inject fake os services so no real OS probing occurs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RecommendedWorkerCountConfigType } from '@studnicky/dagonizer/entities';

import { NodeSystemInfo } from '../../src/NodeSystemInfo.js';

// ---------------------------------------------------------------------------
// Fake os services
// ---------------------------------------------------------------------------

class FakeOs {
  private constructor() {}

  static of(parallelism: number, freemem: number = 4 * 1024 * 1024 * 1024): {
    'availableParallelism'(): number;
    'totalmem'(): number;
    'freemem'(): number;
  } {
    return {
      'availableParallelism': () => parallelism,
      'totalmem': () => freemem * 2,
      'freemem': () => freemem,
    };
  }
}

class WorkerCountConfig {
  private constructor() {}

  static of(overrides: Partial<RecommendedWorkerCountConfigType> = {}): RecommendedWorkerCountConfigType {
    return {
      'maximumWorkers': 8,
      'mainThreadReservation': 1,
      'fallbackWorkerCount': 1,
      'memoryPerWorkerBytes': null,
      ...overrides,
    };
  }
}

// ---------------------------------------------------------------------------
// Basic clamp math
// ---------------------------------------------------------------------------

void describe('NodeSystemInfo.recommendedWorkerCount — clamp math', () => {
  void it('returns parallelism − mainThreadReservation when within bounds', () => {
    const info = new NodeSystemInfo({ 'os': FakeOs.of(4) });
    assert.strictEqual(info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 8 })), 3);
  });

  void it('clamps to maximumWorkers when parallelism is large', () => {
    const info = new NodeSystemInfo({ 'os': FakeOs.of(32) });
    assert.strictEqual(info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 4 })), 4);
  });

  void it('clamps to fallbackWorkerCount when parallelism ≤ mainThreadReservation', () => {
    const info = new NodeSystemInfo({ 'os': FakeOs.of(1) });
    assert.strictEqual(info.recommendedWorkerCount(WorkerCountConfig.of({ 'fallbackWorkerCount': 1 })), 1);
  });

  void it('uses fallbackWorkerCount = 2 when base is negative', () => {
    const info = new NodeSystemInfo({ 'os': FakeOs.of(0) });
    assert.strictEqual(
      info.recommendedWorkerCount(WorkerCountConfig.of({ 'fallbackWorkerCount': 2 })),
      2,
    );
  });

  void it('exact parallelism − reservation = maximumWorkers returns maximumWorkers', () => {
    const info = new NodeSystemInfo({ 'os': FakeOs.of(5) });
    assert.strictEqual(info.recommendedWorkerCount(WorkerCountConfig.of({ 'maximumWorkers': 4 })), 4);
  });
});

// ---------------------------------------------------------------------------
// Memory clamping
// ---------------------------------------------------------------------------

void describe('NodeSystemInfo.recommendedWorkerCount — memory clamping', () => {
  void it('further clamps by freemem / memoryPerWorkerBytes', () => {
    // 4 GB free, 1 GB per worker → memory allows 4 workers
    // base = clamp(8−1, 1, 8) = 7; memory cap = 4 → result = 4
    const freemem = 4 * 1024 * 1024 * 1024;
    const perWorker = 1 * 1024 * 1024 * 1024;
    const info = new NodeSystemInfo({ 'os': FakeOs.of(9, freemem) });
    const result = info.recommendedWorkerCount(WorkerCountConfig.of({
      'maximumWorkers': 8,
      'memoryPerWorkerBytes': perWorker,
    }));
    assert.strictEqual(result, 4);
  });

  void it('does not reduce below fallbackWorkerCount from memory clamping', () => {
    // only 100 MB free, 500 MB per worker → floor(100/500) = 0, clamped to fallback=1
    const freemem = 100 * 1024 * 1024;
    const perWorker = 500 * 1024 * 1024;
    const info = new NodeSystemInfo({ 'os': FakeOs.of(4, freemem) });
    const result = info.recommendedWorkerCount(WorkerCountConfig.of({
      'memoryPerWorkerBytes': perWorker,
      'fallbackWorkerCount': 1,
    }));
    assert.strictEqual(result, 1);
  });

  void it('null memoryPerWorkerBytes skips memory clamping', () => {
    const info = new NodeSystemInfo({ 'os': FakeOs.of(4) });
    const result = info.recommendedWorkerCount(WorkerCountConfig.of({ 'memoryPerWorkerBytes': null }));
    assert.strictEqual(result, 3);
  });
});

// ---------------------------------------------------------------------------
// Default os (real os module) — smoke test
// ---------------------------------------------------------------------------

void describe('NodeSystemInfo — default os services', () => {
  void it('returns a positive integer with default os', () => {
    const info = new NodeSystemInfo();
    const result = info.recommendedWorkerCount(WorkerCountConfig.of());
    assert.ok(result >= 1, `expected >= 1, got ${result}`);
    assert.ok(Number.isInteger(result), 'must be integer');
  });
});
