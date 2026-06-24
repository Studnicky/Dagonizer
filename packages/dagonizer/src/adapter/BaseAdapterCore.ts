/**
 * BaseAdapterCore: shared lifecycle foundation for `BaseAdapter` and
 * `BaseEmbedder`.
 *
 * Owns the retry plumbing (`RetryableErrorPolicy` with exponential
 * backoff), the identity fields (`id`, `displayName`), the default
 * lifecycle methods (`connect`/`disconnect`/`probe`), and the default
 * `classify()` implementation. Child classes add only the concerns
 * specific to their surface:
 *
 *   BaseAdapterCore ─── BaseAdapter  → capabilities + chat() / performChat()
 *                   └── BaseEmbedder → dimensions  + embed() / performEmbed()
 *
 * Constants and the shared options type live here so both subtypes
 * consume a single canonical name with a single canonical value.
 */

import { BackoffStrategyNames } from '../entities/runtime/BackoffStrategy.js';

import { Classifications, LlmError, type ErrorClassificationType } from './LlmError.js';
import { RetryableErrorPolicy } from './RetryableErrorPolicy.js';

/** Options for model selection in `selectChatModel` and `selectEmbeddingModel`. */
export type SelectModelOptionsType = {
  /** Prefer this model name from the catalogue; falls back to the cheapest available if absent. */
  readonly preferred?: string;
}

/** Canonical default: attempts before giving up (adapter + embedder). */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Canonical default: first retry delay in ms (adapter + embedder). */
export const DEFAULT_BASE_DELAY_MS = 400;

/** Fully-resolved options for `BaseAdapterCore` — no optional fields. */
export type BaseAdapterCoreOptionsResolvedType = {
  maxAttempts: number;
  baseDelayMs: number;
}

/**
 * Caller-facing options. Subclasses expose this (or an extension of it)
 * to their own callers; every field falls back to `defaultOptions()`
 * when omitted, so the base materialises a complete value in one place.
 */
export type BaseAdapterCoreOptionsType = {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Fixed model name. When set, `model` getter returns it immediately; `listModels()` seeds a single descriptor. */
  readonly model?: string;
}

export abstract class BaseAdapterCore {
  readonly id: string;
  readonly displayName: string;
  readonly #retry: RetryableErrorPolicy;
  #model: string | null;

  /**
   * The canonical default options. Subclasses do not need to spread this
   * themselves — the base constructor folds caller-supplied partials over
   * it — but it is exposed for callers that want the default values.
   */
  static defaultOptions(): BaseAdapterCoreOptionsResolvedType {
    return { 'maxAttempts': DEFAULT_MAX_ATTEMPTS, 'baseDelayMs': DEFAULT_BASE_DELAY_MS };
  }

  protected constructor(id: string, displayName: string, options: BaseAdapterCoreOptionsType = {}) {
    const resolved: BaseAdapterCoreOptionsResolvedType = { ...BaseAdapterCore.defaultOptions(), ...options };
    this.id = id;
    this.displayName = displayName;
    this.#retry = RetryableErrorPolicy.from({
      'maxAttempts': resolved.maxAttempts,
      'strategy':    BackoffStrategyNames.EXPONENTIAL,
      'baseDelay':   resolved.baseDelayMs,
    });
    this.#model = options.model ?? null;
  }

  /**
   * The currently selected model name. Throws `MODEL_NOT_FOUND` when no
   * model has been set at construction or via `selectChatModel` /
   * `selectEmbeddingModel`. Access only after selection.
   */
  protected get model(): string {
    if (this.#model === null) {
      throw new LlmError('No model selected. Call selectChatModel or selectEmbeddingModel first, or pass model at construction.', Classifications['MODEL_NOT_FOUND']);
    }
    return this.#model;
  }

  /** Set the active model. Called by `selectChatModel` / `selectEmbeddingModel` after picking. */
  protected setModel(name: string): void {
    this.#model = name;
  }

  /**
   * The selected model name, or `''` when none is set. Use inside
   * `listModels()` implementations that need to read the current selection
   * without triggering the `model` getter's `MODEL_NOT_FOUND` throw.
   */
  protected get modelOrEmpty(): string {
    return this.#model ?? '';
  }

  /** No-op default. Subclasses with a session lifecycle override. */
  async connect(): Promise<void> {
    return Promise.resolve();
  }

  /** No-op default. Subclasses with a session lifecycle override. */
  async disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Default availability probe. Returns true; the adapter assumes it
   * can run unless the concrete subclass knows better. Implementations
   * MUST NOT throw; return false instead.
   */
  async probe(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Map a provider-native error into the shared classification.
   *
   * Handles the two branches every adapter shares: an `LlmError` already
   * carries its classification, and an abort/timeout `Error` message maps to
   * `TIMEOUT`. Provider-specific subclasses add only their own branch (e.g.
   * `MODEL_NOT_FOUND`) and then delegate to `super.classify` for these shared
   * cases and the `UNKNOWN` fallback.
   */
  protected classify(error: unknown): ErrorClassificationType {
    if (error instanceof LlmError) return error.classification;
    if (error instanceof Error && /aborted|timeout/iu.test(error.message)) return Classifications['TIMEOUT'];
    return Classifications['UNKNOWN'];
  }

  /** Expose the retry policy to subclasses for envelope execution. */
  protected get retryPolicy(): RetryableErrorPolicy {
    return this.#retry;
  }
}
