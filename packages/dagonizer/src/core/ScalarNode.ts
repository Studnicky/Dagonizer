/**
 * ScalarNode: the per-item specialization of `MonadicNode`.
 *
 * Extends the `MonadicNode` root and implements its `execute(batch)` contract
 * by looping a per-item `executeOne` over the batch — "a scalar is a batch of
 * one." Subclasses implement `executeOne` with the per-item signature; the base
 * maps it over the batch, forwards per-item errors via `state.collectError`,
 * and groups items by the returned output port into a `RoutedBatch`.
 *
 * Use `ScalarNode` for the common per-item leaf node (LLM/IO leaves, most
 * domain nodes). Author a batch-native hot-path node by extending `MonadicNode`
 * directly and implementing `execute`.
 */

import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import { Batch } from './batch/Batch.js';
import type { Item } from './batch/Item.js';
import type { RoutedBatch } from './batch/RoutedBatch.js';
import { MonadicNode } from './MonadicNode.js';

export abstract class ScalarNode<
  TState extends NodeStateInterface,
  TOutput extends string,
  TServices = undefined,
> extends MonadicNode<TState, TOutput, TServices> {
  /**
   * Per-item execution. Subclasses implement this; the base class maps it over
   * the batch and groups items by the returned output port.
   */
  protected abstract executeOne(
    state: TState,
    context: NodeContextInterface<TServices>,
  ): Promise<NodeOutputInterface<TOutput>>;

  /**
   * Iterates items in order, calls `executeOne` for each, forwards errors via
   * `state.collectError`, groups items by the returned output port, and returns
   * a `RoutedBatch`.
   */
  override async execute(
    batch: Batch<TState>,
    context: NodeContextInterface<TServices>,
  ): Promise<RoutedBatch<TOutput, TState>> {
    const acc = new Map<TOutput, Item<TState>[]>();

    for (const item of batch) {
      const result = await this.executeOne(item.state, context);
      // Forward errors to state — identical to the legacy engine path:
      // `for (const err of result.errors) state.collectError(err);`
      for (const err of result.errors) {
        item.state.collectError(err);
      }
      const bucket = acc.get(result.output);
      if (bucket !== undefined) {
        bucket.push(item);
      } else {
        acc.set(result.output, [item]);
      }
    }

    const routed = new Map<TOutput, Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
