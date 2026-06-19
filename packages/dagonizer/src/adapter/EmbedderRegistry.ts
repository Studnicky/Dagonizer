/**
 * EmbedderRegistry: process-local map of (provider, model) →
 * embedder factory.
 *
 * Consumers register an `AdapterDescriptorShapeType` plus a zero-arg factory
 * that constructs the configured embedder. The registry never stores
 * embedder instances; the factory is invoked on each `resolve()` call so
 * each consumer gets a fresh instance with its own retry state, session
 * lifecycle, and abort wiring.
 *
 * Duplicate registration for the same key is treated as a configuration
 * error (throws `LlmError` with reason `CONFIGURATION`). Unregistered
 * lookups return `null` so the cascade can record the miss and move on.
 *
 * Symmetric with `LlmAdapterRegistry`; both extend `BaseRegistry` which
 * owns the shared Map logic.
 */

import type { EmbedderInterface } from '../contracts/EmbedderInterface.js';

import { BaseRegistry } from './BaseRegistry.js';

/** Zero-arg constructor for an embedder; built fresh per `resolve()`. */
export type EmbedderFactoryType = () => EmbedderInterface;

export class EmbedderRegistry extends BaseRegistry<EmbedderInterface> {
  constructor() {
    super('EmbedderRegistry');
  }
}
