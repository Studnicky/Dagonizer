/**
 * LlmAdapter: provider-agnostic chat contract for one round-trip per call.
 *
 * Entity schemas and TypeScript interfaces live in `src/entities/adapter/`;
 * this module re-exports them ergonomically so `@noocodex/dagonizer/adapter`
 * consumers continue to see a single import path.
 *
 * `ChatRequestBuilder` and `ChatResponseMessageBuilder` remain here because
 * they have runtime logic (`SignalComposer.never()`, discriminated dispatch).
 * Module-level defaults for `ChatRequest` fields also live here.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Why an adapter and not just LlmClient methods?                │
 *   │ Retry, error classification, tool-call extraction, structured │
 *   │ output and schema-violation recovery are the same regardless  │
 *   │ of provider. They live once on this shared base; each         │
 *   │ provider package contributes only a thin transport; no       │
 *   │ per-provider duplication of the cross-cutting machinery.      │
 *   └──────────────────────────────────────────────────────────────┘
 */

import type { ChatRequest, LlmOutputSchema, PartialChatRequest, ToolChoice } from '../entities/adapter/ChatRequest.js';
import type { ChatResponseMessage } from '../entities/adapter/ChatResponseMessage.js';
import type { TokenUsage } from '../entities/adapter/TokenUsage.js';
import type { ToolCall } from '../entities/adapter/ToolCall.js';
import { SignalComposer } from '../runtime/SignalComposer.js';

// ── Re-export entity schemas + types from their canonical location ────────────
//
// Schemas and `FromSchema`-derived types are wire-shape entities and live in
// `src/entities/adapter/`. Re-exported here so every consumer of
// `@noocodex/dagonizer/adapter` sees them at the familiar import path.

export type { AdapterCapabilities } from '../entities/adapter/AdapterCapabilities.js';

export { ChatMessageSchema } from '../entities/adapter/ChatMessage.js';
export type { ChatMessage } from '../entities/adapter/ChatMessage.js';

export { ToolDefinitionSchema } from '../entities/adapter/ToolDefinition.js';
export type { ToolDefinition } from '../entities/adapter/ToolDefinition.js';

export { ToolCallSchema } from '../entities/adapter/ToolCall.js';
export type { ToolCall } from '../entities/adapter/ToolCall.js';

export { TokenUsageSchema } from '../entities/adapter/TokenUsage.js';
export type { TokenUsage } from '../entities/adapter/TokenUsage.js';

export { ChatResponseMessageSchema } from '../entities/adapter/ChatResponseMessage.js';
export type { ChatResponseMessage } from '../entities/adapter/ChatResponseMessage.js';

export { ChatResponseSchema } from '../entities/adapter/ChatResponse.js';
export type { ChatResponse } from '../entities/adapter/ChatResponse.js';

export type { ChatRequest, LlmOutputSchema, PartialChatRequest, ToolChoice } from '../entities/adapter/ChatRequest.js';

// ── Defaults ─────────────────────────────────────────────────────────────
//
// Module-level constants own the defaults. Producers fill them; consumers
// see complete values and never have to coalesce `??`.

export const DEFAULT_TOOL_CHOICE: ToolChoice = { 'type': 'auto' };
export const DEFAULT_OUTPUT_SCHEMA: LlmOutputSchema = { 'kind': 'none' };
export const DEFAULT_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.2;

/** Canonical defaults for the four defaultable fields of `PartialChatRequest`. */
const CHAT_REQUEST_DEFAULTS = {
  'toolChoice':   DEFAULT_TOOL_CHOICE,
  'outputSchema': DEFAULT_OUTPUT_SCHEMA,
  'maxTokens':    DEFAULT_MAX_TOKENS,
  'temperature':  DEFAULT_TEMPERATURE,
} as const;

/**
 * ChatRequest builder. Fills defaults so callers can pass a partial
 * literal and still get a complete, V8-monomorphic value.
 *
 *   const req = ChatRequestBuilder.from({ messages: [...] });
 *
 * `messages` is the only field with no sensible default; passing an
 * empty array satisfies the type but produces no model output.
 */
export class ChatRequestBuilder {
  private constructor() { /* static */ }

  /** Materialise a complete `ChatRequest` from a partial input by
   *  filling every absent field with its canonical default. */
  static from(partial: PartialChatRequest): ChatRequest {
    const defaults = { ...CHAT_REQUEST_DEFAULTS, ...partial };
    return {
      'messages':     partial.messages,
      'tools':        partial.tools ?? [],
      'toolChoice':   defaults.toolChoice,
      'outputSchema': defaults.outputSchema,
      'maxTokens':    defaults.maxTokens,
      'temperature':  defaults.temperature,
      'signal':       partial.signal ?? SignalComposer.never(),
    };
  }
}

/**
 * ChatResponseMessageBuilder: static factory for `ChatResponseMessage`
 * variants. Centralises the text/tools/mixed dispatch so every adapter
 * calls one canonical entry point. Distinct name from the type so the
 * value and type identifiers never collide at import sites.
 */
export class ChatResponseMessageBuilder {
  private constructor() { /* static */ }

  /** Build the right discriminated variant from content + tool calls. */
  static from(content: string, toolCalls: readonly ToolCall[]): ChatResponseMessage {
    if (toolCalls.length === 0) return { 'kind': 'text', content };
    if (content.length === 0) return { 'kind': 'tools', 'toolCalls': [...toolCalls] };
    return { 'kind': 'mixed', content, 'toolCalls': [...toolCalls] };
  }
}

export const ZERO_TOKEN_USAGE: TokenUsage = { 'promptTokens': 0, 'completionTokens': 0 };

/**
 * Re-exported from `src/contracts/LlmAdapter.ts` — single source of truth.
 * `./adapter` consumers continue to import `LlmAdapter` from this module.
 */
export type { LlmAdapter } from '../contracts/LlmAdapter.js';
