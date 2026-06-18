/**
 * @studnicky/dagonizer/adapter: public adapter contract surface.
 *
 * Every LLM transport plugin in the ecosystem (Gemini API, Groq, Mistral,
 * Cerebras, OpenRouter, …) implements `LlmAdapter` and typically extends
 * `BaseAdapter` to inherit retry + error classification. Adapter packages
 * depend on this subpath for the contract; the dispatcher and consumers
 * pull the same types through the same export so there's exactly one
 * source of truth.
 */

export type {
  AdapterCapabilities,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatResponseMessage,
  LlmAdapter,
  LlmOutputSchema,
  PartialChatRequest,
  TokenUsage,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from './LlmAdapter.js';

export {
  ChatMessageSchema,
  ChatRequestBuilder,
  ChatResponseMessageBuilder,
  ChatResponseMessageSchema,
  ChatResponseSchema,
  DEFAULT_MAX_TOKENS,
  DEFAULT_OUTPUT_SCHEMA,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOOL_CHOICE,
  TokenUsageSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
  ZERO_TOKEN_USAGE,
} from './LlmAdapter.js';

// ── Canonical adapter constants, base options, and shared base ─────────────
export {
  BaseAdapterCore,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
} from './BaseAdapterCore.js';
export type {
  BaseAdapterCoreOptions,
  BaseAdapterCoreOptionsResolved,
} from './BaseAdapterCore.js';

export { BaseAdapter } from './BaseAdapter.js';

export { OpenAiCompatibleAdapter } from './OpenAiCompatibleAdapter.js';
export type {
  OpenAiCompatibleAdapterOptions,
  OpenAiCompatibleConfig,
} from './OpenAiCompatibleAdapter.js';

// `OpenAiResponseBody` is a schema entity (canonical home `entities/adapter/`).
// Re-exported here so the OpenAI-compatible wire shape stays reachable through
// the `./adapter` public subpath alongside the adapter that parses it.
export { OpenAiResponseBodySchema } from '../entities/adapter/OpenAiResponseBody.js';
export type { OpenAiResponseBody } from '../entities/adapter/OpenAiResponseBody.js';

export {
  Classifications,
  LlmError,
} from './LlmError.js';
export type { ErrorClassification, LlmErrorReason } from './LlmError.js';

export { AdapterDescriptor } from './AdapterDescriptor.js';
export type { AdapterDescriptorShape } from './AdapterDescriptor.js';

export { ToolCallCodec } from './ToolCallCodec.js';

export { BaseRegistry } from './BaseRegistry.js';

export { LlmAdapterRegistry } from './LlmAdapterRegistry.js';
export type { AdapterFactory } from './LlmAdapterRegistry.js';

export { BaseCascade } from './BaseCascade.js';
export type { CascadePreference } from './BaseCascade.js';

export { LlmAdapterCascade } from './LlmAdapterCascade.js';

// ── Embedder surface (parallel to LlmAdapter) ──────────────────────────────
export type { Embedder } from '../contracts/Embedder.js';

export { BaseEmbedder } from './BaseEmbedder.js';

export { EmbedderRegistry } from './EmbedderRegistry.js';
export type { EmbedderFactory } from './EmbedderRegistry.js';

export { EmbedderCascade } from './EmbedderCascade.js';

export { RetryableErrorPolicy } from './RetryableErrorPolicy.js';
