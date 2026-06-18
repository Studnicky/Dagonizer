/**
 * WebSystemInfo: SystemInfoInterface for browser/Web Worker environments.
 *
 * Probes `navigator.hardwareConcurrency` via an injectable `WebNavigatorProbes`
 * bag for deterministic testing. Delegates the clamp formula to
 * `SystemInfo.recommendedWorkerCount` from the core package; this class owns
 * only the environment probing.
 *
 * Memory-based clamping is not applicable in the browser (no free-memory API);
 * `freeMemoryBytes` is always passed as `null` so the core formula skips it
 * regardless of `memoryPerWorkerBytes`.
 *
 * All properties initialised in constructor for V8 shape stability.
 */

import type { SystemInfoInterface } from '@studnicky/dagonizer/contracts';
import { SystemInfo } from '@studnicky/dagonizer/entities';
import type { RecommendedWorkerCountConfig } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// WebNavigatorProbes: injectable navigator probe surface
// ---------------------------------------------------------------------------

/**
 * Injectable navigator probes for `WebSystemInfo`.
 * Mirrors `OsServices` in `NodeSystemInfo`: a typed boundary object so tests
 * inject fake values without touching browser globals.
 */
export interface WebNavigatorProbes {
  /**
   * Number of logical processors available to the browser context.
   * Maps to `navigator.hardwareConcurrency`.
   */
  readonly hardwareConcurrency: number;
}

// ---------------------------------------------------------------------------
// WebSystemInfoProbes: constructor DI bag
// ---------------------------------------------------------------------------

/**
 * Injectable environment probes for WebSystemInfo.
 * All fields are optional; each has a documented safe fallback.
 */
export interface WebSystemInfoProbes {
  /**
   * Number of logical processors available to the browser context.
   * Defaults to 1 when absent or zero (safe fallback for restricted contexts).
   * Maps to `navigator.hardwareConcurrency`.
   */
  readonly hardwareConcurrency?: number;
}

// ---------------------------------------------------------------------------
// DEFAULT_WEB_PROBES: production default reads real navigator
// ---------------------------------------------------------------------------

/**
 * Production default: reads `navigator.hardwareConcurrency` once.
 * Accessed via `globalThis` to avoid a DOM-lib type dependency.
 * Returns 1 when the property is absent or non-positive (restricted contexts).
 */
function readNavigatorHardwareConcurrency(): number {
  const nav = (globalThis as Record<string, unknown>)['navigator'];
  if (nav === null || nav === undefined) { return 1; }
  const hc = (nav as Record<string, unknown>)['hardwareConcurrency'];
  return (typeof hc === 'number' && hc > 0) ? hc : 1;
}

export const DEFAULT_WEB_PROBES: WebNavigatorProbes = {
  get 'hardwareConcurrency'(): number { return readNavigatorHardwareConcurrency(); },
};

// ---------------------------------------------------------------------------
// WebSystemInfo
// ---------------------------------------------------------------------------

export class WebSystemInfo implements SystemInfoInterface {
  readonly #hardwareConcurrency: number;

  constructor(probes: WebSystemInfoProbes = {}) {
    // Safe fallback: 1 when probe is absent, zero, or negative.
    this.#hardwareConcurrency = (probes.hardwareConcurrency !== undefined && probes.hardwareConcurrency > 0)
      ? probes.hardwareConcurrency
      : 1;
  }

  recommendedWorkerCount(config: RecommendedWorkerCountConfig): number {
    return SystemInfo.recommendedWorkerCount(config, {
      'parallelism': this.#hardwareConcurrency,
      'freeMemoryBytes': null,
    });
  }
}
