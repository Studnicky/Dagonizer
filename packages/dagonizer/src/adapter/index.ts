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
  LlmAdapter,
  OutputSchema,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from './LlmAdapter.js';

export { BaseAdapter } from './BaseAdapter.js';
export type { BaseAdapterOptions } from './BaseAdapter.js';

export {
  asNetworkError,
  Classifications,
  classifyHttp,
  LlmError,
} from './LlmError.js';
export type { ErrorClassification } from './LlmError.js';
