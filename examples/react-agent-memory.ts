/**
 * react-agent-memory: ReAct reasoning trace as a stream, recorded into a
 * shared RDF store with provenance, recalled across runs via graph traversal.
 *
 * Demonstrates:
 *   1. Organizing an agent's ReAct reasoning trace as a STREAM
 *      (`ReActTraceProducer` → `StreamChannel.driven` → outer `ScatterNode`).
 *   2. Capturing each reasoning step into a graph store WITH PROVENANCE
 *      (`RecordReasoningStepNode`, a `wasInformedBy` chain per run).
 *   3. RECALLING prior reasoning via graph traversal on a second run against
 *      the SAME store (`ReActRecall.hint`).
 *
 * The pipeline, per run:
 *
 *   dispatcher.execute(agentDagName, agentState)        → Execution (AsyncIterable<NodeResultType>)
 *     → new ReActTraceProducer(execution)                → DagStreamProducer<ReasoningStepType>
 *       → StreamChannel.driven(producer)                  → AsyncIterable<ReasoningStepType>
 *         → traceState.source
 *           → outerDispatcher.execute(traceDagName, traceState)  ← the outer scatter drains the trace
 *
 * `StreamChannel.driven` detaches the producer, which runs the inner agent
 * `Execution` and pushes each reasoning step into the channel; the outer
 * scatter consumes them and records each to the graph. Producer and consumer
 * are back-pressure-coupled through the channel's bounded buffer — but a ReAct
 * trace is only ~4 items against the default 256-item capacity, so `push`
 * never actually blocks here. The back-pressure machinery is exercised, not
 * stressed, at this scale; a producer discovering millions of items is where
 * it would gate the inner loop on the consumer's drain rate.
 *
 * DAG definitions + reusable classes: examples/dags/react-agent-memory.ts
 *
 * Run: npx tsx examples/react-agent-memory.ts
 */

import { Dagonizer, StreamChannel } from '@studnicky/dagonizer';
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
  ScriptedAdapter,
  TokenCollectorSink,
  traceDag,
  TraceState,
} from './dags/react-agent-memory.js';

// ---------------------------------------------------------------------------
// One run of the pipeline: agent loop → trace stream → provenance record
// ---------------------------------------------------------------------------

class ReactRunHarness {
  private constructor() { /* static class */ }

  static async run(
    store: RdfStore,
    runId: string,
    prompt: string,
    recallHint: string,
  ): Promise<{ finalAnswer: string; deltas: readonly string[] }> {
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

    // `execute` returns the Execution (AsyncIterable<NodeResultType>) — handed
    // directly to the trace producer, never drained here.
    const execution = agentDispatcher.execute('urn:noocodec:dag:react-agent', agentState);

    const traceState = new TraceState();
    traceState.source = StreamChannel.driven(new ReActTraceProducer(execution));

    const outerDispatcher = new Dagonizer<TraceState>();
    outerDispatcher.registerNode(new RecordReasoningStepNode(store, runId));
    outerDispatcher.registerDAG(traceDag);

    // The outer scatter drains the reasoning trace and records each step.
    // (`StreamChannel.driven` runs the inner agent loop eagerly within the
    // channel's bounded buffer; at ~4 trace items it never back-pressures.)
    await outerDispatcher.execute('urn:noocodec:dag:react-agent-memory-trace', traceState);

    return { 'finalAnswer': agentState.assistantText, 'deltas': sink.deltas };
  }
}

// ---------------------------------------------------------------------------
// Run 1: no prior memory
// ---------------------------------------------------------------------------

process.stdout.write('--- react-agent-memory: run-1 (no prior memory) ---\n\n');

const store = new RdfStore();

const run1 = await ReactRunHarness.run(store, 'run-1', 'Tell me about dagonizer.', '');
process.stdout.write(`Final answer: "${run1.finalAnswer}"\n`);
process.stdout.write(`Streamed deltas (${String(run1.deltas.length)}): ${JSON.stringify(run1.deltas)}\n\n`);

// ---------------------------------------------------------------------------
// Recall: walk run-1's provenance chain into a one-line hint
// ---------------------------------------------------------------------------

const recallHint = ReActRecall.hint(store, 'run-1');
process.stdout.write(`Recalled hint for run-2: "${recallHint}"\n\n`);

// ---------------------------------------------------------------------------
// Run 2: same store, primed with run-1's recalled reasoning
// ---------------------------------------------------------------------------

process.stdout.write('--- react-agent-memory: run-2 (recalling run-1) ---\n\n');

const run2 = await ReactRunHarness.run(store, 'run-2', 'Tell me about dagonizer again.', recallHint);
process.stdout.write(`Final answer: "${run2.finalAnswer}"\n`);
process.stdout.write(`Streamed deltas (${String(run2.deltas.length)}): ${JSON.stringify(run2.deltas)}\n\n`);

process.stdout.write('Lesson: the ReAct reasoning trace streams through a DagStreamProducer into an\n');
process.stdout.write('        outer scatter that records each step into a shared RdfStore with a\n');
process.stdout.write('        wasInformedBy provenance chain; a second run recalls the first run\'s\n');
process.stdout.write('        chain via graph traversal and injects it as prompt context.\n');
