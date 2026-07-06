import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dagonizer, ReasoningStep, ReasoningTraceItem, StreamChannel } from '@studnicky/dagonizer';
import type { ReasoningTraceItemType, StreamProducerInterface, StreamSinkInterface } from '@studnicky/dagonizer';
import type { ChatMessageType } from '@studnicky/dagonizer/adapter';
import { ToolRegistry } from '@studnicky/dagonizer/tool';
import { RdfStore } from '@studnicky/dagonizer-patterns-graph';
import {
  agentDag,
  AgentState,
  LookupTool,
  MyAppendAssistantNode,
  MyBuildChatRequestNode,
  MyBuildToolWorksetsNode,
  MyCallModelNode,
  MyCollectToolResultsNode,
  MyDecodeTextToolCallsNode,
  MyNormalizeResponseNode,
  MyNormalizeToolCallsNode,
  ReActRecall,
  ReActTraceProducer,
  RecordReasoningStepNode,
  ReasoningProvenanceIri,
  REASONING_PROV_PREDICATE,
  ScriptedAdapter,
  TokenCollectorSink,
  traceDag,
  TraceState,
} from '../dags/react-agent-memory.ts';

class Harness {
  static async run(
    store: RdfStore,
    runId: string,
    prompt: string,
    recallHint: string,
  ): Promise<{ agentState: AgentState; sink: TokenCollectorSink; traceState: TraceState }> {
    const llm = new ScriptedAdapter();
    const sink = new TokenCollectorSink();

    const agentDispatcher = new Dagonizer<AgentState>();
    agentDispatcher.registerNode(new MyBuildChatRequestNode());
    agentDispatcher.registerNode(new MyCallModelNode(llm, { 'sink': sink }));
    agentDispatcher.registerNode(new MyNormalizeResponseNode());
    agentDispatcher.registerNode(new MyDecodeTextToolCallsNode());
    agentDispatcher.registerNode(new MyNormalizeToolCallsNode());
    agentDispatcher.registerNode(new MyBuildToolWorksetsNode());
    agentDispatcher.registerNode(new MyCollectToolResultsNode());
    agentDispatcher.registerNode(new MyAppendAssistantNode());

    const tools = new ToolRegistry();
    tools.register(new LookupTool());
    agentDispatcher.registerBundle(tools.bundle());
    agentDispatcher.registerDAG(agentDag);

    const agentState = new AgentState();
    agentState.prompt = prompt;
    agentState.recallHint = recallHint;

    const execution = agentDispatcher.execute('react-agent', agentState);

    const traceState = new TraceState();
    traceState.source = StreamChannel.driven(new ReActTraceProducer(execution));

    const outerDispatcher = new Dagonizer<TraceState>();
    outerDispatcher.registerNode(new RecordReasoningStepNode(store, runId));
    outerDispatcher.registerDAG(traceDag);

    await outerDispatcher.execute('react-agent-memory-trace', traceState);

    return { agentState, sink, traceState };
  }
}

describe('react-agent-memory: trace stream → provenance record → cross-run recall', () => {
  const store = new RdfStore();

  void it('run-1 records reasoning steps with a wasInformedBy provenance chain', async () => {
    const { traceState } = await Harness.run(store, 'run-1', 'Tell me about dagonizer.', '');

    assert.ok(traceState.steps.length > 0, 'at least one reasoning step must be recorded');

    const kindQuads = [...store.triples()].filter((q) => q.predicate.value === REASONING_PROV_PREDICATE.kind.value);
    const valueQuads = [...store.triples()].filter((q) => q.predicate.value === REASONING_PROV_PREDICATE.value.value);
    const generatedByQuads = [...store.triples()].filter((q) => q.predicate.value === REASONING_PROV_PREDICATE.wasGeneratedBy.value);
    const informedByQuads = [...store.triples()].filter((q) => q.predicate.value === REASONING_PROV_PREDICATE.wasInformedBy.value);

    assert.ok(kindQuads.length > 0, 'prov#kind quads must be present');
    assert.ok(valueQuads.length > 0, 'prov#value quads must be present');
    assert.ok(generatedByQuads.length > 0, 'prov#wasGeneratedBy quads must be present');
    assert.ok(informedByQuads.length > 0, 'prov#wasInformedBy quads must be present (chain of more than one step)');

    // Every wasInformedBy object must match a real prior step's subject
    // (a subject that itself carries a prov#kind quad).
    const kindSubjects = new Set(kindQuads.map((q) => q.subject.value));
    for (const quad of informedByQuads) {
      assert.ok(kindSubjects.has(quad.object.value), `wasInformedBy object '${quad.object.value}' must reference a real prior step`);
    }

    const finalKindQuad = kindQuads.find((q) => q.object.value === 'final');
    assert.ok(finalKindQuad !== undefined, 'a final-kind step must be recorded');
  });

  void it('run-2 recalls run-1\'s reasoning via graph traversal and injects it as prompt context', async () => {
    const hint = ReActRecall.hint(store, 'run-1');
    assert.ok(hint.length > 0, 'recall hint must be non-empty');
    assert.ok(hint.includes('run-1'), 'hint must cite the prior run id');
    assert.ok(hint.includes('final:'), 'hint must include the final step');

    const { agentState } = await Harness.run(store, 'run-2', 'Tell me about dagonizer again.', hint);

    const systemMessages = agentState.history.filter((m: ChatMessageType) => m.role === 'system');
    assert.ok(systemMessages.length > 0, 'run-2 history must carry an injected system message');
    assert.ok(
      systemMessages.some((m) => m.content === hint),
      'the injected system message must carry the exact recalled hint text',
    );
  });

  void it('TokenCollectorSink receives more than one streamed delta', async () => {
    const { sink } = await Harness.run(store, 'run-3', 'One more time.', '');
    assert.ok(sink.deltas.length > 1, `expected more than one streamed delta, got ${String(sink.deltas.length)}`);
  });
});

/** Test-only producer: pushes a fixed, caller-supplied item sequence — used to simulate out-of-order recording. */
class ShuffledItemProducer implements StreamProducerInterface<ReasoningTraceItemType> {
  readonly #items: readonly ReasoningTraceItemType[];

  constructor(items: readonly ReasoningTraceItemType[]) {
    this.#items = items;
  }

  async produce(sink: StreamSinkInterface<ReasoningTraceItemType>): Promise<void> {
    for (const item of this.#items) {
      await sink.push(item);
    }
  }
}

describe('RecordReasoningStepNode: wasInformedBy chain is ordinal-derived, not recording-order-derived', () => {
  void it('links each item to ordinal-1 correctly even when items are recorded OUT OF ORDER', async () => {
    const store = new RdfStore();
    const runId = 'shuffled-run';

    // Four ordinal-tagged items, 0..3 — the ordinal is the ONLY thing that
    // determines the wasInformedBy chain. Recording them out of ordinal
    // order (2, 0, 3, 1) proves RecordReasoningStepNode holds no cross-item
    // state and derives every link from `item.ordinal` alone.
    const items = [
      ReasoningTraceItem.create(0, ReasoningStep.create({ 'kind': 'thought', 'text': 'first thought' })),
      ReasoningTraceItem.create(1, ReasoningStep.create({ 'kind': 'action', 'tool': 'lookup', 'args': { 'query': 'dagonizer' } })),
      ReasoningTraceItem.create(2, ReasoningStep.create({ 'kind': 'observation', 'output': 'an observation' })),
      ReasoningTraceItem.create(3, ReasoningStep.create({ 'kind': 'final', 'text': 'a final answer' })),
    ];
    const shuffledEmissionOrder: ReasoningTraceItemType[] = [];
    for (const index of [2, 0, 3, 1]) {
      const item = items[index];
      if (item !== undefined) shuffledEmissionOrder.push(item);
    }

    const traceState = new TraceState();
    traceState.source = StreamChannel.driven(new ShuffledItemProducer(shuffledEmissionOrder));

    const outerDispatcher = new Dagonizer<TraceState>();
    outerDispatcher.registerNode(new RecordReasoningStepNode(store, runId));
    outerDispatcher.registerDAG(traceDag);
    await outerDispatcher.execute('react-agent-memory-trace', traceState);

    assert.equal(traceState.steps.length, 4, 'all four shuffled items must be recorded');

    // For every ordinal > 0, the graph must carry a wasInformedBy edge from
    // that ordinal's subject to the (ordinal - 1) subject — regardless of
    // the shuffled recording order above.
    for (let ordinal = 1; ordinal < 4; ordinal += 1) {
      const subject = ReasoningProvenanceIri.stepSubject(runId, ordinal);
      const previousSubject = ReasoningProvenanceIri.stepSubject(runId, ordinal - 1);
      const informedByBindings = store.select({
        'subject':   subject,
        'predicate': REASONING_PROV_PREDICATE.wasInformedBy,
        'object':    '?prev',
      });
      const binding = informedByBindings[0];
      assert.ok(binding !== undefined, `ordinal ${String(ordinal)} must carry a wasInformedBy edge`);
      assert.equal(
        binding?.['prev']?.value,
        previousSubject.value,
        `ordinal ${String(ordinal)} must link to ordinal ${String(ordinal - 1)}, not the previously-recorded item`,
      );
    }

    // ordinal 0 must carry NO wasInformedBy edge, even though it was recorded second.
    const ordinalZeroSubject = ReasoningProvenanceIri.stepSubject(runId, 0);
    const ordinalZeroInformedBy = store.select({
      'subject':   ordinalZeroSubject,
      'predicate': REASONING_PROV_PREDICATE.wasInformedBy,
      'object':    '?prev',
    });
    assert.equal(ordinalZeroInformedBy.length, 0, 'ordinal 0 must not carry a wasInformedBy edge');
  });
});
