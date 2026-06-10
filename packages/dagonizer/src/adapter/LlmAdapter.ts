/**
 * LlmAdapter: provider-agnostic chat contract for one round-trip per call.
 *
 * Defines the wire-format entities (schemas + TypeScript interfaces),
 * the `ChatRequest` / `ChatResponse` shapes, request defaults, and the
 * `ChatRequestBuilder`/`ChatResponseMessageBuilder` static factories.
 * Tools and structured-output run through dedicated request fields; the
 * provider implementation maps them to its native wire format.
 *
 * Every field on `ChatRequest` / `ChatResponse` is required; module-level
 * defaults fill the absent cases. This keeps V8 hidden classes
 * monomorphic and removes the null-check tax from every call site.
 * Construct requests via `ChatRequestBuilder.from(partial)` to fill defaults.
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

import { SignalComposer } from '../runtime/SignalComposer.js';

// ── JSON Schema 2020-12 definitions ──────────────────────────────────────────
//
// Each wire-shape entity has a `*Schema` value so provider responses can be
// validated at the JSON-ingest boundary before being narrowed to the
// TypeScript type. Fields that are not JSON-expressible (AbortSignal) appear
// only on the TypeScript interface, not in the schema.
//
// Types are kept as hand-written interfaces rather than `FromSchema<>` because
// `inputSchema`/`arguments` are `Record<string, unknown>` — any JSON object —
// which `json-schema-to-ts` would widen to `Record<string, unknown>` anyway.
// The schemas are the runtime validation artifacts; the interfaces remain the
// TypeScript types.

export const ChatMessageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ChatMessage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['role', 'content', 'toolCallId', 'toolName'],
  'properties': {
    'role': { 'type': 'string', 'enum': ['system', 'user', 'assistant', 'tool'] },
    'content': { 'type': 'string' },
    'toolCallId': { 'type': 'string' },
    'toolName': { 'type': 'string' },
  },
  'additionalProperties': false,
} as const;

export const ToolDefinitionSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ToolDefinition',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['name', 'description', 'inputSchema', 'strict'],
  'properties': {
    'name': { 'type': 'string', 'minLength': 1 },
    'description': { 'type': 'string' },
    'inputSchema': { 'type': 'object' },
    'strict': { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

export const ToolCallSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ToolCall',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['id', 'name', 'arguments'],
  'properties': {
    'id': { 'type': 'string', 'minLength': 1 },
    'name': { 'type': 'string', 'minLength': 1 },
    'arguments': { 'type': 'object' },
  },
  'additionalProperties': false,
} as const;

export const TokenUsageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/TokenUsage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['promptTokens', 'completionTokens'],
  'properties': {
    'promptTokens': { 'type': 'number', 'minimum': 0 },
    'completionTokens': { 'type': 'number', 'minimum': 0 },
  },
  'additionalProperties': false,
} as const;

/**
 * JSON Schema for `ChatResponseMessage` discriminated union. Validates the
 * JSON-expressible fields of what a provider returns (text, tools, or mixed).
 */
export const ChatResponseMessageSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ChatResponseMessage',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'oneOf': [
    {
      'type': 'object',
      'required': ['kind', 'content'],
      'properties': { 'kind': { 'const': 'text' }, 'content': { 'type': 'string' } },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'toolCalls'],
      'properties': {
        'kind': { 'const': 'tools' },
        'toolCalls': { 'type': 'array', 'items': ToolCallSchema },
      },
      'additionalProperties': false,
    },
    {
      'type': 'object',
      'required': ['kind', 'content', 'toolCalls'],
      'properties': {
        'kind': { 'const': 'mixed' },
        'content': { 'type': 'string' },
        'toolCalls': { 'type': 'array', 'items': ToolCallSchema },
      },
      'additionalProperties': false,
    },
  ],
} as const;

/**
 * JSON Schema for `ChatResponse` — the JSON-expressible portion of what the
 * adapter returns. Validates at the JSON-ingest boundary before the
 * TypeScript type is asserted.
 */
export const ChatResponseSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer/adapter/ChatResponse',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['message', 'finishReason', 'usage'],
  'properties': {
    'message': ChatResponseMessageSchema,
    'finishReason': { 'type': 'string', 'enum': ['stop', 'length', 'tool_call', 'error'] },
    'usage': TokenUsageSchema,
  },
  'additionalProperties': false,
} as const;

/** A single message in a chat-style conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Empty string for non-tool messages. Tool messages carry the call id. */
  toolCallId: string;
  /** Empty string for non-tool messages. Tool messages carry the tool name. */
  toolName: string;
}

/** Tool definition the model can choose to invoke. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 2020-12; sent to the provider verbatim. */
  inputSchema: Record<string, unknown>;
  strict: boolean;
}

/** Tool invocation emitted by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** How aggressively the model should pick a tool. */
export type ToolChoice =
  | { type: 'auto' }
  | { type: 'required' }
  | { type: 'none' }
  | { type: 'tool';  name: string };

/**
 * JSON-schema constraint on the model's text response. `kind: 'none'`
 * means "no constraint"; keeps the union shape monomorphic instead of
 * `LlmOutputSchema | undefined`.
 */
export type LlmOutputSchema =
  | { kind: 'none' }
  | { kind: 'schema'; schema: Record<string, unknown>; id: string };

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

/**
 * The model's response, expressed as a discriminated union so every
 * shape is monomorphic.
 *
 *   text: pure prose. `content` is the message body, no tools called.
 *   tools: model emitted one or more tool calls; no prose with them.
 *   mixed: model emitted both prose and tool calls.
 */
export type ChatResponseMessage =
  | { kind: 'text';  content: string }
  | { kind: 'tools'; toolCalls: ToolCall[] }
  | { kind: 'mixed'; content: string; toolCalls: ToolCall[] };

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

/** Token usage. Always present; zero when the provider doesn't report. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export const ZERO_TOKEN_USAGE: TokenUsage = { 'promptTokens': 0, 'completionTokens': 0 };

/** What the adapter returns; every field always present. */
export interface ChatResponse {
  message: ChatResponseMessage;
  finishReason: 'stop' | 'length' | 'tool_call' | 'error';
  usage: TokenUsage;
}

/**
 * Capability declaration for an adapter. The host DAG introspects this
 * to decide whether to route through tool-calling paths or degrade to
 * direct-prose / structured-JSON paths.
 *
 *   toolUse:
 *     'full': adapter + default model produce well-formed `tool_calls`.
 *     'partial': adapter forwards `tools` but the underlying model may
 *                 return malformed calls or refuse silently. Caller
 *                 should validate aggressively or treat tool output as
 *                 advisory.
 *     'none': adapter cannot emit tool calls; caller must inline
 *                 the data the tools would have fetched.
 *
 *   structuredOutput:
 *     true: `outputSchema.kind === 'schema'` is honoured via native
 *             `response_format` / `responseConstraint` / Nano `outputSchema`.
 *     false: schema is best-effort prose; downstream parsing must tolerate
 *             prose answers.
 *
 *   jsonMode:
 *     true: adapter supports `{ "type": "json_object" }` style coarse
 *             JSON-only mode (no schema).
 */
export interface AdapterCapabilities {
  toolUse: 'full' | 'partial' | 'none';
  structuredOutput: boolean;
  jsonMode: boolean;
}

/**
 * Re-exported from `src/contracts/LlmAdapter.ts` — single source of truth.
 * `./adapter` consumers continue to import `LlmAdapter` from this module.
 */
export type { LlmAdapter } from '../contracts/LlmAdapter.js';
