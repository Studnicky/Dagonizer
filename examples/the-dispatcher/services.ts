/**
 * DispatcherServices: dependency contracts for the Dispatcher DAG.
 *
 * Nodes that require LLM calls receive a DispatcherServices instance via
 * constructor injection. The interface contracts are narrow: each node
 * depends only on the operations it actually calls. `intent` is the
 * embedder-backed classification fast path; `null` means no embedder was
 * provisioned for this run and callers fall back to `llm.classify`.
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
  /**
   * Best-effort warm-up: forces the underlying model to load (or stay
   * resident) without producing a usable reply. Never throws — callers
   * fire this eagerly (on backend selection, at flow start) to hide
   * cold-load latency behind the user's read/type time. A failure here
   * must not block or fail a real classify()/compose() call.
   */
  warm(signal?: AbortSignal): Promise<void>;
}

/**
 * Embedder-backed intent classification contract: cosine-similarity
 * triage without an LLM round-trip. Returns `null` below the confidence
 * floor, signalling the caller to fall back to `DispatcherLlmInterface.classify`.
 */
export interface DispatcherIntentInterface {
  classify(message: string): Promise<{ readonly intent: 'routine' | 'escalate' | 'off-topic'; readonly score: number } | null>;
}

/**
 * Top-level service bag injected into every Dispatcher node that calls an LLM.
 */
export interface DispatcherServices {
  readonly llm: DispatcherLlmInterface;
  readonly intent: DispatcherIntentInterface | null;
}
