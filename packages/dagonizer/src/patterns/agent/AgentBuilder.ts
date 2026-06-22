/**
 * AgentBuilder: static factory that assembles the canonical 8-node agent loop
 * into a runnable `DAGType`.
 *
 * The agent loop topology:
 *
 *   build-request (ready)
 *     → call-model (text|tools|mixed) → normalize-response
 *     → text  → append-assistant → done → [end-done / loop]
 *     → tools|mixed → decode-tools
 *       → decoded → normalize-tools
 *         → valid → build-worksets
 *           → ready → dispatch-tools (scatter over safeWorkset, dagFrom: dagName)
 *             → collect-results → done → build-request  ← loop back
 *       → empty → append-assistant
 *   append-assistant.done → end-done      (text-only answer; terminate)
 *   append-assistant.error → end-error
 *   any recoverable error path → end-error
 *
 * The scatter placement uses `{ dagFrom: 'dagName' }` so the dispatcher
 * resolves the body DAG from each scatter item at runtime (the pattern
 * `BuildToolWorksetsNode` stamps each item with `dagName: 'tool:<name>'`).
 *
 * `AgentBuilder.loop(nodes, options?)` is the one-call assembler.
 * Callers still register the nodes and services into a `Dagonizer` separately
 * (the assembled `DAGType` is data-only; it carries no runtime instances).
 *
 * Usage:
 *
 * ```ts
 * const llm = new MyLlmAdapter();
 * const dag = AgentBuilder.loop({
 *   chatRequest:         new MyBuildChatRequestNode(),
 *   callModel:           new MyCallModelNode(llm),
 *   normalizeResponse:   new MyNormalizeResponseNode(),
 *   decodeTextToolCalls: new MyDecodeTextToolCallsNode(),
 *   normalizeToolCalls:  new MyNormalizeToolCallsNode(),
 *   toolWorksets:        new MyBuildToolWorksetsNode(),
 *   collectToolResults:  new MyCollectToolResultsNode(),
 *   appendAssistant:     new MyAppendAssistantNode(),
 * }, { name: 'my-agent', version: '1' });
 *
 * const dispatcher = new Dagonizer<MyState>();
 * dispatcher.registerNode(nodes.chatRequest);
 * // … register all 8 nodes and the tool bundle …
 * dispatcher.registerDAG(dag);
 * ```
 */

import { DAGBuilder } from '../../builder/DAGBuilder.js';
import type { DAGType } from '../../entities/dag/DAG.js';
import type { NodeStateInterface } from '../../NodeStateBase.js';

import type { AppendAssistantNode } from './AppendAssistantNode.js';
import type { BuildChatRequestNode } from './BuildChatRequestNode.js';
import type { BuildToolWorksetsNode } from './BuildToolWorksetsNode.js';
import type { CallModelNode } from './CallModelNode.js';
import type { CollectToolResultsNode } from './CollectToolResultsNode.js';
import type { DecodeTextToolCallsNode } from './DecodeTextToolCallsNode.js';
import type { NormalizeResponseNode } from './NormalizeResponseNode.js';
import type { NormalizeToolCallsNode } from './NormalizeToolCallsNode.js';

// ---------------------------------------------------------------------------
// AgentLoopNodesType
// ---------------------------------------------------------------------------

/**
 * The eight concrete node instances that constitute the canonical agent loop.
 * Each field is the covariant base type — callers pass their subclasses.
 *
 * All eight are required: every node in the loop has a fixed role in the
 * assembled topology. There is no optional node.
 */
export type AgentLoopNodesType = {
  readonly chatRequest:         BuildChatRequestNode<NodeStateInterface>;
  readonly callModel:           CallModelNode<NodeStateInterface>;
  readonly normalizeResponse:   NormalizeResponseNode<NodeStateInterface>;
  readonly decodeTextToolCalls: DecodeTextToolCallsNode<NodeStateInterface>;
  readonly normalizeToolCalls:  NormalizeToolCallsNode<NodeStateInterface>;
  readonly toolWorksets:        BuildToolWorksetsNode<NodeStateInterface>;
  readonly collectToolResults:  CollectToolResultsNode<NodeStateInterface>;
  readonly appendAssistant:     AppendAssistantNode<NodeStateInterface>;
};

// ---------------------------------------------------------------------------
// AgentLoopOptionsType
// ---------------------------------------------------------------------------

/** Module-level defaults for `AgentLoopOptionsType`. */
const AGENT_LOOP_OPTIONS_DEFAULTS = {
  'name':    'agent-loop',
  'version': '1',
} as const satisfies { readonly name: string; readonly version: string };

/**
 * Optional overrides for `AgentBuilder.loop`.
 *
 * All fields have defaults: `name` defaults to `'agent-loop'`,
 * `version` defaults to `'1'`. Override to disambiguate when multiple
 * agent loops coexist in the same dispatcher registry.
 */
export type AgentLoopOptionsType = {
  /** DAG registry name. Defaults to `'agent-loop'`. */
  readonly name?: string;
  /** DAG version string. Defaults to `'1'`. */
  readonly version?: string;
};

// ---------------------------------------------------------------------------
// AgentBuilderInterface
// ---------------------------------------------------------------------------

/**
 * Public shape of `AgentBuilder`.
 *
 * Describes the static factory surface. `AgentBuilder` itself carries no
 * instance state; the class-shape interface serves as an explicit contract
 * for the static method.
 */
export interface AgentBuilderInterface {
  loop(nodes: AgentLoopNodesType, options?: AgentLoopOptionsType): DAGType;
}

// ---------------------------------------------------------------------------
// AgentBuilder
// ---------------------------------------------------------------------------

/**
 * Static factory that assembles the canonical 8-node agent loop into a
 * `DAGType` ready for `dispatcher.registerDAG(dag)`.
 *
 * Use `AgentBuilder.loop(nodes, options?)`. Required node instances are
 * positional; optional config (name, version) lives in the trailing options
 * object per the project's function-signature convention.
 */
export class AgentBuilder {
  private constructor() { /* static class */ }

  /**
   * Assemble the canonical agent loop into a `DAGType`.
   *
   * @param nodes   - The eight concrete node instances for the loop.
   * @param options - Optional: `name` (default `'agent-loop'`), `version` (default `'1'`).
   * @returns A `DAGType` ready to register with `dispatcher.registerDAG(dag)`.
   */
  static loop(nodes: AgentLoopNodesType, options: AgentLoopOptionsType = {}): DAGType {
    const { name, version } = { ...AGENT_LOOP_OPTIONS_DEFAULTS, ...options };

    // Placement names mirror the node's canonical class role. They are
    // plain strings in the DAG wire format — not tied to node.name, which
    // the caller controls. The scatter gather strategy uses 'map' to fold
    // per-clone `output` fields into the parent's `toolOutputs` array.
    return new DAGBuilder(name, version)
      // ── 1. Build the chat request ─────────────────────────────────────────
      .node('build-request', nodes.chatRequest, {
        'ready': 'call-model',
        'error': 'end-error',
      })
      // ── 2. Call the model ────────────────────────────────────────────────
      .node('call-model', nodes.callModel, {
        'text':  'normalize-response',
        'tools': 'normalize-response',
        'mixed': 'normalize-response',
        'error': 'end-error',
      })
      // ── 3. Normalize the model response ──────────────────────────────────
      .node('normalize-response', nodes.normalizeResponse, {
        'text':  'append-assistant',
        'tools': 'decode-tools',
        'mixed': 'decode-tools',
        'empty': 'end-error',
        'error': 'end-error',
      })
      // ── 4a. Text-answer path: append the assistant message ───────────────
      //   done  → end-done (terminate; the model answered without tool use)
      //   error → end-error
      .node('append-assistant', nodes.appendAssistant, {
        'done':  'end-done',
        'error': 'end-error',
      })
      // ── 4b. Tool-call path: decode embedded tool calls from text ──────────
      .node('decode-tools', nodes.decodeTextToolCalls, {
        'decoded': 'normalize-tools',
        'empty':   'append-assistant',
        'error':   'end-error',
      })
      // ── 5. Validate + normalize the decoded calls ─────────────────────────
      .node('normalize-tools', nodes.normalizeToolCalls, {
        'valid': 'worksets',
        'empty': 'append-assistant',
        'error': 'end-error',
      })
      // ── 6. Partition calls into safe/exclusive worksets ───────────────────
      .node('worksets', nodes.toolWorksets, {
        'ready': 'dispatch-tools',
        'empty': 'append-assistant',
        'error': 'end-error',
      })
      // ── 7. Scatter: dispatch one clone per safe-workset item ──────────────
      //   body: { dagFrom: 'dagName' } — each scatter item carries `dagName:
      //   'tool:<name>'` (stamped by BuildToolWorksetsNode), so the dispatcher
      //   resolves the body DAG at runtime.
      //   gather: map strategy folds each clone's `output` field into the
      //   parent's `toolOutputs` array so CollectToolResultsNode can read it.
      .scatter(
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
          'gather': {
            'strategy': 'map',
            'mapping':  { 'output': 'toolOutputs' },
          },
        },
      )
      // ── 8. Collect gathered tool results ─────────────────────────────────
      //   done/empty → loop back to build-request for the next turn
      //   error      → end-error
      .node('collect-results', nodes.collectToolResults, {
        'done':  'build-request',
        'empty': 'build-request',
        'error': 'end-error',
      })
      // ── Terminals ─────────────────────────────────────────────────────────
      .terminal('end-done')
      .terminal('end-error', { 'outcome': 'failed' })
      .build();
  }
}
