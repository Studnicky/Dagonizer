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

import type { LlmAdapter } from '../contracts/LlmAdapter.js';

import { BaseCascade, type CascadePreference } from './BaseCascade.js';
import type { LlmAdapterRegistry } from './LlmAdapterRegistry.js';

export class LlmAdapterCascade extends BaseCascade<LlmAdapterRegistry, LlmAdapter> {
  constructor(registry: LlmAdapterRegistry, preferences: readonly CascadePreference[]) {
    super('LlmAdapterCascade', registry, preferences);
  }
}
