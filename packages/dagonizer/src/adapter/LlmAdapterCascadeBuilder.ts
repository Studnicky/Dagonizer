/**
 * LlmAdapterCascadeBuilder: static factory that assembles a configured
 * `LlmAdapterCascade` from a provider catalogue expressed as DATA.
 *
 * Consumers supply an ordered preference list of catalogue entries, each
 * pairing an `AdapterDescriptorShapeType` with a zero-arg adapter factory.
 * The builder registers every factory in a fresh `LlmAdapterRegistry` and
 * returns an `LlmAdapterCascade` whose preference list mirrors the catalogue
 * order — first entry is the most-preferred provider.
 *
 * This lifts the `buildLlmAdapter`/`LlmRuntime` glue that resume-generator
 * and Foundersmax each re-derive: catalogue-as-data, zero `switch` over
 * provider names, reuses the existing registry + cascade without
 * reimplementing any walking logic.
 *
 * Usage:
 *
 *   const cascade = LlmAdapterCascadeBuilder.build([
 *     { descriptor: { provider: 'gemini-api', model: 'gemini-2.5-flash', capabilities }, factory: () => new GeminiAdapter() },
 *     { descriptor: { provider: 'ollama',     model: 'llama3.1:8b',      capabilities }, factory: () => new OllamaAdapter() },
 *   ]);
 *   const adapter = await cascade.select(); // probes in preference order
 */

import type { AdapterDescriptorShapeType } from './AdapterDescriptor.js';
import { LlmAdapterCascade } from './LlmAdapterCascade.js';
import { LlmAdapterRegistry, type AdapterFactoryType } from './LlmAdapterRegistry.js';

/**
 * One entry in the provider catalogue. Pairs the descriptor (identity +
 * static capabilities) with the zero-arg factory the registry invokes on
 * each `resolve()` call.
 *
 * Not a wire-shape entity: the `factory` field is a function and is not
 * serializable. `AdapterDescriptorShapeType` owns the wire shape of the
 * descriptor portion; no additional schema is introduced here.
 */
export type CatalogueEntryType = {
  descriptor: AdapterDescriptorShapeType;
  factory: AdapterFactoryType;
}

/**
 * Options accepted by `LlmAdapterCascadeBuilder.build()`.
 *
 * Currently empty: reserved for future extension (e.g. a custom registry
 * factory or a pre-populated registry to extend). Trailing options object
 * per project convention.
 */
export type LlmAdapterCascadeBuilderOptionsType = Record<string, never>;

/** Canonical default: no overrides. */
const DEFAULT_CASCADE_BUILDER_OPTIONS: LlmAdapterCascadeBuilderOptionsType = {};

/**
 * Static factory that assembles a preference-ordered `LlmAdapterCascade`
 * from a catalogue expressed as data. Never instantiated.
 */
export class LlmAdapterCascadeBuilder {
  private constructor() { /* static class */ }

  /**
   * Build a configured `LlmAdapterCascade` from an ordered catalogue.
   *
   * - A fresh `LlmAdapterRegistry` is created.
   * - Each `CatalogueEntryType` is registered in catalogue order.
   * - The cascade preference list mirrors catalogue order; first entry is
   *   most-preferred.
   *
   * @param catalogue - Ordered list of provider entries. Preference
   *   decreases with index: `catalogue[0]` is tried first.
   * @param options - Reserved for future extension.
   */
  static build(
    catalogue: readonly CatalogueEntryType[],
    options: LlmAdapterCascadeBuilderOptionsType = DEFAULT_CASCADE_BUILDER_OPTIONS,
  ): LlmAdapterCascade {
    void options; // reserved; destructure when fields are added
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
}
