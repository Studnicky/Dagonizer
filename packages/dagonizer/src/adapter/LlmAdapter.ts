/**
 * LlmAdapter — provider-agnostic chat contract.
 *
 * Mirrors nocturne's `LLMAdapterInterface` (`adapters/llm/providers/
 * types/LLMAdapterInterface.ts:61–247`) but trimmed to the surface the
 * Archivist actually needs: one `chat()` round-trip per call, no
 * streaming, no per-adapter stats. Tools and structured-output run
 * through dedicated request fields — the provider implementation maps
 * them to its native wire format (Gemini's `functionDeclarations`,
 * Nano's `responseConstraint`, WebLLM's `response_format`).
 *
 * Adapters are stateless from the caller's perspective: `chat()` is
 * the only entry point; `connect()` / `disconnect()` are optional
 * for adapters that need to spin up a session (Nano, WebLLM).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Why an adapter and not just LlmClient methods?                │
 *   │ Retry, error classification, tool-call extraction, structured │
 *   │ output and schema-violation recovery are the same regardless  │
 *   │ of provider. Implementing them once on a shared base, with a  │
 *   │ thin per-provider transport, removes the duplication you see  │
 *   │ in the legacy `*Provider.ts` files.                            │
 *   └──────────────────────────────────────────────────────────────┘
 */

/** A single message in a chat-style conversation. */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** When `role === 'tool'`, the id of the tool call this is responding to. */
  readonly toolCallId?: string;
  /** When `role === 'tool'`, the name of the tool that produced this content. */
  readonly toolName?: string;
}

/** Tool definition the model can choose to invoke. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema 2020-12 — sent to the provider verbatim. */
  readonly inputSchema: Record<string, unknown>;
  readonly strict?: boolean;
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

/** Optional JSON-schema constraint on the model's text response. */
export interface OutputSchema {
  readonly schema: Record<string, unknown>;
  /** Stable id for the schema — providers may key caches off this. */
  readonly id?: string;
}

/** One adapter call. */
export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ToolChoice;
  readonly outputSchema?: OutputSchema;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

/** What the adapter returns. */
export interface ChatResponse {
  readonly message: {
    readonly content?: string;
    readonly toolCalls?: readonly ToolCall[];
  };
  readonly finishReason: 'stop' | 'length' | 'tool_call' | 'error';
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
  };
}

/**
 * Capability declaration for an adapter. The host DAG introspects this
 * to decide whether to route through tool-calling paths or degrade to
 * direct-prose / structured-JSON paths.
 *
 *   toolUse:
 *     'full'    — adapter + default model produce well-formed `tool_calls`.
 *     'partial' — adapter forwards `tools` but the underlying model may
 *                 return malformed calls or refuse silently. Caller
 *                 should validate aggressively or treat tool output as
 *                 advisory.
 *     'none'    — adapter cannot emit tool calls; caller must inline
 *                 the data the tools would have fetched.
 *
 *   structuredOutput:
 *     true  — `outputSchema` is honored via native `response_format` /
 *             `responseConstraint` / Nano `outputSchema` etc.
 *     false — schema is best-effort prose; downstream parsing must tolerate
 *             prose answers.
 *
 *   jsonMode:
 *     true  — adapter supports `{ "type": "json_object" }` style coarse
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
  /** Optional — adapters that need a session (Nano, WebLLM) implement these. */
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
}
