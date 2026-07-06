/**
 * CallModelNode: abstract base for sending a chat request to the LLM and
 * storing the response.
 *
 * The LLM adapter is injected via the constructor as `protected readonly llm`.
 * Subclasses may override `resolveAdapter` to swap providers per-state.
 *
 * Template methods:
 *   - `getRequest`: read the prepared `ChatRequestType` from state.
 *   - `storeResponse`: write the `ChatResponseType` back to state.
 *
 * Outputs: `'text' | 'tools' | 'mixed'` based on `response.message.variant`,
 * `'error'` on failure.
 */

import { LlmError } from '../../adapter/LlmError.js';
import { RoutingStreamSink } from '../../adapter/RoutingStreamSink.js';
import type { LlmAdapterInterface } from '../../contracts/LlmAdapterInterface.js';
import type { SchemaObjectType } from '../../contracts/NodeInterface.js';
import { NullStreamSink } from '../../contracts/NullStreamSink.js';
import type { StreamSinkInterface } from '../../contracts/StreamSinkInterface.js';
import { MonadicNode } from '../../core/MonadicNode.js';
import type { ChatRequestType } from '../../entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../entities/adapter/ChatResponse.js';
import type { RoutedChatStreamChunkType } from '../../entities/adapter/RoutedChatStreamChunk.js';
import { Batch } from '../../entities/batch/Batch.js';
import type { ItemType } from '../../entities/batch/Item.js';
import type { RoutedBatchType } from '../../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../entities/node/NodeContext.js';
import { NodeError } from '../../entities/node/NodeError.js';
import { NodeOutput } from '../../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../entities/node/NodeOutput.js';
import { DAGError } from '../../errors/DAGError.js';
import { BatchItemExecutor } from '../../execution/BatchItemExecutor.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';
import type { BatchExecutionOptionsType } from '../../types/BatchExecutionOptions.js';

export abstract class CallModelNode<
  TState extends NodeStateInterface,
> extends MonadicNode<TState, 'text' | 'tools' | 'mixed' | 'error'> {
  readonly outputs = ['text', 'tools', 'mixed', 'error'] as const;

  /**
   * Bound per node INSTANCE, but every chunk that reaches it is
   * self-describing: `execute` wraps `this.sink` in a fresh
   * `RoutingStreamSink` for each item execution, stamping each chunk with
   * `routeKey(state)` and the `{dagName, nodeName}` source. One shared sink
   * — for example a `StreamChannel` feeding a routing DAG that scatters by
   * `routeKey` — correctly demultiplexes concurrent runs on a single node
   * instance; no per-run node instance or dispatcher is needed.
   */
  protected readonly sink: StreamSinkInterface<RoutedChatStreamChunkType>;
  protected readonly execution: BatchExecutionOptionsType;

  constructor(
    protected readonly llm: LlmAdapterInterface,
    /**
     * `sink`: bound per node INSTANCE (see the field doc above). Chunks
     * forwarded to it are routed (tagged with `routeKey` + `source`), so one
     * shared sink safely demultiplexes concurrent runs.
     */
    options: {
      sink?: StreamSinkInterface<RoutedChatStreamChunkType>;
      execution?: BatchExecutionOptionsType;
    } = {},
  ) {
    super();
    this.sink = options.sink ?? new NullStreamSink<RoutedChatStreamChunkType>();
    this.execution = options.execution ?? {};
  }

  override get outputSchema(): Record<'text' | 'tools' | 'mixed' | 'error', SchemaObjectType> {
    return {
      'text':  { 'type': 'object' },
      'tools': { 'type': 'object' },
      'mixed': { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  /**
   * Resolve the LLM adapter to use. Default: `this.llm` (constructor-injected).
   * Override to swap providers (e.g. per-state model selection).
   */
  protected resolveAdapter(_state: TState, _context: NodeContextType): LlmAdapterInterface {
    return this.llm;
  }

  /**
   * The demultiplexing key for this run, read from per-execution state (e.g.
   * a run/session/conversation id). Default `''` — a single unrouted stream.
   * A subclass streaming concurrent runs on a shared node instance overrides
   * this to return a per-run key from `state`.
   */
  protected routeKey(_state: TState): string {
    return '';
  }

  /** Read the prepared chat request from state. */
  protected abstract getRequest(
    state: TState,
    context: NodeContextType,
  ): ChatRequestType;

  /** Write the model's response back to state. */
  protected abstract storeResponse(
    state: TState,
    response: ChatResponseType,
    context: NodeContextType,
  ): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'text' | 'tools' | 'mixed' | 'error', TState>> {
    const acc = new Map<'text' | 'tools' | 'mixed' | 'error', ItemType<TState>[]>();
    const results = await BatchItemExecutor.map(batch.items(), async (item) => {
      const output = await this.#executeItem(item.state, context);

      for (const error of output.errors) {
        item.state.collectError(error);
      }
      return { item, output };
    }, this.execution, context.signal);

    for (const result of results) {
      const bucket = acc.get(result.output.output);
      if (bucket !== undefined) {
        bucket.push(result.item);
      } else {
        acc.set(result.output.output, [result.item]);
      }
    }

    const routed = new Map<'text' | 'tools' | 'mixed' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  async #executeItem(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'text' | 'tools' | 'mixed' | 'error'>> {
    try {
      const adapter = this.resolveAdapter(state, context);
      const request = this.getRequest(state, context);
      const source = { 'dagName': context.dagName, 'nodeName': context.nodeName };
      const routed = RoutingStreamSink.of(this.sink, this.routeKey(state), source);
      const response = await adapter.chatStream(request, routed);
      this.storeResponse(state, response, context);
      return NodeOutput.create(response.message.variant);
    } catch (cause) {
      const error = DAGError.coerce(cause);
      const recoverable = cause instanceof LlmError ? cause.classification.retryable : true;
      return NodeOutput.create('error', {
        'errors': [
          NodeError.create(
            'modelCallFailed',
            error.message,
            'CallModelNode.execute',
            recoverable,
            new Date().toISOString(),
          ),
        ],
      });
    }
  }
}
