/**
 * Tests: AgentBuilder.loop
 *
 * Proves:
 *   1. AgentBuilder.loop(nodes) returns a valid DAGType with the canonical
 *      placement topology (correct names, types, and route maps).
 *   2. The assembled DAG registers cleanly in a Dagonizer (no schema errors,
 *      no missing node references).
 *   3. The loop-back edge is present: collect-results routes to build-request.
 *   4. Scatter placement resolves tool body via dagFrom.
 *   5. Terminal placements use the correct outcome values.
 *   6. Custom name/version options override the defaults.
 *   7. The scatter gather strategy is `map` with the canonical field mapping.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LlmAdapterInterface } from '../../src/contracts/LlmAdapterInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ChatRequestType } from '../../src/entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../src/entities/adapter/ChatResponse.js';
import type { ToolCallType } from '../../src/entities/adapter/ToolCall.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { AgentBuilder } from '../../src/patterns/agent/AgentBuilder.js';
import type { AgentLoopNodesType, AgentLoopOptionsType } from '../../src/patterns/agent/AgentBuilder.js';
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
  protected getResponse(state: LoopState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }
}

class StubDecodeTextToolCallsNode extends DecodeTextToolCallsNode<LoopState> {
  readonly name = 'decode-tools';
  protected getText(state: LoopState, _ctx: NodeContextType): string {
    return state.assistantText;
  }
  protected storeToolCalls(state: LoopState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

class StubNormalizeToolCallsNode extends NormalizeToolCallsNode<LoopState> {
  readonly name = 'normalize-tools';
  protected getToolCalls(state: LoopState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }
  protected writeNormalized(state: LoopState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

class StubBuildToolWorksetsNode extends BuildToolWorksetsNode<LoopState> {
  readonly name = 'build-worksets';
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
  protected getGatheredResults(state: LoopState, _ctx: NodeContextType): readonly unknown[] {
    return state.toolOutputs;
  }
  protected writeResult(state: LoopState, results: readonly unknown[], _ctx: NodeContextType): void {
    state.collectedResults = [...results];
  }
}

class StubAppendAssistantNode extends AppendAssistantNode<LoopState> {
  readonly name = 'append-assistant';
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

  static nodes(llm: LlmAdapterInterface): AgentLoopNodesType {
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
        async connect(): Promise<void> { /* no-op */ },
        async disconnect(): Promise<void> { /* no-op */ },
        async probe(): Promise<boolean> { return true; },
      },
      'tools': new ToolRegistry(),
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('AgentBuilder.loop: topology', () => {
  void it('returns a valid DAGType with the canonical name and version defaults', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));

    assert.equal(dag['@type'], 'DAG');
    assert.equal(dag.name, 'agent-loop');
    assert.equal(dag.version, '1');
    assert.ok(dag['@id'].includes('agent-loop'), '@id must contain the dag name');
    assert.ok(dag['@context'] !== undefined);
  });

  void it('accepts name and version overrides via options', () => {
    const options: AgentLoopOptionsType = { 'name': 'my-agent', 'version': '2.0' };
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm), options);

    assert.equal(dag.name, 'my-agent');
    assert.equal(dag.version, '2.0');
    assert.ok(dag['@id'].includes('my-agent'), '@id must reflect the custom name');
  });

  void it('entrypoint is build-request', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));
    assert.equal(dag.entrypoint, 'build-request');
  });

  void it('contains exactly the expected placement names', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));
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
      'collect-results',
      'end-done',
      'end-error',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `placement '${name}' must be present`);
    }
  });

  void it('collect-results routes back to build-request (loop-back edge)', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));
    const collectNode = dag.nodes.find((n) => n.name === 'collect-results');
    assert.ok(collectNode !== undefined, 'collect-results placement must exist');
    assert.equal(collectNode['@type'], 'SingleNode', 'collect-results must be a SingleNode');

    // @type narrowed to 'SingleNode' — access outputs
    if (collectNode['@type'] === 'SingleNode') {
      assert.equal(collectNode.outputs['done'], 'build-request', 'done → build-request (loop back)');
      assert.equal(collectNode.outputs['empty'], 'build-request', 'empty → build-request (loop back)');
      assert.equal(collectNode.outputs['error'], 'end-error', 'error → end-error');
    }
  });

  void it('append-assistant routes to end-done on success', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));
    const appendNode = dag.nodes.find((n) => n.name === 'append-assistant');
    assert.ok(appendNode !== undefined, 'append-assistant must exist');
    if (appendNode['@type'] === 'SingleNode') {
      assert.equal(appendNode.outputs['done'], 'end-done');
      assert.equal(appendNode.outputs['error'], 'end-error');
    }
  });

  void it('dispatch-tools scatter uses dagFrom body', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));
    const scatter = dag.nodes.find((n) => n.name === 'dispatch-tools');
    assert.ok(scatter !== undefined, 'dispatch-tools must exist');
    assert.equal(scatter['@type'], 'ScatterNode', 'dispatch-tools must be a ScatterNode');

    if (scatter['@type'] === 'ScatterNode') {
      assert.ok('dagFrom' in scatter.body, 'scatter body must use dagFrom');
      if ('dagFrom' in scatter.body) {
        assert.equal(scatter.body.dagFrom, 'dagName', 'dagFrom must reference dagName field');
      }
      assert.equal(scatter.source, 'safeWorkset', 'scatter source must be safeWorkset');
    }
  });

  void it('scatter gather strategy is map with canonical mapping', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));
    const scatter = dag.nodes.find((n) => n.name === 'dispatch-tools');
    assert.ok(scatter !== undefined);
    if (scatter['@type'] === 'ScatterNode') {
      assert.equal(scatter.gather.strategy, 'map', 'gather strategy must be map');
      if (scatter.gather.strategy === 'map') {
        assert.deepEqual(
          scatter.gather.mapping,
          { 'output': 'toolOutputs' },
          'mapping must fold clone.output → parent.toolOutputs',
        );
      }
    }
  });

  void it('end-done is a completed terminal; end-error is a failed terminal', () => {
    const dag = AgentBuilder.loop(LoopFixture.nodes(LoopFixture.services().llm));

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

void describe('AgentBuilder.loop: Dagonizer registration', () => {
  void it('assembled DAG registers cleanly in a Dagonizer (no schema errors)', () => {
    const services = LoopFixture.services();
    const nodes = LoopFixture.nodes(services.llm);
    const dag = AgentBuilder.loop(nodes);

    const dispatcher = new Dagonizer<LoopState>();
    dispatcher.registerNode(nodes.chatRequest);
    dispatcher.registerNode(nodes.callModel);
    dispatcher.registerNode(nodes.normalizeResponse);
    dispatcher.registerNode(nodes.decodeTextToolCalls);
    dispatcher.registerNode(nodes.normalizeToolCalls);
    dispatcher.registerNode(nodes.toolWorksets);
    dispatcher.registerNode(nodes.collectToolResults);
    dispatcher.registerNode(nodes.appendAssistant);
    // No tool DAGs registered: scatter with dagFrom resolves at runtime,
    // so missing tool DAGs are not a registration-time error.
    dispatcher.registerDAG(dag);
    // Reaching here without throw proves the DAG is schema-valid and all
    // node references resolve.
  });

  void it('executes a text-answer turn to completion without tool calls', async () => {
    const services = LoopFixture.services();
    const nodes = LoopFixture.nodes(services.llm);
    const dag = AgentBuilder.loop(nodes);

    const dispatcher = new Dagonizer<LoopState>();
    dispatcher.registerNode(nodes.chatRequest);
    dispatcher.registerNode(nodes.callModel);
    dispatcher.registerNode(nodes.normalizeResponse);
    dispatcher.registerNode(nodes.decodeTextToolCalls);
    dispatcher.registerNode(nodes.normalizeToolCalls);
    dispatcher.registerNode(nodes.toolWorksets);
    dispatcher.registerNode(nodes.collectToolResults);
    dispatcher.registerNode(nodes.appendAssistant);
    dispatcher.registerDAG(dag);

    const state = new LoopState();
    state.prompt = 'Say hello';

    const result = await dispatcher.execute('agent-loop', state);

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
