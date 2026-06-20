/**
 * OllamaEmbedder: embeddings via Ollama's `/api/embeddings` endpoint.
 * Works against both a local daemon (no API key needed) and Ollama Cloud
 * (requires an API key). Mirrors `OllamaApiAdapter` (its sibling under
 * the `adapter` surface) on construction shape and probe behaviour.
 *
 * Wire format (Ollama native; no OpenAI-compatible alternative exists
 * for embeddings):
 *
 *   POST {baseUrl}/api/embeddings
 *   Authorization: Bearer <apiKey>   (omitted when no apiKey is set)
 *   { "model": "nomic-embed-text", "prompt": "<text>" }
 *
 *   → { "embedding": number[] }
 *
 * Dimensions are model-dependent. Pulled inline from a small table so
 * the registered `dimensions` matches the wire output without a probe
 * round-trip at construction time. Unknown models fall through to the
 * `nomic-embed-text` default (768); consumers can override by passing
 * a known dimension via `options.dimensions`.
 *
 * Local daemon usage:  `new OllamaEmbedder()`
 * Ollama Cloud usage:  `new OllamaEmbedder({ apiKey: '<key>', baseUrl: 'https://api.ollama.ai' })`
 *
 * When `options.model` is omitted, call `selectEmbeddingModel()` after
 * construction to discover and select an available embedding model from
 * the running daemon.
 *
 * Probe (local): GET `/api/tags` with a short timeout. Same surface the
 * chat adapter uses, so a single Ollama daemon being up makes both
 * surfaces available.
 * Probe (cloud): returns true iff a non-empty `apiKey` was supplied and
 * a non-default `baseUrl` is set, since cloud does not expose `/api/tags`
 * unauthenticated in the same way as the local daemon.
 */

import { BaseEmbedder, Classifications, LlmError } from '@studnicky/dagonizer/adapter';
import type { BaseEmbedderOptionsType } from '@studnicky/dagonizer/adapter';
import type { AbortableOptionsType } from '@studnicky/dagonizer/contracts';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import { OllamaEmbedResponseValidator } from './OllamaEmbedResponse.js';
import { OllamaTagsResponseValidator } from './OllamaTagsResponse.js';

/** Dimensions for `nomic-embed-text`, the default model. Mirrors `KNOWN_DIMENSIONS['nomic-embed-text']`. */
const DEFAULT_DIMENSIONS = 768;
const PROBE_TIMEOUT_MS = 500;
const DISCOVERY_TIMEOUT_MS = 3000;

/**
 * Lowercased name fragments that identify embedding models in the Ollama model list.
 * A model name containing any of these substrings is classified as `'embedding'`;
 * all others default to `'chat'`.
 */
const EMBEDDING_MARKERS: readonly string[] = ['embed', 'bge', 'minilm', 'gte-'];

/**
 * Module-level defaults; the producer fills them so the consumer never
 * sees absence. `apiKey` defaults to the empty string — local Ollama
 * needs no auth, and the empty string keeps the private field a stable
 * `string` (V8 shape stability) instead of `string | undefined`. The
 * Authorization header is gated on a non-empty key.
 *
 * `model` is intentionally absent here: the base class holds the selected
 * model and throws when unset. `OllamaEmbedder` resolves a concrete model
 * at construction (from the explicit option or the DEFAULT_MODEL fallback)
 * and calls `setModel()` so the base field is always populated when `model`
 * is supplied; when omitted, `selectEmbeddingModel()` must be called first.
 */
const OLLAMA_EMBEDDER_DEFAULTS = {
  'baseUrl': 'http://127.0.0.1:11434',
  'apiKey': '',
} as const;

/**
 * Known model → output dimensionality. Sourced from each model card on
 * the Ollama library. When the consumer pulls a model not listed here
 * they must supply `dimensions` explicitly; the runtime probe-call
 * shortcut isn't worth a round-trip on every adapter construction.
 */
const KNOWN_DIMENSIONS: Readonly<Record<string, number>> = {
  'nomic-embed-text':         768,
  'nomic-embed-text:latest':  768,
  'mxbai-embed-large':       1024,
  'mxbai-embed-large:latest':1024,
  'all-minilm':               384,
  'all-minilm:latest':        384,
  'snowflake-arctic-embed':   1024,
  'snowflake-arctic-embed:latest': 1024,
};

/**
 * Constructor options for `OllamaEmbedder`.
 *
 * Both local and cloud usage share this options object:
 *   - Local daemon (no auth): `new OllamaEmbedder()`
 *   - Ollama Cloud (auth required): `new OllamaEmbedder({ apiKey: '<key>', baseUrl: 'https://api.ollama.ai' })`
 *
 * Unlike `GeminiApiEmbedder` and `MistralEmbedder` where an API key is
 * always required (making it a required positional), Ollama's local mode
 * needs no key at all. `apiKey` therefore lives in the options bag and is
 * omitted for local usage.
 *
 * `model` is optional. When omitted, call `selectEmbeddingModel()` to
 * discover an available model from the running daemon. When provided,
 * `embed()` is immediately usable.
 */
export type OllamaEmbedderOptionsType = BaseEmbedderOptionsType & {
  /**
   * Base URL of the Ollama server.
   * Local default: `'http://127.0.0.1:11434'`.
   * Ollama Cloud: set to `'https://api.ollama.ai'` (or the documented cloud endpoint).
   */
  readonly baseUrl?: string;
  /**
   * API key for Ollama Cloud authentication.
   * When present, requests include `Authorization: Bearer <apiKey>`.
   * Omit entirely for local Ollama daemon usage (no auth header is sent).
   */
  readonly apiKey?: string;
};

export class OllamaEmbedder extends BaseEmbedder {
  readonly #baseUrl: string;
  readonly #apiKey: string;

  /**
   * Constructor: `(options?)`. All configuration lives in `options`.
   * `options.model` selects the embedding model — when omitted, call
   * `selectEmbeddingModel()` before `embed()` to discover and pick one;
   * `options.baseUrl` overrides the server URL;
   * `options.dimensions` overrides the auto-resolved dimensionality;
   * `options.apiKey` enables Ollama Cloud authentication.
   *
   * Local usage:  `new OllamaEmbedder()`
   * Cloud usage:  `new OllamaEmbedder({ apiKey: '<key>', baseUrl: 'https://api.ollama.ai' })`
   *
   * `apiKey` is optional in the options bag (not a required positional) because
   * local Ollama needs no key. Compare `GeminiApiEmbedder(apiKey, options?)` and
   * `MistralEmbedder(apiKey, options?)` where a key is always required.
   */
  constructor(options: OllamaEmbedderOptionsType = {}) {
    const baseUrl = options.baseUrl ?? OLLAMA_EMBEDDER_DEFAULTS.baseUrl;
    const apiKey  = options.apiKey  ?? OLLAMA_EMBEDDER_DEFAULTS.apiKey;

    // When a model is provided, resolve dimensions immediately so embed() works
    // without a discovery round-trip. When omitted, DEFAULT_DIMENSIONS is used
    // as a placeholder; `selectEmbeddingModel()` will call `setModel()` before
    // `embed()` is invoked, so the placeholder never surfaces in practice.
    const selectedModel = options.model;
    const dimensions = options.dimensions
      ?? (selectedModel !== undefined ? (KNOWN_DIMENSIONS[selectedModel] ?? DEFAULT_DIMENSIONS) : DEFAULT_DIMENSIONS);

    super('ollama', `Ollama (${selectedModel ?? 'unset'})`, dimensions, options);
    this.#baseUrl = baseUrl;
    this.#apiKey  = apiKey;

    // Pre-select the model when supplied so embed() is immediately usable.
    if (selectedModel !== undefined) {
      this.setModel(selectedModel);
    }
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#apiKey.length > 0) {
      headers['Authorization'] = `Bearer ${this.#apiKey}`;
    }
    const raw = await this.fetchJson(
      `${this.#baseUrl}/api/embeddings`,
      {
        'method': 'POST',
        headers,
        'body': JSON.stringify({ 'model': this.model, 'prompt': text }),
      },
      signal,
    );
    if (!OllamaEmbedResponseValidator.is(raw) || raw.embedding.length === 0) {
      throw new LlmError(
        `Ollama embed: missing or empty 'embedding' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return raw.embedding;
  }

  /**
   * Probe true when the Ollama server answers a GET against `/api/tags`
   * (the native model-list endpoint) with 2xx inside a short timeout.
   * When `apiKey` is set, the Authorization header is included so cloud
   * probes authenticate correctly.
   * Never throws; returns false on transport failure or timeout so the
   * cascade routes around the embedder. Symmetric with
   * `OllamaApiAdapter.probe`.
   */
  override async probe(_options?: AbortableOptionsType): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
    const headers: Record<string, string> = {};
    if (this.#apiKey.length > 0) {
      headers['Authorization'] = `Bearer ${this.#apiKey}`;
    }
    try {
      const res = await fetch(`${this.#baseUrl}/api/tags`, {
        'method': 'GET',
        headers,
        'signal': controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Enumerate models installed in the Ollama daemon by calling `GET /api/tags`.
   * Uses a short discovery timeout composed with any caller-supplied signal.
   *
   * Each model name is classified:
   *   - `'embedding'` when the lowercased name contains any of the known
   *     embedding markers (`embed`, `bge`, `minilm`, `gte-`).
   *   - `'chat'` otherwise.
   *
   * `cloud` is `true` when the name ends with `:cloud` or `-cloud`; `false`
   * otherwise. Daemon-local models are always non-cloud.
   *
   * Returns `[]` on any transport failure or validation error — never throws.
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    if (options?.signal !== undefined) {
      options.signal.addEventListener('abort', () => { controller.abort(); }, { 'once': true });
    }
    const headers: Record<string, string> = {};
    if (this.#apiKey.length > 0) {
      headers['Authorization'] = `Bearer ${this.#apiKey}`;
    }
    try {
      const res = await fetch(`${this.#baseUrl}/api/tags`, {
        'method': 'GET',
        headers,
        'signal': controller.signal,
      });
      if (!res.ok) {
        return [];
      }
      const body: unknown = await res.json() as unknown;
      if (!OllamaTagsResponseValidator.is(body)) {
        return [];
      }
      return body.models.map((entry): LlmModelType => {
        const lower = entry.name.toLowerCase();
        const isEmbedding = EMBEDDING_MARKERS.some((marker) => lower.includes(marker));
        const isCloud = lower.endsWith(':cloud') || lower.endsWith('-cloud');
        return {
          'name': entry.name,
          'variant': isEmbedding ? 'embedding' : 'chat',
          'cloud': isCloud,
        };
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
