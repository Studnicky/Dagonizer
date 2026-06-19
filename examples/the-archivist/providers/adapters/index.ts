/**
 * Adapters barrel: re-exports each adapter from its plugin package.
 *
 * Contract types (LlmAdapterInterface, ChatRequestType, etc.) and BaseAdapter come
 * from `@studnicky/dagonizer/adapter`. Concrete provider adapters live
 * in their own `@studnicky/dagonizer-adapter-*` packages.
 */

export type {
  AdapterCapabilitiesType,
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  LlmAdapterInterface,
  LlmOutputSchemaType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';

export {
  BaseAdapter,
  Classifications,
  LlmError,
} from '@studnicky/dagonizer/adapter';
export type { ErrorClassificationType, OpenAiCompatibleAdapterOptionsType } from '@studnicky/dagonizer/adapter';

export { CerebrasApiAdapter }       from '@studnicky/dagonizer-adapter-cerebras';
export { GeminiApiAdapter }         from '@studnicky/dagonizer-adapter-gemini-api';
export type { GeminiApiAdapterOptionsType } from '@studnicky/dagonizer-adapter-gemini-api';
export { GeminiNanoAdapter } from '@studnicky/dagonizer-adapter-gemini-nano';
export type { GeminiNanoAvailabilityType } from '@studnicky/dagonizer-adapter-gemini-nano';
export { GroqApiAdapter }           from '@studnicky/dagonizer-adapter-groq';
export { MistralApiAdapter }        from '@studnicky/dagonizer-adapter-mistral';
export { OllamaApiAdapter }         from '@studnicky/dagonizer-adapter-ollama';
export type { OllamaApiAdapterOptionsType } from '@studnicky/dagonizer-adapter-ollama';
export { OllamaProbe } from './detectOllama.ts';
export { OpenRouterApiAdapter }     from '@studnicky/dagonizer-adapter-openrouter';
export type { OpenRouterApiAdapterOptionsType } from '@studnicky/dagonizer-adapter-openrouter';
export { WebLlmAdapter } from '@studnicky/dagonizer-adapter-web-llm';
export type { WebLlmAdapterOptionsType, WebLlmInitReportType } from '@studnicky/dagonizer-adapter-web-llm';
