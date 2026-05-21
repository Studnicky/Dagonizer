/**
 * Adapters barrel — every `LlmAdapter` implementation + shared types.
 */

// Contract surface is re-exported from the canonical subpath so the example
// stays close to how external consumers will import it.
export type {
  AdapterCapabilities,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmAdapter,
  OutputSchema,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from '@noocodex/dagonizer/adapter';

export {
  asNetworkError,
  BaseAdapter,
  Classifications,
  classifyHttp,
  LlmError,
} from '@noocodex/dagonizer/adapter';
export type { ErrorClassification } from '@noocodex/dagonizer/adapter';

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
