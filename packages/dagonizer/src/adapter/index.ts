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
  BaseAdapterCoreOptionsType,
  BaseAdapterCoreOptionsResolvedType,
} from './BaseAdapterCore.js';

export { BaseAdapter } from './BaseAdapter.js';
export type { BaseAdapterOptionsType } from './BaseAdapter.js';

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
export { LlmAdapterCascadeBuilder } from './LlmAdapterCascadeBuilder.js';
export type { CatalogueEntryType, LlmAdapterCascadeBuilderOptionsType } from './LlmAdapterCascadeBuilder.js';

// ── EmbedderInterface surface (parallel to LlmAdapterInterface) ──────────────────────────────
export type { EmbedderInterface } from '../contracts/EmbedderInterface.js';

export { BaseEmbedder } from './BaseEmbedder.js';
export type { BaseEmbedderOptionsType } from './BaseEmbedder.js';

export { LocalModelEmbedder } from './LocalModelEmbedder.js';

export { EmbedderRegistry } from './EmbedderRegistry.js';
export type { EmbedderFactoryType } from './EmbedderRegistry.js';

export { EmbedderCascade } from './EmbedderCascade.js';

export { RetryableErrorPolicy } from './RetryableErrorPolicy.js';

export { BaseLlmService } from './BaseLlmService.js';
