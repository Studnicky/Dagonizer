/**
 * WebSystemInfo: SystemInfoInterface for browser/Web Worker environments.
 *
 * Probes `navigator.hardwareConcurrency` via an injectable `WebNavigatorProbes`
 * record for deterministic testing. Delegates the clamp formula to
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
import type { RecommendedWorkerCountConfigType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// WebNavigatorProbes: injectable navigator probe surface
// ---------------------------------------------------------------------------

/**
 * Injectable navigator probes for `WebSystemInfo`.
 * Mirrors `OsServicesInterface` in `NodeSystemInfo`: a typed boundary object so tests
 * inject fake values without touching browser globals.
 */
export type WebNavigatorProbesType = {
  /**
   * Number of logical processors available to the browser context.
   * Maps to `navigator.hardwareConcurrency`.
   */
  readonly hardwareConcurrency: number;
};

// ---------------------------------------------------------------------------
// WebSystemInfoProbes: constructor DI record
// ---------------------------------------------------------------------------

/**
 * Injectable environment probes for WebSystemInfo.
 * All fields are optional; each has a documented default.
 */
export type WebSystemInfoProbesType = {
  /**
   * Number of logical processors available to the browser context.
   * Defaults to 1 when absent or zero (minimum for restricted contexts).
   * Maps to `navigator.hardwareConcurrency`.
   */
  readonly hardwareConcurrency?: number;
};

// ---------------------------------------------------------------------------
// DEFAULT_WEB_PROBES: production default reads real navigator
// ---------------------------------------------------------------------------

/**
 * Reads `navigator.hardwareConcurrency`. Accessed via `Reflect.get(globalThis, …)`
 * to avoid a DOM-lib type dependency; `Reflect.get` returns `unknown`, so no cast
 * is required. Returns 1 when the property is absent or non-positive (restricted
 * contexts). Static class — `noun.verb()`, no freestanding helper.
 */
class WebNavigator {
  private constructor() { /* static class */ }

  static hardwareConcurrency(): number {
    const nav: unknown = Reflect.get(globalThis, 'navigator');
    if (nav === null || nav === undefined || typeof nav !== 'object') { return 1; }
    const hc: unknown = Reflect.get(nav, 'hardwareConcurrency');
    return (typeof hc === 'number' && hc > 0) ? hc : 1;
  }
}

export const DEFAULT_WEB_PROBES: WebNavigatorProbesType = {
  get 'hardwareConcurrency'(): number { return WebNavigator.hardwareConcurrency(); },
};

// ---------------------------------------------------------------------------
// WebSystemInfo
// ---------------------------------------------------------------------------

export class WebSystemInfo implements SystemInfoInterface {
  readonly #hardwareConcurrency: number;

  constructor(probes: WebSystemInfoProbesType = {}) {
    // Default to 1 when probe is absent, zero, or negative.
    this.#hardwareConcurrency = (probes.hardwareConcurrency !== undefined && probes.hardwareConcurrency > 0)
      ? probes.hardwareConcurrency
      : 1;
  }

  recommendedWorkerCount(config: RecommendedWorkerCountConfigType): number {
    return SystemInfo.recommendedWorkerCount(config, {
      'parallelism': this.#hardwareConcurrency,
      'freeMemoryBytes': null,
    });
  }
}
