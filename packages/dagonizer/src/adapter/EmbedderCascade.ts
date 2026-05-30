/**
 * EmbedderCascade: preference-ordered availability selector.
 *
 * Given a registry and an ordered list of (provider, model) preferences,
 * walks the list in order, resolving each against the registry and
 * probing the resulting embedder. Returns the first embedder whose
 * `probe()` resolves true. When every preference is exhausted, throws
 * `LlmError(NO_ADAPTER_AVAILABLE)` with a human-readable summary of
 * which preferences were tried and why each was skipped.
 *
 * Design notes:
 *
 *   - Probing is sequential and short-circuits on the first success.
 *     Parallel probing isn't worth the complexity; probes are cheap and
 *     we want strict preference ordering rather than first-to-respond.
 *   - The cascade does not cache embedder instances. Each `select()`
 *     call produces a fresh resolution path, which means callers that
 *     want pinning should hold onto the returned instance themselves.
 *   - Unregistered preferences and probe-false embedders are both
 *     surfaced in the failure message so misconfiguration is debuggable.
 *
 * Symmetric with `LlmAdapterCascade`.
 */

import type { Embedder } from '../contracts/Embedder.js';

import type { EmbedderRegistry } from './EmbedderRegistry.js';
import { Classifications, LlmError } from './LlmError.js';

/** One entry in a cascade preference list. */
export interface EmbedderCascadePreference {
  readonly provider: string;
  readonly model: string;
}

export class EmbedderCascade {
  readonly #registry:    EmbedderRegistry;
  readonly #preferences: readonly EmbedderCascadePreference[];

  constructor(registry: EmbedderRegistry, preferences: readonly EmbedderCascadePreference[]) {
    this.#registry    = registry;
    this.#preferences = preferences;
  }

  /**
   * Walk the preference list, probing each registered embedder in turn.
   * Returns the first embedder to probe true. Throws
   * `LlmError(NO_ADAPTER_AVAILABLE)` listing each skipped preference
   * when nothing is runnable.
   */
  async select(): Promise<Embedder> {
    const attempts: string[] = [];
    for (const pref of this.#preferences) {
      const embedder = this.#registry.resolve(pref.provider, pref.model);
      if (embedder === null) {
        attempts.push(`${pref.provider}:${pref.model} (unregistered)`);
        continue;
      }
      const ok = await embedder.probe();
      if (ok) return embedder;
      attempts.push(`${pref.provider}:${pref.model} (probe failed)`);
    }
    throw new LlmError(
      `EmbedderCascade: no embedder available. Tried: ${attempts.join(', ')}`,
      Classifications['NO_ADAPTER_AVAILABLE'],
    );
  }
}
