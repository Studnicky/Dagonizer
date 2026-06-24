/**
 * Tests: agent-flow pattern bases — end-to-end turn/tool DAG.
 *
 * Proves:
 *   1. All 8 abstract bases are subclassable via class extension only (zero callbacks).
 *   2. The full pipeline build-request → call-model → decode-tools →
 *      normalize → build-worksets → scatter-dispatch → collect-results.
 *   3. The scatter runs each tool on an isolated `ToolInvocationState` (no
 *      parent-state shape mutation).
 *   4. The `map` gather strategy folds per-clone `output` into the parent
 *      `toolOutputs` array, which `CollectToolResultsNode` then finalizes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { LlmAdapterInterface } from '../../src/contracts/LlmAdapterInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { ChatRequestType } from '../../src/entities/adapter/ChatRequest.js';
import type { ChatResponseType } from '../../src/entities/adapter/ChatResponse.js';
import type { ToolCallType } from '../../src/entities/adapter/ToolCall.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { JsonValue } from '../../src/entities/JsonValue.js';
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
import type { ToolInterface } from '../../src/tool/ToolInterface.js';
import { ToolRegistry } from '../../src/tool/ToolRegistry.js';

// ── Harness state ─────────────────────────────────────────────────────────────

class HarnessState extends NodeStateBase {
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
    // Initialise in declaration order — V8 shape stability.
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

  protected override snapshotData(): JsonObjectType {
    return {
      'prompt': this.prompt,
      'assistantText': this.assistantText,
      'decodedCalls': JsonValue.from(this.decodedCalls),
      'safeWorkset': JsonValue.from(this.safeWorkset),
      'exclusiveWorkset': JsonValue.from(this.exclusiveWorkset),
      'toolOutputs': JsonValue.from(this.toolOutputs),
      'collectedResults': JsonValue.from(this.collectedResults),
    };
  }

  protected override restoreData(snapshot: JsonObjectType): void {
    if (typeof snapshot['prompt'] === 'string') this.prompt = snapshot['prompt'];
    if (typeof snapshot['assistantText'] === 'string') this.assistantText = snapshot['assistantText'];
    // Each Array.isArray guard narrows snapshot[key] to JsonValueType[].
    // JsonValueType is assignable to unknown, so we widen to unknown[] first
    // so the type-predicate's produced type (ToolCallType / ToolCallScatterItemType)
    // is assignable to the parameter type (unknown), satisfying TS2677.
    const rawCalls: unknown[] = Array.isArray(snapshot['decodedCalls']) ? snapshot['decodedCalls'] : [];
    this.decodedCalls = rawCalls.filter(
      (e): e is ToolCallType =>
        typeof e === 'object' && e !== null && 'id' in e && 'name' in e && 'arguments' in e,
    );
    const rawSafe: unknown[] = Array.isArray(snapshot['safeWorkset']) ? snapshot['safeWorkset'] : [];
    this.safeWorkset = rawSafe.filter(
      (e): e is ToolCallScatterItemType =>
        typeof e === 'object' && e !== null && 'id' in e && 'name' in e && 'arguments' in e && 'dagName' in e,
    );
    const rawExclusive: unknown[] = Array.isArray(snapshot['exclusiveWorkset']) ? snapshot['exclusiveWorkset'] : [];
    this.exclusiveWorkset = rawExclusive.filter(
      (e): e is ToolCallScatterItemType =>
        typeof e === 'object' && e !== null && 'id' in e && 'name' in e && 'arguments' in e && 'dagName' in e,
    );
    if (Array.isArray(snapshot['toolOutputs'])) this.toolOutputs = snapshot['toolOutputs'];
    if (Array.isArray(snapshot['collectedResults'])) this.collectedResults = snapshot['collectedResults'];
  }
}

// ── Fake LLM adapter ─────────────────────────────────────────────────────────

/**
 * Returns a text response containing an embedded tool-call JSON envelope.
 * The model text has prose before the JSON so `ToolCallCodec.decode` proves
 * it tolerates surrounding content.
 */
class FakeTextToolAdapter {
  readonly id = 'fake-text-tool';
  readonly displayName = 'Fake Text Tool Adapter';
  readonly capabilities = {
    'toolUse': 'none' as const,
    'structuredOutput': false,
    'jsonMode': false,
  };

  async chat(_request: ChatRequestType): Promise<ChatResponseType> {
    return {
      'message': {
        'variant': 'text',
        'content': 'I will compute.\n{"tool_calls":[{"name":"calculator","arguments":{"a":7,"b":35}}]}',
      },
      'finishReason': 'stop',
      'usage': { 'promptTokens': 1, 'completionTokens': 1 },
    };
  }

  async connect(): Promise<void> { /* no-op */ }
  async disconnect(): Promise<void> { /* no-op */ }
  async probe(): Promise<boolean> { return true; }
  async listModels(): Promise<readonly never[]> { return []; }
}

// ── Calculator tool ───────────────────────────────────────────────────────────

class CalculatorTool implements ToolInterface<Record<string, unknown>, { result: number }> {
  readonly definition = {
    'name': 'calculator',
    'description': 'Adds two numbers.',
    'inputSchema': {
      'type': 'object' as const,
      'required': ['a', 'b'],
      'properties': {
        'a': { 'type': 'number' },
        'b': { 'type': 'number' },
      },
    },
    'outputSchema': {
      'type': 'object' as const,
      'required': ['result'],
      'properties': { 'result': { 'type': 'number' } },
    },
    'strict': true,
  };

  async execute(input: Record<string, unknown>): Promise<{ result: number }> {
    const a = Number(input['a']);
    const b = Number(input['b']);
    return { 'result': a + b };
  }
}

// ── Concrete leaf nodes ───────────────────────────────────────────────────────

class TestBuildChatRequestNode extends BuildChatRequestNode<HarnessState> {
  readonly name = 'build-request';

  protected buildRequest(
    state: HarnessState,
    context: NodeContextType,
  ): ChatRequestType {
    const req: ChatRequestType = {
      'messages': [{ 'role': 'user', 'content': state.prompt }],
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
}

class TestCallModelNode extends CallModelNode<HarnessState> {
  readonly name = 'call-model';
  constructor(llm: LlmAdapterInterface) { super(llm); }

  protected getRequest(state: HarnessState, _context: NodeContextType): ChatRequestType {
    // chatRequest is set by TestBuildChatRequestNode (this node runs only after
    // build-request on the success path); guard rather than cast away the null.
    if (state.chatRequest === null) throw new Error('chatRequest must be built before call-model');
    return state.chatRequest;
  }

  protected storeResponse(state: HarnessState, response: ChatResponseType, _context: NodeContextType): void {
    state.chatResponse = response;
    if (response.message.variant === 'text') {
      state.assistantText = response.message.content;
    }
  }
}

class TestDecodeTextToolCallsNode extends DecodeTextToolCallsNode<HarnessState> {
  readonly name = 'decode-tools';

  protected getText(state: HarnessState, _context: NodeContextType): string {
    return state.assistantText;
  }

  protected storeToolCalls(state: HarnessState, calls: readonly ToolCallType[], _context: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

class TestNormalizeToolCallsNode extends NormalizeToolCallsNode<HarnessState> {
  readonly name = 'normalize-tools';

  protected getToolCalls(state: HarnessState, _context: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }

  protected writeNormalized(state: HarnessState, calls: readonly ToolCallType[], _context: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

class TestBuildToolWorksetsNode extends BuildToolWorksetsNode<HarnessState> {
  readonly name = 'build-worksets';

  protected getToolCalls(state: HarnessState, _context: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }

  protected classifyCall(_call: ToolCallType, _state: HarnessState, _context: NodeContextType): 'safe' | 'exclusive' {
    return 'safe';
  }

  protected writeSafeWorkset(state: HarnessState, calls: readonly ToolCallScatterItemType[], _context: NodeContextType): void {
    state.safeWorkset = [...calls];
  }

  protected writeExclusiveWorkset(state: HarnessState, calls: readonly ToolCallScatterItemType[], _context: NodeContextType): void {
    state.exclusiveWorkset = [...calls];
  }
}

class TestCollectToolResultsNode extends CollectToolResultsNode<HarnessState> {
  readonly name = 'collect-results';

  protected getGatheredResults(state: HarnessState, _context: NodeContextType): readonly unknown[] {
    return state.toolOutputs;
  }

  protected writeResult(state: HarnessState, results: readonly unknown[], _context: NodeContextType): void {
    state.collectedResults = [...results];
  }
}

class TestNormalizeResponseNode extends NormalizeResponseNode<HarnessState> {
  readonly name = 'normalize-response';

  protected getResponse(state: HarnessState, _context: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }
}

class TestAppendAssistantNode extends AppendAssistantNode<HarnessState> {
  readonly name = 'append-assistant';

  protected getResponse(state: HarnessState, _context: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }

  protected append(state: HarnessState, response: ChatResponseType, _context: NodeContextType): void {
    if (response.message.variant === 'text') {
      state.assistantText = `[appended] ${response.message.content}`;
    }
  }
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

class AgentFixtures {
  private constructor() { /* static class */ }

  static adapter(): FakeTextToolAdapter {
    return new FakeTextToolAdapter();
  }

  static registry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());
    return registry;
  }

  static services(registry: ToolRegistry): { llm: LlmAdapterInterface; tools: ToolRegistry } {
    return { 'llm': AgentFixtures.adapter(), 'tools': registry };
  }
}

// ── Isolated unit tests ───────────────────────────────────────────────────────

void describe('NormalizeResponseNode: unit', () => {
  void it('routes text response to text output', async () => {
    const node = new TestNormalizeResponseNode();
    const dag = new DAGBuilder('normalize-test', '1')
      .node('normalize-response', node, { 'text': 'end', 'tools': 'end', 'mixed': 'end', 'empty': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    state.chatResponse = {
      'message': { 'variant': 'text', 'content': 'Hello' },
      'finishReason': 'stop',
      'usage': { 'promptTokens': 1, 'completionTokens': 1 },
    };

    const result = await dispatcher.execute('normalize-test', state);
    assert.equal(result.terminalOutcome, 'completed');
  });

  void it('routes null response to empty output', async () => {
    const node = new TestNormalizeResponseNode();
    const dag = new DAGBuilder('normalize-empty-test', '1')
      .node('normalize-response', node, { 'text': 'end', 'tools': 'end', 'mixed': 'end', 'empty': 'end', 'error': 'end' })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    const result = await dispatcher.execute('normalize-empty-test', state);
    assert.equal(result.terminalOutcome, 'completed');
  });
});

void describe('AppendAssistantNode: unit', () => {
  void it('appends text response to assistant text field', async () => {
    const node = new TestAppendAssistantNode();
    const dag = new DAGBuilder('append-test', '1')
      .node('append-assistant', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    state.chatResponse = {
      'message': { 'variant': 'text', 'content': 'Hello world' },
      'finishReason': 'stop',
      'usage': { 'promptTokens': 1, 'completionTokens': 1 },
    };

    const result = await dispatcher.execute('append-test', state);
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.assistantText, '[appended] Hello world');
  });

  void it('routes error when no response stored', async () => {
    const node = new TestAppendAssistantNode();
    const dag = new DAGBuilder('append-missing-test', '1')
      .node('append-assistant', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    const result = await dispatcher.execute('append-missing-test', state);
    assert.equal(result.terminalOutcome, 'failed');
  });
});

void describe('NormalizeToolCallsNode: unit', () => {
  void it('filters invalid calls and routes valid', async () => {
    const node = new TestNormalizeToolCallsNode();
    const dag = new DAGBuilder('normalize-calls-test', '1')
      .node('normalize-tools', node, { 'valid': 'end', 'empty': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    state.decodedCalls = [
      { 'id': 'c1', 'name': 'calculator', 'arguments': { 'a': 1, 'b': 2 } },
    ];

    const result = await dispatcher.execute('normalize-calls-test', state);
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(state.decodedCalls.length, 1);
  });

  void it('routes error when all calls are invalid', async () => {
    const node = new TestNormalizeToolCallsNode();
    const dag = new DAGBuilder('normalize-bad-calls-test', '1')
      .node('normalize-tools', node, { 'valid': 'end', 'empty': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new HarnessState();
    state.decodedCalls = [{ 'id': '', 'name': 'calculator', 'arguments': { 'a': 1 } }];

    const result = await dispatcher.execute('normalize-bad-calls-test', state);
    assert.equal(result.terminalOutcome, 'failed');
  });
});

// ── Full pipeline end-to-end ──────────────────────────────────────────────────

void describe('Agent-flow nodes: full turn/tool pipeline end-to-end', () => {
  void it('build-request → call-model → decode-tools → normalize → build-worksets → scatter → collect-results', async () => {
    // Tool registry: registers calculator as tool:calculator DAG with isolation factory.
    const registry = AgentFixtures.registry();
    const services = AgentFixtures.services(registry);

    const buildRequestNode = new TestBuildChatRequestNode();
    const callModelNode = new TestCallModelNode(services.llm);
    const decodeToolsNode = new TestDecodeTextToolCallsNode();
    const normalizeToolsNode = new TestNormalizeToolCallsNode();
    const buildWorksetsNode = new TestBuildToolWorksetsNode();
    const collectResultsNode = new TestCollectToolResultsNode();

    // Parent DAG:
    //   build-request (ready) → call-model (text) → decode-tools (decoded)
    //   → normalize-tools (valid) → build-worksets (ready)
    //   → scatter [dispatch-tools] on safeWorkset (dagFrom: 'dagName')
    //   → (all-success) → collect-results (done) → end
    //
    // The scatter `map` gather strategy maps each clone's `output` field
    // into the parent's `toolOutputs` array.
    const parentDag = new DAGBuilder('agent-pipeline', '1')
      .node('build-request', buildRequestNode, { 'ready': 'call-model', 'error': 'end-fail' })
      .node('call-model', callModelNode, { 'text': 'decode-tools', 'tools': 'end-fail', 'mixed': 'end-fail', 'error': 'end-fail' })
      .node('decode-tools', decodeToolsNode, { 'decoded': 'normalize-tools', 'empty': 'end-fail', 'error': 'end-fail' })
      .node('normalize-tools', normalizeToolsNode, { 'valid': 'build-worksets', 'empty': 'end-fail', 'error': 'end-fail' })
      .node('build-worksets', buildWorksetsNode, { 'ready': 'dispatch-tools', 'empty': 'end-fail', 'error': 'end-fail' })
      .scatter<HarnessState, string>(
        'dispatch-tools',
        'safeWorkset',
        { 'dagFrom': 'dagName' },
        {
          'all-success': 'collect-results',
          'partial':     'collect-results',
          'all-error':   'collect-results',
          'empty':       'collect-results',
        },
        {
          // map strategy: for each clone reads clone.output → appends to parent.toolOutputs
          'gather': {
            'strategy': 'map',
            'mapping': { 'output': 'toolOutputs' },
          },
        },
      )
      .node('collect-results', collectResultsNode, { 'done': 'end', 'empty': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // Dispatcher: register parent nodes, then the tool bundle (ToolInvokeNode instances
    // with TServices = undefined — registerBundle now accepts TBundleServices = undefined
    // on a services-typed dispatcher), then the parent DAG.
    const dispatcher = new Dagonizer<HarnessState>();
    dispatcher.registerNode(buildRequestNode);
    dispatcher.registerNode(callModelNode);
    dispatcher.registerNode(decodeToolsNode);
    dispatcher.registerNode(normalizeToolsNode);
    dispatcher.registerNode(buildWorksetsNode);
    dispatcher.registerNode(collectResultsNode);
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state = new HarnessState();
    state.prompt = 'What is 7 + 35?';

    const result = await dispatcher.execute('agent-pipeline', state);

    assert.equal(result.terminalOutcome, 'completed', 'pipeline must complete successfully');

    // 1. Chat request was built and stored.
    assert.ok(state.chatRequest !== null, 'chatRequest must be populated');

    // 2. Chat response was stored; text extracted.
    assert.ok(state.chatResponse !== null, 'chatResponse must be populated');
    assert.ok(state.assistantText.length > 0, 'assistantText must be populated from response');

    // 3. Decoded calls: one calculator call.
    assert.equal(state.decodedCalls.length, 1, 'one tool call decoded from text');
    assert.equal(state.decodedCalls[0]?.name, 'calculator', 'decoded call is calculator');

    // 4. Safe workset: one item stamped with correct dagName.
    assert.equal(state.safeWorkset.length, 1, 'one safe workset item');
    assert.equal(state.safeWorkset[0]?.dagName, 'tool:calculator', 'scatter item dagName is tool:calculator');

    // 5. Scatter dispatched the tool DAG on isolated ToolInvocationState.
    //    The map gather strategy folded clone.output → parent.toolOutputs.
    //    CalculatorTool returns { result: 42 } for a=7, b=35.
    assert.equal(state.toolOutputs.length, 1, 'one tool output gathered via map strategy');
    assert.deepEqual(state.toolOutputs[0], { 'result': 42 }, 'tool result is 42 (7 + 35)');

    // 6. CollectToolResultsNode finalized the results.
    assert.equal(state.collectedResults.length, 1, 'one collected result after CollectToolResultsNode');
    assert.deepEqual(state.collectedResults[0], { 'result': 42 }, 'collected result is 42');

    // 7. Isolation: child ToolInvocationState fields must NOT leak onto parent.
    assert.ok(!Object.hasOwn(state, 'input'), 'child input field must not leak onto parent state');
    assert.ok(!Object.hasOwn(state, 'output'), 'child output field must not leak onto parent state');
  });
});
