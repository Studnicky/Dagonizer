/**
 * LocalModelEmbedder: abstract intermediate base for on-device embedders.
 *
 * Centralizes the lifecycle every on-device embedder duplicates: load a
 * foreign module, build a model/extractor/engine handle from it, memoize
 * the handle for the embedder's lifetime, and reset the memoization on
 * `disconnect()`.
 *
 *   BaseEmbedder ─── LocalModelEmbedder<TModule, TModel>
 *                       ├─ connect()/disconnect() → memoized loadModule()+spawnModel()
 *                       └─ performEmbed() → embedWith(model, text, signal)
 *
 * Concrete subclasses implement only `loadModule()` (import + validate the
 * foreign library), `spawnModel()` (construct the extractor/model/engine
 * handle), and `embedWith()` (run the embedding against that handle).
 */

import { BaseEmbedder, type BaseEmbedderOptionsType } from './BaseEmbedder.js';

export abstract class LocalModelEmbedder<TModule, TModel> extends BaseEmbedder {
  readonly #moduleUrl: string;
  readonly #ensureModel: () => Promise<TModel>;
  readonly #resetModel: () => void;

  protected constructor(
    id: string,
    displayName: string,
    dimensions: number,
    moduleUrl: string,
    options: BaseEmbedderOptionsType = {},
  ) {
    super(id, displayName, dimensions, options);
    this.#moduleUrl = moduleUrl;

    // Memoization state lives in a CONSTRUCTOR-LOCAL CLOSURE VARIABLE, not an
    // object property. The two instance fields below are always assigned
    // exactly once, to a stable function reference, for the lifetime of the
    // instance — the declared field TYPE never changes, so V8 hidden-class
    // shape stays fixed. This sidesteps both the `T | null` property-flip
    // anti-pattern AND the awkwardness of a module-level
    // `WeakMap<LocalModelEmbedder<TModule, TModel>, ...>` (whose generic
    // parameters don't survive being read back out without a cast).
    let cached: Promise<TModel> | undefined;
    this.#ensureModel = (): Promise<TModel> => {
      cached ??= this.loadModule().then((module) => this.spawnModel(module));
      return cached;
    };
    this.#resetModel = (): void => {
      cached = undefined;
    };
  }

  /** Lazy-load and memoize the model handle. Idempotent across calls. */
  override async connect(): Promise<void> {
    await this.#ensureModel();
  }

  /** Release the memoized model handle so the next `connect()`/`embed()` reloads it. */
  override async disconnect(): Promise<void> {
    this.#resetModel();
    return Promise.resolve();
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const model = await this.#ensureModel();
    return this.embedWith(model, text, signal);
  }

  /** Resolve a path/URL for a bundled asset relative to the subclass's own module. */
  protected resolveAssetPath(relative: string): string {
    return new URL(relative, this.#moduleUrl).toString();
  }

  /** Import and validate the subclass's foreign library module. NO CDN — bundled npm import. */
  protected abstract loadModule(): Promise<TModule>;
  /** Build the extractor/model/engine handle from the loaded module (use `this.model` for the model id). */
  protected abstract spawnModel(module: TModule): Promise<TModel>;
  /**
   * Run the embedding against the built model handle. `signal` is part of
   * the contract because some backends (e.g. WebGPU engines) check it
   * mid-flight; TypeScript's bivariant method-parameter checking lets a
   * concrete override omit the trailing `signal` parameter entirely when it
   * doesn't need it — prefer that over an unused `signal` parameter.
   */
  protected abstract embedWith(model: TModel, text: string, signal: AbortSignal): Promise<readonly number[]>;
}
