/**
 * BaseCascade<TRegistry, TInstance>: generic preference-ordered
 * availability selector.
 *
 * `EmbedderCascade` and `LlmAdapterCascade` were structurally
 * identical: sequential resolve→probe→select, throwing
 * `LlmError(NO_ADAPTER_AVAILABLE)` when every preference is exhausted.
 * This abstract base owns the shared `select()` loop; each child
 * extends it with its concrete registry and instance types.
 *
 * The `cascadeName` constructor parameter drives the failure-message
 * prefix so diagnostics remain accurate.
 *
 * Constraint on TRegistry: must expose `resolve(provider, model)` that
 * returns `TInstance | null`. Constraint on TInstance: must expose
 * `probe()` that returns `Promise<boolean>`. Both constraints are
 * expressed as structural types so no common base class is required.
 */

import { Classifications, LlmError } from './LlmError.js';

/** One entry in a cascade preference list. Canonical single type for all cascades. */
export type CascadePreferenceType = {
  provider: string;
  model: string;
}

export abstract class BaseCascade<
  TRegistry extends { resolve(provider: string, model: string): TInstance | null },
  TInstance extends { probe(): Promise<boolean> },
> {
  readonly #cascadeName: string;
  readonly #registry:    TRegistry;
  readonly #preferences: readonly CascadePreferenceType[];

  protected constructor(
    cascadeName: string,
    registry: TRegistry,
    preferences: readonly CascadePreferenceType[],
  ) {
    this.#cascadeName = cascadeName;
    this.#registry    = registry;
    this.#preferences = preferences;
  }

  /**
   * Walk the preference list, probing each registered instance in turn.
   * Returns the first instance to probe true. Throws
   * `LlmError(NO_ADAPTER_AVAILABLE)` listing each skipped preference
   * when nothing is runnable.
   */
  async select(): Promise<TInstance> {
    const attempts: string[] = [];
    for (const pref of this.#preferences) {
      const instance = this.#registry.resolve(pref.provider, pref.model);
      if (instance === null) {
        attempts.push(`${pref.provider}:${pref.model} (unregistered)`);
        continue;
      }
      const ok = await instance.probe();
      if (ok) return instance;
      attempts.push(`${pref.provider}:${pref.model} (probe failed)`);
    }
    throw new LlmError(
      `${this.#cascadeName}: no adapter available. Tried: ${attempts.join(', ')}`,
      Classifications['NO_ADAPTER_AVAILABLE'],
    );
  }
}
