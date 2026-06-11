/**
 * ChatRequest: a single adapter round-trip call shape.
 *
 * Every field is always present; `ChatRequestBuilder.from(partial)` in
 * `src/adapter/LlmAdapter.ts` fills the defaultable fields so callers
 * always get a complete, V8-monomorphic value.
 *
 * `signal` is an `AbortSignal` — not JSON-serialisable — so there is no
 * JSON Schema for this type. This follows the entity-narrowing interface
 * pattern used by `NodeContextInterface` (which also carries `signal`).
 */

import type { ChatMessage } from './ChatMessage.js';
import type { ToolDefinition } from './ToolDefinition.js';

/** How aggressively the model should pick a tool. */
export type ToolChoice =
  | { type: 'auto' }
  | { type: 'required' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

/**
 * JSON-schema constraint on the model's text response. `kind: 'none'`
 * means "no constraint"; keeps the union shape monomorphic instead of
 * `LlmOutputSchema | undefined`.
 */
export type LlmOutputSchema =
  | { kind: 'none' }
  | { kind: 'schema'; schema: Record<string, unknown>; id: string };

/** One adapter call; every field always present. */
export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  toolChoice: ToolChoice;
  outputSchema: LlmOutputSchema;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}

/** Loose-input shape for `ChatRequestBuilder.from`. Only `messages` is required. */
export interface PartialChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  outputSchema?: LlmOutputSchema;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}
