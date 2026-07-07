/**
 * ClassifyMessageNode: mode-switched triage with LLM fallback.
 *
 * Routes each inbound customer message to one of three outputs:
 *   'routine'   — AI can handle; routes to ai-compose.
 *   'escalate'  — human operator needed; routes to park-for-operator.
 *   'off-topic' — blank or unrelated; routes to decline.
 *
 * Fast paths (win regardless of `state.classificationMode`):
 *   Trolley switch (state.humanMode === true) forces escalation on every
 *   message before any classification is attempted.
 *   Empty message → off-topic immediately.
 *
 * Mode dispatch (`state.classificationMode`):
 *   `'llm'`      — runs `services.llm.classify` exclusively; `services.intent`
 *                  is never consulted.
 *   `'embedder'` — when `services.intent` is provisioned, classifies via
 *                  cosine similarity against the three intent anchors — no
 *                  LLM round-trip, so trivial messages never risk the
 *                  adapter timeout. If the embedder is confident (above its
 *                  floor), its verdict routes directly. If the embedder is
 *                  unavailable (`services.intent === null`) or unconfident
 *                  (returns `null`), the node falls back to the LLM path.
 *
 * LLM fallback and error handling:
 *   If the LLM call throws, the node escalates with a safety reason rather
 *   than surfacing an unhandled error — a conservative fallback that keeps
 *   customers in the flow.
 */

import { Batch, BatchItemExecutor, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';
import { Timeout } from '@studnicky/dagonizer/runtime';

import type { DispatcherState } from '../DispatcherState.ts';
import type { DispatcherServices } from '../services.ts';

export class ClassifyMessageNode extends MonadicNode<DispatcherState, 'routine' | 'escalate' | 'off-topic'> {
  readonly name = 'classify-message';
  readonly outputs = ['routine', 'escalate', 'off-topic'] as const;
  override readonly timeout = Timeout.ofMs(60_000);

  readonly #services: DispatcherServices;

  constructor(services: DispatcherServices) {
    super();
    this.#services = services;
  }

  override get outputSchema(): Record<'routine' | 'escalate' | 'off-topic', SchemaObjectType> {
    return {
      'routine':   { 'type': 'object' },
      'escalate':  { 'type': 'object' },
      'off-topic': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<DispatcherState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'routine' | 'escalate' | 'off-topic', DispatcherState>> {
    const acc = new Map<'routine' | 'escalate' | 'off-topic', ItemType<DispatcherState>[]>();
    const results = await BatchItemExecutor.map(batch.items(), async (item) => {
      const output = await this.routeItem(item.state, context);

      for (const error of output.errors) {
        item.state.collectError(error);
      }
      return { item, output };
    }, this.#services.execution, context.signal);

    for (const result of results) {
      const bucket = acc.get(result.output.output);
      if (bucket === undefined) {
        acc.set(result.output.output, [result.item]);
      } else {
        bucket.push(result.item);
      }
    }

    const routed = new Map<'routine' | 'escalate' | 'off-topic', Batch<DispatcherState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private async routeItem(
    state: DispatcherState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'routine' | 'escalate' | 'off-topic'>> {
    // Trolley switch: force human routing regardless of content.
    if (state.humanMode) {
      state.escalationReason = 'Human mode active — all messages routed to operator';
      return NodeOutput.create('escalate');
    }

    // Empty message → off-topic without LLM.
    if (state.message.trim().length === 0) {
      return NodeOutput.create('off-topic');
    }

    if (state.classificationMode === 'llm') {
      return this.classifyViaLlm(state, context);
    }

    // Embedder mode: cosine similarity against the intent anchors, no LLM
    // round-trip, no timeout exposure — falls back to the LLM path below
    // when the embedder is unavailable or unconfident.
    if (this.#services.intent !== null) {
      const result = await this.#services.intent.classify(state.message);
      if (result !== null) return this.route(state, result.intent);
    }
    return this.classifyViaLlm(state, context);
  }

  /** LLM classification with conservative escalation on error. */
  private async classifyViaLlm(
    state: DispatcherState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'routine' | 'escalate' | 'off-topic'>> {
    let intent: 'routine' | 'escalate' | 'off-topic';
    try {
      intent = await this.#services.llm.classify(state.message, state.conversation, context.signal);
    } catch {
      state.escalationReason = 'LLM unavailable; escalated for safety';
      return NodeOutput.create('escalate');
    }
    return this.route(state, intent);
  }

  /** Shared routing for both the embedder and LLM classification paths. */
  private route(
    state: DispatcherState,
    intent: 'routine' | 'escalate' | 'off-topic',
  ): NodeOutputType<'routine' | 'escalate' | 'off-topic'> {
    if (intent === 'escalate') {
      state.escalationReason = 'Agent determined this message requires human review.';
      return NodeOutput.create('escalate');
    }
    if (intent === 'off-topic') return NodeOutput.create('off-topic');
    return NodeOutput.create('routine');
  }
}
