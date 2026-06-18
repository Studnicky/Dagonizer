/**
 * NodeSystemInfo: SystemInfoInterface implementation for Node.js.
 *
 * Probes `os.availableParallelism()` (cgroup-aware) and `os.freemem()` for
 * memory-based pool-size clamping. All os methods are injectable via the
 * `services` constructor parameter for deterministic testing.
 *
 * Delegates the clamp formula to `SystemInfo.recommendedWorkerCount` from the
 * core package; this class owns only the environment probing.
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import os from 'node:os';

import type { SystemInfoInterface } from '@studnicky/dagonizer/contracts';
import { SystemInfo } from '@studnicky/dagonizer/entities';
import type { RecommendedWorkerCountConfig } from '@studnicky/dagonizer/entities';

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
    return SystemInfo.recommendedWorkerCount(config, {
      'parallelism': this.#os.availableParallelism(),
      'freeMemoryBytes': this.#os.freemem(),
    });
  }
}
