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

import type { AgentServicesType } from '../../contracts/AgentServicesType.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class CollectToolResultsNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'done' | 'empty' | 'error', AgentServicesType> {
  readonly outputs = ['done', 'empty', 'error'] as const;

  /**
   * Read the gather-folded result collection from parent state.
   * Typically populated by the scatter's `map` gather strategy.
   */
  protected abstract getGatheredResults(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): readonly unknown[];

  /**
   * Write the finalized tool results back to state.
   * Called only when `getGatheredResults` returns a non-empty array.
   */
  protected abstract writeResult(
    state: TState,
    results: readonly unknown[],
    context: NodeContextType<AgentServicesType>,
  ): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): Promise<NodeOutputType<'done' | 'empty' | 'error'>> {
    try {
      const results = this.getGatheredResults(state, context);
      if (results.length === 0) {
        return NodeOutputBuilder.of('empty');
      }
      this.writeResult(state, results, context);
      return NodeOutputBuilder.of('done');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'collectToolResultsFailed',
            error.message,
            'CollectToolResultsNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
