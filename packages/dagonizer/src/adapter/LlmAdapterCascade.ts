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
 * Extends `BaseCascade` which owns the shared `select()` loop.
 * Symmetric with `EmbedderCascade`.
 */

import type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';

import type { AdapterDescriptorShapeType } from './AdapterDescriptor.js';
import { BaseCascade, type CascadePreferenceType } from './BaseCascade.js';
import { LlmAdapterRegistry, type AdapterFactoryType } from './LlmAdapterRegistry.js';

/**
 * One entry in the provider catalogue. Pairs the descriptor identity and
 * static capabilities with the zero-arg factory the registry invokes on each
 * resolve call.
 */
export type CatalogueEntryType = {
  descriptor: AdapterDescriptorShapeType;
  factory: AdapterFactoryType;
}

export type LlmAdapterCascadeOptionsType = Record<string, never>;

const DEFAULT_CASCADE_OPTIONS: LlmAdapterCascadeOptionsType = {};

export class LlmAdapterCascade extends BaseCascade<LlmAdapterRegistry, LlmAdapterInterface> {
  static create(
    catalogue: readonly CatalogueEntryType[],
    options: LlmAdapterCascadeOptionsType = DEFAULT_CASCADE_OPTIONS,
  ): LlmAdapterCascade {
    void options;
    const registry = new LlmAdapterRegistry();
    for (const entry of catalogue) {
      registry.register(entry.descriptor, entry.factory);
    }
    const preferences = catalogue.map((entry) => ({
      'provider': entry.descriptor.provider,
      'model':    entry.descriptor.model,
    }));
    return new LlmAdapterCascade(registry, preferences);
  }

  constructor(registry: LlmAdapterRegistry, preferences: readonly CascadePreferenceType[]) {
    super('LlmAdapterCascade', registry, preferences);
  }
}
