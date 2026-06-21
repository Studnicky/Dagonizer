/**
 * NormalizeResponseNode: abstract base for inspecting a stored model response
 * and routing on its message variant.
 *
 * Template method:
 *   - `getResponse`: read the `ChatResponseType` from state (or `null`).
 *
 * Outputs:
 *   - `'text' | 'tools' | 'mixed'` — from `response.message.variant`
 *   - `'empty'` — when `getResponse` returns `null`
 *   - `'error'` — on unexpected failure
 */

import type { AgentServicesType } from '../../contracts/AgentServicesType.js';
import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { ScalarNode } from '../../core/ScalarNode.js';
import type { ChatResponseType } from '../../entities/adapter/ChatResponse.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

export abstract class NormalizeResponseNode<
  TState extends NodeStateInterface,
> extends ScalarNode<TState, 'text' | 'tools' | 'mixed' | 'empty' | 'error', AgentServicesType> {
  readonly outputs = ['text', 'tools', 'mixed', 'empty', 'error'] as const;

  override get outputSchema(): Record<'text' | 'tools' | 'mixed' | 'empty' | 'error', SchemaObjectType> {
    return {
      'text':  { 'type': 'object' },
      'tools': { 'type': 'object' },
      'mixed': { 'type': 'object' },
      'empty': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /** Read the stored chat response from state. Return `null` when absent. */
  protected abstract getResponse(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): ChatResponseType | null;

  protected override async executeOne(
    state: TState,
    context: NodeContextType<AgentServicesType>,
  ): Promise<NodeOutputType<'text' | 'tools' | 'mixed' | 'empty' | 'error'>> {
    try {
      const response = this.getResponse(state, context);
      if (response === null) {
        return NodeOutputBuilder.of('empty');
      }
      return NodeOutputBuilder.of(response.message.variant);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      return NodeOutputBuilder.of('error', {
        'errors': [
          NodeErrorBuilder.from(
            'normalizeResponseFailed',
            error.message,
            'NormalizeResponseNode.executeOne',
            true,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
