/**
 * react-agent-routing: ONE shared `RoutingCallModelNode` and ONE shared
 * `StreamChannel<RoutedChatStreamChunkType>` sink serve TWO concurrent
 * conversations. Every chunk the node streams is self-describing
 * (`routeKey` + `source`), so a routing DAG scattering over the shared
 * channel demultiplexes the interleaved chunks back into separate
 * per-conversation transcripts — proving the sink itself can classify and
 * route by payload, not just buffer.
 *
 * DAG definitions + reusable classes: examples/dags/react-agent-routing.ts
 * (which reuses `AgentState` and the eight agent-loop node subclasses from
 * examples/dags/react-agent-memory.ts unchanged).
 *
 * Run: npx tsx examples/react-agent-routing.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { StreamChannel } from '@studnicky/dagonizer/channels';
import type { RoutedChatStreamChunkType } from '@studnicky/dagonizer/adapter';
import { ToolRegistry } from '@studnicky/dagonizer/tool';
import {
  agentDag,
  AgentState,
  LookupTool,
  MyAppendAssistantNode,
  MyBuildChatRequestNode,
  MyBuildToolWorksetsNode,
  MyCollectToolResultsNode,
  MyDecodeTextToolCallsNode,
  MyNormalizeResponseNode,
  MyNormalizeToolCallsNode,
  ScriptedAdapter,
} from './dags/react-agent-memory.js';
import {
  RouteChunkNode,
  RoutingCallModelNode,
  routingDag,
  RoutingState,
  TranscriptStore,
} from './dags/react-agent-routing.js';

// ---------------------------------------------------------------------------
// RoutingRunHarness: wires the shared sink, the shared node, and the routing
// DAG's concurrent drain in the order that avoids deadlock.
// ---------------------------------------------------------------------------

class RoutingRunHarness {
  private constructor() { /* static class */ }

  static async run(): Promise<{ transcripts: TranscriptStore; chunks: readonly RoutedChatStreamChunkType[] }> {
    // ONE shared sink every routed chunk from either conversation lands on.
    const channel = new StreamChannel<RoutedChatStreamChunkType>();

    // ONE shared agent dispatcher: one RoutingCallModelNode instance, wired
    // to the shared channel, plus the other seven agent-loop node subclasses.
    const llm = new ScriptedAdapter();
    const agentDispatcher = new Dagonizer<AgentState>();
    agentDispatcher.registerNode(new MyBuildChatRequestNode());
    agentDispatcher.registerNode(new RoutingCallModelNode(llm, { 'sink': channel }));
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

    // A SEPARATE routing dispatcher: one RouteChunkNode writing into ONE
    // shared TranscriptStore, scattering over the same shared channel.
    const transcripts = new TranscriptStore();
    const routingDispatcher = new Dagonizer<RoutingState>();
    routingDispatcher.registerNode(new RouteChunkNode(transcripts));
    routingDispatcher.registerDAG(routingDag);

    const routingState = new RoutingState();
    routingState.source = channel;

    // LIFECYCLE ORDER (critical — avoids deadlock):
    //
    // 1. Start the routing drain FIRST, without awaiting. It begins pulling
    //    from `channel` immediately, so the (256-item default) buffer never
    //    fills — pushes from either conversation never block.
    const routingDone = routingDispatcher.execute('react-agent-routing', routingState);

    // 2. Run two conversations CONCURRENTLY against the ONE shared node and
    //    ONE shared channel, each seeded with a distinct conversationId.
    const stateFor = (conversationId: string, prompt: string): AgentState => {
      const state = new AgentState();
      state.conversationId = conversationId;
      state.prompt = prompt;
      return state;
    };

    await Promise.all([
      agentDispatcher.execute('react-agent', stateFor('c1', 'Tell me about dagonizer.')),
      agentDispatcher.execute('react-agent', stateFor('c2', 'Tell me about dagonizer, briefly.')),
    ]);

    // 3. Only after both conversations finish pushing does the sink close —
    //    this is what ends the routing scatter's async-iterable source.
    channel.close();

    // 4. Now the routing drain can be awaited to completion.
    await routingDone;

    return { transcripts, 'chunks': routingState.chunks };
  }
}

// ---------------------------------------------------------------------------
// Run + report
// ---------------------------------------------------------------------------

process.stdout.write('--- react-agent-routing: two concurrent conversations, one shared sink ---\n\n');

const { transcripts, chunks } = await RoutingRunHarness.run();

process.stdout.write(`Total routed chunks observed: ${String(chunks.length)}\n\n`);

process.stdout.write(`c1 transcript: "${transcripts.transcript('c1')}"\n`);
process.stdout.write(`c2 transcript: "${transcripts.transcript('c2')}"\n\n`);

process.stdout.write(`Route keys with recorded transcripts: ${JSON.stringify(transcripts.keys())}\n\n`);

process.stdout.write('Lesson: one shared StreamChannel, fed by one shared RoutingCallModelNode instance,\n');
process.stdout.write('        carried BOTH conversations\' chunks interleaved. A routing DAG scattering\n');
process.stdout.write('        over that same channel classified each chunk by its stamped routeKey and\n');
process.stdout.write('        demultiplexed it into a separate, uncontaminated transcript per conversation\n');
process.stdout.write('        — the sink itself is a DAG that routes by payload, not a passive buffer.\n');
