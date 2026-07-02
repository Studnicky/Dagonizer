/**
 * LlmAdapterInterface: provider-agnostic chat contract for one round-trip per call.
 *
 * Entity schemas and TypeScript interfaces live in `src/entities/adapter/`;
 * this module re-exports them ergonomically so `@studnicky/dagonizer/adapter`
 * consumers continue to see a single import path.
 *
 * `ChatRequestBuilder` and `ChatResponseMessageBuilder` remain here because
 * they have runtime logic (`Signal.never()`, discriminated dispatch).
 * Module-level defaults for `ChatRequestType` fields also live here.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Why an adapter and not just LlmClientInterface methods?                │
 *   │ Retry, error classification, tool-call extraction, structured │
 *   │ output and schema-violation recovery are the same regardless  │
 *   │ of provider. They live once on this shared base; each         │
 *   │ provider package contributes only a thin transport; no       │
 *   │ per-provider duplication of the cross-cutting machinery.      │
 *   └──────────────────────────────────────────────────────────────┘
 */

import { Signal } from '@studnicky/signal';

import type { ChatRequestType, LlmOutputSchemaType, PartialChatRequestType, ToolChoiceType } from '../entities/adapter/ChatRequest.js';
import type { ChatResponseMessageType } from '../entities/adapter/ChatResponseMessage.js';
import type { TokenUsageType } from '../entities/adapter/TokenUsage.js';
import type { ToolCallType } from '../entities/adapter/ToolCall.js';

// ── Re-export entity schemas + types from their canonical location ────────────
//
// Schemas and `FromSchema`-derived types are wire-shape entities and live in
// `src/entities/adapter/`. Re-exported here so every consumer of
// `@studnicky/dagonizer/adapter` sees them at the familiar import path.

export type { AdapterCapabilitiesType } from '../entities/adapter/AdapterCapabilities.js';

export { ChatMessageSchema } from '../entities/adapter/ChatMessage.js';
export type { ChatMessageType } from '../entities/adapter/ChatMessage.js';

export { ToolDefinitionSchema } from '../entities/adapter/ToolDefinition.js';
export type { ToolDefinitionType } from '../entities/adapter/ToolDefinition.js';

export { ToolCallSchema } from '../entities/adapter/ToolCall.js';
export type { ToolCallType } from '../entities/adapter/ToolCall.js';

export { TokenUsageSchema } from '../entities/adapter/TokenUsage.js';
export type { TokenUsageType } from '../entities/adapter/TokenUsage.js';

export { ChatResponseMessageSchema } from '../entities/adapter/ChatResponseMessage.js';
export type { ChatResponseMessageType } from '../entities/adapter/ChatResponseMessage.js';

export { ChatResponseSchema } from '../entities/adapter/ChatResponse.js';
export type { ChatResponseType } from '../entities/adapter/ChatResponse.js';

export { LlmModelSchema } from '../entities/adapter/LlmModel.js';
export type { LlmModelType } from '../entities/adapter/LlmModel.js';

export type { ChatRequestType, LlmOutputSchemaType, PartialChatRequestType, ToolChoiceType } from '../entities/adapter/ChatRequest.js';

// ── Defaults ─────────────────────────────────────────────────────────────
//
// Module-level constants own the defaults. Producers fill them; consumers
// see complete values and never have to coalesce `??`.

export const DEFAULT_TOOL_CHOICE: ToolChoiceType = { 'type': 'auto' };
export const DEFAULT_OUTPUT_SCHEMA: LlmOutputSchemaType = { 'variant': 'none' };
export const DEFAULT_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.2;

/** Canonical defaults for the four defaultable fields of `PartialChatRequestType`. */
const CHAT_REQUEST_DEFAULTS = {
  'toolChoice':   DEFAULT_TOOL_CHOICE,
  'outputSchema': DEFAULT_OUTPUT_SCHEMA,
  'maxTokens':    DEFAULT_MAX_TOKENS,
  'temperature':  DEFAULT_TEMPERATURE,
} as const;

/**
 * ChatRequestType builder. Fills defaults so callers can pass a partial
 * literal and still get a complete, V8-monomorphic value.
 *
 *   const req = ChatRequestBuilder.from({ messages: [...] });
 *
 * `messages` is the only field with no sensible default; passing an
 * empty array satisfies the type but produces no model output.
 */
export class ChatRequestBuilder {
  private constructor() { /* static */ }

  /** Materialise a complete `ChatRequestType` from a partial input by
   *  filling every absent field with its canonical default. */
  static from(partial: PartialChatRequestType): ChatRequestType {
    const defaults = { ...CHAT_REQUEST_DEFAULTS, ...partial };
    return {
      'messages':     partial.messages,
      'tools':        partial.tools ?? [],
      'toolChoice':   defaults.toolChoice,
      'outputSchema': defaults.outputSchema,
      'maxTokens':    defaults.maxTokens,
      'temperature':  defaults.temperature,
      'signal':       partial.signal ?? Signal.never(),
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
  static from(content: string, toolCalls: readonly ToolCallType[]): ChatResponseMessageType {
    if (toolCalls.length === 0) return { 'variant': 'text', content };
    if (content.length === 0) return { 'variant': 'tools', 'toolCalls': [...toolCalls] };
    return { 'variant': 'mixed', content, 'toolCalls': [...toolCalls] };
  }
}

export const ZERO_TOKEN_USAGE: TokenUsageType = { 'promptTokens': 0, 'completionTokens': 0 };

/**
 * Re-exported from `src/contracts/LlmAdapterInterface.ts` — single source of truth.
 * `./adapter` consumers continue to import `LlmAdapterInterface` from this module.
 */
export type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';
