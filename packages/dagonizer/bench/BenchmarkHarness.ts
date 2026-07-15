import { performance } from 'node:perf_hooks';

type MemorySnapshot = {
  readonly heapUsedBytes: number;
  readonly rssBytes: number;
  readonly externalBytes: number;
};

type BenchmarkMeasurement = {
  readonly elapsedMs: number;
  readonly heapUsedBeforeBytes: number;
  readonly heapUsedAfterBytes: number;
  readonly heapUsedPeakBytes: number;
  readonly heapUsedDeltaBytes: number;
  readonly rssBeforeBytes: number;
  readonly rssAfterBytes: number;
  readonly rssPeakBytes: number;
  readonly externalBeforeBytes: number;
  readonly externalAfterBytes: number;
};

/** Shared timing, sampled-memory, and percentile measurements for graph benchmarks. */
export class BenchmarkHarness {
  static elapsed(operation: () => void): number {
    const started = performance.now();
    operation();
    return performance.now() - started;
  }

  static measure(operation: () => void): BenchmarkMeasurement {
    const before = BenchmarkHarness.memory();
    let peak = before;
    const started = performance.now();
    operation();
    peak = BenchmarkHarness.maxMemory(peak, BenchmarkHarness.memory());
    const after = BenchmarkHarness.memory();
    peak = BenchmarkHarness.maxMemory(peak, after);
    return {
      'elapsedMs': performance.now() - started,
      'heapUsedBeforeBytes': before.heapUsedBytes,
      'heapUsedAfterBytes': after.heapUsedBytes,
      'heapUsedPeakBytes': peak.heapUsedBytes,
      'heapUsedDeltaBytes': after.heapUsedBytes - before.heapUsedBytes,
      'rssBeforeBytes': before.rssBytes,
      'rssAfterBytes': after.rssBytes,
      'rssPeakBytes': peak.rssBytes,
      'externalBeforeBytes': before.externalBytes,
      'externalAfterBytes': after.externalBytes,
    };
  }

  static measureIterations(iterations: number, operation: (index: number) => void): BenchmarkMeasurement {
    const before = BenchmarkHarness.memory();
    let peak = before;
    const started = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      operation(index);
      if ((index & 63) === 63) peak = BenchmarkHarness.maxMemory(peak, BenchmarkHarness.memory());
    }
    const after = BenchmarkHarness.memory();
    peak = BenchmarkHarness.maxMemory(peak, after);
    return {
      'elapsedMs': performance.now() - started,
      'heapUsedBeforeBytes': before.heapUsedBytes,
      'heapUsedAfterBytes': after.heapUsedBytes,
      'heapUsedPeakBytes': peak.heapUsedBytes,
      'heapUsedDeltaBytes': after.heapUsedBytes - before.heapUsedBytes,
      'rssBeforeBytes': before.rssBytes,
      'rssAfterBytes': after.rssBytes,
      'rssPeakBytes': peak.rssBytes,
      'externalBeforeBytes': before.externalBytes,
      'externalAfterBytes': after.externalBytes,
    };
  }

  static percentiles(values: readonly number[]): { readonly p50: number; readonly p95: number; readonly p99: number } {
    if (values.length === 0) throw new Error('Cannot calculate percentiles for an empty sample set');
    const sorted = [...values].sort((left, right) => left - right);
    const valueAt = (rank: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(rank * sorted.length) - 1)] ?? 0;
    return { 'p50': valueAt(0.50), 'p95': valueAt(0.95), 'p99': valueAt(0.99) };
  }

  private static memory(): MemorySnapshot {
    const usage = process.memoryUsage();
    return { 'heapUsedBytes': usage.heapUsed, 'rssBytes': usage.rss, 'externalBytes': usage.external };
  }

  private static maxMemory(left: MemorySnapshot, right: MemorySnapshot): MemorySnapshot {
    return {
      'heapUsedBytes': Math.max(left.heapUsedBytes, right.heapUsedBytes),
      'rssBytes': Math.max(left.rssBytes, right.rssBytes),
      'externalBytes': Math.max(left.externalBytes, right.externalBytes),
    };
  }
}
