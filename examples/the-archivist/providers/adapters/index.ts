/**
 * Adapters barrel: re-exports each adapter from its plugin package.
 *
 * Contract types (LlmAdapter, ChatRequest, etc.) and BaseAdapter come
 * from `@noocodex/dagonizer/adapter`. Concrete provider adapters live
 * in their own `@noocodex/dagonizer-adapter-*` packages.
 */

export type {
  AdapterCapabilities,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmAdapter,
  LlmOutputSchema,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from '@noocodex/dagonizer/adapter';

export {
  BaseAdapter,
  Classifications,
  LlmError,
} from '@noocodex/dagonizer/adapter';
export type { ErrorClassification, OpenAiCompatibleAdapterOptions } from '@noocodex/dagonizer/adapter';

export { CerebrasApiAdapter }       from '@noocodex/dagonizer-adapter-cerebras';
export { GeminiApiAdapter }         from '@noocodex/dagonizer-adapter-gemini-api';
export type { GeminiApiAdapterOptions } from '@noocodex/dagonizer-adapter-gemini-api';
export { GeminiNanoAdapter } from '@noocodex/dagonizer-adapter-gemini-nano';
export type { GeminiNanoAvailability } from '@noocodex/dagonizer-adapter-gemini-nano';
export { GroqApiAdapter }           from '@noocodex/dagonizer-adapter-groq';
export { MistralApiAdapter }        from '@noocodex/dagonizer-adapter-mistral';
export { OllamaApiAdapter }         from '@noocodex/dagonizer-adapter-ollama';
export type { OllamaApiAdapterOptions } from '@noocodex/dagonizer-adapter-ollama';
export { OllamaProbe, detectOllama, listOllamaModels } from './detectOllama.ts';
export { OpenRouterApiAdapter }     from '@noocodex/dagonizer-adapter-openrouter';
export type { OpenRouterApiAdapterOptions } from '@noocodex/dagonizer-adapter-openrouter';
export { WebLlmAdapter } from '@noocodex/dagonizer-adapter-web-llm';
export type { WebLlmAdapterOptions, WebLlmInitReport } from '@noocodex/dagonizer-adapter-web-llm';
