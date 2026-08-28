/**
 * DispatcherServices: dependency contracts for the Dispatcher DAG.
 *
 * Nodes that require LLM calls receive a DispatcherServices instance via
 * constructor injection. The interface contracts are narrow: each node
 * depends only on the operations it actually calls. The embedder-backed
 * classification path provisions only when execution requests `intent` and
 * rejects when the model or WASM runtime cannot be prepared.
 */

import type { ConversationTurnType } from './DispatcherState.ts';
import type { BatchExecutionOptionsType } from '@studnicky/dagonizer';

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
   * Best-effort warm-up for an explicit execution-time request. Implementations
   * do not surface warm-up failure; classify and compose retain authoritative
   * error behavior.
   */
  warm(signal?: AbortSignal): Promise<void>;
}

/**
 * Embedder-backed intent classification contract: cosine-similarity
 * triage without an LLM round-trip. Returns `null` below the confidence
 * floor, signalling the caller to route to `DispatcherLlmInterface.classify`.
 */
export interface DispatcherIntentInterface {
  classify(message: string): Promise<{ readonly intent: 'routine' | 'escalate' | 'off-topic'; readonly score: number } | null>;
}

/**
 * Top-level service bag injected into every Dispatcher node that calls an LLM.
 *
 * `intent` is a lazy, memoized provider rather than a resolved value: the
 * embedder provisions on first call, not at service-construction time, so a
 * DAG run that never reaches embedder-mode classification never pays the
 * model/WASM fetch cost. Callers use `await services.intent.load()`; repeated
 * calls resolve to the same classifier, while provisioning failures reject.
 */
export interface DispatcherServices {
  readonly llm: DispatcherLlmInterface;
  readonly intent: {
    readonly displayName: string | null;
    load(): Promise<DispatcherIntentInterface>;
  };
  readonly execution?: BatchExecutionOptionsType;
}
