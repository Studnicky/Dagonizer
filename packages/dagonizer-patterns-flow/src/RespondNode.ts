/**
 * RespondNode — terminal node that writes the draft response to a
 * consumer-controlled location and marks the lifecycle completed.
 *
 * Default implementation reads from `state.draft` (a common convention
 * across the Archivist and similar flows). Override `extractDraft` to
 * pull from a different field.
 */

import type { NodeContextInterface, NodeOutputInterface, NodeStateInterface } from '@noocodex/dagonizer';

import { FlowNode } from './FlowNode.js';

export abstract class RespondNode<
  TState extends NodeStateInterface,
> extends FlowNode<TState, 'success'> {
  readonly outputs = ['success'] as const;

  protected abstract emit(state: TState, draft: string): void;

  /** Default extraction: state.draft when present. Override for custom fields. */
  protected extractDraft(state: TState): string {
    return (state as { draft?: unknown }).draft as string ?? '';
  }

  async execute(
    state: TState,
    _context: NodeContextInterface<undefined>,
  ): Promise<NodeOutputInterface<'success'>> {
    this.emit(state, this.extractDraft(state));
    return Promise.resolve({ 'output': 'success' });
  }
}
