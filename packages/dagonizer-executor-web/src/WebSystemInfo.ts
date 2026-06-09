/**
 * WebSystemInfo: SystemInfoInterface for browser/Web Worker environments.
 *
 * Constructor DI: the host environment probes (`hardwareConcurrency`,
 * `crossOriginIsolated`) are injected so this class is fully testable in
 * Node.js without browser globals. Consumers construct:
 *
 *   new WebSystemInfo({
 *     hardwareConcurrency: navigator.hardwareConcurrency,
 *     crossOriginIsolated: crossOriginIsolated,
 *   })
 *
 * For tests: inject the numeric values directly.
 *
 * Formula (quadrascope SystemInfo pattern):
 *   recommended = clamp(
 *     hardwareConcurrency − mainThreadReservation,
 *     fallbackWorkerCount,
 *     maximumWorkers,
 *   )
 *
 * Memory-based clamping is not applicable in the browser (no memory API);
 * `memoryPerWorkerBytes` is accepted and ignored for interface compatibility.
 *
 * All properties initialised in constructor for V8 shape stability.
 */

import type { SystemInfoInterface } from '@noocodex/dagonizer/contracts';
import type { RecommendedWorkerCountConfig } from '@noocodex/dagonizer/entities';

// ---------------------------------------------------------------------------
// WebSystemInfoProbes
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
  /**
   * Whether the context is cross-origin isolated (SharedArrayBuffer available).
   * Not used in the worker-count formula; reserved for future SharedArrayBuffer
   * fast-path detection. Defaults to false.
   */
  readonly crossOriginIsolated?: boolean;
}

// ---------------------------------------------------------------------------
// WebSystemInfo
// ---------------------------------------------------------------------------

export class WebSystemInfo implements SystemInfoInterface {
  readonly #hardwareConcurrency: number;
  readonly #crossOriginIsolated: boolean;

  constructor(probes: WebSystemInfoProbes = {}) {
    // Safe fallback: 1 when probe is absent, zero, or negative.
    this.#hardwareConcurrency = (probes.hardwareConcurrency !== undefined && probes.hardwareConcurrency > 0)
      ? probes.hardwareConcurrency
      : 1;
    this.#crossOriginIsolated = probes.crossOriginIsolated ?? false;
  }

  /**
   * Whether the browser context supports SharedArrayBuffer
   * (cross-origin isolated). Reserved for future use.
   */
  get crossOriginIsolated(): boolean {
    return this.#crossOriginIsolated;
  }

  recommendedWorkerCount(config: RecommendedWorkerCountConfig): number {
    const raw = this.#hardwareConcurrency - config.mainThreadReservation;
    // maximumWorkers is a hard cap: it wins over fallbackWorkerCount when the
    // two conflict (a pool must never exceed its configured ceiling).
    const clamped = Math.min(config.maximumWorkers, Math.max(raw, config.fallbackWorkerCount));
    return clamped;
  }
}
