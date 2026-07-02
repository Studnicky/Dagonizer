/**
 * NormalizeToolCallsNode: abstract base for validating and normalizing decoded
 * tool calls before dispatch.
 *
 * Filters out any call missing a required field (`id`, `name`, `arguments`).
 * When all calls are invalid, routes `'error'`. When none present, routes
 * `'empty'`. When at least one valid call exists, writes the valid subset and
 * routes `'valid'`.
 *
 * Template methods:
 *   - `getToolCalls`: read the raw tool calls from state.
 *   - `writeNormalized`: write the valid subset back to state.
 *
 * Outputs: `'valid'`, `'empty'`, `'error'`.
 */

import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class NormalizeToolCallsNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'valid' | 'empty' | 'error'> {
  readonly outputs = ['valid', 'empty', 'error'] as const;

  override get outputSchema(): Record<'valid' | 'empty' | 'error', SchemaObjectType> {
    return {
      'valid': { 'type': 'object' },
      'empty': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /** Read the decoded tool calls from state. */
  protected abstract getToolCalls(
    state: TState,
    context: NodeContextType,
  ): readonly ToolCallType[];

  /** Write the validated subset of tool calls back to state. */
  protected abstract writeNormalized(
    state: TState,
    calls: readonly ToolCallType[],
    context: NodeContextType,
  ): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'valid' | 'empty' | 'error'>> {
    try {
      const calls = this.getToolCalls(state, context);
      if (calls.length === 0) {
        return NodeOutputBuilder.of('empty');
      }

      const valid = calls.filter(
        (c) =>
          typeof c.id === 'string' && c.id.length > 0 &&
          typeof c.name === 'string' && c.name.length > 0 &&
          typeof c.arguments === 'object' && c.arguments !== null,
      );

      if (valid.length === 0) {
        return NodeOutputBuilder.of('error', {
          'errors': [
            NodeErrorBuilder.from(
              'normalizeToolCallsAllInvalid',
              `All ${String(calls.length)} tool call(s) were missing required fields`,
              'NormalizeToolCallsNode.executeOne',
              false,
              new Date().toISOString(),
            ),
          ],
        });
      }

      this.writeNormalized(state, valid, context);
      return NodeOutputBuilder.of('valid');
    } catch (cause) {
      const error = DAGError.coerce(cause);
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'normalizeToolCallsFailed',
            error.message,
            'NormalizeToolCallsNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
