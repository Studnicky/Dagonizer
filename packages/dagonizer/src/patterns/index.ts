/**
 * @studnicky/dagonizer/patterns: pattern-tier public surface.
 *
 * Ships:
 *   - `MonadicNode<TState, TOutput, TServices>`: the root node base (the monad —
 *     `execute(batch) → RoutedBatchType`), re-exported here from `core` for
 *     co-import with the pattern surface. Per-item pattern bases extend
 *     `ScalarNode` (which extends `MonadicNode`); hot-path nodes extend
 *     `MonadicNode` directly.
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

export type { LlmClientInterface } from '../contracts/LlmClientInterface.js';

export type {
  BindingType,
  QuadType,
  SlotPatternType,
  TermType,
  TripleStoreInterface,
} from '../contracts/TripleStoreInterface.js';
