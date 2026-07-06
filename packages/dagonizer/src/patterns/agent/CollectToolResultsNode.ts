/**
 * CollectToolResultsNode: abstract base for gathering scatter clone outputs
 * into the parent state after scatter dispatch completes.
 *
 * Runs in the parent flow after the scatter's gather strategy has folded
 * per-clone results into parent state. Reads the gathered result collection
 * from state and writes a normalized form back.
 *
 * Template methods:
 *   - `getGatheredResults`: read the per-clone result collection from state.
 *   - `writeResult`: write the finalized results collection back to state.
 *
 * Outputs: `'done'` on success, `'empty'` when no results, `'error'` on failure.
 */

import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { MonadicNode } from '../../core/MonadicNode.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeError } from '../../entities/node/NodeError.js';
import { NodeOutput } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class CollectToolResultsNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'done' | 'empty' | 'error'> {
  readonly outputs = ['done', 'empty', 'error'] as const;

  override get outputSchema(): Record<'done' | 'empty' | 'error', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'empty': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /**
   * Read the gather-folded result collection from parent state.
   * Typically populated by the scatter's `map` gather strategy.
   */
  protected abstract getGatheredResults(
    state: TState,
    context: NodeContextType,
  ): readonly unknown[];

  /**
   * Write the finalized tool results back to state.
   * Called only when `getGatheredResults` returns a non-empty array.
   */
  protected abstract writeResult(
    state: TState,
    results: readonly unknown[],
    context: NodeContextType,
  ): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'done' | 'empty' | 'error', TState>> {
    const acc = new Map<'done' | 'empty' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'done' | 'empty' | 'error'>;

      try {
        const results = this.getGatheredResults(state, context);
        if (results.length === 0) {
          output = NodeOutput.create('empty');
        } else {
          this.writeResult(state, results, context);
          output = NodeOutput.create('done');
        }
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutput.create('error', {
          'errors': [
            NodeError.create(
              'collectToolResultsFailed',
              error.message,
              'CollectToolResultsNode.execute',
              true,
              new Date().toISOString(),
            ),
          ],
        });
      }

      for (const error of output.errors) {
        state.collectError(error);
      }
      const bucket = acc.get(output.output);
      if (bucket !== undefined) {
        bucket.push(item);
      } else {
        acc.set(output.output, [item]);
      }
    }

    const routed = new Map<'done' | 'empty' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
