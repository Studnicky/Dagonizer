/**
 * AdapterBase: shared lifecycle foundation for `BaseAdapter` and
 * `BaseEmbedder`.
 *
 * Owns the retry plumbing (`RetryableErrorPolicy` with exponential
 * backoff), the identity fields (`id`, `displayName`), the default
 * lifecycle methods (`connect`/`disconnect`/`probe`), and the default
 * `classify()` implementation. Child classes add only the concerns
 * specific to their surface:
 *
 *   AdapterBase ─── BaseAdapter  → capabilities + chat() / performChat()
 *               └── BaseEmbedder → dimensions  + embed() / performEmbed()
 *
 * Constants and the shared options type live here so both subtypes
 * consume a single canonical name with a single canonical value.
 */

import type { AbortableOptionsInterface } from '../contracts/AbortableOptionsInterface.js';
import { BackoffStrategy } from '../runtime/index.js';

import { Classifications, LlmError, type ErrorClassification } from './LlmError.js';
import { RetryableErrorPolicy } from './RetryableErrorPolicy.js';

/** Canonical default: attempts before giving up (adapter + embedder). */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Canonical default: first retry delay in ms (adapter + embedder). */
export const DEFAULT_BASE_DELAY_MS = 400;

/** Partial options accepted by any `AdapterBase` subclass constructor. */
export interface AdapterBaseOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
}

/** Fully-resolved `AdapterBaseOptions` with no optional fields. */
export interface AdapterBaseOptionsResolved {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
}

export abstract class AdapterBase {
  readonly id: string;
  readonly displayName: string;
  readonly #retry: RetryableErrorPolicy;

  /**
   * Returns a fully-resolved options object. Subclasses that receive a
   * partial `options` from their own callers spread this as a base so
   * the object handed to `super()` is always complete:
   *
   *   super(id, name, { ...AdapterBase.defaultOptions(), ...options });
   */
  static defaultOptions(): AdapterBaseOptionsResolved {
    return { 'maxAttempts': DEFAULT_MAX_ATTEMPTS, 'baseDelayMs': DEFAULT_BASE_DELAY_MS };
  }

  protected constructor(id: string, displayName: string, options: AdapterBaseOptions = {}) {
    this.id = id;
    this.displayName = displayName;
    this.#retry = new RetryableErrorPolicy({
      'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      'strategy':    BackoffStrategy.EXPONENTIAL,
      'baseDelay':   options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    });
  }

  /** No-op default. Subclasses with a session lifecycle override. */
  async connect(_options?: AbortableOptionsInterface): Promise<void> {
    return Promise.resolve();
  }

  /** No-op default. Subclasses with a session lifecycle override. */
  async disconnect(_options?: AbortableOptionsInterface): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Default availability probe. Returns true; the adapter assumes it
   * can run unless the concrete subclass knows better. Implementations
   * MUST NOT throw; return false instead.
   */
  async probe(_options?: AbortableOptionsInterface): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Map a provider-native error into the shared classification. */
  protected classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    return Classifications['UNKNOWN'];
  }

  /** Expose the retry policy to subclasses for envelope execution. */
  protected get retryPolicy(): RetryableErrorPolicy {
    return this.#retry;
  }
}
