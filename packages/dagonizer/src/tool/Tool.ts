/**
 * Tool: canonical executable-tool contract.
 *
 * A `Tool<TInput, TOutput>` couples a `ToolDefinition` (the JSON-Schema
 * surface the LLM declares via the adapter's tool channel) with an
 * `execute()` method the dispatcher invokes when a `ToolCall` lands.
 *
 * Tools are stateless adapters: consumers register one instance per
 * tool and reuse it across runs. Concrete tools are static classes per
 * project standards (`OpenLibrarySearchTool.search(...)` style); the
 * `Tool` interface they conform to is what `ScoutNode` and other tool-
 * dispatching patterns target.
 *
 * `ToolDefinition` and `ToolCall` shapes are reused from
 * `@noocodex/dagonizer/adapter` so the LLM tool-channel and the
 * tool-execution boundary speak the same vocabulary.
 */

import type { ToolDefinition } from '../adapter/index.js';
import type { AbortableOptionsInterface } from '../contracts/AbortableOptionsInterface.js';

export interface Tool<TInput extends Record<string, unknown>, TOutput> {
  /** JSON-Schema-shaped declaration the LLM sees in its tool list. */
  readonly definition: ToolDefinition;
  /** Invoke the tool. Long-running calls must honour `options.signal`. */
  execute(input: TInput, options?: AbortableOptionsInterface): Promise<TOutput>;
}
