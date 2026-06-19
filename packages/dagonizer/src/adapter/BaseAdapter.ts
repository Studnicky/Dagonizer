/**
 * BaseAdapter: abstract base every concrete LLM adapter extends.
 *
 * Extends `BaseAdapterCore` for shared lifecycle (retry policy,
 * `connect`/`disconnect`/`probe`, `classify`) and adds only what is
 * unique to the LLM surface: `capabilities` and the `chat()` envelope
 * that calls the abstract `performChat()`.
 *
 *   LlmAdapterInterface contract → BaseAdapter ┐
 *                                     ├─ chat() → retry-wrapped performChat()
 *                                     └─ classify(err) returns retryable/non-retryable
 *
 * The retry wrapper rethrows non-retryable errors immediately and
 * loops with exponential backoff for retryable ones (NETWORK, TIMEOUT,
 * QUOTA_EXHAUSTED). Honors `Retry-After` hints if the adapter surfaces
 * them through the `retryAfterMs` field on the classification.
 *
 * `QUOTA_EXHAUSTED` retry-after hints are only honored up to `MAX_QUOTA_WAIT_MS`;
 * past that cap the adapter gives up immediately rather than blocking the caller.
 */

import type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';
import type { ChatMessageType } from '../entities/adapter/ChatMessage.js';

import { BaseAdapterCore, type BaseAdapterCoreOptionsType } from './BaseAdapterCore.js';
import type { AdapterCapabilitiesType, ChatRequestType, ChatResponseType } from './LlmAdapter.js';
import { LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';

export abstract class BaseAdapter extends BaseAdapterCore implements LlmAdapterInterface {
  readonly capabilities: AdapterCapabilitiesType;

  /**
   * Format a `tool`-role message as the conversational line every text-only
   * adapter feeds back into the next turn: `[tool <name> result] <content>`.
   *
   * Adapters whose provider has no native tool-result channel (gemini-nano,
   * web-llm) flatten tool results into the prompt; this static is the single
   * source of that string so the format never drifts between them. A blank
   * `toolName` falls back to `unknown`.
   */
  static formatToolResult(message: Extract<ChatMessageType, { 'role': 'tool' }>): string {
    const toolName = message.toolName.length > 0 ? message.toolName : 'unknown';
    return `[tool ${toolName} result] ${message.content}`;
  }

  protected constructor(
    id: string,
    displayName: string,
    capabilities: AdapterCapabilitiesType,
    options: BaseAdapterCoreOptionsType = {},
  ) {
    super(id, displayName, options);
    this.capabilities = capabilities;
  }

  async chat(request: ChatRequestType): Promise<ChatResponseType> {
    return this.retryPolicy.run(async () => {
      try {
        return await this.performChat(request);
      } catch (rawError) {
        const classification = this.classify(rawError);
        // QUOTA_EXHAUSTED: honor retry-after hint only when short; cap prevents
        // indefinitely-long waits when providers return aggressive Retry-After values.
        if (
          classification.reason === 'QUOTA_EXHAUSTED'
          && classification.retryable
          && classification.retryAfterMs !== null
          && classification.retryAfterMs > MAX_QUOTA_WAIT_MS
        ) {
          throw new LlmError(
            `quota exhausted; retry-after ${String(classification.retryAfterMs)}ms exceeds ${String(MAX_QUOTA_WAIT_MS)}ms cap`,
            { ...classification, 'retryable': false },
            { 'cause': rawError },
          );
        }
        // Rethrow as LlmError; RetryableErrorPolicy retries only when the
        // classification is retryable.
        throw new LlmError(LlmError.messageFrom(rawError), classification, { 'cause': rawError });
      }
    }, { 'signal': request.signal });
  }

  /** Concrete adapter: perform the actual API call. */
  protected abstract performChat(request: ChatRequestType): Promise<ChatResponseType>;
}
