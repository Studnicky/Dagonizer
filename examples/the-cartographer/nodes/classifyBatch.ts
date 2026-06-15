/**
 * classifyBatch: reservoir scatter body node — kind-keyed batch classification pass.
 *
 * Runs as the body of the 'batch-by-kind' scatter, which uses a reservoir
 * (keyField: 'kind', capacity: 50, idleMs: 100). The reservoir buffers
 * incoming canonical events by their `kind` field and releases a per-kind
 * batch when either capacity is reached or 100 ms of idle elapses.
 *
 * This node is a pass-through: it receives the batch (all items of the same
 * kind, as partitioned by the reservoir), records the batch size onto
 * `state.batchKindCount` for observability, then routes all items to the
 * single output port 'classified'. The source collection (`canonicalEvents`)
 * is read-only from the scatter's perspective — the gather strategy is
 * 'discard' so no clone state flows back to the parent. The main
 * `process-events` scatter reads the original `canonicalEvents` array
 * unchanged in the next step.
 *
 * The primary purpose is to demonstrate the engine's keyed reservoir
 * mechanism: grouping heterogeneous events by kind before processing,
 * enabling cache amortisation and batch-native enrichment in downstream
 * nodes that share per-kind resources.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { NodeContextInterface } from '@noocodex/dagonizer';
import { MonadicNode, RoutedBatchBuilder } from '@noocodex/dagonizer';
import type { Batch, RoutedBatch } from '@noocodex/dagonizer';

// #region classify-batch-node
export class ClassifyBatchNode extends MonadicNode<CartographerState, 'classified', CartographerServices> {
  readonly 'name' = 'classify-batch';
  readonly 'outputs' = ['classified'] as const;

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextInterface<CartographerServices>,
  ): Promise<RoutedBatch<'classified', CartographerState>> {
    // Record the batch size on each clone for observability. In a real
    // implementation this is where per-kind shared resources (model weights,
    // cache warm-up, bulk DB fetches) would be amortised across the batch.
    for (const item of batch) {
      item.state.batchKindCount = batch.size;
    }
    return RoutedBatchBuilder.of('classified', batch);
  }
}
// #endregion classify-batch-node

export const classifyBatch = new ClassifyBatchNode();
