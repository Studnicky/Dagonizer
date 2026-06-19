/**
 * SystemInfo: canonical worker-count clamp computation.
 *
 * Provides the single shared implementation of the recommended-worker-count
 * formula used by `NodeSystemInfo` (dagonizer-executor-node) and
 * `WebSystemInfo` (dagonizer-executor-web). Both executor packages probe
 * their host environment and pass the raw numbers here; this module owns the
 * clamp semantics so the formula is defined once and tested once.
 *
 * Formula:
 *   base  = max(1, min(maximumWorkers, max(fallbackWorkerCount,
 *             parallelism − mainThreadReservation)))
 *   final = memoryPerWorkerBytes != null && freeMemoryBytes != null
 *           ? max(1, min(base, max(fallbackWorkerCount,
 *               floor(freeMemoryBytes / memoryPerWorkerBytes))))
 *           : base
 *
 * `maximumWorkers` is a hard cap that wins over `fallbackWorkerCount`.
 * The floor at 1 ensures a pool never starts with zero workers.
 */

import type { RecommendedWorkerCountConfigType } from './RecommendedWorkerCountConfig.js';

// ---------------------------------------------------------------------------
// SystemInfoProbesType
// ---------------------------------------------------------------------------

/**
 * Raw host-environment measurements passed to `SystemInfo.recommendedWorkerCount`.
 *
 * `parallelism` — number of logical processors reported by the host (e.g.
 *   `os.availableParallelism()` on Node.js, `navigator.hardwareConcurrency`
 *   in a browser). Must be >= 1.
 *
 * `freeMemoryBytes` — bytes of free/available memory at the moment of the
 *   probe (e.g. `os.freemem()` on Node.js). Provide `null` when the host
 *   environment cannot supply a memory reading (browser, Worker, etc.); the
 *   memory clamp is then skipped regardless of `memoryPerWorkerBytes`.
 */
export type SystemInfoProbesType = {
  /** Number of logical processors available to the host. Must be >= 1. */
  readonly parallelism: number;
  /**
   * Free memory in bytes at probe time. `null` when the host environment
   * cannot supply a memory reading; the memory clamp is skipped.
   */
  readonly freeMemoryBytes: number | null;
}

// ---------------------------------------------------------------------------
// SystemInfo
// ---------------------------------------------------------------------------

/**
 * Static utility class that computes the recommended worker count from a
 * `RecommendedWorkerCountConfig` and raw host probes.
 *
 * Both executor packages (`dagonizer-executor-node`, `dagonizer-executor-web`)
 * delegate to this method after obtaining their environment-specific probes.
 * The clamp semantics live here; the executor packages own only the probing.
 */
export class SystemInfo {
  private constructor() { /* static class */ }

  /**
   * Compute the recommended worker-pool size.
   *
   * @param config - Pool-size bounds and defaults from `RecommendedWorkerCountConfig`.
   * @param probes - Raw host measurements (`parallelism`, optional `freeMemoryBytes`).
   * @returns An integer >= 1 that is the recommended pool size.
   *
   * @example
   * // Node.js
   * import os from 'node:os';
   * SystemInfo.recommendedWorkerCount(config, {
   *   parallelism:    os.availableParallelism(),
   *   freeMemoryBytes: os.freemem(),
   * });
   *
   * // Browser / Web Worker
   * SystemInfo.recommendedWorkerCount(config, {
   *   parallelism:    navigator.hardwareConcurrency ?? 1,
   *   freeMemoryBytes: null,
   * });
   */
  static recommendedWorkerCount(
    config: RecommendedWorkerCountConfigType,
    probes: SystemInfoProbesType,
  ): number {
    const {
      maximumWorkers,
      mainThreadReservation,
      fallbackWorkerCount,
      memoryPerWorkerBytes,
    } = config;
    const { parallelism, freeMemoryBytes } = probes;

    // Base clamp: reserve the main thread, apply fallback floor, apply hard cap.
    const base = Math.max(
      1,
      Math.min(
        maximumWorkers,
        Math.max(fallbackWorkerCount, parallelism - mainThreadReservation),
      ),
    );

    // Memory clamp: only when both memoryPerWorkerBytes and freeMemoryBytes are available.
    if (memoryPerWorkerBytes !== null && memoryPerWorkerBytes > 0 && freeMemoryBytes !== null) {
      const memoryBased = Math.floor(freeMemoryBytes / memoryPerWorkerBytes);
      return Math.max(1, Math.min(base, Math.max(fallbackWorkerCount, memoryBased)));
    }

    return base;
  }
}
