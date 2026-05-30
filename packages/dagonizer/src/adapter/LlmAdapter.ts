/**
 * LlmAdapter: provider-agnostic chat contract.
 *
 * Mirrors nocturne's `LLMAdapterInterface` (`adapters/llm/providers/
 * types/LLMAdapterInterface.ts:61–247`) but trimmed to the surface the
 * Archivist actually needs: one `chat()` round-trip per call, no
 * streaming, no per-adapter stats. Tools and structured-output run
 * through dedicated request fields; the provider implementation maps
 * them to its native wire format (Gemini's `functionDeclarations`,
 * Nano's `responseConstraint`, WebLLM's `response_format`).
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

/** A single message in a chat-style conversation. */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Empty string for non-tool messages. Tool messages carry the call id. */
  readonly toolCallId: string;
  /** Empty string for non-tool messages. Tool messages carry the tool name. */
  readonly toolName: string;
}

/** Tool definition the model can choose to invoke. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema 2020-12; sent to the provider verbatim. */
  readonly inputSchema: Record<string, unknown>;
  readonly strict: boolean;
}

/** Tool invocation emitted by the model. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** How aggressively the model should pick a tool. */
export type ToolChoice =
  | { readonly type: 'auto' }
  | { readonly type: 'required' }
  | { readonly type: 'none' }
  | { readonly type: 'tool';  readonly name: string };

/**
 * JSON-schema constraint on the model's text response. `kind: 'none'`
 * means "no constraint"; keeps the union shape monomorphic instead of
 * `OutputSchema | undefined`.
 */
export type OutputSchema =
  | { readonly kind: 'none' }
  | { readonly kind: 'schema'; readonly schema: Record<string, unknown>; readonly id: string };

// ── Defaults ─────────────────────────────────────────────────────────────
//
// Module-level constants own the defaults. Producers fill them; consumers
// see complete values and never have to coalesce `??`.

export const DEFAULT_TOOL_CHOICE: ToolChoice = { 'type': 'auto' };
export const DEFAULT_OUTPUT_SCHEMA: OutputSchema = { 'kind': 'none' };
export const DEFAULT_MAX_TOKENS = 512;
export const DEFAULT_TEMPERATURE = 0.2;

/** A signal that never aborts; used when callers don't supply one. */
const NEVER_ABORTING_SIGNAL: AbortSignal = new AbortController().signal;

/** One adapter call; every field always present. */
export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly toolChoice: ToolChoice;
  readonly outputSchema: OutputSchema;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly signal: AbortSignal;
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
    return {
      'messages':     partial.messages,
      'tools':        partial.tools        ?? [],
      'toolChoice':   partial.toolChoice   ?? DEFAULT_TOOL_CHOICE,
      'outputSchema': partial.outputSchema ?? DEFAULT_OUTPUT_SCHEMA,
      'maxTokens':    partial.maxTokens    ?? DEFAULT_MAX_TOKENS,
      'temperature':  partial.temperature  ?? DEFAULT_TEMPERATURE,
      'signal':       partial.signal       ?? NEVER_ABORTING_SIGNAL,
    };
  }
}

/** Loose-input shape for `ChatRequestBuilder.from`. Only `messages` is required. */
export interface PartialChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoice;
  readonly outputSchema?: OutputSchema;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
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
  | { readonly kind: 'text';  readonly content: string }
  | { readonly kind: 'tools'; readonly toolCalls: readonly ToolCall[] }
  | { readonly kind: 'mixed'; readonly content: string; readonly toolCalls: readonly ToolCall[] };

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
    if (content.length === 0) return { 'kind': 'tools', toolCalls };
    return { 'kind': 'mixed', content, toolCalls };
  }
}

/** Token usage. Always present; zero when the provider doesn't report. */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export const ZERO_TOKEN_USAGE: TokenUsage = { 'promptTokens': 0, 'completionTokens': 0 };

/** What the adapter returns; every field always present. */
export interface ChatResponse {
  readonly message: ChatResponseMessage;
  readonly finishReason: 'stop' | 'length' | 'tool_call' | 'error';
  readonly usage: TokenUsage;
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
  readonly toolUse: 'full' | 'partial' | 'none';
  readonly structuredOutput: boolean;
  readonly jsonMode: boolean;
}

/** Implemented by every provider. */
export interface LlmAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /**
   * Bring up any per-session state (model download, websocket handshake).
   * Adapters that don't need a session implement a no-op; `BaseAdapter`
   * provides a default empty implementation so consumers don't branch
   * on `connect` vs `undefined`.
   */
  connect(): Promise<void>;
  /** Tear down any per-session state. No-op default on `BaseAdapter`. */
  disconnect(): Promise<void>;
  /**
   * Quick availability check. Returns true when this adapter can plausibly
   * serve a chat call right now (credentials present, runtime backend
   * reachable, model available). Implementations MUST NOT throw on
   * transport failure; return false so a cascade can route around the
   * adapter and try the next preference.
   *
   * `BaseAdapter` ships a default that returns true; concrete adapters
   * override with a real probe (e.g. credential check, HEAD request,
   * `navigator.ml` feature detect).
   */
  probe(): Promise<boolean>;
}
