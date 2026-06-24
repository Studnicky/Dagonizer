/**
 * BaseLlmService: abstract base for domain-specific LLM service classes.
 *
 * Wraps an `LlmAdapterInterface` and provides convenience helpers
 * so subclasses only need to implement domain methods:
 *
 *   class MyService extends BaseLlmService {
 *     async classify(message: string): Promise<'a' | 'b'> {
 *       const raw = await this.text('Classify: ' + message);
 *       return raw.startsWith('a') ? 'a' : 'b';
 *     }
 *   }
 *
 * The injected adapter is the only dependency; prompt strategy and domain
 * logic live entirely in the subclass.
 */

import type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';
import type { ChatRequestType } from '../entities/adapter/ChatRequest.js';
import type { ChatResponseMessageType } from '../entities/adapter/ChatResponseMessage.js';

import { ChatRequestBuilder } from './LlmAdapter.js';

export abstract class BaseLlmService {
  readonly #adapter: LlmAdapterInterface;

  constructor(adapter: LlmAdapterInterface) {
    this.#adapter = adapter;
  }

  /** The underlying adapter. Subclasses may read it for advanced use. */
  protected get adapter(): LlmAdapterInterface { return this.#adapter; }

  /**
   * Send a single-turn prompt and return the text content of the response.
   * Convenience wrapper for the common classify/extract/compose pattern.
   */
  protected async text(
    prompt: string,
    options: { readonly maxTokens?: number; readonly temperature?: number; readonly signal?: AbortSignal } = {},
  ): Promise<string> {
    const { maxTokens, temperature, signal } = options;
    const request = ChatRequestBuilder.from({
      'messages': [{ 'role': 'user', 'content': prompt }],
      ...(maxTokens !== undefined ? { 'maxTokens': maxTokens } : {}),
      ...(temperature !== undefined ? { 'temperature': temperature } : {}),
      ...(signal !== undefined ? { 'signal': signal } : {}),
    });
    const response = await this.#adapter.chat(request);
    return BaseLlmService.contentOf(response.message);
  }

  /**
   * Send a full ChatRequestType and return the response message.
   * Use for multi-turn conversations or structured output.
   */
  protected async chat(request: ChatRequestType): Promise<ChatResponseMessageType> {
    const response = await this.#adapter.chat(request);
    return response.message;
  }

  /**
   * Extract the text content from a chat response message.
   * Returns empty string for tool-call-only responses.
   */
  static contentOf(message: ChatResponseMessageType): string {
    return message.variant === 'text' ? message.content : '';
  }
}
