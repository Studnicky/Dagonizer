/**
 * ProvisionEmbedderNode: pre-phase node — warms the lazy embedder classifier.
 *
 * Runs before the entrypoint via a `PhaseNode` placement with phase: 'pre',
 * after `SetupNode`. When any item in the batch runs in `'embedder'`
 * classification mode, awaits `services.intent()` so the provisioning
 * attempt is an explicit, traceable DAG step rather than something hidden
 * inside `classify-message`. `services.intent` is memoized, so successful
 * provisioning is a no-op on every run after the first. A provisioning error
 * rejects this node and places the affected item in the failed partition.
 */

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';
import type { DispatcherServices } from '../services.ts';

export class ProvisionEmbedderNode extends MonadicNode<DispatcherState, 'ready'> {
  readonly name = 'dispatcher-provision-embedder';
  readonly '@id' = 'urn:noocodec:node:dispatcher-provision-embedder';
  readonly outputs: readonly ['ready'] = ['ready'];

  readonly #services: DispatcherServices;

  constructor(services: DispatcherServices) {
    super();
    this.#services = services;
  }

  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return { 'ready': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'ready', DispatcherState>> {
    const needsEmbedder = [...batch].some((item) => item.state.classificationMode === 'embedder');
    if (needsEmbedder) {
      await this.#services.intent.load();
    }
    return RoutedBatch.create('ready', batch);
  }
}
