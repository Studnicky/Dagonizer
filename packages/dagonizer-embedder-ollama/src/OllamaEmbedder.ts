/**
 * OllamaEmbedder: embeddings via Ollama's `/api/embeddings` endpoint.
 * Works against both a local daemon (no API key needed) and Ollama Cloud
 * (requires an API key). Mirrors `OllamaApiAdapter` (its sibling under
 * the `adapter` surface) on construction shape and probe behaviour.
 *
 * Wire format (Ollama native; no OpenAI-compatible alternative for
 * embeddings as of this writing):
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
 * Probe (local): GET `/api/tags` with a short timeout. Same surface the
 * chat adapter uses, so a single Ollama daemon being up makes both
 * surfaces available.
 * Probe (cloud): returns true iff a non-empty `apiKey` was supplied and
 * a non-default `baseUrl` is set, since cloud does not expose `/api/tags`
 * unauthenticated in the same way as the local daemon.
 */

import { BaseEmbedder, Classifications, LlmError } from '@noocodex/dagonizer/adapter';
import type { BaseAdapterCoreOptions } from '@noocodex/dagonizer/adapter';
import type { AbortableOptionsInterface } from '@noocodex/dagonizer/contracts';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
/** Dimensions for `nomic-embed-text`, the default model. Mirrors `KNOWN_DIMENSIONS[DEFAULT_MODEL]`. */
const DEFAULT_DIMENSIONS = 768;
const PROBE_TIMEOUT_MS = 500;

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
 */
export interface OllamaEmbedderOptions extends BaseAdapterCoreOptions {
  /**
   * Embedding model name. Must match a model pulled on the target server.
   * Defaults to `'nomic-embed-text'`.
   */
  readonly model?: string;
  /**
   * Base URL of the Ollama server.
   * Local default: `'http://127.0.0.1:11434'`.
   * Ollama Cloud: set to `'https://api.ollama.ai'` (or the documented cloud endpoint).
   */
  readonly baseUrl?: string;
  /**
   * Explicit dimensions. Required for models not in the built-in table.
   * Otherwise auto-resolved from `KNOWN_DIMENSIONS`.
   */
  readonly dimensions?: number;
  /**
   * API key for Ollama Cloud authentication.
   * When present, requests include `Authorization: Bearer <apiKey>`.
   * Omit entirely for local Ollama daemon usage (no auth header is sent).
   */
  readonly apiKey?: string;
}

interface OllamaEmbedResponse {
  readonly embedding: readonly number[];
}

function isOllamaEmbedResponse(v: unknown): v is OllamaEmbedResponse {
  if (typeof v !== 'object' || v === null) return false;
  return Array.isArray((v as Record<string, unknown>)['embedding']);
}

export class OllamaEmbedder extends BaseEmbedder {
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #apiKey: string | undefined;

  /**
   * Constructor: `(options?)`. All configuration lives in `options`.
   * `options.model` selects the embedding model (default `'nomic-embed-text'`);
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
  constructor(options: OllamaEmbedderOptions = {}) {
    const model = options.model ?? DEFAULT_MODEL;
    // Resolve dimensions: explicit override → known-model table → DEFAULT_DIMENSIONS (768).
    // DEFAULT_DIMENSIONS mirrors KNOWN_DIMENSIONS[DEFAULT_MODEL] and is a concrete constant,
    // so the fallback chain always terminates with a number — no unreachable literal appended.
    const dimensions = options.dimensions ?? KNOWN_DIMENSIONS[model] ?? DEFAULT_DIMENSIONS;
    super('ollama', `Ollama (${model})`, dimensions, options);
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#model = model;
    this.#apiKey = options.apiKey;
  }

  protected async performEmbed(text: string, signal: AbortSignal): Promise<readonly number[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#apiKey !== undefined) {
      headers['Authorization'] = `Bearer ${this.#apiKey}`;
    }
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/api/embeddings`, {
        'method': 'POST',
        headers,
        'body': JSON.stringify({ 'model': this.#model, 'prompt': text }),
        signal,
      });
    } catch (err) {
      throw new LlmError(
        `Ollama embed network error: ${err instanceof Error ? err.message : String(err)}`,
        Classifications['NETWORK'],
        { 'cause': err },
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new LlmError(
        `Ollama embed failed: ${String(res.status)} ${body}`,
        LlmError.classifyHttp(res.status, { 'body': body }),
      );
    }

    const raw: unknown = await res.json();
    if (!isOllamaEmbedResponse(raw) || raw.embedding.length === 0) {
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
  override async probe(_options?: AbortableOptionsInterface): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
    const headers: Record<string, string> = {};
    if (this.#apiKey !== undefined) {
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
}
