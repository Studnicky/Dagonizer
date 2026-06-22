/**
 * 29-agent-builder: AgentBuilder.loop — assemble the canonical 8-node agent loop.
 *
 * Shows how to:
 *   1. Subclass the 8 abstract base nodes from @studnicky/dagonizer/patterns.
 *   2. Call AgentBuilder.loop(nodes, options?) to assemble a ready-to-register DAGType.
 *   3. Register nodes + DAG + tool bundle on a Dagonizer.
 *   4. Execute one text-answer turn (stub LLM returns a canned response).
 *
 * The LLM adapter in this example is a stub that always returns a plain text
 * response — no real model is required. Labeled with "STUB:" in comments.
 *
 * DAG factory: examples/dags/29-agent-builder.ts
 *
 * Run: npx tsx examples/29-agent-builder.ts
 */

import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import type {
  ChatRequestType,
  ChatResponseType,
  ToolCallType,
} from '@studnicky/dagonizer/adapter';
import {
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
  AgentLoopNodesType,
  ToolCallScatterItemType,
} from '@studnicky/dagonizer/patterns';
import { ToolRegistry } from '@studnicky/dagonizer/tool';
import type { NodeContextType } from '@studnicky/dagonizer/entities';

// ---------------------------------------------------------------------------
// Domain state
// ---------------------------------------------------------------------------

class AgentState extends NodeStateBase {
  /** System prompt / user messages for this conversation turn. */
  prompt: string = '';
  /** Assembled chat request, stored between build-request and call-model. */
  chatRequest: ChatRequestType | null = null;
  /** Raw model response from call-model. */
  chatResponse: ChatResponseType | null = null;
  /** Accumulated assistant text for the current turn. */
  assistantText: string = '';
  /** Tool calls decoded from text (text-channel fallback). */
  decodedCalls: ToolCallType[] = [];
  /** Scatter items for safe (concurrent) tool dispatch. */
  safeWorkset: ToolCallScatterItemType[] = [];
  /** Scatter items for exclusive (serial) tool dispatch. */
  exclusiveWorkset: ToolCallScatterItemType[] = [];
  /** Gather-folded tool outputs after scatter completes. */
  toolOutputs: unknown[] = [];
  /** Finalized tool results after collection. */
  collectedResults: unknown[] = [];
  /** Conversation history built up across turns. */
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
}

// ---------------------------------------------------------------------------
// STUB: LLM adapter — always returns a plain text response
// ---------------------------------------------------------------------------

class StubLlmAdapter implements LlmAdapterInterface {
  readonly id          = 'stub';
  readonly displayName = 'Stub (canned)';
  readonly capabilities = {
    'toolUse':          'none' as const,
    'structuredOutput': false,
    'jsonMode':         false,
  };

  async chat(_req: ChatRequestType): Promise<ChatResponseType> {
    // STUB: always returns a plain text answer regardless of the request.
    return {
      'message':      { 'variant': 'text', 'content': 'Hello! I am the stub assistant.' },
      'finishReason': 'stop',
      'usage':        { 'promptTokens': 10, 'completionTokens': 8 },
    };
  }

  async connect():    Promise<void>    { /* no-op */ }
  async disconnect(): Promise<void>    { /* no-op */ }
  async probe():      Promise<boolean> { return true; }
}

// ---------------------------------------------------------------------------
// Concrete node subclasses — one per abstract base class
// ---------------------------------------------------------------------------

// 1. BuildChatRequestNode: assembles the ChatRequestType from state.
class MyBuildChatRequestNode extends BuildChatRequestNode<AgentState> {
  readonly name = 'build-request';

  protected buildRequest(state: AgentState, context: NodeContextType): ChatRequestType {
    const req: ChatRequestType = {
      'messages':     [{ 'role': 'user', 'content': state.prompt }],
      'tools':        [],
      'toolChoice':   { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens':    256,
      'temperature':  0.7,
      'signal':       context.signal,
    };
    state.chatRequest = req;
    return req;
  }
}

// 2. CallModelNode: sends the request to the LLM adapter and stores the response.
class MyCallModelNode extends CallModelNode<AgentState> {
  readonly name = 'call-model';

  constructor(llm: LlmAdapterInterface) { super(llm); }

  protected getRequest(state: AgentState, _ctx: NodeContextType): ChatRequestType {
    if (state.chatRequest === null) throw new Error('chatRequest not set');
    return state.chatRequest;
  }

  protected storeResponse(state: AgentState, response: ChatResponseType, _ctx: NodeContextType): void {
    state.chatResponse = response;
    if (response.message.variant === 'text') {
      state.assistantText = response.message.content;
    }
  }
}

// 3. NormalizeResponseNode: reads the stored response and routes on its variant.
class MyNormalizeResponseNode extends NormalizeResponseNode<AgentState> {
  readonly name = 'normalize-response';

  protected getResponse(state: AgentState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }
}

// 4. DecodeTextToolCallsNode: decodes tool-call JSON embedded in text responses.
class MyDecodeTextToolCallsNode extends DecodeTextToolCallsNode<AgentState> {
  readonly name = 'decode-tools';

  protected getText(state: AgentState, _ctx: NodeContextType): string {
    return state.assistantText;
  }

  protected storeToolCalls(state: AgentState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

// 5. NormalizeToolCallsNode: validates decoded calls (id, name, arguments present).
class MyNormalizeToolCallsNode extends NormalizeToolCallsNode<AgentState> {
  readonly name = 'normalize-tools';

  protected getToolCalls(state: AgentState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }

  protected writeNormalized(state: AgentState, calls: readonly ToolCallType[], _ctx: NodeContextType): void {
    state.decodedCalls = [...calls];
  }
}

// 6. BuildToolWorksetsNode: partitions calls into safe/exclusive scatter worksets.
class MyBuildToolWorksetsNode extends BuildToolWorksetsNode<AgentState> {
  readonly name = 'build-worksets';

  protected getToolCalls(state: AgentState, _ctx: NodeContextType): readonly ToolCallType[] {
    return state.decodedCalls;
  }

  protected classifyCall(_call: ToolCallType, _state: AgentState, _ctx: NodeContextType): 'safe' | 'exclusive' {
    // All tools run concurrently in this stub — no exclusivity requirements.
    return 'safe';
  }

  protected writeSafeWorkset(state: AgentState, calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void {
    state.safeWorkset = [...calls];
  }

  protected writeExclusiveWorkset(state: AgentState, calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void {
    state.exclusiveWorkset = [...calls];
  }
}

// 7. CollectToolResultsNode: collects gather-folded tool outputs into finalized results.
class MyCollectToolResultsNode extends CollectToolResultsNode<AgentState> {
  readonly name = 'collect-results';

  protected getGatheredResults(state: AgentState, _ctx: NodeContextType): readonly unknown[] {
    return state.toolOutputs;
  }

  protected writeResult(state: AgentState, results: readonly unknown[], _ctx: NodeContextType): void {
    state.collectedResults = [...results];
  }
}

// 8. AppendAssistantNode: appends the model response to the conversation history.
class MyAppendAssistantNode extends AppendAssistantNode<AgentState> {
  readonly name = 'append-assistant';

  protected getResponse(state: AgentState, _ctx: NodeContextType): ChatResponseType | null {
    return state.chatResponse;
  }

  protected append(state: AgentState, response: ChatResponseType, _ctx: NodeContextType): void {
    if (response.message.variant === 'text') {
      state.history.push({ 'role': 'assistant', 'content': response.message.content });
    }
  }
}

// ---------------------------------------------------------------------------
// Assemble the agent loop via AgentBuilder.loop
// ---------------------------------------------------------------------------

import { dag } from './dags/29-agent-builder.js';

// Shared stub LLM adapter.
const llm = new StubLlmAdapter();

// The 8 concrete node instances (AgentLoopNodesType).
const nodes: AgentLoopNodesType = {
  'chatRequest':         new MyBuildChatRequestNode(),
  'callModel':           new MyCallModelNode(llm),
  'normalizeResponse':   new MyNormalizeResponseNode(),
  'decodeTextToolCalls': new MyDecodeTextToolCallsNode(),
  'normalizeToolCalls':  new MyNormalizeToolCallsNode(),
  'toolWorksets':        new MyBuildToolWorksetsNode(),
  'collectToolResults':  new MyCollectToolResultsNode(),
  'appendAssistant':     new MyAppendAssistantNode(),
};

// ---------------------------------------------------------------------------
// Wire dispatcher
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<AgentState>();

// Register all 8 nodes.
dispatcher.registerNode(nodes.chatRequest);
dispatcher.registerNode(nodes.callModel);
dispatcher.registerNode(nodes.normalizeResponse);
dispatcher.registerNode(nodes.decodeTextToolCalls);
dispatcher.registerNode(nodes.normalizeToolCalls);
dispatcher.registerNode(nodes.toolWorksets);
dispatcher.registerNode(nodes.collectToolResults);
dispatcher.registerNode(nodes.appendAssistant);

// Register tool bundle (empty: no tools in this example, but pattern is shown).
const tools = new ToolRegistry();
// tools.register(new MyTool());   // ← register your tools here
dispatcher.registerBundle(tools.bundle());

// Register the assembled agent-loop DAG.
dispatcher.registerDAG(dag);

// ---------------------------------------------------------------------------
// Execute one text-answer turn
// ---------------------------------------------------------------------------

process.stdout.write('--- Example 29: AgentBuilder.loop ---\n\n');

const state = new AgentState();
state.prompt = 'What is the capital of France?';

process.stdout.write(`Prompt: "${state.prompt}"\n`);

const result = await dispatcher.execute('my-agent', state);

process.stdout.write(`\nOutcome:       ${result.terminalOutcome}\n`);
process.stdout.write(`assistantText: "${state.assistantText}"\n`);
process.stdout.write(`history entries: ${String(state.history.length)}\n`);

if (state.history.length > 0) {
  const last = state.history[state.history.length - 1];
  process.stdout.write(`Last message: [${last?.role ?? ''}] "${last?.content ?? ''}"\n`);
}

process.stdout.write('\nLesson: AgentBuilder.loop(nodes, options?) assembles the canonical 8-node agent\n');
process.stdout.write('        loop into a DAGType. Subclass each abstract base node to adapt\n');
process.stdout.write('        how state is read and written; AgentBuilder owns the topology.\n');
