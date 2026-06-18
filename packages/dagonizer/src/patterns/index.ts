/**
 * @studnicky/dagonizer/patterns: pattern-tier public surface.
 *
 * Ships:
 *   - `MonadicNode<TState, TOutput, TServices>`: the root node base (the monad —
 *     `execute(batch) → RoutedBatch`), re-exported here from `core` for
 *     co-import with the pattern surface. Per-item pattern bases extend
 *     `ScalarNode` (which extends `MonadicNode`); hot-path nodes extend
 *     `MonadicNode` directly.
 *   - `LlmClient`: minimal chat-shaped service contract; any
 *     `LlmAdapter` satisfies it.
 *   - `TripleStore`: minimal RDF quad-store service contract.
 *
 * Tool-shaped patterns (e.g. `ScoutNode`) reference the canonical `Tool`
 * type from `@studnicky/dagonizer/tool` directly — there is no aliased
 * re-export.
 *
 * Plugin packages (`@studnicky/dagonizer-patterns-rag`,
 * `@studnicky/dagonizer-patterns-graph`,
 * `@studnicky/dagonizer-patterns-flow`) build on top of these.
 */

export { MonadicNode } from '../core/MonadicNode.js';

export type { LlmClient } from '../contracts/LlmClient.js';

export type {
  Binding,
  Quad,
  SlotPattern,
  Term,
  TripleStore,
} from '../contracts/TripleStore.js';
