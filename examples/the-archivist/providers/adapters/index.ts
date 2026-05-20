/**
 * Adapters barrel — every `LlmAdapter` implementation + shared types.
 */

export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmAdapter,
  OutputSchema,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from './LlmAdapter.ts';

export {
  Classifications,
  LlmError,
  asNetworkError,
  classifyHttp,
  type ErrorClassification,
  type LlmErrorReason,
} from './LlmError.ts';

export { BaseAdapter } from './BaseAdapter.ts';

export { CerebrasApiAdapter, type CerebrasApiAdapterOptions } from './CerebrasApiAdapter.ts';
export { GeminiApiAdapter, type GeminiApiAdapterOptions } from './GeminiApiAdapter.ts';
export {
  GeminiNanoAdapter,
  detectGeminiNano,
  type GeminiNanoAvailability,
} from './GeminiNanoAdapter.ts';
export { GroqApiAdapter, type GroqApiAdapterOptions } from './GroqApiAdapter.ts';
export { MistralApiAdapter, type MistralApiAdapterOptions } from './MistralApiAdapter.ts';
export { OpenRouterApiAdapter, type OpenRouterApiAdapterOptions } from './OpenRouterApiAdapter.ts';
export { StubAdapter } from './StubAdapter.ts';
export { WebLlmAdapter, detectWebGpu, type WebLlmAdapterOptions, type WebLlmInitReport } from './WebLlmAdapter.ts';
