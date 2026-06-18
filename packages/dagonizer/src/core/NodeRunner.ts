/**
 * NodeRunner: static utility that runs a `NodeInterface` over a `Batch`.
 *
 * All nodes implement the one batch-native contract
 * `execute(batch, context) → RoutedBatch`. `NodeRunner.run` is a thin
 * delegation helper retained for call sites that benefit from a named
 * invocation boundary (tests, composites).
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { Batch } from '../entities/batch/Batch.js';
import type { RoutedBatch } from '../entities/batch/RoutedBatch.js';
import type { NodeContextInterface } from '../entities/node/NodeContext.js';
import type { NodeStateInterface } from '../NodeStateBase.js';


export class NodeRunner {
  private constructor() { /* static class */ }

  /**
   * Runs a `NodeInterface` over a batch.
   * Delegates directly to `node.execute(batch, context)`.
   */
  static async run<
    TState extends NodeStateInterface,
    TOutput extends string,
    TServices,
  >(
    node: NodeInterface<TState, TOutput, TServices>,
    batch: Batch<TState>,
    context: NodeContextInterface<TServices>,
  ): Promise<RoutedBatch<TOutput, TState>> {
    return node.execute(batch, context);
  }
}
