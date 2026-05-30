/**
 * @noocodex/dagonizer/patterns: pattern-tier public surface.
 *
 * Ships:
 *   - `MonadicNode<TState, TOutput, TServices>`: root abstract class
 *     every pattern (in this package or downstream plugins) extends.
 *   - `LlmClient`: minimal chat-shaped service contract; any
 *     `LlmAdapter` satisfies it.
 *   - `TripleStore`: minimal RDF quad-store service contract.
 *   - `SearchTool<TInput, TOutput>`: generic tool contract used by
 *     `ScoutNode`-style patterns.
 *
 * Plugin packages (`@noocodex/dagonizer-patterns-rag`,
 * `@noocodex/dagonizer-patterns-graph`,
 * `@noocodex/dagonizer-patterns-flow`) build on top of these.
 */

export { MonadicNode } from './MonadicNode.js';

export type { LlmClient } from './LlmClient.js';

export type {
  Binding,
  Quad,
  SlotPattern,
  Term,
  TripleStore,
} from './TripleStore.js';

export type { SearchTool } from './SearchTool.js';
