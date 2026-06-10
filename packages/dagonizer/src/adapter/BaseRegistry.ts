/**
 * BaseRegistry<TInstance>: generic Map-backed adapter registry.
 *
 * `EmbedderRegistry` and `LlmAdapterRegistry` were structurally
 * identical (a `Map`-backed `register`/`has`/`resolve`/`list` with a
 * duplicate-key throw and a private `RegistryEntry` interface). This
 * abstract base owns the shared logic; each child extends it with its
 * specific instance type and factory alias.
 *
 * The `registryName` constructor parameter drives the duplicate-key
 * error message so diagnostics remain accurate.
 */

import { AdapterDescriptor, type AdapterDescriptorShape } from './AdapterDescriptor.js';
import { Classifications, LlmError } from './LlmError.js';

interface RegistryEntry<TFactory> {
  readonly descriptor: AdapterDescriptorShape;
  readonly factory:    TFactory;
}

export abstract class BaseRegistry<TInstance> {
  readonly #registryName: string;
  readonly #entries: Map<string, RegistryEntry<() => TInstance>>;

  protected constructor(registryName: string) {
    this.#registryName = registryName;
    this.#entries = new Map<string, RegistryEntry<() => TInstance>>();
  }

  /**
   * Register a factory for the (provider, model) pair carried by the
   * descriptor. Throws `LlmError(CONFIGURATION)` if the key is already
   * registered; re-registration is almost always a bug.
   */
  register(descriptor: AdapterDescriptorShape, factory: () => TInstance): void {
    const key = AdapterDescriptor.key(descriptor.provider, descriptor.model);
    if (this.#entries.has(key)) {
      throw new LlmError(
        `${this.#registryName}: duplicate registration for '${key}'`,
        Classifications['CONFIGURATION'],
      );
    }
    this.#entries.set(key, { descriptor, factory });
  }

  /** True when the (provider, model) pair has a registered factory. */
  has(provider: string, model: string): boolean {
    return this.#entries.has(AdapterDescriptor.key(provider, model));
  }

  /**
   * Resolve the (provider, model) pair to a fresh instance, or `null`
   * when no factory is registered. The cascade relies on `null` so it
   * can log the miss and try the next preference.
   */
  resolve(provider: string, model: string): TInstance | null {
    const entry = this.#entries.get(AdapterDescriptor.key(provider, model));
    if (entry === undefined) return null;
    return entry.factory();
  }

  /** Snapshot of all registered descriptors in insertion order. */
  list(): readonly AdapterDescriptorShape[] {
    return [...this.#entries.values()].map((entry) => entry.descriptor);
  }
}
