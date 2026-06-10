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
 * Extends `BaseCascade` which owns the shared `select()` loop.
 * Symmetric with `LlmAdapterCascade`.
 */

import type { Embedder } from '../contracts/Embedder.js';

import { BaseCascade, type CascadePreference } from './BaseCascade.js';
import type { EmbedderRegistry } from './EmbedderRegistry.js';

export class EmbedderCascade extends BaseCascade<EmbedderRegistry, Embedder> {
  constructor(registry: EmbedderRegistry, preferences: readonly CascadePreference[]) {
    super('EmbedderCascade', registry, preferences);
  }
}
