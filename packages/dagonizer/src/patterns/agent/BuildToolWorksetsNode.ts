/**
 * BuildToolWorksetsNode: abstract base for partitioning normalized tool calls
 * into safe (concurrent) and exclusive (serial) worksets for scatter dispatch.
 *
 * Each call is stamped with `dagName: 'tool:' + call.name` so the scatter
 * placement can resolve the body dag at runtime via `{ dagFrom: 'dagName' }`.
 *
 * Template methods:
 *   - `getToolCalls`: read the normalized tool calls from state.
 *   - `classifyCall`: classify a single call as `'safe'` or `'exclusive'`.
 *   - `writeSafeWorkset`: write the safe scatter items to state.
 *   - `writeExclusiveWorkset`: write the exclusive scatter items to state.
 *
 * Outputs: `'ready'` when worksets built, `'empty'` when no calls, `'error'` on failure.
 */

import type { AgentServicesType } from '../../contracts/AgentServicesType.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

/**
 * A scatter item that pairs a tool call with the name of the embedded DAG
 * body to run it in. The `dagName` field is read by the scatter placement's
 * `dagFrom` option to resolve the body dag at execution time.
 *
 * Convention: the scatter placement uses `{ dagFrom: 'dagName' }` to read
 * this field from each item and dispatch to `tool:<name>`.
 */
export type ToolCallScatterItemType = ToolCallType & {
  readonly dagName: string;
};

export abstract class BuildToolWorksetsNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'ready' | 'empty' | 'error', AgentServicesType> {
  readonly outputs = ['ready', 'empty', 'error'] as const;

  /** Read the validated tool calls from state. */
  protected abstract getToolCalls(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): readonly ToolCallType[];

  /**
   * Classify a single call as concurrent-safe or exclusive.
   * `'safe'` calls may run in parallel. `'exclusive'` calls must run alone.
   */
  protected abstract classifyCall(
    call: ToolCallType,
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): 'safe' | 'exclusive';

  /** Write the safe (concurrent) scatter items to state. */
  protected abstract writeSafeWorkset(
    state: TState,
    calls: readonly ToolCallScatterItemType[],
    context: NodeContextType<AgentServicesType>,
  ): void;

  /** Write the exclusive (serial) scatter items to state. */
  protected abstract writeExclusiveWorkset(
    state: TState,
    calls: readonly ToolCallScatterItemType[],
    context: NodeContextType<AgentServicesType>,
  ): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): Promise<NodeOutputType<'ready' | 'empty' | 'error'>> {
    try {
      const calls = this.getToolCalls(state, context);
      if (calls.length === 0) {
        return NodeOutputBuilder.of('empty');
      }

      const safeItems: ToolCallScatterItemType[] = [];
      const exclusiveItems: ToolCallScatterItemType[] = [];

      for (const call of calls) {
        const bucket = this.classifyCall(call, state, context);
        const item: ToolCallScatterItemType = {
          'id': call.id,
          'name': call.name,
          'arguments': call.arguments,
          'dagName': `tool:${call.name}`,
        };
        if (bucket === 'safe') {
          safeItems.push(item);
        } else {
          exclusiveItems.push(item);
        }
      }

      this.writeSafeWorkset(state, safeItems, context);
      this.writeExclusiveWorkset(state, exclusiveItems, context);
      return NodeOutputBuilder.of('ready');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'buildToolWorksetsFailed',
            error.message,
            'BuildToolWorksetsNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
