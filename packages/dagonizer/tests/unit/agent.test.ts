/**
 * Tests: JSON-LD agent DAG
 *
 * Proves:
 *   1. DAGBuilder materializes an agent loop as JSON-LD DAG
 *      topology (correct names, types, and route maps).
 *   2. The assembled DAG registers cleanly in a Dagonizer (no schema errors,
 *      no missing node references).
 *   3. The loop-back edge is present: collect-results routes to build-request.
 *   4. Scatter placement resolves tool body via a typed DagReference.
 *   5. Terminal placements use the correct outcome values.
 *   6. The explicit gather strategy is `map` with the canonical field mapping.
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
import type { ToolCallType } from '../../src/entities/adapter/ToolCall.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { AppendAssistantNode } from '../../src/patterns/agent/AppendAssistantNode.js';
import { BuildChatRequestNode } from '../../src/patterns/agent/BuildChatRequestNode.js';
import { BuildToolWorksetsNode } from '../../src/patterns/agent/BuildToolWorksetsNode.js';
import type { ToolCallScatterItemType } from '../../src/patterns/agent/BuildToolWorksetsNode.js';
import { CallModelNode } from '../../src/patterns/agent/CallModelNode.js';
import { CollectToolResultsNode } from '../../src/patterns/agent/CollectToolResultsNode.js';
import { DecodeTextToolCallsNode } from '../../src/patterns/agent/DecodeTextToolCallsNode.js';
import { NormalizeResponseNode } from '../../src/patterns/agent/NormalizeResponseNode.js';
import { NormalizeToolCallsNode } from '../../src/patterns/agent/NormalizeToolCallsNode.js';
import { ToolRegistry } from '../../src/tool/ToolRegistry.js';

// ── Minimal harness state ─────────────────────────────────────────────────────

class LoopState extends NodeStateBase {
  prompt: string;
  chatRequest: ChatRequestType | null;
  chatResponse: ChatResponseType | null;
  assistantText: string;
  decodedCalls: ToolCallType[];
  safeWorkset: ToolCallScatterItemType[];
  exclusiveWorkset: ToolCallScatterItemType[];
  toolOutputs: unknown[];
  collectedResults: unknown[];

  constructor() {
    super();
    this.prompt = '';
    this.chatRequest = null;
    this.chatResponse = null;
    this.assistantText = '';
    this.decodedCalls = [];
    this.safeWorkset = [];
    this.exclusiveWorkset = [];
    this.toolOutputs = [];
    this.collectedResults = [];
  }
}

// ── Concrete node subclasses ──────────────────────────────────────────────────

class StubBuildChatRequestNode extends BuildChatRequestNode<LoopState> {
  readonly name = 'build-request';
  readonly '@id' = 'urn:noocodec:node:build-request';
  protected buildRequest(state: LoopState, context: NodeContextType): ChatRequestType {
    const req: ChatRequestType = {
      'messages': [{ 'role': 'user', 'content': state.prompt }],
      'tools': [],
      'toolChoice': { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens': 128,
      'temperature': 0,
      'signal': context.signal,
    };
    state.chatRequest = req;
    return req;
  }
}

class StubCallModelNode extends CallModelNode<LoopState> {
  readonly name = 'call-model';
  readonly '@id' = 'urn:noocodec:node:call-model';
  constructor(llm: LlmAdapterInterface) { super(llm); }
  protected getRequest(state: LoopState, _ctx: NodeContextType): ChatRequestType {
    if (state.chatRequest === null) throw new Error('chatRequest not set');
    return state.chatRequest;
  }
  protected storeResponse(state: LoopState, response: ChatResponseType, _ctx: NodeContextType): void {
    state.chatResponse = response;
    if (response.message.variant === 'text') {
      state.assistantText = response.message.content;
    }
  }
}

class StubNormalizeResponseNode extends NormalizeResponseNode<LoopState> {
  readonly name = 'normalize-response';
  readonly '@id' = 'urn:noocodec:node:normalize-response';
  protected getResponse(state: LoopState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }
}

class StubDecodeTextToolCallsNode extends DecodeTextToolCallsNode<LoopState> {
  readonly name = 'decode-tools';
  readonly '@id' = 'urn:noocodec:node:decode-tools';
  protected getText(state: LoopState, _ctx: NodeContextType): string {
    return state.assistantText;
  }
  protected storeToolCalls(state: LoopState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

class StubNormalizeToolCallsNode extends NormalizeToolCallsNode<LoopState> {
  readonly name = 'normalize-tools';
  readonly '@id' = 'urn:noocodec:node:normalize-tools';
  protected getToolCalls(state: LoopState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }
  protected writeNormalized(state: LoopState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

class StubBuildToolWorksetsNode extends BuildToolWorksetsNode<LoopState> {
  readonly name = 'build-worksets';
  readonly '@id' = 'urn:noocodec:node:build-worksets';
  protected getToolCalls(state: LoopState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }
  protected classifyCall(_call: ToolCallType, _state: LoopState, _ctx: NodeContextType): 'safe' | 'exclusive' {
    return 'safe';
  }
  protected writeSafeWorkset(state: LoopState, calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void {
    state.safeWorkset = [...calls];
  }
  protected writeExclusiveWorkset(state: LoopState, calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void {
    state.exclusiveWorkset = [...calls];
  }
}

class StubCollectToolResultsNode extends CollectToolResultsNode<LoopState> {
  readonly name = 'collect-results';
  readonly '@id' = 'urn:noocodec:node:collect-results';
  protected getGatheredResults(state: LoopState, _ctx: NodeContextType): readonly unknown[] {
    return state.toolOutputs;
  }
  protected writeResult(state: LoopState, results: readonly unknown[], _ctx: NodeContextType): void {
    state.collectedResults = [...results];
  }
}

class StubAppendAssistantNode extends AppendAssistantNode<LoopState> {
  readonly name = 'append-assistant';
  readonly '@id' = 'urn:noocodec:node:append-assistant';
  protected getResponse(state: LoopState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }
  protected append(state: LoopState, response: ChatResponseType, _ctx: NodeContextType): void {
    if (response.message.variant === 'text') {
      state.assistantText = `[appended] ${response.message.content}`;
    }
  }
}

// ── Shared fixture ────────────────────────────────────────────────────────────

class LoopFixture {
  private constructor() { /* static class */ }

  static nodes(llm: LlmAdapterInterface) {
    return {
      'chatRequest':         new StubBuildChatRequestNode(),
      'callModel':           new StubCallModelNode(llm),
      'normalizeResponse':   new StubNormalizeResponseNode(),
      'decodeTextToolCalls': new StubDecodeTextToolCallsNode(),
      'normalizeToolCalls':  new StubNormalizeToolCallsNode(),
      'toolWorksets':        new StubBuildToolWorksetsNode(),
      'collectToolResults':  new StubCollectToolResultsNode(),
      'appendAssistant':     new StubAppendAssistantNode(),
    };
  }

  static services(): {
    llm: LlmAdapterInterface;
    tools: ToolRegistry;
  } {
    return {
      'llm': {
        'id': 'stub',
        'displayName': 'Stub',
        'capabilities': {
          'toolUse': 'none' as const,
          'structuredOutput': false,
          'jsonMode': false,
        },
        async chat(_req: ChatRequestType): Promise<ChatResponseType> {
          return {
            'message': { 'variant': 'text', 'content': 'Hello from stub' },
            'finishReason': 'stop',
            'usage': { 'promptTokens': 1, 'completionTokens': 1 },
          };
        },
        async chatStream(
          req: ChatRequestType,
          sink: StreamSinkInterface<ChatStreamChunkType>,
        ): Promise<ChatResponseType> {
          const response = await this.chat(req);
          if (response.message.variant === 'text') {
            await sink.push(ChatStreamChunk.create(response.message.content));
          }
          return response;
        },
        async connect(): Promise<void> { /* no-op */ },
        async disconnect(): Promise<void> { /* no-op */ },
        async probe(): Promise<boolean> { return true; },
        async listModels(): Promise<readonly never[]> { return []; },
      },
      'tools': new ToolRegistry(),
    };
  }
}

function buildAgentDag(
  nodes: ReturnType<typeof LoopFixture.nodes>,
  dagIri = 'urn:noocodec:dag:agent-loop',
  name = 'agent-loop',
  version = '1',
) {
  const iri = (placement: string): string => placementIri(placement, dagIri);
  return new DAGBuilder(dagIri, version, { name })
    .node(iri('build-request'), nodes.chatRequest, {
      'ready': iri('call-model'),
      'error': iri('end-error'),
    }, { 'name': 'build-request' })
    .node(iri('call-model'), nodes.callModel, {
      'text':  iri('normalize-response'),
      'tools': iri('normalize-response'),
      'mixed': iri('normalize-response'),
      'error': iri('end-error'),
    }, { 'name': 'call-model' })
    .node(iri('normalize-response'), nodes.normalizeResponse, {
      'text':  iri('append-assistant'),
      'tools': iri('decode-tools'),
      'mixed': iri('decode-tools'),
      'empty': iri('end-error'),
      'error': iri('end-error'),
    }, { 'name': 'normalize-response' })
    .node(iri('append-assistant'), nodes.appendAssistant, {
      'done':  iri('end-done'),
      'error': iri('end-error'),
    }, { 'name': 'append-assistant' })
    .node(iri('decode-tools'), nodes.decodeTextToolCalls, {
      'decoded': iri('normalize-tools'),
      'empty':   iri('end-error'),
      'error':   iri('end-error'),
    }, { 'name': 'decode-tools' })
    .node(iri('normalize-tools'), nodes.normalizeToolCalls, {
      'valid': iri('worksets'),
      'empty': iri('end-error'),
      'error': iri('end-error'),
    }, { 'name': 'normalize-tools' })
    .node(iri('worksets'), nodes.toolWorksets, {
      'ready': iri('dispatch-tools'),
      'empty': iri('end-error'),
      'error': iri('end-error'),
    }, { 'name': 'worksets' })
    .scatter(
      iri('dispatch-tools'),
      'safeWorkset',
      { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': ['urn:noocodec:tool:calculator'] } },
      {
        'all-success': iri('join-tool-results'),
        'partial': iri('join-tool-results'),
        'all-error': iri('join-tool-results'),
        'empty': iri('join-tool-results'),
      },
      {
        'itemKey': 'currentItem',
        'name':    'dispatch-tools',
      },
    )
    .gather(iri('join-tool-results'), { [iri('dispatch-tools')]: {} }, {
      'strategy': 'map',
      'mapping': { 'output': 'toolOutputs' },
    }, {
      'success': iri('collect-results'),
      'error': iri('end-error'),
      'empty': iri('collect-results'),
    }, { 'name': 'join-tool-results' })
    .node(iri('collect-results'), nodes.collectToolResults, {
      'done':  iri('build-request'),
      'empty': iri('build-request'),
      'error': iri('end-error'),
    }, { 'name': 'collect-results' })
    .terminal(iri('end-done'), { 'name': 'end-done' })
    .terminal(iri('end-error'), { 'name': 'end-error', 'outcome': 'failed' })
    .build();
}

function placementIri(name: string, dagIri = 'urn:noocodec:dag:agent-loop'): string {
  return `${dagIri}/node/${name}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('JSON-LD agent DAG: topology', () => {
  const nodes = LoopFixture.nodes(LoopFixture.services().llm);
  const dag = buildAgentDag(nodes);

  void it('returns a valid DAGType with the canonical name and version defaults', () => {
    assert.equal(dag['@type'], 'DAG');
    assert.equal(dag.name, 'agent-loop');
    assert.equal(dag.version, '1');
    assert.ok(dag['@id'].includes('agent-loop'), '@id must contain the DAG display label');
    assert.ok(dag['@context'] !== undefined);
  });

  void it('main entrypoint is build-request', () => {
    assert.equal(dag.entrypoints['main'], placementIri('build-request'));
  });

  void it('contains exactly the expected placement names', () => {
    const names = dag.nodes.map((n) => n.name);
    const expected = [
      'build-request',
      'call-model',
      'normalize-response',
      'append-assistant',
      'decode-tools',
      'normalize-tools',
      'worksets',
      'dispatch-tools',
      'join-tool-results',
      'collect-results',
      'end-done',
      'end-error',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `placement '${name}' must be present`);
    }
  });

  void it('collect-results routes back to build-request (loop-back edge)', () => {
    const collectNode = dag.nodes.find((n) => n.name === 'collect-results');
    assert.ok(collectNode !== undefined, 'collect-results placement must exist');
    assert.equal(collectNode['@type'], 'SingleNode', 'collect-results must be a SingleNode');

    // @type narrowed to 'SingleNode' — access outputs
    if (collectNode['@type'] === 'SingleNode') {
      assert.equal(collectNode.outputs['done'], placementIri('build-request'), 'done → build-request (loop back)');
      assert.equal(collectNode.outputs['empty'], placementIri('build-request'), 'empty → build-request (loop back)');
      assert.equal(collectNode.outputs['error'], placementIri('end-error'), 'error → end-error');
    }
  });

  void it('append-assistant routes to end-done on success', () => {
    const appendNode = dag.nodes.find((n) => n.name === 'append-assistant');
    assert.ok(appendNode !== undefined, 'append-assistant must exist');
    if (appendNode['@type'] === 'SingleNode') {
      assert.equal(appendNode.outputs['done'], placementIri('end-done'));
      assert.equal(appendNode.outputs['error'], placementIri('end-error'));
    }
  });

  void it('dispatch-tools scatter uses a DagReference body', () => {
    const scatter = dag.nodes.find((n) => n.name === 'dispatch-tools');
    assert.ok(scatter !== undefined, 'dispatch-tools must exist');
    assert.equal(scatter['@type'], 'ScatterNode', 'dispatch-tools must be a ScatterNode');

    if (scatter['@type'] === 'ScatterNode') {
      assert.ok('dag' in scatter.body, 'scatter body must use a DagReference');
      assert.deepEqual(scatter.body.dag, {
        '@type': 'DagReference',
        'from': 'item',
        'path': 'dagIri',
        'candidates': ['urn:noocodec:tool:calculator'],
      });
      assert.equal(scatter.source, 'safeWorkset', 'scatter source must be safeWorkset');
    }
  });

  void it('explicit gather strategy is map with canonical mapping', () => {
    const gather = dag.nodes.find((n) => n.name === 'join-tool-results');
    assert.ok(gather !== undefined);
    assert.equal(gather['@type'], 'GatherNode', 'join-tool-results must be a GatherNode');
    if (gather['@type'] === 'GatherNode') {
      assert.deepEqual(gather.sources, { [placementIri('dispatch-tools')]: {} });
      assert.equal(gather.gather.strategy, 'map', 'gather strategy must be map');
      if (gather.gather.strategy === 'map') {
        assert.deepEqual(
          gather.gather.mapping,
          { 'output': 'toolOutputs' },
          'mapping must fold clone.output → parent.toolOutputs',
        );
      }
    }
  });

  void it('end-done is a completed terminal; end-error is a failed terminal', () => {
    const endDone = dag.nodes.find((n) => n.name === 'end-done');
    assert.ok(endDone !== undefined, 'end-done must exist');
    assert.equal(endDone['@type'], 'TerminalNode');
    if (endDone['@type'] === 'TerminalNode') {
      assert.equal(endDone.outcome, 'completed');
    }

    const endError = dag.nodes.find((n) => n.name === 'end-error');
    assert.ok(endError !== undefined, 'end-error must exist');
    assert.equal(endError['@type'], 'TerminalNode');
    if (endError['@type'] === 'TerminalNode') {
      assert.equal(endError.outcome, 'failed');
    }
  });

});

void describe('JSON-LD agent DAG: Dagonizer registration', () => {
  void it('assembled DAG registers cleanly in a Dagonizer (no schema errors)', () => {
    const services = LoopFixture.services();
    const nodes = LoopFixture.nodes(services.llm);
    const dag = buildAgentDag(nodes);

    const dispatcher = new Dagonizer<LoopState>();
    dispatcher.registerNode(nodes.chatRequest);
    dispatcher.registerNode(nodes.callModel);
    dispatcher.registerNode(nodes.normalizeResponse);
    dispatcher.registerNode(nodes.decodeTextToolCalls);
    dispatcher.registerNode(nodes.normalizeToolCalls);
    dispatcher.registerNode(nodes.toolWorksets);
    dispatcher.registerNode(nodes.collectToolResults);
    dispatcher.registerNode(nodes.appendAssistant);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:tool:calculator', '1').terminal('urn:noocodec:tool:calculator/node/end', { 'name': 'end' }).build());
    dispatcher.registerDAG(dag);
    // Reaching here without throw proves the DAG is schema-valid and all
    // node references resolve.
  });

  void it('executes a text-answer turn to completion without tool calls', async () => {
    const services = LoopFixture.services();
    const nodes = LoopFixture.nodes(services.llm);
    const dag = buildAgentDag(nodes);

    const dispatcher = new Dagonizer<LoopState>();
    dispatcher.registerNode(nodes.chatRequest);
    dispatcher.registerNode(nodes.callModel);
    dispatcher.registerNode(nodes.normalizeResponse);
    dispatcher.registerNode(nodes.decodeTextToolCalls);
    dispatcher.registerNode(nodes.normalizeToolCalls);
    dispatcher.registerNode(nodes.toolWorksets);
    dispatcher.registerNode(nodes.collectToolResults);
    dispatcher.registerNode(nodes.appendAssistant);
    dispatcher.registerDAG(new DAGBuilder('urn:noocodec:tool:calculator', '1').terminal('urn:noocodec:tool:calculator/node/end', { 'name': 'end' }).build());
    dispatcher.registerDAG(dag);

    const state = new LoopState();
    state.prompt = 'Say hello';

    const result = await dispatcher.execute('urn:noocodec:dag:agent-loop', state);

    // The stub LLM returns a plain text response, so the loop does not enter
    // the tool-call path. The assistant message is appended and the DAG
    // terminates at end-done (completed).
    assert.equal(result.terminalOutcome, 'completed', 'text-only turn must complete');
    assert.ok(state.chatResponse !== null, 'chatResponse must be stored');
    assert.ok(
      state.assistantText.includes('[appended]'),
      'assistant text must be appended by AppendAssistantNode',
    );
  });
});
