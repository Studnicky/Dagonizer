/**
 * ToolInterface: canonical executable-tool contract.
 *
 * A `ToolInterface<TInput, TOutput>` couples a `ToolDefinition` (the JSON-Schema
 * surface the LLM declares via the adapter's tool channel) with an
 * `execute()` method the dispatcher invokes when a `ToolCall` lands.
 *
 * Concrete tools are classes that implement this interface. Consumers
 * construct one instance per tool and reuse it across runs
 * (`new OpenLibrarySearchTool()`). The `execute()` method is the
 * invocation verb; helper logic lives as private static methods on the
 * tool class. `ScoutNode` and other tool-dispatching patterns target
 * this interface, not any concrete implementation.
 *
 * `ToolDefinition` and `ToolCall` shapes are reused from
 * `@studnicky/dagonizer/adapter` so the LLM tool-channel and the
 * tool-execution boundary speak the same vocabulary.
 */

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { ToolDefinitionType } from '../entities/adapter/ToolDefinition.js';

export interface ToolInterface<TInput extends Record<string, unknown>, TOutput> {
  /** JSON-Schema-shaped declaration the LLM sees in its tool list. */
  readonly definition: ToolDefinitionType;
  /** Invoke the tool. Long-running calls must honour `options.signal`. */
  execute(input: TInput, options?: AbortableOptionsType): Promise<TOutput>;
}
