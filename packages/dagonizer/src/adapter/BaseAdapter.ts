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
 *
 * Circuit breaking and rate limiting are opt-in, per-instance capabilities
 * layered around `chat()`. Both wrap OUTSIDE the retry loop — the circuit
 * breaker outermost, the token bucket immediately inside it, the retry-wrapped
 * attempt innermost — so an open circuit or an exhausted bucket fails a call
 * once, instantly, without burning retry attempts or backoff delays. A
 * consumer supplies real `@studnicky/resilience` `CircuitBreaker`/`TokenBucket`
 * instances via the constructor options; `null` (the default for both) means
 * the capability is disabled and `chat()` behaves exactly as it did before.
 */

import type { CircuitBreaker, TokenBucket } from '@studnicky/resilience';

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { LlmAdapterInterface } from '../contracts/LlmAdapterInterface.js';
import type { StreamSinkInterface } from '../contracts/StreamSinkInterface.js';
import type { ChatMessageType } from '../entities/adapter/ChatMessage.js';
import { ChatStreamChunkBuilder } from '../entities/adapter/ChatStreamChunk.js';
import type { ChatStreamChunkType } from '../entities/adapter/ChatStreamChunk.js';
import type { LlmModelType } from '../entities/adapter/LlmModel.js';

import { BaseAdapterCore, type BaseAdapterCoreOptionsType, type SelectModelOptionsType } from './BaseAdapterCore.js';
import type { AdapterCapabilitiesType, ChatRequestType, ChatResponseType } from './LlmAdapter.js';
import { Classifications, LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';
import { ModelCost } from './ModelCost.js';

/**
 * Canonical default per-request hard abort+timeout ceiling in ms. Adapters use
 * this value unless the constructor `timeoutMs` option overrides it.
 */
export const DEFAULT_CHAT_TIMEOUT_MS = 60_000;

/**
 * Caller-facing options for every chat adapter. Extends the shared core options
 * with `systemPrompt`: a default system message the base injects as the leading
 * turn of any chat request that carries no system message of its own. The text
 * is consumer-supplied (the engine owns no persona), so adapters stay backend
 * plumbing while a consumer configures role/format/language framing once at
 * construction. Empty string (the default) means no injection.
 */
export type BaseAdapterOptionsType = BaseAdapterCoreOptionsType & {
  readonly systemPrompt?: string;
  /**
   * Per-request hard abort+timeout ceiling in ms. Defaults to
   * `DEFAULT_CHAT_TIMEOUT_MS`. Even an adapter whose underlying operation never
   * settles rejects within this ceiling.
   */
  readonly timeoutMs?: number;
  /**
   * Circuit breaker guarding `chat()`. Wraps the entire retry-wrapped attempt
   * (outermost), so a tripped circuit rejects a call with
   * `CircuitBreakerOpenError` instantly — no attempt is made, no retry
   * budget is spent. `null` (the default) disables circuit breaking.
   */
  readonly circuitBreaker?: CircuitBreaker | null;
  /**
   * Token bucket rate limiter guarding `chat()`. Consumes exactly one token
   * per logical `chat()` call — not once per retry attempt — immediately
   * before the retry-wrapped attempt runs; an exhausted bucket throws
   * `TokenBucketExhaustedError` and the call fails fast without entering the
   * retry loop. `null` (the default) disables rate limiting.
   */
  readonly tokenBucket?: TokenBucket | null;
};

export abstract class BaseAdapter extends BaseAdapterCore implements LlmAdapterInterface {
  readonly capabilities: AdapterCapabilitiesType;
  /** Consumer-configured default system prompt; `''` when none was set. */
  readonly #systemPrompt: string;
  readonly #timeoutMs: number;
  /** Circuit breaker guarding `chat()`; `null` when circuit breaking is disabled. */
  readonly #circuitBreaker: CircuitBreaker | null;
  /** Token bucket rate limiter guarding `chat()`; `null` when rate limiting is disabled. */
  readonly #tokenBucket: TokenBucket | null;

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
    options: BaseAdapterOptionsType = {},
  ) {
    super(id, displayName, options);
    this.capabilities = capabilities;
    this.#systemPrompt = options.systemPrompt ?? '';
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS;
    this.#circuitBreaker = options.circuitBreaker ?? null;
    this.#tokenBucket = options.tokenBucket ?? null;
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
   *      lowest `costRank` (ties resolve to the earliest in the catalogue) —
   *      preferring fully-local models: a cloud-routed model (e.g. Ollama's
   *      `:cloud`/`-cloud` tags) needs a provider subscription and fails
   *      without one, so cloud models are only auto-selected when no local
   *      chat model is available. An explicit in-catalogue `preferred` at
   *      step 3 still wins, cloud or not.
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
      // it from its best cost signal). Prefer fully-local models — a
      // cloud-routed model needs a provider subscription and fails without
      // one, so it is chosen only when no local chat model exists. Both
      // `chatModels` and the derived pool are non-empty here.
      const localChatModels = chatModels.filter((m) => !m.cloud);
      const pool = localChatModels.length > 0 ? localChatModels : chatModels;
      selected = pool.reduce((cheapest, m) => (m.costRank < cheapest.costRank ? m : cheapest));
    }
    if (selected === undefined) return null;
    this.setModel(selected.name);
    return selected.name;
  }

  /**
   * Best-effort cooperative cancellation hook. Invoked by the shared
   * abort+timeout guard the instant the request's deadline elapses or the
   * external signal aborts, BEFORE the guard rejects. The default is a no-op;
   * subclasses whose backend exposes a cooperative interrupt (e.g. an
   * in-browser engine's `interruptGenerate()`) override this to ask the
   * backend to stop. Correctness — the caller's promise always rejecting —
   * does not depend on this hook; it is a best-effort courtesy. Must not throw
   * and must not block; the guard swallows any error it raises.
   */
  protected onCancelRequested(): void {
    // no-op default — subclasses override to cooperatively interrupt their backend
  }

  async chat(request: ChatRequestType): Promise<ChatResponseType> {
    const prepared = this.#withDefaultSystemPrompt(request);
    const attempt = async (): Promise<ChatResponseType> => this.retryPolicy.run(async () => {
      try {
        return await this.#guardChat(prepared);
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
    }, { 'signal': prepared.signal });
    return this.#guardResilience(attempt);
  }

  /**
   * Layer the configured circuit breaker and token bucket around `run` —
   * the entire retry-wrapped `chat()` attempt. Circuit breaker outermost: an
   * open circuit rejects with `CircuitBreakerOpenError` before the token
   * bucket is even consulted, so a call that is about to fail fast does not
   * also spend a rate-limit token. Token bucket next: `consume()` throws
   * `TokenBucketExhaustedError` immediately when no token is available,
   * again before `run` (and therefore before any retry attempt) executes.
   * Both errors propagate as their own `@studnicky/resilience` type — no
   * Dagonizer wrapping — since neither is a provider-native chat failure.
   * Either or both guards are skipped entirely when their configured
   * instance is `null`.
   */
  async #guardResilience(run: () => Promise<ChatResponseType>): Promise<ChatResponseType> {
    const throttled = async (): Promise<ChatResponseType> => {
      if (this.#tokenBucket !== null) this.#tokenBucket.consume();
      return run();
    };
    if (this.#circuitBreaker !== null) return this.#circuitBreaker.execute(throttled);
    return throttled();
  }

  /**
   * Stream a chat request. Streaming is single-attempt: NOT wrapped in
   * retryPolicy. Retrying a partially-emitted stream would re-push deltas
   * already delivered to the sink, so a mid-stream failure surfaces to the
   * caller rather than silently replaying. The system-prompt injection that
   * `chat()` performs is applied identically here so buffered and streamed
   * paths behave the same.
   *
   * The full call — including every `performChatStream` override — is
   * bounded by the same abort+timeout deadline `chat()` uses, so a hung
   * stream still settles within `this.#timeoutMs`.
   *
   * Sink delivery is best-effort: a rejecting `sink.push()` never fails the
   * call (see `pushChunk`). The resolved `ChatResponseType` is authoritative
   * regardless of sink health.
   */
  async chatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    const prepared = this.#withDefaultSystemPrompt(request);
    return this.withDeadline(prepared, (derived) => this.performChatStream(derived, sink));
  }

  /**
   * Buffered default streaming implementation: perform ONE full chat call
   * through the same guarded/classified path `chat()` uses, push a single
   * chunk carrying the complete response text, and return the assembled
   * response. `content` is empty for a pure tool-call response, so the
   * emitted chunk carries `''` in that case (no text was produced).
   *
   * Concrete streaming adapters override this to emit real per-token deltas
   * while assembling the same `ChatResponseType` to return. Overrides MUST
   * remain single-attempt (no retry) for the same reason `chatStream` is not
   * retry-wrapped.
   */
  protected async performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    // `this.chat()` re-applies the (idempotent) default-system-prompt step;
    // applying it twice is a no-op, so the buffered path reuses chat()'s full
    // guard/timeout/classify + retry envelope unchanged.
    const response = await this.chat(request);
    const fullText = response.message.variant === 'tools' ? '' : response.message.content;
    await this.pushChunk(sink, ChatStreamChunkBuilder.of(fullText));
    return response;
  }

  /**
   * Push one chunk to `sink`, swallowing a rejection. `sink` is a best-effort
   * observability side-channel: a dead or misbehaving consumer must not fail
   * an otherwise-valid generation. Back-pressure is preserved for a healthy
   * sink — its `push()` is still awaited normally; only a REJECTION is
   * swallowed.
   */
  protected async pushChunk(
    sink: StreamSinkInterface<ChatStreamChunkType>,
    chunk: ChatStreamChunkType,
  ): Promise<void> {
    try {
      await sink.push(chunk);
    } catch {
      // sink is a best-effort observability side-channel; a dead consumer must not fail a valid generation
    }
  }

  /**
   * Wrap `run` in a hard abort+timeout race so the caller's promise always
   * settles. A per-request timeout and the caller's external signal are
   * folded into one composed signal that is threaded into the derived
   * request `run` receives (so an adapter that forwards `request.signal` to
   * `fetch` aborts naturally). The race rejects the instant that composed
   * signal aborts — even if the underlying operation never settles (a hung
   * socket, a frozen on-device stream) — after giving the subclass one
   * best-effort `onCancelRequested()` call. The timer is always cleared.
   *
   * Shared by `chat()` (via `#guardChat`) and `chatStream()` so every
   * `performChat`/`performChatStream` override — including every concrete
   * adapter's streaming override — settles within `this.#timeoutMs`.
   */
  protected async withDeadline<T>(
    request: ChatRequestType,
    run: (derived: ChatRequestType) => Promise<T>,
  ): Promise<T> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new LlmError(`${this.id} request timeout`, Classifications['TIMEOUT']));
    }, this.#timeoutMs);
    const composed = AbortSignal.any([request.signal, timeoutController.signal]);
    const derived: ChatRequestType = { ...request, 'signal': composed };
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const settleReject = (reason: unknown): void => {
          if (settled) return;
          settled = true;
          reject(reason instanceof Error ? reason : new LlmError(String(reason), Classifications['TIMEOUT']));
        };
        const onAbort = (): void => {
          try {
            this.onCancelRequested();
          } catch {
            // best-effort cooperative cancel; correctness comes from the reject below
          }
          settleReject(composed.reason);
        };
        if (composed.aborted) {
          onAbort();
          return;
        }
        composed.addEventListener('abort', onAbort, { 'once': true });
        Promise.resolve(run(derived)).then(
          (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
          },
          (error: unknown) => {
            settleReject(error);
          },
        );
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Wrap `performChat` in the shared abort+timeout race via `withDeadline`.
   */
  async #guardChat(request: ChatRequestType): Promise<ChatResponseType> {
    return this.withDeadline(request, (derived) => this.performChat(derived));
  }

  /**
   * Prepend the configured default system prompt as the leading message when
   * the request carries no system message of its own. Returns the request
   * unchanged when no default is configured (`''`) or the consumer already
   * supplied a system turn — never overrides an explicit system message, and
   * never produces a second system turn. The leading position matters: the
   * on-device backends (Chrome Prompt API, MLC WebLLM) reject a system message
   * at any non-zero index. Pure: builds a new request, mutates nothing.
   */
  #withDefaultSystemPrompt(request: ChatRequestType): ChatRequestType {
    if (this.#systemPrompt === '') return request;
    if (request.messages.some((m) => m.role === 'system')) return request;
    const system: ChatMessageType = { 'role': 'system', 'content': this.#systemPrompt };
    return { ...request, 'messages': [system, ...request.messages] };
  }

  /** Concrete adapter: perform the actual API call. */
  protected abstract performChat(request: ChatRequestType): Promise<ChatResponseType>;
}
