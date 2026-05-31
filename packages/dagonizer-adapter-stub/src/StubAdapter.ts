/**
 * StubAdapter: offline canned-response adapter and test-fixture primitives.
 *
 * Two roles:
 *
 *   1. Production fallback: returns `defaultResponse` (or a per-request
 *      `respond()` subclass override) when no real model is attached.
 *   2. Test fixture: records every request, drains a pre-seeded response
 *      queue, and injects errors on demand. Every downstream consumer of
 *      `LlmAdapter` ends up needing these primitives in tests; keeping
 *      them in the upstream stub avoids per-project wrapper drift.
 *
 * Extension surface for production stubs (e.g. Archivist's
 * `ArchivistStub`) is unchanged; subclass and override
 * `performChat(request)` for full control, or `respond(request)` for the
 * simple text path. Queue + invocations + error injection are additive.
 */

import { BaseAdapter, ZERO_TOKEN_USAGE } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';

export interface StubAdapterOptions {
  /** Per-prompt response. Defaults to a generic placeholder. */
  readonly defaultResponse?: string;
  readonly maxAttempts?: number;
  /**
   * Pre-seeded response queue. Drained in arrival order; falls back to
   * `respond()` / `defaultResponse` when empty. Useful for retry loops
   * and multi-turn refinement tests.
   */
  readonly responses?: readonly string[];
  /**
   * Pre-seeded error. The first `chat()` call throws this and then
   * clears it. Pass an `LlmError` to control BaseAdapter's retry
   * classification; pass a plain `Error` for a UNKNOWN failure.
   */
  readonly error?: Error;
}

export class StubAdapter extends BaseAdapter {
  readonly #defaultResponse: string;
  readonly #queue: string[];
  readonly #invocations: ChatRequest[] = [];
  #error: Error | undefined;

  constructor(options: StubAdapterOptions = {}) {
    super(
      'stub',
      'Canned responses (no real LLM)',
      // The default declares 'none' so consumers know there's no real
      // intelligence behind the responses. Subclasses that emit
      // structured tool calls or JSON re-declare via their super() call.
      { 'toolUse': 'none', 'structuredOutput': false, 'jsonMode': false },
      { 'maxAttempts': options.maxAttempts ?? 1 },
    );
    this.#defaultResponse = options.defaultResponse ?? '(stub adapter: no model attached)';
    this.#queue = options.responses === undefined ? [] : [...options.responses];
    this.#error = options.error;
  }

  /** Snapshot of every ChatRequest seen via `chat()`, in arrival order. */
  get invocations(): readonly ChatRequest[] {
    return this.#invocations;
  }

  /** Push a response onto the queue. Drained on subsequent `chat()` calls. */
  enqueueResponse(text: string): void {
    this.#queue.push(text);
  }

  /**
   * Make the next `chat()` throw the supplied error. Pass `undefined` to
   * clear without throwing. The error is cleared after one throw; call
   * again to re-arm.
   */
  setError(err: Error | undefined): void {
    this.#error = err;
  }

  /** Reset invocations, queue, and pending error. Test isolation helper. */
  clear(): void {
    this.#invocations.length = 0;
    this.#queue.length = 0;
    this.#error = undefined;
  }

  /**
   * Stub adapter never wins a cascade. Probe always returns false so
   * the stub is opt-in only; consumers must construct and inject it
   * explicitly. A cascade with nothing else available fails loud
   * rather than silently degrading to canned responses.
   */
  override async probe(): Promise<boolean> {
    return Promise.resolve(false);
  }

  override async chat(request: ChatRequest): Promise<ChatResponse> {
    // Record once per logical chat() call (before BaseAdapter's retry
    // loop). Subclasses that need per-retry recording can override
    // performChat directly.
    this.#invocations.push(request);
    return super.chat(request);
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    // 1. Error injection: one-shot. Re-arm via setError().
    if (this.#error !== undefined) {
      const err = this.#error;
      this.#error = undefined;
      throw err;
    }

    // 2. Queued response: drains in FIFO order.
    if (this.#queue.length > 0) {
      const text = this.#queue.shift() as string;
      return Promise.resolve({
        'message': { 'kind': 'text', 'content': text },
        'finishReason': 'stop',
        'usage': ZERO_TOKEN_USAGE,
      });
    }

    // 3. Fallback to subclass override or defaultResponse.
    return Promise.resolve({
      'message': { 'kind': 'text', 'content': this.respond(request) },
      'finishReason': 'stop',
      'usage': ZERO_TOKEN_USAGE,
    });
  }

  /**
   * Compose the response text. Override in subclasses to inject domain-
   * specific behaviour (pattern-matching prompts, looking up data,
   * etc.). The default returns the configured `defaultResponse`.
   *
   * The queue takes precedence over this hook; when both are set, the
   * queue drains first. Once empty, `respond()` is consulted.
   */
  protected respond(_request: ChatRequest): string {
    return this.#defaultResponse;
  }
}
