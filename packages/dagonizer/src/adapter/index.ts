/**
 * @noocodex/dagonizer/adapter — public adapter contract surface.
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
  OutputSchema,
  PartialChatRequest,
  TokenUsage,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from './LlmAdapter.js';

export {
  ChatRequest as ChatRequestBuilder,
  ChatResponseMessage as ChatResponseMessageBuilder,
  DEFAULT_MAX_TOKENS,
  DEFAULT_OUTPUT_SCHEMA,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOOL_CHOICE,
  ZERO_TOKEN_USAGE,
} from './LlmAdapter.js';

export {
  BaseAdapter,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
} from './BaseAdapter.js';
export type { BaseAdapterOptions, PartialBaseAdapterOptions } from './BaseAdapter.js';

export { OpenAiCompatibleAdapter } from './OpenAiCompatibleAdapter.js';
export type {
  OpenAiCompatibleAdapterOptions,
  OpenAiCompatibleConfig,
} from './OpenAiCompatibleAdapter.js';

export {
  asNetworkError,
  Classifications,
  classifyHttp,
  LlmError,
} from './LlmError.js';
export type { ErrorClassification } from './LlmError.js';
