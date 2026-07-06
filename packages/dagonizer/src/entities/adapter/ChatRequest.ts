/**
 * ChatRequestType: a single adapter round-trip call shape.
 *
 * Every field is always present; `ChatRequest.create(partial)` in
 * `src/adapter/LlmAdapter.ts` fills the defaultable fields so callers
 * always get a complete, V8-monomorphic value.
 *
 * `signal` is an `AbortSignal` — not JSON-serialisable — so there is no
 * JSON Schema for this type. This follows the entity-narrowing interface
 * pattern used by `NodeContextType` (which also carries `signal`).
 */

import type { ChatMessageType } from './ChatMessage.js';
import type { ToolDefinitionType } from './ToolDefinition.js';

/**
 * How aggressively the model should pick a tool.
 *   `auto`:     model decides whether to call a tool.
 *   `required`: model must call at least one tool.
 *   `none`:     model must not call any tool.
 *   `tool`:     model must call the specific named tool.
 */
export type ToolChoiceType =
  | { type: 'auto' }
  | { type: 'required' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

/**
 * JSON-schema constraint on the model's text response.
 *   `none`:   no constraint on the response shape.
 *   `schema`: the model must conform to the provided JSON Schema; `id` names the schema.
 * The union is always present (no `| undefined`) to keep `ChatRequestType` V8-monomorphic.
 */
export type LlmOutputSchemaType =
  | { variant: 'none' }
  | { variant: 'schema'; schema: Record<string, unknown>; id: string };

/** One adapter call; every field always present. Constructed via `ChatRequest.create(partial)`. */
export type ChatRequestType = {
  /** Ordered conversation history passed to the model. */
  messages: ChatMessageType[];
  /** Tool definitions the model may choose to invoke. Empty array means no tools. */
  tools: ToolDefinitionType[];
  /** How aggressively the model should pick a tool. */
  toolChoice: ToolChoiceType;
  /** JSON Schema constraint on the model's response; `variant: 'none'` means no constraint. */
  outputSchema: LlmOutputSchemaType;
  /** Maximum number of tokens the model may generate. */
  maxTokens: number;
  /** Sampling temperature; higher values increase randomness. */
  temperature: number;
  /** AbortSignal to cancel an in-flight request. */
  signal: AbortSignal;
}

/**
 * Loose-input shape accepted by `ChatRequest.create`. Only `messages` is required;
 * every other field is defaulted to produce a complete `ChatRequestType`.
 */
export type PartialChatRequestType = {
  /** Ordered conversation history. Required. */
  messages: ChatMessageType[];
  /** Tool definitions. Defaults to `[]`. */
  tools?: ToolDefinitionType[];
  /** Tool choice policy. Defaults to `{ type: 'auto' }`. */
  toolChoice?: ToolChoiceType;
  /** Output schema constraint. Defaults to `{ variant: 'none' }`. */
  outputSchema?: LlmOutputSchemaType;
  /** Max tokens. Defaults to the adapter's configured maximum. */
  maxTokens?: number;
  /** Sampling temperature. Defaults to the adapter's configured value. */
  temperature?: number;
  /** Cancellation signal. Defaults to a never-fired signal. */
  signal?: AbortSignal;
}
