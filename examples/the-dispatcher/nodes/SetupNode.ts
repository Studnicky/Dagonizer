/**
 * SetupNode: pre-phase node — stamps per-run metadata.
 *
 * Runs before the entrypoint via a `PhaseNode` placement with phase: 'pre'.
 * Stamps `state.metadata.runId` so downstream nodes can correlate events
 * within one execution. Does NOT clear state fields so the HITL resume path
 * (operator sets state.response before resume()) is preserved across runs.
 *
 * Routes 'ready' always.
 */

import { MonadicNode, RoutedBatch } from '@studnicky/dagonizer';
import type { Batch, NodeContextType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

import type { DispatcherState } from '../DispatcherState.ts';

export class SetupNode extends MonadicNode<DispatcherState, 'ready'> {
  readonly name = 'dispatcher-setup';
  readonly '@id' = 'urn:noocodec:node:dispatcher-setup';
  readonly outputs = ['ready'] as const;

  override get outputSchema(): Record<'ready', SchemaObjectType> {
    return { 'ready': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'ready', DispatcherState>> {
    for (const item of batch) {
      const runId = new Date().toISOString().replace(/[:.]/g, '-');
      item.state.setMetadata('runId', runId);
    }
    return RoutedBatch.create('ready', batch);
  }
}
