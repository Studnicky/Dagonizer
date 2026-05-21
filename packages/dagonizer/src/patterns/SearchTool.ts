/**
 * SearchTool — generic external-tool contract every `ScoutNode` calls.
 *
 * A scout pattern wraps a tool: `ScoutNode<TState, TItem, TIn, TOut>`
 * takes a `Tool<TIn, TOut>` via its services bag, calls
 * `tool.run(input)` with the consumer-built input, normalises the
 * output into the consumer's entity shape, and writes back to state.
 *
 * `SearchTool<TInput, TOutput>` is a structural alias for `Tool<TInput,
 * TOutput>` named for the read-side scout use case. The dedicated
 * `@noocodex/dagonizer/tool` subpath (phase 4) ships the canonical
 * `Tool` interface plus shared `HttpTransport` helpers; this file
 * re-exports the read-shape so pattern bases don't have to depend on
 * the tool subpath transitively until they ship.
 */

/**
 * Base tool contract — single `run(input): Promise<output>` entry point.
 * Concrete tools are static classes (per project standards) that
 * implement this shape:
 *
 *   class OpenLibrarySearchTool {
 *     static async run(input: { query: string; limit?: number }): Promise<Candidate[]>;
 *   }
 */
export interface SearchTool<TInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}
