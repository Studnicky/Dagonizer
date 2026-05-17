/**
 * ToolDefinition / ToolCall / ToolOutcome — the Archivist's tool contract.
 *
 * Mirrors nocturne's adapter-side tool surface
 * (`adapters/llm/providers/types/ToolDefinitionInterface.ts`,
 * `ToolCallInterface.ts`, `entities/llm/ToolUseOutcomeType.ts`) so any
 * future tool-calling LLM adapter can be swapped in without reshaping
 * the Archivist's DAG nodes.
 *
 * A `Tool<TInput, TOutput>` is a runnable adapter: a definition the LLM
 * can declare in its tools list, plus an `execute()` that the dispatcher
 * invokes when the LLM emits a `ToolCall` naming the tool. In Dagonizer
 * the call site is a DAG node — see `webSearchScout` for the canonical
 * pattern.
 */

export interface ToolDefinition {
  /** Stable name the LLM uses to invoke the tool. */
  readonly name: string;
  /** Human-readable description that guides the LLM on when to invoke. */
  readonly description: string;
  /** JSON Schema 2020-12 for the tool's input. */
  readonly inputSchema: Record<string, unknown>;
  /** Default true: provider must enforce schema strictly. */
  readonly strict?: boolean;
}

export interface ToolCall {
  /** Provider-issued or locally minted id (e.g. `crypto.randomUUID()`). */
  readonly id: string;
  /** Matches `ToolDefinition.name`. */
  readonly name: string;
  /** Parsed arguments — pre-validated against `inputSchema` by the caller. */
  readonly arguments: Record<string, unknown>;
}

export type ToolOutcome<TResult> =
  | { readonly kind: 'tool_result';   readonly result: TResult }
  | { readonly kind: 'tool_error';    readonly error: Error };

/**
 * Tool — definition + invocation pair. Stateless; consumers register
 * one instance per tool and reuse across runs.
 */
export interface Tool<TInput extends Record<string, unknown>, TResult> {
  readonly definition: ToolDefinition;
  execute(input: TInput, signal?: AbortSignal): Promise<TResult>;
}
