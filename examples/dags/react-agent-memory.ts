/**
 * react-agent-memory/dags: ReAct reasoning trace, streamed as a scatter
 * source, recorded into a shared RDF store with provenance, and recalled
 * across runs via graph traversal. Pure module — no side effects at import
 * time; every export is a class, a state, a node, or a pre-assembled DAG.
 *
 * Two DAGs live here:
 *
 *   1. `agentDag` - the JSON-LD canonical 8-node ReAct loop,
 *      driven by `ScriptedAdapter`: turn 1 emits a structured `'tools'`
 *      response (`lookup`), turn 2 (once a `tool`-role message is present
 *      in history) emits a plain-text final answer. `MyDecodeTextToolCallsNode`
 *      re-encodes the structured tool call as the `{tool_calls:[...]}` text
 *      envelope so `DecodeTextToolCallsNode` (the text-channel decoder
 *      decoder) genuinely parses it — the same decode path a text-only
 *      model's embedded-JSON tool call would take.
 *
 *   2. `traceDag` — a `ScatterNode` over a `ReasoningTraceItemType` stream
 *      (each item self-describing: `{ ordinal, step }`), whose body
 *      (`record-step`) writes each step into the shared `RdfStore` with a
 *      `wasInformedBy` chain derived from `item.ordinal - 1`. Because the
 *      chain is derived from the item's own ordinal rather than threaded
 *      through node-instance state, the chain is correct at ANY scatter
 *      concurrency, including out-of-order recording — `execution: { mode: 'item',
 *      concurrency: 1 }` below is a default, not a correctness requirement.
 *
 * The bridge between them: `ReActTraceProducer` (an `AgentTraceProducer`, a
 * `DagStreamProducer`) wraps the agent loop's `Execution` (its
 * `AsyncIterable<NodeResultType>`) and tags each emitted step with a
 * monotonic ordinal; `StreamChannel.driven(producer)` turns that into the
 * outer scatter's `AsyncIterable<ReasoningTraceItemType>` source. The outer
 * scatter drains the trace; `driven` runs the inner loop eagerly within the
 * channel's bounded buffer (no back-pressure at this item count) — see the
 * runnable entry point (`examples/react-agent-memory.ts`).
 *
 * Provenance quad shape, per step, in the run's named graph
 * (`urn:noocodec:react-agent-memory:run:<runId>`):
 *
 *   <step> prov#kind           "<thought|action|observation|final>"
 *   <step> prov#value          "<step text/tool-call/observation>"
 *   <step> prov#wasGeneratedBy <run>
 *   <step> prov#wasInformedBy  <previous step>   (when ordinal > 0)
 *
 * `ReActRecall.hint(store, priorRunId)` walks the `wasInformedBy` chain
 * backward from the prior run's `final` step to reconstruct a one-line
 * summary, injected as a leading `system` message on the next run.
 */

import { DAG_CONTEXT, NodeStateBase, Validator } from '@studnicky/dagonizer';
import type {
  DAGType,
  EntityValidatorInterface,
  NodeContextType,
  NodeResultType,
  NodeStateInterface,
  SchemaObjectType,
} from '@studnicky/dagonizer';
import { ReasoningTraceItemSchema } from '@studnicky/dagonizer';
import type { ReasoningTraceItemType } from '@studnicky/dagonizer';
import { BaseAdapter, ChatStreamChunk } from '@studnicky/dagonizer/adapter';
import type {
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ChatStreamChunkType,
  RoutedChatStreamChunkType,
  ToolCallType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import type { StreamSinkInterface } from '@studnicky/dagonizer';
import {
  AgentTraceProducer,
  AppendAssistantNode,
  BuildChatRequestNode,
  BuildToolWorksetsNode,
  CallModelNode,
  CollectToolResultsNode,
  DecodeTextToolCallsNode,
  NormalizeResponseNode,
  NormalizeToolCallsNode,
} from '@studnicky/dagonizer/patterns';
import type {
  BindingType,
  QuadType,
  TermType,
  ToolCallScatterItemType,
  TripleStoreInterface,
} from '@studnicky/dagonizer/patterns';
import { RecordFindingsNode } from '@studnicky/dagonizer-patterns-graph';
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import type { ToolInterface } from '@studnicky/dagonizer/tool';

// ---------------------------------------------------------------------------
// Provenance vocabulary
// ---------------------------------------------------------------------------

/** Metadata key the outer scatter stamps each `ReasoningTraceItemType` item under. */
export const REASONING_ITEM_KEY = 'reasoning-step-item';

/** Fixed predicate IRIs for the reasoning-trace provenance vocabulary. */
export const REASONING_PROV_PREDICATE: {
  readonly kind: TermType;
  readonly value: TermType;
  readonly wasGeneratedBy: TermType;
  readonly wasInformedBy: TermType;
} = {
  'kind': { 'termType': 'NamedNode', 'value': 'urn:noocodec:react-agent-memory:prov#kind' },
  'value': { 'termType': 'NamedNode', 'value': 'urn:noocodec:react-agent-memory:prov#value' },
  'wasGeneratedBy': { 'termType': 'NamedNode', 'value': 'urn:noocodec:react-agent-memory:prov#wasGeneratedBy' },
  'wasInformedBy': { 'termType': 'NamedNode', 'value': 'urn:noocodec:react-agent-memory:prov#wasInformedBy' },
};

/** Static factory for the run/step IRIs the provenance vocabulary addresses. */
export class ReasoningProvenanceIri {
  private constructor() { /* static class */ }

  /** The named graph a run's provenance quads are asserted into. */
  static runGraph(runId: string): TermType {
    return { 'termType': 'NamedNode', 'value': `urn:noocodec:react-agent-memory:run:${runId}` };
  }

  /** The subject IRI for one step within a run. */
  static stepSubject(runId: string, index: number): TermType {
    return { 'termType': 'NamedNode', 'value': `urn:noocodec:react-agent-memory:run:${runId}:step:${String(index)}` };
  }
}

// ---------------------------------------------------------------------------
// Agent-loop state
// ---------------------------------------------------------------------------

export class AgentState extends NodeStateBase {
  /** Per-run conversation id — the demultiplexing key for routed concurrent streams (see react-agent-routing). */
  conversationId: string = '';
  /** The visitor's prompt for this turn. */
  prompt: string = '';
  /** Leading system-message hint recalled from a prior run; `''` when none. */
  recallHint: string = '';
  /** Assembled chat request, stored between build-request and call-model. */
  chatRequest: ChatRequestType | null = null;
  /** Raw model response from call-model. */
  chatResponse: ChatResponseType | null = null;
  /** Human-readable text for the current turn's model output (thought/final). */
  assistantText: string = '';
  /** Tool calls decoded from the text-channel envelope. */
  decodedCalls: ToolCallType[] = [];
  /** Scatter items for safe (concurrent) tool dispatch. */
  safeWorkset: ToolCallScatterItemType[] = [];
  /** Scatter items for exclusive (serial) tool dispatch. */
  exclusiveWorkset: ToolCallScatterItemType[] = [];
  /** Gather-folded tool outputs after scatter completes. */
  toolOutputs: unknown[] = [];
  /** Finalized tool results after collection. */
  collectedResults: unknown[] = [];
  /** Full conversation history threaded across loop-back turns. */
  history: ChatMessageType[] = [];
}

// ---------------------------------------------------------------------------
// Trace-recording (outer scatter) state
// ---------------------------------------------------------------------------

export class TraceState extends NodeStateBase {
  /** Stream of ordinal-tagged reasoning items, bridged in via `StreamChannel.driven`. */
  source: AsyncIterable<ReasoningTraceItemType> | null = null;
  /** Gather-folded log of every recorded item (for inspection/tests). */
  steps: ReasoningTraceItemType[] = [];
}

// ---------------------------------------------------------------------------
// ScriptedAdapter: deterministic, offline LLM adapter
// ---------------------------------------------------------------------------

/**
 * Deterministic adapter with no live network or model. Turn 1 (no `tool`-role
 * message yet in history) emits a structured `'tools'` response invoking
 * `lookup`. Turn 2 (a `tool`-role message present) emits a plain-text final
 * answer that cites the tool's observation. `performChatStream` streams the
 * final answer word-by-word so `TokenCollectorSink` observes multiple deltas.
 */
export class ScriptedAdapter extends BaseAdapter {
  constructor() {
    super('scripted', 'Scripted (deterministic)', {
      'toolUse':          'full',
      'structuredOutput': false,
      'jsonMode':         false,
    });
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const toolMessage = request.messages.find((m) => m.role === 'tool');
    if (toolMessage === undefined) {
      return {
        'message': {
          'variant':   'tools',
          'toolCalls': [{ 'id': 'call-1', 'name': 'lookup', 'arguments': { 'query': 'dagonizer' } }],
        },
        'finishReason': 'tool_call',
        'usage':        { 'promptTokens': 12, 'completionTokens': 6 },
      };
    }
    const observation = toolMessage.role === 'tool' ? toolMessage.content : '';
    return {
      'message':      { 'variant': 'text', 'content': `Based on the lookup, ${observation}` },
      'finishReason': 'stop',
      'usage':        { 'promptTokens': 20, 'completionTokens': 10 },
    };
  }

  protected override async performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    const response = await this.chat(request);
    const text = response.message.variant === 'text' ? response.message.content : '';
    const words = text.split(' ').filter((word) => word.length > 0);
    for (const word of words) {
      await sink.push(ChatStreamChunk.create(`${word} `));
    }
    return response;
  }
}

// ---------------------------------------------------------------------------
// TokenCollectorSink: collects every streamed delta
// ---------------------------------------------------------------------------

export class TokenCollectorSink implements StreamSinkInterface<RoutedChatStreamChunkType> {
  readonly deltas: string[];

  constructor() {
    this.deltas = [];
  }

  async push(item: RoutedChatStreamChunkType): Promise<void> {
    this.deltas.push(item.delta);
  }
}

// ---------------------------------------------------------------------------
// LookupTool: deterministic in-memory dictionary lookup
// ---------------------------------------------------------------------------

const LOOKUP_DICTIONARY: Readonly<Record<string, string>> = {
  'dagonizer': 'Dagonizer is a type-safe, abortable DAG dispatcher for TypeScript.',
};

export class LookupTool implements ToolInterface<Record<string, unknown>, unknown> {
  readonly definition: ToolDefinitionType = {
    'name':        'lookup',
    'description': 'Look up a short definition for a known term.',
    'inputSchema': {
      'type':       'object',
      'properties': { 'query': { 'type': 'string' } },
      'required':   ['query'],
    },
    'outputSchema': {
      'type':       'object',
      'properties': { 'result': { 'type': 'string' } },
      'required':   ['result'],
    },
    'strict': true,
  };

  async execute(input: Record<string, unknown>): Promise<unknown> {
    const query = typeof input['query'] === 'string' ? input['query'] : '';
    const result = LOOKUP_DICTIONARY[query.toLowerCase()] ?? `No entry found for "${query}".`;
    return { 'result': result };
  }
}

// ---------------------------------------------------------------------------
// Concrete agent-loop node subclasses
// ---------------------------------------------------------------------------

// 1. BuildChatRequestNode: seeds history on the first turn (with the recall
//    hint as a leading system message when present), then assembles the
//    request from the full running history.
export class MyBuildChatRequestNode extends BuildChatRequestNode<AgentState> {
  readonly name = 'build-request';
  readonly '@id' = 'urn:noocodec:node:build-request';

  protected buildRequest(state: AgentState, context: NodeContextType): ChatRequestType {
    if (state.history.length === 0) {
      const seed: ChatMessageType[] = [];
      if (state.recallHint !== '') {
        seed.push({ 'role': 'system', 'content': state.recallHint });
      }
      seed.push({ 'role': 'user', 'content': state.prompt });
      state.history = seed;
    }
    const req: ChatRequestType = {
      'messages':     [...state.history],
      'tools':        [],
      'toolChoice':   { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens':    256,
      'temperature':  0.2,
      'signal':       context.signal,
    };
    state.chatRequest = req;
    return req;
  }
}

// 2. CallModelNode: sends the request, stores the response and a
//    human-readable "thought" text for the trace.
export class MyCallModelNode extends CallModelNode<AgentState> {
  readonly name = 'call-model';
  readonly '@id' = 'urn:noocodec:node:call-model';

  constructor(llm: LlmAdapterInterface, options: { sink?: StreamSinkInterface<RoutedChatStreamChunkType> } = {}) {
    super(llm, options);
  }

  protected getRequest(state: AgentState, _ctx: NodeContextType): ChatRequestType {
    if (state.chatRequest === null) throw new Error('chatRequest not set');
    return state.chatRequest;
  }

  protected storeResponse(state: AgentState, response: ChatResponseType, _ctx: NodeContextType): void {
    state.chatResponse = response;
    if (response.message.variant === 'text' || response.message.variant === 'mixed') {
      state.assistantText = response.message.content;
    } else {
      state.assistantText = 'planning to invoke a tool';
    }
  }
}

// 3. NormalizeResponseNode: routes on the stored response's variant.
export class MyNormalizeResponseNode extends NormalizeResponseNode<AgentState> {
  readonly name = 'normalize-response';
  readonly '@id' = 'urn:noocodec:node:normalize-response';

  protected getResponse(state: AgentState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }
}

// 4. DecodeTextToolCallsNode: text-channel tool-call decoder. When the
//    response carries structured tool calls (`'tools'`/`'mixed'`), re-encodes
//    them as the `{tool_calls:[...]}` text envelope so the same decode path a
//    text-only model's embedded-JSON tool call would take is genuinely
//    exercised (`ToolCallCodec.decode` parses real JSON here, not a stub).
export class MyDecodeTextToolCallsNode extends DecodeTextToolCallsNode<AgentState> {
  readonly name = 'decode-tools';
  readonly '@id' = 'urn:noocodec:node:decode-tools';

  protected getText(state: AgentState, _ctx: NodeContextType): string {
    const response = state.chatResponse;
    if (response !== null && (response.message.variant === 'tools' || response.message.variant === 'mixed')) {
      const calls = response.message.toolCalls.map((c) => ({ 'name': c.name, 'arguments': c.arguments }));
      return JSON.stringify({ 'tool_calls': calls });
    }
    return state.assistantText;
  }

  protected storeToolCalls(state: AgentState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

// 5. NormalizeToolCallsNode: validates decoded calls.
export class MyNormalizeToolCallsNode extends NormalizeToolCallsNode<AgentState> {
  readonly name = 'normalize-tools';
  readonly '@id' = 'urn:noocodec:node:normalize-tools';

  protected getToolCalls(state: AgentState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }

  protected writeNormalized(state: AgentState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

// 6. BuildToolWorksetsNode: every call runs concurrently (single tool, no
//    exclusivity requirements in this example).
export class MyBuildToolWorksetsNode extends BuildToolWorksetsNode<AgentState> {
  readonly name = 'build-worksets';
  readonly '@id' = 'urn:noocodec:node:build-worksets';

  protected getToolCalls(state: AgentState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }

  protected classifyCall(_call: ToolCallType, _state: AgentState, _ctx: NodeContextType): 'safe' | 'exclusive' {
    return 'safe';
  }

  protected writeSafeWorkset(state: AgentState, calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void {
    state.safeWorkset = [...calls];
  }

  protected writeExclusiveWorkset(state: AgentState, calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void {
    state.exclusiveWorkset = [...calls];
  }
}

// 7. CollectToolResultsNode: finalizes the gathered tool output AND appends
//    the assistant tool-call turn + the tool's observation into history, so
//    the next build-request turn asks the model with the observation in
//    context (this is what lets ScriptedAdapter detect "tool already ran"
//    and answer with the final text).
export class MyCollectToolResultsNode extends CollectToolResultsNode<AgentState> {
  readonly name = 'collect-results';
  readonly '@id' = 'urn:noocodec:node:collect-results';

  protected getGatheredResults(state: AgentState, _ctx: NodeContextType): readonly unknown[] {
    return state.toolOutputs;
  }

  protected writeResult(state: AgentState, results: readonly unknown[], _ctx: NodeContextType): void {
    state.collectedResults = [...results];
    const call = state.decodedCalls[0];
    const toolName = call !== undefined ? call.name : 'unknown';
    const toolCallId = call !== undefined ? call.id : 'unknown';
    const observation = results[0];
    const observationText = typeof observation === 'string' ? observation : JSON.stringify(observation);
    state.history = [
      ...state.history,
      { 'role': 'assistant', 'content': `Calling tool ${toolName} with ${JSON.stringify(call?.arguments ?? {})}` },
      { 'role': 'tool', 'content': observationText, 'toolCallId': toolCallId, 'toolName': toolName },
    ];
  }
}

// 8. AppendAssistantNode: appends the final text answer to history.
export class MyAppendAssistantNode extends AppendAssistantNode<AgentState> {
  readonly name = 'append-assistant';
  readonly '@id' = 'urn:noocodec:node:append-assistant';

  protected getResponse(state: AgentState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }

  protected append(state: AgentState, response: ChatResponseType, _ctx: NodeContextType): void {
    if (response.message.variant === 'text') {
      state.history = [...state.history, { 'role': 'assistant', 'content': response.message.content }];
    }
  }
}

// ---------------------------------------------------------------------------
// ReActTraceProducer: maps agent-loop node results to reasoning steps
// ---------------------------------------------------------------------------

export class ReActTraceProducer extends AgentTraceProducer {
  protected describe(stage: NodeResultType<NodeStateInterface>): string {
    const state = stage.state;
    if (!(state instanceof AgentState)) return '';

    if (stage.nodeName === 'call-model' || stage.nodeName === 'normalize-response') {
      return state.assistantText;
    }
    if (stage.nodeName === 'decode-tools' || stage.nodeName === 'normalize-tools') {
      const call = state.decodedCalls[0];
      return call !== undefined ? call.name : 'unknown-tool';
    }
    if (stage.nodeName === 'collect-results') {
      const result = state.collectedResults[0];
      if (result === undefined) return '';
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
    // 'append-assistant'
    return state.assistantText;
  }
}

// ---------------------------------------------------------------------------
// RecordReasoningStepNode: writes one scattered reasoning step + provenance
// ---------------------------------------------------------------------------

const STEP_VALIDATOR: EntityValidatorInterface<ReasoningTraceItemType> = Validator.compile<ReasoningTraceItemType>(ReasoningTraceItemSchema);

/**
 * Scatter body node for `traceDag`: reads the current scattered item from
 * metadata (stamped under `REASONING_ITEM_KEY`), asserts its provenance
 * quads into the shared store, and links `wasInformedBy` to the item at
 * `item.ordinal - 1`. The chain is derived entirely from the item's own
 * ordinal, so it is correct regardless of the order items are actually
 * recorded in — the node holds no cross-item state. A fresh instance is
 * constructed per run (`runId` is instance-private), matching the repo's
 * isolated-child-state convention.
 */
export class RecordReasoningStepNode extends RecordFindingsNode<TraceState, ReasoningTraceItemType> {
  readonly name = 'record-step';
  readonly '@id' = 'urn:noocodec:node:record-step';
  readonly outputs = ['success'] as const;

  readonly #runId: string;

  constructor(memory: TripleStoreInterface, runId: string) {
    super(memory);
    this.#runId = runId;
  }

  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  protected selectEntities(state: TraceState): readonly ReasoningTraceItemType[] {
    const raw = state.getMetadata(REASONING_ITEM_KEY);
    if (!STEP_VALIDATOR.is(raw)) return [];
    return [raw];
  }

  protected toQuads(item: ReasoningTraceItemType): readonly QuadType[] {
    const entity = item.step;
    const subject = ReasoningProvenanceIri.stepSubject(this.#runId, item.ordinal);
    const graph = ReasoningProvenanceIri.runGraph(this.#runId);
    const runSubject = ReasoningProvenanceIri.runGraph(this.#runId);
    const valueText = entity.kind === 'action'
      ? `${entity.tool}(${JSON.stringify(entity.args)})`
      : entity.kind === 'observation'
        ? entity.output
        : entity.text;

    const quads: QuadType[] = [
      { 'subject': subject, 'predicate': REASONING_PROV_PREDICATE.kind, 'object': { 'termType': 'Literal', 'value': entity.kind }, 'graph': graph },
      { 'subject': subject, 'predicate': REASONING_PROV_PREDICATE.value, 'object': { 'termType': 'Literal', 'value': valueText }, 'graph': graph },
      { 'subject': subject, 'predicate': REASONING_PROV_PREDICATE.wasGeneratedBy, 'object': runSubject, 'graph': graph },
    ];
    if (item.ordinal > 0) {
      const previousSubject = ReasoningProvenanceIri.stepSubject(this.#runId, item.ordinal - 1);
      quads.push({ 'subject': subject, 'predicate': REASONING_PROV_PREDICATE.wasInformedBy, 'object': previousSubject, 'graph': graph });
    }

    return quads;
  }
}

// ---------------------------------------------------------------------------
// ReActRecall: cross-run graph traversal
// ---------------------------------------------------------------------------

/**
 * Reconstructs a one-line hint from a prior run's reasoning chain: finds the
 * prior run's `final` step, walks `wasInformedBy` backward to the first
 * step, then formats `kind: value` pairs in forward order.
 */
export class ReActRecall {
  private constructor() { /* static class */ }

  static hint(store: TripleStoreInterface, priorRunId: string): string {
    const graph = ReasoningProvenanceIri.runGraph(priorRunId);
    const finalBindings: readonly BindingType[] = store.select({
      'subject':   '?s',
      'predicate': REASONING_PROV_PREDICATE.kind,
      'object':    { 'termType': 'Literal', 'value': 'final' },
      'graph':     graph,
    });
    const finalBinding = finalBindings[0];
    if (finalBinding === undefined) return '';
    const finalSubject = finalBinding['s'];
    if (finalSubject === undefined) return '';

    const chain: TermType[] = [finalSubject];
    let current = finalSubject;
    for (;;) {
      const prevBindings: readonly BindingType[] = store.select({
        'subject':   current,
        'predicate': REASONING_PROV_PREDICATE.wasInformedBy,
        'object':    '?prev',
      });
      const prevBinding = prevBindings[0];
      if (prevBinding === undefined) break;
      const prev = prevBinding['prev'];
      if (prev === undefined) break;
      chain.unshift(prev);
      current = prev;
    }

    const parts: string[] = [];
    for (const subject of chain) {
      const kindBindings = store.select({ 'subject': subject, 'predicate': REASONING_PROV_PREDICATE.kind, 'object': '?k' });
      const valueBindings = store.select({ 'subject': subject, 'predicate': REASONING_PROV_PREDICATE.value, 'object': '?v' });
      const kindTerm = kindBindings[0]?.['k'];
      const valueTerm = valueBindings[0]?.['v'];
      if (kindTerm === undefined || valueTerm === undefined) continue;
      parts.push(`${kindTerm.value}: ${valueTerm.value}`);
    }

    if (parts.length === 0) return '';
    return `Prior reasoning (${priorRunId}): ${parts.join('; ')}`;
  }
}

/**
 * The pre-assembled agent-loop DAG, registered under its canonical DAG IRI.
 * Import and pass to `dispatcher.registerDAG(agentDag)`.
 */
// #region react-agent-dag
export const agentDag: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:react-agent',
  '@type': 'DAG',
  'name': 'react-agent',
  'version': '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:react-agent/node/build-request' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:react-agent/node/build-request',
      '@type': 'SingleNode',
      'name': 'build-request',
      'node': 'urn:noocodec:node:build-request',
      'outputs': {
        'ready': 'urn:noocodec:dag:react-agent/node/call-model',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/call-model',
      '@type': 'SingleNode',
      'name': 'call-model',
      'node': 'urn:noocodec:node:call-model',
      'outputs': {
        'text': 'urn:noocodec:dag:react-agent/node/normalize-response',
        'tools': 'urn:noocodec:dag:react-agent/node/normalize-response',
        'mixed': 'urn:noocodec:dag:react-agent/node/normalize-response',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/normalize-response',
      '@type': 'SingleNode',
      'name': 'normalize-response',
      'node': 'urn:noocodec:node:normalize-response',
      'outputs': {
        'text': 'urn:noocodec:dag:react-agent/node/append-assistant',
        'tools': 'urn:noocodec:dag:react-agent/node/decode-tools',
        'mixed': 'urn:noocodec:dag:react-agent/node/decode-tools',
        'empty': 'urn:noocodec:dag:react-agent/node/end-error',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/append-assistant',
      '@type': 'SingleNode',
      'name': 'append-assistant',
      'node': 'urn:noocodec:node:append-assistant',
      'outputs': {
        'done': 'urn:noocodec:dag:react-agent/node/end-done',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/decode-tools',
      '@type': 'SingleNode',
      'name': 'decode-tools',
      'node': 'urn:noocodec:node:decode-tools',
      'outputs': {
        'decoded': 'urn:noocodec:dag:react-agent/node/normalize-tools',
        'empty': 'urn:noocodec:dag:react-agent/node/end-error',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/normalize-tools',
      '@type': 'SingleNode',
      'name': 'normalize-tools',
      'node': 'urn:noocodec:node:normalize-tools',
      'outputs': {
        'valid': 'urn:noocodec:dag:react-agent/node/worksets',
        'empty': 'urn:noocodec:dag:react-agent/node/end-error',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/worksets',
      '@type': 'SingleNode',
      'name': 'worksets',
      'node': 'urn:noocodec:node:build-worksets',
      'outputs': {
        'ready': 'urn:noocodec:dag:react-agent/node/dispatch-tools',
        'empty': 'urn:noocodec:dag:react-agent/node/end-error',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/dispatch-tools',
      '@type': 'ScatterNode',
      'name': 'dispatch-tools',
      'source': 'safeWorkset',
      'body': {
        'dag': {
          '@type': 'DagReference',
          'from': 'item',
          'path': 'dagIri',
          'candidates': ['urn:noocodec:tool:lookup'],
        },
      },
      'outputs': {
        'all-success': 'urn:noocodec:dag:react-agent/node/join-tool-results',
        'partial': 'urn:noocodec:dag:react-agent/node/join-tool-results',
        'all-error': 'urn:noocodec:dag:react-agent/node/join-tool-results',
        'empty': 'urn:noocodec:dag:react-agent/node/join-tool-results',
      },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/join-tool-results',
      '@type': 'GatherNode',
      'name': 'join-tool-results',
      sources: { 'urn:noocodec:dag:react-agent/node/dispatch-tools': {} },
      'gather': {
        'strategy': 'map',
        'mapping': { 'output': 'toolOutputs' },
      },
      'outputs': {
        'success': 'urn:noocodec:dag:react-agent/node/collect-results',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
        'empty': 'urn:noocodec:dag:react-agent/node/collect-results',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/collect-results',
      '@type': 'SingleNode',
      'name': 'collect-results',
      'node': 'urn:noocodec:node:collect-results',
      'outputs': {
        'done': 'urn:noocodec:dag:react-agent/node/build-request',
        'empty': 'urn:noocodec:dag:react-agent/node/build-request',
        'error': 'urn:noocodec:dag:react-agent/node/end-error',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/end-done',
      '@type': 'TerminalNode',
      'name': 'end-done',
      'outcome': 'completed',
    },
    {
      '@id': 'urn:noocodec:dag:react-agent/node/end-error',
      '@type': 'TerminalNode',
      'name': 'end-error',
      'outcome': 'failed',
    },
  ],
};
// #endregion react-agent-dag

// ---------------------------------------------------------------------------
// traceDag: scatter over the reasoning-step stream
// ---------------------------------------------------------------------------

// #region react-trace-dag
export const traceDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:react-agent-memory-trace',
  '@type':      'DAG',
  'name':       'react-agent-memory-trace',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:react-agent-memory-trace/node/scatter-steps' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:react-agent-memory-trace/node/scatter-steps',
      '@type':       'ScatterNode',
      'name':        'scatter-steps',
      'body':        { 'node': 'urn:noocodec:node:record-step' },
      'source':      'source',
      'itemKey':     REASONING_ITEM_KEY,
      // A free performance choice, not a correctness requirement:
      // RecordReasoningStepNode derives the wasInformedBy chain from each
      // item's own `ordinal` field, so raising this is safe at any value.
      'execution': { 'mode': 'item', 'concurrency': 1 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:react-agent-memory-trace/node/collect-steps',
        'partial': 'urn:noocodec:dag:react-agent-memory-trace/node/collect-steps',
        'all-error': 'urn:noocodec:dag:react-agent-memory-trace/node/collect-steps',
        'empty': 'urn:noocodec:dag:react-agent-memory-trace/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent-memory-trace/node/collect-steps',
      '@type': 'GatherNode',
      'name': 'collect-steps',
      sources: { 'urn:noocodec:dag:react-agent-memory-trace/node/scatter-steps': {} },
      'gather': { 'strategy': 'append', 'target': 'steps' },
      'outputs': {
        'success': 'urn:noocodec:dag:react-agent-memory-trace/node/end',
        'error': 'urn:noocodec:dag:react-agent-memory-trace/node/end',
        'empty': 'urn:noocodec:dag:react-agent-memory-trace/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent-memory-trace/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
// #endregion react-trace-dag
