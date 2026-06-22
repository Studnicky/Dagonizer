/**
 * 29-agent-builder/dags: DAGType factory for the canonical 8-node agent loop.
 *
 * `AgentLoopDagFactory.create(nodes, options?)` wraps `AgentBuilder.loop` and
 * returns the assembled `DAGType`. The factory is the single export from this
 * module; the executable entry point (`examples/29-agent-builder.ts`) calls it
 * to obtain the DAG and register it on the dispatcher.
 *
 * Topology assembled by AgentBuilder:
 *
 *   build-request ──► call-model ──► normalize-response
 *     ├─ text  ──► append-assistant ──► end-done (completed)
 *     └─ tools/mixed ──► decode-tools ──► normalize-tools ──► worksets
 *                          ──► dispatch-tools (scatter, dagFrom: dagName)
 *                            └─ collect-results ──► build-request  ← loop back
 *
 * Terminals:
 *   end-done   (completed) — text-only answer; loop terminates cleanly
 *   end-error  (failed)    — any unrecoverable error path
 */

import {
  AgentBuilder,
} from '@studnicky/dagonizer/patterns';
import type {
  AgentLoopNodesType,
  AgentLoopOptionsType,
} from '@studnicky/dagonizer/patterns';
import type { DAGType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// AgentLoopDagFactory
// ---------------------------------------------------------------------------

/**
 * Static factory that delegates to `AgentBuilder.loop`.
 *
 * Export the produced DAG as a value from this module so the example entry
 * point can import it directly:
 *
 * ```ts
 * import { dag } from './dags/29-agent-builder.js';
 * dispatcher.registerDAG(dag);
 * ```
 */
export class AgentLoopDagFactory {
  private constructor() { /* static class */ }

  /**
   * Assemble the canonical 8-node agent loop.
   *
   * @param nodes   - The eight concrete node instances (see `AgentLoopNodesType`).
   * @param options - Optional name/version overrides (defaults: `'my-agent'` / `'1'`).
   * @returns A `DAGType` ready for `dispatcher.registerDAG(dag)`.
   */
  static create(nodes: AgentLoopNodesType, options: AgentLoopOptionsType = {}): DAGType {
    return AgentBuilder.loop(nodes, options);
  }
}

// ---------------------------------------------------------------------------
// Pre-assembled DAG export (placeholder nodes for the module-level export)
//
// The example entry point (29-agent-builder.ts) imports `dag` here and passes
// its own node instances to the dispatcher. The module-level export uses stub
// node stubs that satisfy the type constraint — they are NEVER registered or
// executed; only the DAG topology (name, version, placements, routes) matters
// at import time.
//
// In production code, call `AgentLoopDagFactory.create(yourNodes, options)` so
// the topology references the nodes your dispatcher will register.
// ---------------------------------------------------------------------------

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
import type { LlmAdapterInterface } from '@studnicky/dagonizer/adapter';
import type {
  ChatRequestType,
  ChatResponseType,
  ToolCallType,
} from '@studnicky/dagonizer/adapter';
import type { NodeContextType } from '@studnicky/dagonizer/entities';
import { NodeStateBase } from '@studnicky/dagonizer';
import type { ToolCallScatterItemType } from '@studnicky/dagonizer/patterns';

// Minimal state for the factory stubs — never used at runtime, only types.
class _StubState extends NodeStateBase {}

class _StubBuildChatRequest extends BuildChatRequestNode<_StubState> {
  readonly name = 'build-request';
  protected buildRequest(_state: _StubState, ctx: NodeContextType): ChatRequestType {
    return {
      'messages':     [],
      'tools':        [],
      'toolChoice':   { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens':    256,
      'temperature':  0,
      'signal':       ctx.signal,
    };
  }
}

class _StubCallModel extends CallModelNode<_StubState> {
  readonly name = 'call-model';
  constructor(llm: LlmAdapterInterface) { super(llm); }
  protected getRequest(_state: _StubState, _ctx: NodeContextType): ChatRequestType {
    return {
      'messages':     [],
      'tools':        [],
      'toolChoice':   { 'type': 'auto' },
      'outputSchema': { 'variant': 'none' },
      'maxTokens':    256,
      'temperature':  0,
      'signal':       _ctx.signal,
    };
  }
  protected storeResponse(_state: _StubState, _response: ChatResponseType, _ctx: NodeContextType): void { /* no-op */ }
}

class _StubNormalizeResponse extends NormalizeResponseNode<_StubState> {
  readonly name = 'normalize-response';
  protected getResponse(_state: _StubState, _ctx: NodeContextType): ChatResponseType | null { return null; }
}

class _StubDecodeTextToolCalls extends DecodeTextToolCallsNode<_StubState> {
  readonly name = 'decode-tools';
  protected getText(_state: _StubState, _ctx: NodeContextType): string { return ''; }
  protected storeToolCalls(_state: _StubState, _calls: readonly ToolCallType[], _ctx: NodeContextType): void { /* no-op */ }
}

class _StubNormalizeToolCalls extends NormalizeToolCallsNode<_StubState> {
  readonly name = 'normalize-tools';
  protected getToolCalls(_state: _StubState, _ctx: NodeContextType): readonly ToolCallType[] { return []; }
  protected writeNormalized(_state: _StubState, _calls: readonly ToolCallType[], _ctx: NodeContextType): void { /* no-op */ }
}

class _StubBuildToolWorksets extends BuildToolWorksetsNode<_StubState> {
  readonly name = 'build-worksets';
  protected getToolCalls(_state: _StubState, _ctx: NodeContextType): readonly ToolCallType[] { return []; }
  protected classifyCall(_call: ToolCallType, _state: _StubState, _ctx: NodeContextType): 'safe' | 'exclusive' { return 'safe'; }
  protected writeSafeWorkset(_state: _StubState, _calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void { /* no-op */ }
  protected writeExclusiveWorkset(_state: _StubState, _calls: readonly ToolCallScatterItemType[], _ctx: NodeContextType): void { /* no-op */ }
}

class _StubCollectToolResults extends CollectToolResultsNode<_StubState> {
  readonly name = 'collect-results';
  protected getGatheredResults(_state: _StubState, _ctx: NodeContextType): readonly unknown[] { return []; }
  protected writeResult(_state: _StubState, _results: readonly unknown[], _ctx: NodeContextType): void { /* no-op */ }
}

class _StubAppendAssistant extends AppendAssistantNode<_StubState> {
  readonly name = 'append-assistant';
  protected getResponse(_state: _StubState, _ctx: NodeContextType): ChatResponseType | null { return null; }
  protected append(_state: _StubState, _response: ChatResponseType, _ctx: NodeContextType): void { /* no-op */ }
}

// A null-object LLM adapter — only used to satisfy the CallModelNode constructor for the type stubs.
const _nullLlm: LlmAdapterInterface = {
  'id': '_null',
  'displayName': 'null',
  'capabilities': { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
  async chat(_r: ChatRequestType): Promise<ChatResponseType> {
    return { 'message': { 'variant': 'text', 'content': '' }, 'finishReason': 'stop', 'usage': { 'promptTokens': 0, 'completionTokens': 0 } };
  },
  async connect():    Promise<void>              { /* no-op */ },
  async disconnect(): Promise<void>              { /* no-op */ },
  async probe():      Promise<boolean>           { return false; },
  async listModels(): Promise<readonly never[]>  { return []; },
};

/**
 * The pre-assembled agent-loop DAG, registered under the name `'my-agent'`.
 *
 * Import this value and pass it to `dispatcher.registerDAG(dag)`.
 *
 * The topology is identical to what your production call produces —
 * `AgentBuilder.loop` only reads each node's `.name` property to stamp the
 * `node` reference in each placement. The stub nodes here use the same
 * canonical names as the production subclasses in `examples/29-agent-builder.ts`.
 */
export const dag: DAGType = AgentLoopDagFactory.create({
  'chatRequest':         new _StubBuildChatRequest(),
  'callModel':           new _StubCallModel(_nullLlm),
  'normalizeResponse':   new _StubNormalizeResponse(),
  'decodeTextToolCalls': new _StubDecodeTextToolCalls(),
  'normalizeToolCalls':  new _StubNormalizeToolCalls(),
  'toolWorksets':        new _StubBuildToolWorksets(),
  'collectToolResults':  new _StubCollectToolResults(),
  'appendAssistant':     new _StubAppendAssistant(),
}, { 'name': 'my-agent', 'version': '1' });
