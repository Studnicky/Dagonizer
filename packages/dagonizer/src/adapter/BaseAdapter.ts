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

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';
import type { ChatMessageType } from '../entities/adapter/ChatMessage.js';
import type { LlmModelType } from '../entities/adapter/LlmModel.js';

import { BaseAdapterCore, type BaseAdapterCoreOptionsType, type SelectModelOptionsType } from './BaseAdapterCore.js';
import type { AdapterCapabilitiesType, ChatRequestType, ChatResponseType } from './LlmAdapter.js';
import { LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';
import { ModelCost } from './ModelCost.js';

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

  /**
   * Return available model descriptors for this provider.
   *
   * Default: returns an empty array when no model was set at construction,
   * or a single `{ name, variant: 'chat', cloud: false }` descriptor when
   * the constructor `model` option was provided. Concrete subclasses that
   * can enumerate provider models override this method.
   */
  async listModels(options?: AbortableOptionsType): Promise<readonly LlmModelType[]> {
    void options;
    try {
      const name = this.model;
      return [{ 'name': name, 'variant': 'chat', 'cloud': false, 'costRank': ModelCost.rankFromName(name) }];
    } catch {
      return [];
    }
  }

  /**
   * Discover the live model catalogue via `listModels()`, pick the best chat
   * model, set it as the active model, and return its name (or `null` when no
   * model can be resolved). The adapter's configured model acts as the implicit
   * discovery *preference*: the selection is always gated on the provider's
   * dynamic response, but a curated default is honored when the provider still
   * serves it. Selection rules:
   *   1. Compute the preference: explicit `options.preferred`, else the
   *      configured model (`modelOrEmpty`).
   *   2. If discovery returns no chat models (endpoint unreachable, CORS-blocked,
   *      or empty), trust the configured default when present — but never
   *      substitute an unconfirmed explicit `options.preferred`; return `null`
   *      so the caller can route around an unusable backend.
   *   3. If the preference is in the live catalogue, pick it.
   *   4. Else pick the cheapest available chat model — the one with the
   *      lowest `costRank` (ties resolve to the earliest in the catalogue).
   *   5. Return `null` when the catalogue contains no chat models.
   */
  async selectChatModel(options: SelectModelOptionsType = {}): Promise<string | null> {
    const models = await this.listModels();
    // A chat-capable model is anything that is not an embedder: 'chat' or the
    // provider-unclassified 'unknown' variant both route to chat.
    const chatModels = models.filter((m) => m.variant !== 'embedding');
    const configuredDefault = this.modelOrEmpty;
    const preferred = options.preferred ?? configuredDefault;
    if (chatModels.length === 0) {
      // Discovery yielded nothing — the provider's models endpoint is
      // unreachable, CORS-blocked, or empty. Fall back to the adapter's own
      // configured default so a working chat key is not stranded; an explicit
      // caller preference is not a substitute for catalogue confirmation.
      return options.preferred === undefined && configuredDefault.length > 0
        ? configuredDefault
        : null;
    }
    let selected: LlmModelType | undefined;
    if (preferred.length > 0) {
      selected = chatModels.find((m) => m.name === preferred);
    }
    if (selected === undefined) {
      // Configured default absent from the live catalogue: fall back to the
      // cheapest available chat model by `costRank` (each adapter populates
      // it from its best cost signal). `chatModels` is non-empty here.
      selected = chatModels.reduce((cheapest, m) => (m.costRank < cheapest.costRank ? m : cheapest));
    }
    if (selected === undefined) return null;
    this.setModel(selected.name);
    return selected.name;
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
