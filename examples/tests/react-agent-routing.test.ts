import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
} from '../dags/react-agent-memory.ts';
import {
  RouteChunkNode,
  RoutingCallModelNode,
  routingDag,
  RoutingState,
  TranscriptStore,
} from '../dags/react-agent-routing.ts';

class Harness {
  private constructor() { /* static class */ }

  static async run(): Promise<{ transcripts: TranscriptStore; chunks: readonly RoutedChatStreamChunkType[] }> {
    const channel = new StreamChannel<RoutedChatStreamChunkType>();

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

    const transcripts = new TranscriptStore();
    const routingDispatcher = new Dagonizer<RoutingState>();
    routingDispatcher.registerNode(new RouteChunkNode(transcripts));
    routingDispatcher.registerDAG(routingDag);

    const routingState = new RoutingState();
    routingState.source = channel;

    const routingDone = routingDispatcher.execute('urn:noocodec:dag:react-agent-routing', routingState);

    const stateFor = (conversationId: string, prompt: string): AgentState => {
      const state = new AgentState();
      state.conversationId = conversationId;
      state.prompt = prompt;
      return state;
    };

    await Promise.all([
      agentDispatcher.execute('urn:noocodec:dag:react-agent', stateFor('c1', 'Tell me about dagonizer.')),
      agentDispatcher.execute('urn:noocodec:dag:react-agent', stateFor('c2', 'Tell me about dagonizer, briefly.')),
    ]);

    channel.close();
    await routingDone;

    return { transcripts, 'chunks': routingState.chunks };
  }
}

describe('react-agent-routing: one shared sink demultiplexes concurrent conversations by routeKey', () => {
  void it('routes every chunk to exactly one conversation, with no cross-contamination', async () => {
    const { transcripts, chunks } = await Harness.run();

    const c1 = transcripts.transcript('c1');
    const c2 = transcripts.transcript('c2');

    assert.ok(c1.length > 0, 'c1 must have a non-empty transcript');
    assert.ok(c2.length > 0, 'c2 must have a non-empty transcript');

    // ScriptedAdapter's final answer text is prompt-INSENSITIVE (a fixed
    // tool observation), so c1 and c2's transcripts are legitimately the
    // same string when read in isolation — that alone does not indicate
    // contamination. The actual proof of no cross-contamination is at the
    // chunk level: each conversation must have produced its own exclusive
    // set of chunks, and neither transcript may be a doubled/merged copy
    // (which would occur if both conversations' chunks landed in one
    // bucket instead of being demultiplexed by routeKey).
    const c1ChunkCount = chunks.filter((chunk) => chunk.routeKey === 'c1').length;
    const c2ChunkCount = chunks.filter((chunk) => chunk.routeKey === 'c2').length;
    assert.ok(c1ChunkCount > 0, 'c1 must own at least one chunk');
    assert.ok(c2ChunkCount > 0, 'c2 must own at least one chunk');
    assert.equal(c1ChunkCount + c2ChunkCount, chunks.length, 'every chunk must be owned by exactly one of c1 or c2');
  });

  void it('TranscriptStore.keys() is exactly {c1, c2} — no stray or missing route keys', async () => {
    const { transcripts } = await Harness.run();
    const keys = [...transcripts.keys()].sort();
    assert.deepEqual(keys, ['c1', 'c2']);
  });

  void it('every routed chunk carries a source stamp of {dagName, nodeName}', async () => {
    const { chunks } = await Harness.run();
    assert.ok(chunks.length > 0, 'at least one chunk must be routed');
    for (const chunk of chunks) {
      assert.equal(chunk.source.dagName, 'urn:noocodec:dag:react-agent');
      assert.equal(chunk.source.nodeName, 'call-model');
      assert.ok(chunk.routeKey === 'c1' || chunk.routeKey === 'c2', `unexpected routeKey: ${chunk.routeKey}`);
    }
  });

  void it('every chunk with routeKey c1 belongs to c1\'s transcript, and c2 likewise, with no interleaving loss', async () => {
    const { transcripts, chunks } = await Harness.run();

    const c1Deltas = chunks.filter((chunk) => chunk.routeKey === 'c1').map((chunk) => chunk.delta).join('');
    const c2Deltas = chunks.filter((chunk) => chunk.routeKey === 'c2').map((chunk) => chunk.delta).join('');

    assert.equal(transcripts.transcript('c1'), c1Deltas, 'TranscriptStore c1 must equal the concatenation of only c1-routed chunks');
    assert.equal(transcripts.transcript('c2'), c2Deltas, 'TranscriptStore c2 must equal the concatenation of only c2-routed chunks');
  });
});
