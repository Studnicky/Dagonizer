/**
 * EmbedderRegistry: process-local map of (provider, model) →
 * embedder factory.
 *
 * Consumers register an `AdapterDescriptorShape` plus a zero-arg factory
 * that constructs the configured embedder. The registry never stores
 * embedder instances; the factory is invoked on each `resolve()` call so
 * each consumer gets a fresh instance with its own retry state, session
 * lifecycle, and abort wiring.
 *
 * Duplicate registration for the same key is treated as a configuration
 * error (throws `LlmError` with reason `CONFIGURATION`). Unregistered
 * lookups return `null` so the cascade can record the miss and move on.
 *
 * Symmetric with `LlmAdapterRegistry`; both share `AdapterDescriptor.key()`
 * so a single descriptor format works for both surfaces.
 */

import type { Embedder } from '../contracts/Embedder.js';

import { AdapterDescriptor, type AdapterDescriptorShape } from './AdapterDescriptor.js';
import { Classifications, LlmError } from './LlmError.js';

/** Zero-arg constructor for an embedder; built fresh per `resolve()`. */
export type EmbedderFactory = () => Embedder;

interface RegistryEntry {
  readonly descriptor: AdapterDescriptorShape;
  readonly factory:    EmbedderFactory;
}

export class EmbedderRegistry {
  readonly #entries: Map<string, RegistryEntry>;

  constructor() {
    this.#entries = new Map<string, RegistryEntry>();
  }

  /**
   * Register a factory for the (provider, model) pair carried by the
   * descriptor. Throws `LlmError(CONFIGURATION)` if the key is already
   * registered; re-registration is almost always a bug.
   */
  register(descriptor: AdapterDescriptorShape, factory: EmbedderFactory): void {
    const key = AdapterDescriptor.key(descriptor.provider, descriptor.model);
    if (this.#entries.has(key)) {
      throw new LlmError(
        `EmbedderRegistry: duplicate registration for '${key}'`,
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
   * Resolve the (provider, model) pair to a fresh embedder instance, or
   * `null` when no factory is registered. The cascade relies on `null`
   * (rather than throwing) so it can log the miss and try the next
   * preference.
   */
  resolve(provider: string, model: string): Embedder | null {
    const entry = this.#entries.get(AdapterDescriptor.key(provider, model));
    if (entry === undefined) return null;
    return entry.factory();
  }

  /** Snapshot of all registered descriptors in insertion order. */
  list(): readonly AdapterDescriptorShape[] {
    return [...this.#entries.values()].map((entry) => entry.descriptor);
  }
}
