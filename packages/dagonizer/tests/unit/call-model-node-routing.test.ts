/**
 * Tests: `CallModelNode` routed-sink demultiplexing.
 *
 * Proves that two concurrent executions of ONE shared `CallModelNode`
 * instance, wired to ONE shared downstream sink, produce chunks that are
 * correctly separable by `routeKey` — even when the underlying adapter
 * interleaves the two runs' pushes at the microtask level. Before the
 * routed-sink seam this was impossible to disambiguate: the shared sink
 * saw only `{delta}` with no indication of which run produced it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { LlmAdapterInterface } from '../../src/contracts/LlmAdapterInterface.js';
import type { StreamSinkInterface } from '../../src/contracts/StreamSinkInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ChatRequestType } from '../../src/entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../src/entities/adapter/ChatResponse.js';
import { ChatStreamChunk } from '../../src/entities/adapter/ChatStreamChunk.js';
import type { ChatStreamChunkType } from '../../src/entities/adapter/ChatStreamChunk.js';
import type { RoutedChatStreamChunkType } from '../../src/entities/adapter/RoutedChatStreamChunk.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { CallModelNode } from '../../src/patterns/agent/CallModelNode.js';

const ROUTING_TEST_DAG_IRI = 'urn:noocodec:dag:routing-test';
const ROUTING_TEST_CALL_MODEL_IRI = 'urn:noocodec:dag:routing-test/node/call-model';
const ROUTING_TEST_END_IRI = 'urn:noocodec:dag:routing-test/node/end';
const ROUTING_TEST_END_FAIL_IRI = 'urn:noocodec:dag:routing-test/node/end-fail';

// ── Harness state: carries a per-run id and the words to stream ────────────

class RunState extends NodeStateBase {
  runId: string;
  words: string[];
  chatRequest: ChatRequestType | null;
  chatResponse: ChatResponseType | null;

  constructor(runId: string, words: string[]) {
    super();
    this.runId = runId;
    this.words = words;
    this.chatRequest = null;
    this.chatResponse = null;
  }
}

// ── Scripted adapter: streams the request's words with a task-queue yield
//    between each push, so two concurrent `chatStream` calls genuinely
//    interleave their pushes into whatever sink they were each handed. ─────

/** Yields the current macrotask, letting other scheduled callbacks interleave. */
class TaskQueue {
  static yield(): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}

class InterleavingWordAdapter implements LlmAdapterInterface {
  readonly id = 'interleaving-word';
  readonly displayName = 'Interleaving Word Adapter';
  readonly capabilities = { 'toolUse': 'none' as const, 'structuredOutput': false, 'jsonMode': false };

  async chat(request: ChatRequestType): Promise<ChatResponseType> {
    const content = request.messages.map((m) => (m.role === 'user' ? m.content : '')).join(' ');
    return {
      'message': { 'variant': 'text', 'content': content },
      'finishReason': 'stop',
      'usage': { 'promptTokens': 1, 'completionTokens': 1 },
    };
  }

  async chatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    const response = await this.chat(request);
    const words = response.message.variant === 'text' ? response.message.content.split(' ') : [];
    for (const word of words) {
      await TaskQueue.yield();
      await sink.push(ChatStreamChunk.create(word));
    }
    return response;
  }

  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async probe(): Promise<boolean> { return true; }
  async listModels(): Promise<readonly never[]> { return []; }
}

// ── Shared collecting sink: ONE instance wired into every execution ────────

class CollectingSink implements StreamSinkInterface<RoutedChatStreamChunkType> {
  readonly received: RoutedChatStreamChunkType[] = [];

  async push(item: RoutedChatStreamChunkType): Promise<void> {
    await TaskQueue.yield();
    this.received.push(item);
  }
}

// ── Node under test: routeKey demultiplexes by state.runId ────────────────

class RunKeyedCallModelNode extends CallModelNode<RunState> {
  readonly name = 'call-model';
  readonly '@id' = 'urn:noocodec:node:call-model';

  protected override routeKey(state: RunState): string {
    return state.runId;
  }

  protected getRequest(state: RunState, context: NodeContextType): ChatRequestType {
    const req: ChatRequestType = {
      'messages': [{ 'role': 'user', 'content': state.words.join(' ') }],
      'tools': [],
      'toolChoice': { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens': 256,
      'temperature': 0,
      'signal': context.signal,
    };
    state.chatRequest = req;
    return req;
  }

  protected storeResponse(state: RunState, response: ChatResponseType, _context: NodeContextType): void {
    state.chatResponse = response;
  }
}

void describe('CallModelNode: routed-sink demultiplexing', () => {
  void it('separates concurrent runs on one shared node instance by routeKey', async () => {
    const sink = new CollectingSink();
    const node = new RunKeyedCallModelNode(new InterleavingWordAdapter(), { 'sink': sink });

    const dag = new DAGBuilder(ROUTING_TEST_DAG_IRI, '1', { 'name': 'routing-test' })
      .node(ROUTING_TEST_CALL_MODEL_IRI, node, {
        'text': ROUTING_TEST_END_IRI,
        'tools': ROUTING_TEST_END_IRI,
        'mixed': ROUTING_TEST_END_IRI,
        'error': ROUTING_TEST_END_FAIL_IRI,
      }, { 'name': 'call-model' })
      .terminal(ROUTING_TEST_END_IRI, { 'name': 'end' })
      .terminal(ROUTING_TEST_END_FAIL_IRI, { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RunState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const stateA = new RunState('run-a', ['alpha', 'bravo', 'charlie']);
    const stateB = new RunState('run-b', ['delta', 'echo']);

    const [resultA, resultB] = await Promise.all([
      dispatcher.execute(ROUTING_TEST_DAG_IRI, stateA),
      dispatcher.execute(ROUTING_TEST_DAG_IRI, stateB),
    ]);

    assert.equal(resultA.terminalOutcome, 'completed');
    assert.equal(resultB.terminalOutcome, 'completed');

    // Both runs' chunks landed in the ONE shared sink.
    assert.equal(sink.received.length, 5);

    // Every chunk is tagged with its origin's routeKey, so the two runs are
    // separable even though their pushes interleaved at the task-queue level.
    const runADeltas = sink.received.filter((c) => c.routeKey === 'run-a').map((c) => c.delta);
    const runBDeltas = sink.received.filter((c) => c.routeKey === 'run-b').map((c) => c.delta);
    assert.deepEqual(runADeltas, ['alpha', 'bravo', 'charlie']);
    assert.deepEqual(runBDeltas, ['delta', 'echo']);

    // Every routed chunk also carries a consistent source (dag/node).
    for (const chunk of sink.received) {
      assert.deepEqual(chunk.source, { 'dagName': ROUTING_TEST_DAG_IRI, 'nodeName': 'call-model' });
    }
  });
});
