/**
 * ScalarNode: abstract base class that adapts a per-item `executeOne` into
 * a batch-native `execute`. Implements `NodeInterface`.
 *
 * Subclasses implement `executeOne` with the per-item signature.
 * The base class maps it over the batch, forwards errors via
 * `state.collectError`, and groups items by the returned output port
 * into a `RoutedBatch`.
 *
 * Migration path: swap the base class from `MonadicNode` to `ScalarNode`
 * and rename `execute` to `executeOne`.
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import { EMPTY_CONTRACT_FRAGMENT } from '../contracts/OperationContractFragment.js';
import type { OperationContractFragment } from '../contracts/OperationContractFragment.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeOutputInterface } from '../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Timeout } from '../runtime/Timeout.js';

import { Batch } from './batch/Batch.js';
import type { Item } from './batch/Item.js';
import type { RoutedBatch } from './batch/RoutedBatch.js';

export abstract class ScalarNode<
  TState extends NodeStateInterface,
  TOutput extends string,
  TServices = undefined,
> implements NodeInterface<TState, TOutput, TServices> {
  abstract readonly name: string;
  abstract readonly outputs: readonly TOutput[];

  readonly contract: OperationContractFragment = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout: Timeout = Timeout.none();

  /**
   * Per-item execution. Subclasses implement this; the base class maps it
   * over the batch and groups items by the returned output port.
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
  async execute(
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
