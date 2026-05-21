/**
 * Adapters barrel — re-exports each adapter from its plugin package
 * plus the Archivist-grounded stub subclass that lives in the example.
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

export { CerebrasApiAdapter }       from '@noocodex/dagonizer-adapter-cerebras';
export type { CerebrasApiAdapterOptions } from '@noocodex/dagonizer-adapter-cerebras';
export { GeminiApiAdapter }         from '@noocodex/dagonizer-adapter-gemini-api';
export type { GeminiApiAdapterOptions } from '@noocodex/dagonizer-adapter-gemini-api';
export { GeminiNanoAdapter, detectGeminiNano } from '@noocodex/dagonizer-adapter-gemini-nano';
export type { GeminiNanoAvailability } from '@noocodex/dagonizer-adapter-gemini-nano';
export { GroqApiAdapter }           from '@noocodex/dagonizer-adapter-groq';
export type { GroqApiAdapterOptions } from '@noocodex/dagonizer-adapter-groq';
export { MistralApiAdapter }        from '@noocodex/dagonizer-adapter-mistral';
export type { MistralApiAdapterOptions } from '@noocodex/dagonizer-adapter-mistral';
export { OllamaApiAdapter }         from '@noocodex/dagonizer-adapter-ollama';
export type { OllamaApiAdapterOptions } from '@noocodex/dagonizer-adapter-ollama';
export { detectOllama }             from './detectOllama.js';
export { OpenRouterApiAdapter }     from '@noocodex/dagonizer-adapter-openrouter';
export type { OpenRouterApiAdapterOptions } from '@noocodex/dagonizer-adapter-openrouter';
export { StubAdapter }              from '@noocodex/dagonizer-adapter-stub';
export type { StubAdapterOptions }  from '@noocodex/dagonizer-adapter-stub';
export { WebLlmAdapter, detectWebGpu } from '@noocodex/dagonizer-adapter-web-llm';
export type { WebLlmAdapterOptions, WebLlmInitReport } from '@noocodex/dagonizer-adapter-web-llm';

// Archivist-grounded stub subclass — stays in the example since it depends
// on the Archivist's SeedLibrary + MemoryStore.
export { ArchivistStub } from './ArchivistStub.js';
export type { ArchivistStubOptions } from './ArchivistStub.js';
