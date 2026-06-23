/**
 * DispatcherServices: dependency contracts for the Dispatcher DAG.
 *
 * Nodes that require LLM calls receive a DispatcherServices instance via
 * constructor injection. The interface contracts are narrow: each node
 * depends only on the operations it actually calls.
 */

import type { ConversationTurnType } from './DispatcherState.ts';

/**
 * LLM contract for the Dispatcher: classify an inbound customer message
 * and compose a reply. The narrow interface exists so that tests can stub
 * responses without a real adapter, and so the production implementation
 * (DispatcherLlmClient) stays the only concrete class.
 */
export interface DispatcherLlmInterface {
  classify(message: string, conversation: readonly ConversationTurnType[], signal?: AbortSignal): Promise<'routine' | 'escalate' | 'off-topic'>;
  compose(message: string, conversation: readonly ConversationTurnType[], signal?: AbortSignal): Promise<string>;
}

/**
 * Top-level service bag injected into every Dispatcher node that calls an LLM.
 */
export interface DispatcherServices {
  readonly llm: DispatcherLlmInterface;
}
