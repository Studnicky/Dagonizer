/**
 * LlmAdapterRegistry: process-local map of (provider, model) →
 * adapter factory.
 *
 * Consumers register an `AdapterDescriptorShape` plus a zero-arg factory
 * that constructs the configured adapter. The registry never stores
 * adapter instances; the factory is invoked on each `resolve()` call so
 * each consumer gets a fresh instance with its own retry state, session
 * lifecycle, and abort wiring.
 *
 * Duplicate registration for the same key is treated as a configuration
 * error (throws `LlmError` with reason `CONFIGURATION`). Unregistered
 * lookups return `null` so the cascade can record the miss and move on.
 *
 * Symmetric with `EmbedderRegistry`; both extend `BaseRegistry` which
 * owns the shared Map logic.
 */

import type { LlmAdapter } from '../contracts/LlmAdapter.js';

import { BaseRegistry } from './BaseRegistry.js';

/** Zero-arg constructor for an adapter; built fresh per `resolve()`. */
export type AdapterFactory = () => LlmAdapter;

export class LlmAdapterRegistry extends BaseRegistry<LlmAdapter> {
  constructor() {
    super('LlmAdapterRegistry');
  }
}
