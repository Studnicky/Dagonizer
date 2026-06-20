/**
 * DecodeTextToolCallsNode: abstract base for parsing tool-call JSON embedded
 * in a model's text response (text-channel tool calls).
 *
 * Template methods:
 *   - `getText`: read the raw model text from state.
 *   - `storeToolCalls`: write the decoded `ToolCallType[]` back to state.
 *
 * Overridable default:
 *   - `idPrefix` getter: prefix for synthesized call ids (default `'agent'`).
 *
 * Outputs: `'decoded'` when calls found, `'empty'` when none, `'error'` on failure.
 */

import { ToolCallCodec } from '../../adapter/ToolCallCodec.js';
import type { AgentServicesType } from '../../contracts/AgentServicesType.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ToolCallType } from '../../entities/adapter/ToolCall.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class DecodeTextToolCallsNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'decoded' | 'empty' | 'error', AgentServicesType> {
  readonly outputs = ['decoded', 'empty', 'error'] as const;

  /**
   * Prefix for synthesized tool call ids. Default: `'agent'`.
   * Override as a getter when a subclass needs a different namespace.
   */
  protected get idPrefix(): string {
    return 'agent';
  }

  /** Read the model's raw text response from state. */
  protected abstract getText(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): string;

  /** Write the decoded tool calls back to state. */
  protected abstract storeToolCalls(
    state: TState,
    calls: readonly ToolCallType[],
    context: NodeContextType<AgentServicesType>,
  ): void;

  protected override async executeOne(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): Promise<NodeOutputType<'decoded' | 'empty' | 'error'>> {
    try {
      const text = this.getText(state, context);
      if (text.trim().length === 0) {
        return NodeOutputBuilder.of('empty');
      }
      const calls = ToolCallCodec.decode(text, this.idPrefix);
      this.storeToolCalls(state, calls, context);
      return NodeOutputBuilder.of(calls.length > 0 ? 'decoded' : 'empty');
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'decodeTextToolCallsFailed',
            error.message,
            'DecodeTextToolCallsNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
