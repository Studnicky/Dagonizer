/**
 * react-agent-routing/dags: the streaming SINK is itself a DAG — one shared
 * `StreamChannel<RoutedChatStreamChunkType>` demultiplexes CONCURRENT agent
 * runs by feeding a routing DAG that scatters over the channel and classifies
 * each chunk by `routeKey` into a per-conversation transcript.
 *
 * Pure module — no side effects at import time; every export is a class, a
 * state, a node, or a pre-assembled DAG. Reuses `AgentState` and the eight
 * concrete agent-loop node subclasses from `examples/dags/react-agent-memory.ts`
 * unchanged — this module adds only what routing needs on top of them:
 *
 *   - `RoutingCallModelNode` — the SAME `call-model` node, subclassed to
 *     override `routeKey(state)` with a per-run id (`state.conversationId`).
 *     One instance of this node, wired to one shared sink, is safe to run
 *     concurrently for many conversations: `CallModelNode.execute` wraps
 *     the shared sink in a fresh `RoutingStreamSink` per execution, so every
 *     chunk it pushes downstream already carries `routeKey` + `source`.
 *   - `TranscriptStore` — a plain shared bucket (`Map<routeKey, string[]>`),
 *     constructor-injected into the routing DAG's body node, mirroring how
 *     `react-agent-memory`'s `RecordReasoningStepNode` writes into a shared
 *     `RdfStore` rather than folding through gather.
 *   - `RouteChunkNode` — the routing DAG's scatter body: reads the current
 *     `RoutedChatStreamChunkType` item (stamped by the scatter under
 *     `ROUTE_ITEM_KEY`) and appends its `delta` into `TranscriptStore` under
 *     `item.routeKey`. This is the classify-and-route step: the DAG reads a
 *     payload field and dispatches to a destination bucket by that field's
 *     value.
 *   - `routingDag` — a `ScatterNode` over `RoutingState.source` (the shared
 *     `StreamChannel`, itself an `AsyncIterable<RoutedChatStreamChunkType>`),
 *     body `route-chunk`, then `collect-chunks` append gather
 *     logging every routed chunk on `RoutingState` for inspection/assertions
 *     (source-stamp checks) without participating in the demux itself — the
 *     demux happens via `TranscriptStore`, not through gather.
 *
 * The runnable entry point (`examples/react-agent-routing.ts`) wires ONE
 * shared `StreamChannel` as the sink for ONE shared `RoutingCallModelNode`,
 * runs TWO conversations concurrently against it, and drains the routing DAG
 * over the same channel to reconstruct each conversation's transcript
 * separately — proving the sink can BE a DAG that classifies and routes by
 * payload, not just a passive buffer.
 */

import { Batch, MonadicNode, NodeOutput, NodeStateBase, RoutedBatch, Validator } from '@studnicky/dagonizer';
import type { DAGType, EntityValidatorInterface, SchemaObjectType } from '@studnicky/dagonizer';
import { RoutedChatStreamChunkSchema } from '@studnicky/dagonizer/adapter';
import type { RoutedChatStreamChunkType } from '@studnicky/dagonizer/adapter';
import { DAG_CONTEXT } from '@studnicky/dagonizer';
import { AgentState, MyCallModelNode } from './react-agent-memory.ts';

// ---------------------------------------------------------------------------
// RoutingCallModelNode: the SAME call-model node, routed per conversation
// ---------------------------------------------------------------------------

/**
 * Overrides `routeKey` to read `state.conversationId` — the per-run id each
 * concurrent conversation seeds before calling `dispatcher.execute`. Every
 * other behavior (request/response wiring) is inherited unchanged from
 * `MyCallModelNode`.
 */
export class RoutingCallModelNode extends MyCallModelNode {
  protected override routeKey(state: AgentState): string {
    return state.conversationId;
  }
}

// ---------------------------------------------------------------------------
// TranscriptStore: shared per-routeKey bucket the routing DAG writes into
// ---------------------------------------------------------------------------

/**
 * Plain shared accumulator, constructor-injected into `RouteChunkNode` —
 * mirrors `RdfStore` injection in `react-agent-memory`. Not a state field:
 * the routing DAG's scatter body runs on a per-item clone, so the
 * cross-item, cross-route accumulation lives here instead of on state.
 */
export class TranscriptStore {
  readonly #transcripts: Map<string, string[]>;

  constructor() {
    this.#transcripts = new Map();
  }

  /** Append `delta` to the transcript for `routeKey`. */
  append(routeKey: string, delta: string): void {
    const existing = this.#transcripts.get(routeKey) ?? [];
    existing.push(delta);
    this.#transcripts.set(routeKey, existing);
  }

  /** The concatenated transcript for `routeKey`; `''` when no deltas were routed. */
  transcript(routeKey: string): string {
    return (this.#transcripts.get(routeKey) ?? []).join('');
  }

  /** Every route key that received at least one delta. */
  keys(): readonly string[] {
    return [...this.#transcripts.keys()];
  }
}

// ---------------------------------------------------------------------------
// RoutingState: the routing DAG's scatter state
// ---------------------------------------------------------------------------

export class RoutingState extends NodeStateBase {
  /** The shared `StreamChannel<RoutedChatStreamChunkType>` — the sink AND the scatter source. */
  source: AsyncIterable<RoutedChatStreamChunkType> | null = null;
  /** Every routed chunk seen, in arrival order (gather 'append') — inspection/assertion log, not the demux itself. */
  chunks: RoutedChatStreamChunkType[] = [];
}

// ---------------------------------------------------------------------------
// RouteChunkNode: classify each chunk by routeKey, route it into TranscriptStore
// ---------------------------------------------------------------------------

/** Metadata key the scatter stamps each `RoutedChatStreamChunkType` item under. */
export const ROUTE_ITEM_KEY = 'routed-chunk-item';

const CHUNK_VALIDATOR: EntityValidatorInterface<RoutedChatStreamChunkType> = Validator.compile<RoutedChatStreamChunkType>(RoutedChatStreamChunkSchema);

/**
 * The routing DAG's scatter body: reads the current scattered
 * `RoutedChatStreamChunkType`, and appends its `delta` into the shared
 * `TranscriptStore` under `item.routeKey` — the classify-and-route step that
 * demultiplexes concurrent agent runs sharing one sink.
 */
export class RouteChunkNode extends MonadicNode<RoutingState, 'done'> {
  readonly name = 'route-chunk';
  readonly '@id' = 'urn:noocodec:node:route-chunk';
  readonly outputs = ['done'] as const;

  readonly #transcripts: TranscriptStore;

  constructor(transcripts: TranscriptStore) {
    super();
    this.#transcripts = transcripts;
  }

  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<RoutingState>) {
    for (const item of batch) {
      const raw = item.state.getMetadata(ROUTE_ITEM_KEY);
      if (CHUNK_VALIDATOR.is(raw)) {
        this.#transcripts.append(raw.routeKey, raw.delta);
      }
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// routingDag: scatter over the shared StreamChannel, classifying by routeKey
// ---------------------------------------------------------------------------

// #region react-routing-dag
export const routingDag: DAGType = {
  '@context':   DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:react-agent-routing',
  '@type':      'DAG',
  'name':       'react-agent-routing',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:react-agent-routing/node/scatter-chunks' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:react-agent-routing/node/scatter-chunks',
      '@type':       'ScatterNode',
      'name':        'scatter-chunks',
      'body':        { 'node': 'urn:noocodec:node:route-chunk' },
      'source':      'source',
      'itemKey':     ROUTE_ITEM_KEY,
      // Chunks route by their own `routeKey`; TranscriptStore.append is safe
      // under any interleaving (single-threaded event loop), so raising this
      // is a free performance choice, not a correctness requirement.
      'execution': { 'mode': 'item', 'concurrency': 4 },
      'outputs': {
        'all-success': 'urn:noocodec:dag:react-agent-routing/node/collect-chunks',
        'partial': 'urn:noocodec:dag:react-agent-routing/node/collect-chunks',
        'all-error': 'urn:noocodec:dag:react-agent-routing/node/collect-chunks',
        'empty': 'urn:noocodec:dag:react-agent-routing/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent-routing/node/collect-chunks',
      '@type': 'GatherNode',
      'name': 'collect-chunks',
      sources: { 'urn:noocodec:dag:react-agent-routing/node/scatter-chunks': {} },
      'gather': { 'strategy': 'append', 'target': 'chunks' },
      'outputs': {
        'success': 'urn:noocodec:dag:react-agent-routing/node/end',
        'error': 'urn:noocodec:dag:react-agent-routing/node/end',
        'empty': 'urn:noocodec:dag:react-agent-routing/node/end',
      },
    },
    {
      '@id': 'urn:noocodec:dag:react-agent-routing/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
};
// #endregion react-routing-dag
