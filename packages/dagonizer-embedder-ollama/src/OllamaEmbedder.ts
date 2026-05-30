/**
 * OllamaEmbedder — local-first embeddings via Ollama's `/api/embeddings`
 * endpoint. Mirrors `OllamaApiAdapter` (its sibling under the `adapter`
 * surface) on construction shape and probe behaviour.
 *
 * Wire format (Ollama native — no OpenAI-compatible alternative for
 * embeddings as of this writing):
 *
 *   POST {baseUrl}/api/embeddings
 *   { "model": "nomic-embed-text", "prompt": "<text>" }
 *
 *   → { "embedding": number[] }
 *
 * Dimensions are model-dependent. Pulled inline from a small table so
 * the registered `dimensions` matches the wire output without a probe
 * round-trip at construction time. Unknown models fall through to the
 * `nomic-embed-text` default (768) — consumers can override by passing
 * a known dimension via `options.dimensions`.
 *
 * Probe: GET `/api/tags` with a short timeout. Same surface the chat
 * adapter uses, so a single Ollama daemon being up makes both surfaces
 * available.
 */

import { BaseEmbedder, classifyHttp, Classifications, LlmError } from '@noocodex/dagonizer/adapter';
import type { BaseEmbedderOptions } from '@noocodex/dagonizer/adapter';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const PROBE_TIMEOUT_MS = 500;

/**
 * Known model → output dimensionality. Sourced from each model card on
 * the Ollama library. When the consumer pulls a model not listed here
 * they must supply `dimensions` explicitly — the runtime probe-call
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

export interface OllamaEmbedderOptions extends BaseEmbedderOptions {
  /** Override base URL when targeting a remote daemon or a proxy. */
  readonly baseUrl?: string;
  /**
   * Explicit dimensions. Required for models not in the built-in table.
   * Otherwise auto-resolved.
   */
  readonly dimensions?: number;
}

interface OllamaEmbedResponse {
  readonly embedding?: readonly number[];
}

export class OllamaEmbedder extends BaseEmbedder {
  readonly #baseUrl: string;
  readonly #model: string;

  /**
   * Constructor: `(model, options?)`. `model` is required — Ollama
   * embedding models are pulled per-host and there's no portable
   * default; the consumer names the model they've pulled. Pass
   * `'nomic-embed-text'` for the common default.
   */
  constructor(model: string = DEFAULT_MODEL, options: OllamaEmbedderOptions = {}) {
    const dimensions = options.dimensions ?? KNOWN_DIMENSIONS[model] ?? KNOWN_DIMENSIONS[DEFAULT_MODEL] ?? 768;
    super('ollama', `Ollama (${model})`, dimensions, options);
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#model = model;
  }

  protected async performEmbed(text: string): Promise<readonly number[]> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/api/embeddings`, {
        'method': 'POST',
        'headers': { 'Content-Type': 'application/json' },
        'body': JSON.stringify({ 'model': this.#model, 'prompt': text }),
      });
    } catch (err) {
      throw new LlmError(
        `Ollama embed network error: ${err instanceof Error ? err.message : String(err)}`,
        Classifications['NETWORK'],
        err,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      throw new LlmError(
        `Ollama embed failed: ${String(res.status)} ${body}`,
        classifyHttp(res.status, body),
      );
    }

    const payload = (await res.json()) as OllamaEmbedResponse;
    if (payload.embedding === undefined || payload.embedding.length === 0) {
      throw new LlmError(
        `Ollama embed: missing or empty 'embedding' field`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return payload.embedding;
  }

  /**
   * Probe true when the Ollama daemon answers a GET against `/api/tags`
   * (the native model-list endpoint) with 2xx inside a short timeout.
   * Never throws — returns false on transport failure or timeout so the
   * cascade routes around the embedder. Symmetric with
   * `OllamaApiAdapter.probe`.
   */
  override async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.#baseUrl}/api/tags`, {
        'method': 'GET',
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
