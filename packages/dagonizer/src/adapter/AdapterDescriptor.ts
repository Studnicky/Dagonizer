/**
 * AdapterDescriptor: registry key helpers and the descriptor shape used
 * to register an adapter factory in `LlmAdapterRegistry`.
 *
 * The descriptor pairs a (provider, model) identity with the static
 * capability declaration. The registry uses `AdapterDescriptor.key()` to
 * compute its lookup string; consumers may also call it directly when
 * they need to reason about preferences in their own code.
 *
 * `AdapterDescriptor` is a static class; no instances. Per project
 * standards, helpers live as `noun.verb()` rather than as freestanding
 * functions.
 */

import type { AdapterCapabilitiesType } from './LlmAdapter.js';

/**
 * Shape of one entry in the adapter registry. `provider` is a stable
 * short name (e.g. `'gemini-api'`, `'ollama'`, `'web-llm'`); `model` is
 * the provider-specific model identifier.
 */
export type AdapterDescriptorShapeType = {
  provider: string;
  model: string;
  capabilities: AdapterCapabilitiesType;
}

/**
 * Static helpers for adapter descriptors. The class exists purely to
 * scope `key()` under a `noun.verb()` name; never instantiated.
 */
export class AdapterDescriptor {
  private constructor() { /* static class */ }

  /**
   * Canonical registry key for a (provider, model) pair. Stable across
   * versions; registries and cascades depend on this format.
   */
  static key(provider: string, model: string): string {
    return `${provider}:${model}`;
  }
}
