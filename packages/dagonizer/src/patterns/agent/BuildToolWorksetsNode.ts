/**
 * BuildToolWorksetsNode: abstract base for partitioning normalized tool calls
 * into safe (concurrent) and exclusive (serial) worksets for scatter dispatch.
 *
 * Each call is stamped with an absolute tool DAG IRI so a scatter
 * placement can resolve the body DAG through an item-scoped `DagReference`.
 *
 * Template methods:
 *   - `getToolCalls`: read the normalized tool calls from state.
 *   - `classifyCall`: classify a single call as `'safe'` or `'exclusive'`.
 *   - `writeSafeWorkset`: write the safe scatter items to state.
 *   - `writeExclusiveWorkset`: write the exclusive scatter items to state.
 *
 * Outputs: `'ready'` when worksets built, `'empty'` when no calls, `'error'` on failure.
 */

import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { MonadicNode } from '../../core/MonadicNode.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeError } from '../../entities/node/NodeError.js';
import { NodeOutput } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

/**
 * A scatter item that pairs a tool call with the IRI of the embedded DAG
 * body to run it in. The `dagIri` field is read by the scatter placement's
 * item-scoped `DagReference` to resolve the body DAG at execution time.
 *
 * Convention: the scatter placement uses
 * `{ dag: { from: 'item', path: 'dagIri', candidates: [...] } }` to read this
 * field from each item and dispatch to a declared tool DAG IRI candidate.
 */
export type ToolCallScatterItemType = ToolCallType & {
  readonly dagIri: string;
};

export abstract class BuildToolWorksetsNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'ready' | 'empty' | 'error'> {
  readonly outputs = ['ready', 'empty', 'error'] as const;

  override get outputSchema(): Record<'ready' | 'empty' | 'error', SchemaObjectType> {
    return {
      'ready': { 'type': 'object' },
      'empty': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /** Read the validated tool calls from state. */
  protected abstract getToolCalls(
    state: TState,
    context: NodeContextType,
  ): readonly ToolCallType[];

  /**
   * Classify a single call as concurrent-safe or exclusive.
   * `'safe'` calls may run in parallel. `'exclusive'` calls must run alone.
   */
  protected abstract classifyCall(
    call: ToolCallType,
    state: TState,
    context: NodeContextType,
  ): 'safe' | 'exclusive';

  /** Write the safe (concurrent) scatter items to state. */
  protected abstract writeSafeWorkset(
    state: TState,
    calls: readonly ToolCallScatterItemType[],
    context: NodeContextType,
  ): void;

  /** Write the exclusive (serial) scatter items to state. */
  protected abstract writeExclusiveWorkset(
    state: TState,
    calls: readonly ToolCallScatterItemType[],
    context: NodeContextType,
  ): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'ready' | 'empty' | 'error', TState>> {
    const acc = new Map<'ready' | 'empty' | 'error', ItemType<TState>[]>();

    for (const item of batch) {
      const state = item.state;
      let output: NodeOutputType<'ready' | 'empty' | 'error'>;

      try {
        const calls = this.getToolCalls(state, context);
        if (calls.length === 0) {
          output = NodeOutput.create('empty');
        } else {
          const safeItems: ToolCallScatterItemType[] = [];
          const exclusiveItems: ToolCallScatterItemType[] = [];

          for (const call of calls) {
            const bucket = this.classifyCall(call, state, context);
            const scatterItem: ToolCallScatterItemType = {
              'id': call.id,
              'name': call.name,
              'arguments': call.arguments,
              'dagIri': `urn:noocodec:tool:${encodeURIComponent(call.name)}`,
            };
            if (bucket === 'safe') {
              safeItems.push(scatterItem);
            } else {
              exclusiveItems.push(scatterItem);
            }
          }

          this.writeSafeWorkset(state, safeItems, context);
          this.writeExclusiveWorkset(state, exclusiveItems, context);
          output = NodeOutput.create('ready');
        }
      } catch (cause) {
        const error = DAGError.coerce(cause);
        output = NodeOutput.create('error', {
          'errors': [
            NodeError.create(
              'buildToolWorksetsFailed',
              error.message,
              'BuildToolWorksetsNode.execute',
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

    const routed = new Map<'ready' | 'empty' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }
}
