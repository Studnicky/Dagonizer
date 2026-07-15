/**
 * @studnicky/dagonizer/adapter: public adapter contract surface.
 *
 * Every LLM transport plugin in the ecosystem (Gemini API, Groq, Mistral,
 * Cerebras, OpenRouter, …) implements `LlmAdapterInterface` and typically extends
 * `BaseAdapter` to inherit retry + error classification. Adapter packages
 * depend on this subpath for the contract; the dispatcher and consumers
 * pull the same types through the same export so there's exactly one
 * source of truth.
 */

export { N3GraphDataset } from './N3GraphDataset.js';
export { FileGraphDataset } from './FileGraphDataset.js';

export type {
  AdapterCapabilitiesType,
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ChatResponseMessageType,
  LlmAdapterInterface,
  LlmOutputSchemaType,
  PartialChatRequestType,
  TokenUsageType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from './LlmAdapter.js';

export {
  ChatMessageSchema,
  ChatRequest,
  ChatResponseMessage,
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
  BaseAdapterCoreOptionsType,
  BaseAdapterCoreOptionsResolvedType,
} from './BaseAdapterCore.js';

export { BaseAdapter } from './BaseAdapter.js';
export type { BaseAdapterOptionsType } from './BaseAdapter.js';

// `CircuitBreaker`/`TokenBucket` are `@studnicky/resilience` classes, used
// directly (not wrapped) as the `circuitBreaker`/`tokenBucket` fields of
// `BaseAdapterOptionsType`. Re-exported here so a consumer configuring
// resilience for an adapter needs only this subpath — no separate
// `@studnicky/resilience` import for the common case of building one
// breaker/bucket and passing it into an adapter constructor.
export { CircuitBreaker, CircuitBreakerOpenError, TokenBucket, TokenBucketExhaustedError } from '@studnicky/resilience';

export { SseLineParser } from './SseLineParser.js';
export type { SseFrameType } from './SseLineParser.js';

export { OpenAiCompatibleAdapter } from './OpenAiCompatibleAdapter.js';
export type {
  OpenAiCompatibleAdapterOptionsType,
  OpenAiCompatibleConfigType,
} from './OpenAiCompatibleAdapter.js';

export { ModelCost } from './ModelCost.js';
export type { OpenAiCostEntryType } from './ModelCost.js';

// `OpenAiResponseBody` is a schema entity (canonical home `entities/adapter/`).
// Re-exported here so the OpenAI-compatible wire shape stays reachable through
// the `./adapter` public subpath alongside the adapter that parses it.
export { OpenAiResponseBodySchema } from '../entities/adapter/OpenAiResponseBody.js';
export type { OpenAiResponseBodyType } from '../entities/adapter/OpenAiResponseBody.js';

// `OpenAiStreamChunk` is a schema entity (canonical home `entities/adapter/`).
// Re-exported here so the OpenAI-compatible SSE wire shape stays reachable
// through the `./adapter` public subpath alongside the streaming adapter.
export { OpenAiStreamChunkSchema } from '../entities/adapter/OpenAiStreamChunk.js';
export type { OpenAiStreamChunkType } from '../entities/adapter/OpenAiStreamChunk.js';

// `ChatStreamChunk` is a schema entity (canonical home `entities/adapter/`).
// Re-exported here so the streamed-chunk wire shape stays reachable through
// the `./adapter` public subpath alongside the rest of the chat surface.
export { ChatStreamChunkSchema, ChatStreamChunk } from '../entities/adapter/ChatStreamChunk.js';
export type { ChatStreamChunkType } from '../entities/adapter/ChatStreamChunk.js';

// `RoutedChatStreamChunk` is a schema entity (canonical home `entities/adapter/`).
// Re-exported here so the routed streamed-chunk wire shape stays reachable
// through the `./adapter` public subpath alongside `RoutingStreamSink`, the
// decorator that produces it.
export { RoutedChatStreamChunkSchema, RoutedChatStreamChunk } from '../entities/adapter/RoutedChatStreamChunk.js';
export type { RoutedChatStreamChunkType } from '../entities/adapter/RoutedChatStreamChunk.js';

export { RoutingStreamSink } from './RoutingStreamSink.js';

export {
  Classifications,
  LlmError,
} from './LlmError.js';
export type { ErrorClassificationType, LlmErrorReasonType } from './LlmError.js';

export { AdapterDescriptor } from './AdapterDescriptor.js';
export type { AdapterDescriptorShapeType } from './AdapterDescriptor.js';

export { ToolCallCodec } from './ToolCallCodec.js';

export { BaseRegistry } from './BaseRegistry.js';

export { LlmAdapterRegistry } from './LlmAdapterRegistry.js';
export type { AdapterFactoryType } from './LlmAdapterRegistry.js';

export { BaseCascade } from './BaseCascade.js';
export type { CascadePreferenceType } from './BaseCascade.js';

export { LlmAdapterCascade } from './LlmAdapterCascade.js';
export type { CatalogueEntryType, LlmAdapterCascadeOptionsType } from './LlmAdapterCascade.js';

// ── EmbedderInterface surface (parallel to LlmAdapterInterface) ──────────────────────────────
export type { EmbedderInterface } from '../contracts/EmbedderInterface.js';

export { BaseEmbedder } from './BaseEmbedder.js';
export type { BaseEmbedderOptionsType } from './BaseEmbedder.js';

export { LocalModelEmbedder } from './LocalModelEmbedder.js';
export { CloudEmbedder } from './CloudEmbedder.js';

export { EmbedderRegistry } from './EmbedderRegistry.js';
export type { EmbedderFactoryType } from './EmbedderRegistry.js';

export { EmbedderCascade } from './EmbedderCascade.js';

export { RetryableErrorPolicy } from './RetryableErrorPolicy.js';

export { BaseLlmService } from './BaseLlmService.js';
