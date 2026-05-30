/**
 * @noocodex/dagonizer/patterns: pattern-tier public surface.
 *
 * Ships:
 *   - `MonadicNode<TState, TOutput, TServices>`: root abstract class
 *     every pattern (in this package or downstream plugins) extends.
 *   - `LlmClient`: minimal chat-shaped service contract; any
 *     `LlmAdapter` satisfies it.
 *   - `TripleStore`: minimal RDF quad-store service contract.
 *
 * Tool-shaped patterns (e.g. `ScoutNode`) reference the canonical `Tool`
 * type from `@noocodex/dagonizer/tool` directly — there is no aliased
 * re-export.
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
