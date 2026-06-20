/**
 * BaseEmbedder: abstract base every concrete embedder extends.
 *
 * Extends `BaseAdapterCore` for shared lifecycle (retry policy,
 * `connect`/`disconnect`/`probe`, `classify`) and adds only what is
 * unique to the embedding surface: `dimensions` and the `embed()` /
 * `embedBatch()` envelope that calls the abstract `performEmbed()`.
 *
 *   EmbedderInterface contract → BaseEmbedder ┐
 *                                    ├─ embed() → retry-wrapped performEmbed()
 *                                    └─ classify(err) returns retryable/non-retryable
 *
 * The retry wrapper rethrows non-retryable errors immediately and
 * loops with exponential backoff for retryable ones (NETWORK, TIMEOUT,
 * QUOTA_EXHAUSTED). Default `embedBatch()` calls `embed()` in series;
 * adapters with native batch endpoints override.
 *
 * Mirrors `BaseAdapter` symbol-for-symbol so the cascade plumbing and
 * the error taxonomy stay shared across the two surfaces.
 */

import type { AbortableOptionsType } from '../contracts/AbortableOptionsType.js';
import type { EmbedderInterface } from '../contracts/EmbedderInterface.js';
import type { LlmModelType } from '../entities/adapter/LlmModel.js';
import { SignalComposer } from '../runtime/SignalComposer.js';

import { BaseAdapterCore, type BaseAdapterCoreOptionsType, type SelectModelOptionsType } from './BaseAdapterCore.js';
import { LlmError, MAX_QUOTA_WAIT_MS } from './LlmError.js';

/**
 * Caller-facing options shared by every concrete embedder.
 *
 * Extends `BaseAdapterCoreOptionsType` (retry tuning) with the two fields every
 * embedder exposes: `model` and `dimensions`. Both are caller overrides — the
 * concrete embedder owns the provider-specific default and materialises a
 * complete value by spreading its own `DEFAULTS` over the caller partial, so
 * the base never needs a default for either. A concrete embedder extends this
 * interface and adds only its own extras.
 */
export type BaseEmbedderOptionsType = BaseAdapterCoreOptionsType & {
  /** Override the embedding model. The concrete embedder supplies the default. */
  readonly model?: string;
  /** Override the output dimensionality. The concrete embedder supplies the default. */
  readonly dimensions?: number;
}

export abstract class BaseEmbedder extends BaseAdapterCore implements EmbedderInterface {
  readonly dimensions: number;

  protected constructor(
    id: string,
    displayName: string,
    dimensions: number,
    options: BaseAdapterCoreOptionsType = {},
  ) {
    super(id, displayName, options);
    this.dimensions = dimensions;
  }

  /**
   * Return available model descriptors for this provider.
   *
   * Default: returns an empty array when no model was set at construction,
   * or a single `{ name, variant: 'embedding', cloud: false }` descriptor
   * when the constructor `model` option was provided. Concrete subclasses
   * that can enumerate provider models override this method.
   */
  async listModels(): Promise<readonly LlmModelType[]> {
    try {
      const name = this.model;
      return [{ 'name': name, 'variant': 'embedding', 'cloud': false }];
    } catch {
      return [];
    }
  }

  /**
   * Select the best embedding model from `listModels()` and set it as the
   * active model. Returns the selected model name, or `null` when no
   * embedding model is available. Selection rules:
   *   1. If `options.preferred` is in the embedding catalogue, pick it.
   *   2. Else pick the first embedding model (local preferred).
   *   3. Return `null` when the catalogue contains no embedding models.
   */
  async selectEmbeddingModel(options: SelectModelOptionsType = {}): Promise<string | null> {
    const models = await this.listModels();
    const embedModels = models.filter((m) => m.variant === 'embedding');
    if (embedModels.length === 0) return null;
    let selected: LlmModelType | undefined;
    if (options.preferred !== undefined) {
      selected = embedModels.find((m) => m.name === options.preferred);
    }
    if (selected === undefined) {
      selected = embedModels.find((m) => !m.cloud) ?? embedModels[0];
    }
    if (selected === undefined) return null;
    this.setModel(selected.name);
    return selected.name;
  }

  async embed(text: string, options?: AbortableOptionsType): Promise<readonly number[]> {
    const signal = options?.signal ?? SignalComposer.never();
    return this.retryPolicy.run(async () => {
      try {
        return await this.performEmbed(text, signal);
      } catch (rawError) {
        // Already classified by performEmbed; don't double-wrap. Apply the
        // quota cap, then rethrow as-is.
        if (rawError instanceof LlmError) {
          const c = rawError.classification;
          if (c.reason === 'QUOTA_EXHAUSTED' && c.retryable && c.retryAfterMs !== null && c.retryAfterMs > MAX_QUOTA_WAIT_MS) {
            throw new LlmError(
              `quota exhausted; retry-after ${String(c.retryAfterMs)}ms exceeds ${String(MAX_QUOTA_WAIT_MS)}ms cap`,
              { ...c, 'retryable': false },
              { 'cause': rawError },
            );
          }
          throw rawError;
        }
        throw new LlmError(LlmError.messageFrom(rawError), this.classify(rawError), { 'cause': rawError });
      }
    }, { signal });
  }

  /**
   * Default batch implementation: serial iteration over `embed()`. Adapters whose
   * provider exposes a native batch endpoint override and post one
   * request for the whole batch.
   */
  async embedBatch(texts: readonly string[], options?: AbortableOptionsType): Promise<readonly (readonly number[])[]> {
    const results: (readonly number[])[] = [];
    for (const t of texts) {
      results.push(await this.embed(t, options));
    }
    return results;
  }

  /**
   * Fetch a JSON body at the embedder's HTTP boundary. Wraps `fetch`,
   * re-throwing a `fetch()` rejection as a NETWORK-classified `LlmError`,
   * classifying a non-ok response via `LlmError.classifyHttp`, and
   * returning the parsed body typed `unknown`. The caller validates the
   * `unknown` against its own provider schema before typed access — this
   * method never casts the body to a wire type. `signal` is threaded
   * explicitly into `fetch` so caller aborts propagate.
   */
  protected async fetchJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (err) {
      throw LlmError.ofNetworkError(err);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.displayName} ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }
    const body: unknown = await res.json();
    return body;
  }

  /** Concrete embedder: perform the actual API call. `signal` is always a valid AbortSignal. */
  protected abstract performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]>;
}
