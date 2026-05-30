/**
 * SearchTool: alias of the canonical `Tool<TInput, TOutput>` shape.
 *
 * Re-exports the executable-tool interface shipped at
 * `@noocodex/dagonizer/tool`. Pattern bases that target tools (e.g.
 * `ScoutNode<TState, TItem, TIn, TOut>`) reference `SearchTool` for
 * readability; the underlying type is `Tool`, which is the single
 * source of truth.
 */

export type { Tool as SearchTool } from '../tool/index.js';
