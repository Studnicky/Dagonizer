/**
 * NodeSystemInfo: SystemInfoInterface implementation for Node.js.
 *
 * Probes `os.availableParallelism()` (cgroup-aware) and `os.freemem()` for
 * memory-based pool-size clamping. All os methods are injectable via the
 * `services` constructor parameter for deterministic testing.
 *
 * Formula:
 *   base  = clamp(parallelism − mainThreadReservation, fallbackWorkerCount, maximumWorkers)
 *   final = memoryPerWorkerBytes != null
 *           ? clamp(Math.floor(freemem / memoryPerWorkerBytes), fallbackWorkerCount, base)
 *           : base
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import os from 'node:os';

import type { SystemInfoInterface } from '@noocodex/dagonizer/contracts';
import type { RecommendedWorkerCountConfig } from '@noocodex/dagonizer/entities';

// ---------------------------------------------------------------------------
// OsServices: injectable os probe surface
// ---------------------------------------------------------------------------

export interface OsServices {
  availableParallelism(): number;
  totalmem(): number;
  freemem(): number;
}

// ---------------------------------------------------------------------------
// NodeSystemInfoServices: top-level DI bag
// ---------------------------------------------------------------------------

export interface NodeSystemInfoServices {
  readonly os?: OsServices;
}

// ---------------------------------------------------------------------------
// NodeSystemInfo
// ---------------------------------------------------------------------------

const DEFAULT_OS: OsServices = {
  'availableParallelism': () => os.availableParallelism(),
  'totalmem': () => os.totalmem(),
  'freemem': () => os.freemem(),
};

export class NodeSystemInfo implements SystemInfoInterface {
  readonly #os: OsServices;

  constructor(services: NodeSystemInfoServices = {}) {
    this.#os = services.os ?? DEFAULT_OS;
  }

  recommendedWorkerCount(config: RecommendedWorkerCountConfig): number {
    const {
      maximumWorkers,
      mainThreadReservation,
      fallbackWorkerCount,
      memoryPerWorkerBytes,
    } = config;

    const parallelism = this.#os.availableParallelism();
    // maximumWorkers is a hard cap: it wins over fallbackWorkerCount when the
    // two conflict (a pool must never exceed its configured ceiling).
    const base = Math.min(maximumWorkers, Math.max(fallbackWorkerCount, parallelism - mainThreadReservation));

    if (memoryPerWorkerBytes !== null) {
      const freemem = this.#os.freemem();
      const memoryBased = Math.floor(freemem / memoryPerWorkerBytes);
      return Math.min(base, Math.max(fallbackWorkerCount, memoryBased));
    }

    return base;
  }
}
