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
import type { RecommendedWorkerCountConfigType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// OsServicesInterface: injectable os probe surface
// ---------------------------------------------------------------------------

export interface OsServicesInterface {
  availableParallelism(): number;
  totalmem(): number;
  freemem(): number;
}

// ---------------------------------------------------------------------------
// NodeSystemInfoServicesType: top-level DI record
// ---------------------------------------------------------------------------

export type NodeSystemInfoServicesType = {
  readonly os?: OsServicesInterface;
};

// ---------------------------------------------------------------------------
// NodeSystemInfo
// ---------------------------------------------------------------------------

const DEFAULT_OS: OsServicesInterface = {
  'availableParallelism': () => os.availableParallelism(),
  'totalmem': () => os.totalmem(),
  'freemem': () => os.freemem(),
};

export class NodeSystemInfo implements SystemInfoInterface {
  readonly #os: OsServicesInterface;

  constructor(services: NodeSystemInfoServicesType = {}) {
    this.#os = services.os ?? DEFAULT_OS;
  }

  recommendedWorkerCount(config: RecommendedWorkerCountConfigType): number {
    return SystemInfo.recommendedWorkerCount(config, {
      'parallelism': this.#os.availableParallelism(),
      'freeMemoryBytes': this.#os.freemem(),
    });
  }
}
