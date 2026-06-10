/**
 * LlmAdapterCascade: preference-ordered availability selector.
 *
 * Given a registry and an ordered list of (provider, model) preferences,
 * walks the list in order, resolving each against the registry and
 * probing the resulting adapter. Returns the first adapter whose
 * `probe()` resolves true. When every preference is exhausted, throws
 * `LlmError(NO_ADAPTER_AVAILABLE)` with a human-readable summary of
 * which preferences were tried and why each was skipped.
 *
 * Design notes:
 *
 *   - Probing is sequential and short-circuits on the first success.
 *     Parallel probing isn't worth the complexity; probes are cheap and
 *     we want strict preference ordering rather than first-to-respond.
 *   - The cascade does not cache adapter instances. Each `select()` call
 *     produces a fresh resolution path, which means callers that want
 *     pinning should hold onto the returned instance themselves.
 *   - Unregistered preferences and probe-false adapters are both
 *     surfaced in the failure message so misconfiguration is debuggable.
 */

import type { LlmAdapter } from '../contracts/LlmAdapter.js';

import type { LlmAdapterRegistry } from './LlmAdapterRegistry.js';
import { Classifications, LlmError } from './LlmError.js';

/** One entry in a cascade preference list. */
export interface CascadePreference {
  readonly provider: string;
  readonly model: string;
}

export class LlmAdapterCascade {
  readonly #registry:    LlmAdapterRegistry;
  readonly #preferences: readonly CascadePreference[];

  constructor(registry: LlmAdapterRegistry, preferences: readonly CascadePreference[]) {
    this.#registry    = registry;
    this.#preferences = preferences;
  }

  /**
   * Walk the preference list, probing each registered adapter in turn.
   * Returns the first adapter to probe true. Throws
   * `LlmError(NO_ADAPTER_AVAILABLE)` listing each skipped preference
   * when nothing is runnable.
   */
  async select(): Promise<LlmAdapter> {
    const attempts: string[] = [];
    for (const pref of this.#preferences) {
      const adapter = this.#registry.resolve(pref.provider, pref.model);
      if (adapter === null) {
        attempts.push(`${pref.provider}:${pref.model} (unregistered)`);
        continue;
      }
      const ok = await adapter.probe();
      if (ok) return adapter;
      attempts.push(`${pref.provider}:${pref.model} (probe failed)`);
    }
    throw new LlmError(
      `LlmAdapterCascade: no adapter available. Tried: ${attempts.join(', ')}`,
      Classifications['NO_ADAPTER_AVAILABLE'],
    );
  }
}
