/**
 * ChatRequestType: a single adapter round-trip call shape.
 *
 * Every field is always present; `ChatRequestBuilder.from(partial)` in
 * `src/adapter/LlmAdapter.ts` fills the defaultable fields so callers
 * always get a complete, V8-monomorphic value.
 *
 * `signal` is an `AbortSignal` — not JSON-serialisable — so there is no
 * JSON Schema for this type. This follows the entity-narrowing interface
 * pattern used by `NodeContextType` (which also carries `signal`).
 */

import type { ChatMessageType } from './ChatMessage.js';
import type { ToolDefinitionType } from './ToolDefinition.js';

/** How aggressively the model should pick a tool. */
export type ToolChoiceType =
  | { type: 'auto' }
  | { type: 'required' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

/**
 * JSON-schema constraint on the model's text response. `kind: 'none'`
 * means "no constraint"; keeps the union shape monomorphic instead of
 * `LlmOutputSchemaType | undefined`.
 */
export type LlmOutputSchemaType =
  | { kind: 'none' }
  | { kind: 'schema'; schema: Record<string, unknown>; id: string };

/** One adapter call; every field always present. */
export type ChatRequestType = {
  messages: ChatMessageType[];
  tools: ToolDefinitionType[];
  toolChoice: ToolChoiceType;
  outputSchema: LlmOutputSchemaType;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

/** Loose-input shape for `ChatRequestBuilder.from`. Only `messages` is required. */
export type PartialChatRequestType = {
  messages: ChatMessageType[];
  tools?: ToolDefinitionType[];
  toolChoice?: ToolChoiceType;
  outputSchema?: LlmOutputSchemaType;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}
