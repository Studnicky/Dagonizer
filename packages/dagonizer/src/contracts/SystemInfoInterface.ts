/**
 * SystemInfoInterface: host-environment probe for pool sizing recommendations.
 *
 * Adapter contract. Implementations are environment-specific:
 * - NodeSystemInfo (`@studnicky/dagonizer-executor-node`): uses
 *   `os.availableParallelism()` + `os.totalmem()`/`os.freemem()`.
 * - WebSystemInfo (`@studnicky/dagonizer-executor-web`): uses
 *   `navigator.hardwareConcurrency`.
 *
 * The formula follows the quadrascope pattern:
 *   clamp(parallelism − mainThreadReservation, fallbackWorkerCount, maximumWorkers)
 *
 * Memory-based clamping: when `memoryPerWorkerBytes` is non-null and the
 * implementation can probe available memory, the recommended count is
 * further clamped to `Math.floor(availableMemory / memoryPerWorkerBytes)`.
 */

import type { RecommendedWorkerCountConfig } from '../entities/executor/RecommendedWorkerCountConfig.js';

export interface SystemInfoInterface {
  /**
   * Recommend a worker count for a pool given the configuration.
   * Implementations probe the host environment; core entities carry the
   * configuration shape and defaults.
   */
  recommendedWorkerCount(config: RecommendedWorkerCountConfig): number;
}
