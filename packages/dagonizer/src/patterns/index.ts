/**
 * @studnicky/dagonizer/patterns: pattern-tier public surface.
 *
 * Ships:
 *   - `MonadicNode<TState, TOutput>`: the root node base (the monad —
 *     `execute(batch) → RoutedBatchType`), re-exported here from `core` for
 *     co-import with the pattern surface. Per-item pattern bases extend
 *     `ScalarNode` (which extends `MonadicNode`); hot-path nodes extend
 *     `MonadicNode` directly.
 *   - Agent-flow template-method bases: `BuildChatRequestNode`, `CallModelNode`,
 *     `NormalizeResponseNode`, `DecodeTextToolCallsNode`, `AppendAssistantNode`,
 *     `NormalizeToolCallsNode`, `BuildToolWorksetsNode`, `CollectToolResultsNode`.
 *     Agent nodes receive dependencies via constructor injection.
 *   - `LlmClientInterface`: minimal chat-shaped service contract; any
 *     `LlmAdapterInterface` satisfies it.
 *   - `TripleStoreInterface`: minimal RDF quad-store service contract.
 *
 * ToolInterface-shaped patterns (e.g. `ScoutNode`) reference the canonical `ToolInterface`
 * type from `@studnicky/dagonizer/tool` directly — there is no aliased
 * re-export.
 *
 * Plugin packages (`@studnicky/dagonizer-patterns-rag`,
 * `@studnicky/dagonizer-patterns-graph`,
 * `@studnicky/dagonizer-patterns-flow`) build on top of these.
 */

export { MonadicNode } from '../core/MonadicNode.js';

export {
  AgentBuilder,
  AppendAssistantNode,
  BuildChatRequestNode,
  BuildToolWorksetsNode,
  CallModelNode,
  CollectToolResultsNode,
  DecodeTextToolCallsNode,
  NormalizeResponseNode,
  NormalizeToolCallsNode,
} from './agent/index.js';

export type { AgentBuilderInterface, AgentLoopNodesType, AgentLoopOptionsType, ToolCallScatterItemType } from './agent/index.js';

export type { LlmClientInterface } from '../contracts/LlmClientInterface.js';

export type {
  BindingType,
  QuadType,
  SlotPatternType,
  TermType,
  TripleStoreInterface,
} from '../contracts/TripleStoreInterface.js';

// NOTE: DecisionNode, LlmDispatchNode, ComposeNode live in
// @studnicky/dagonizer-patterns-rag which is a peerDependency consumer
// of dagonizer. A re-export here would create a circular dependency
// (dagonizer → dagonizer-patterns-rag → dagonizer). Consumers import
// those nodes directly from @studnicky/dagonizer-patterns-rag.

// LLM-backed pattern node bases — generic across any domain
export { LlmDispatchNode } from './LlmDispatchNode.js';
export { DecisionNode } from './DecisionNode.js';
export { ComposeNode } from './ComposeNode.js';

// Sub-DAG stream producer: bridges an inner DAG's execution stream into a scatter source
export { DagStreamProducer } from './DagStreamProducer.js';
