/**
 * OllamaApiAdapter: local-first Ollama via the OpenAI-compatible endpoint.
 *
 * Ollama exposes two HTTP surfaces. The native `/api/chat` and
 * `/api/generate` endpoints carry Ollama-specific options (`keep_alive`,
 * `num_ctx`, `num_predict`); the alternate `/v1/chat/completions`
 * endpoint speaks the OpenAI wire format. We target the OpenAI-compatible
 * surface so this adapter reuses `OpenAiCompatibleAdapter` end-to-end
 * (tools, tool_choice, response_format, finish_reason mapping) without
 * a second wire-protocol implementation. Ollama-native knobs that don't
 * map to the OpenAI spec are deferred; set them at the model layer
 * (e.g. via a Modelfile) or via the daemon's `OLLAMA_*` environment.
 *
 * Authentication: Ollama doesn't validate credentials on the loopback
 * default. We send a placeholder `Authorization: Bearer ollama` header
 * so the wire shape stays identical to upstream providers; consumers can
 * override via `apiKey` when proxying Ollama behind a gateway that does
 * enforce auth.
 *
 * Identifier: `'ollama'`, matching the convention used by the other
 * adapter plugins (`'mistral'`, `'groq'`, `'cerebras'`).
 */

import { Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, OpenAiCompatibleAdapter } from '@studnicky/dagonizer/adapter';
import type { ChatRequestType, ChatResponseType } from '@studnicky/dagonizer/adapter';

import { OllamaTagsResponseValidator } from './OllamaTagsResponse.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

/**
 * Substrings that mark an installed model as embedding-only. The chat-model
 * picker skips any model whose name contains one of these — an embedder
 * (e.g. `nomic-embed-text`, `bge-*`, `all-minilm`, `gte-*`) cannot answer a
 * chat prompt, so handing it to a chat node would only produce empty output.
 */
const EMBED_MARKERS: readonly string[] = ['embed', 'bge', 'minilm', 'gte-'];

/**
 * Tag suffixes that mark a model as Ollama-cloud-routed rather than fully
 * local. Ollama spells the cloud variant two ways: a bare `:cloud` tag
 * (e.g. `glm-5.1:cloud`) and a size-qualified `-cloud` suffix on the tag
 * (e.g. `qwen3-coder:480b-cloud`). Either needs an Ollama account and a
 * network round-trip, so the discovery picker deprioritizes both.
 */
const CLOUD_SUFFIXES: readonly string[] = [':cloud', '-cloud'];

const DISCOVERY_TIMEOUT_MS = 1500;
// No portable default model: Ollama models are pulled per-host.
// Consumers name the model they've pulled; this fallback is a convenience
// for bare `new OllamaApiAdapter()` in development only.
const FALLBACK_MODEL = 'llama3.2:latest';

/**
 * Options accepted at construction.
 *
 * `model` is required. Ollama models are pulled per-host and there is
 * no portable default; the consumer names the model they've pulled.
 *
 * `baseUrl` defaults to the local loopback. Override when targeting a
 * remote Ollama daemon or a proxy.
 *
 * `apiKey` is optional; defaults to the placeholder `'ollama'`. Override
 * only when proxying Ollama behind a gateway that enforces auth.
 */
export type OllamaApiAdapterOptionsType = {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly maxAttempts?: number;
};

const PROBE_TIMEOUT_MS = 500;

export class OllamaApiAdapter extends OpenAiCompatibleAdapter {
  readonly #baseUrl: string;

  constructor(options: OllamaApiAdapterOptionsType = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const model = options.model ?? FALLBACK_MODEL;
    super(
      options.apiKey ?? 'ollama',
      {
        'id': 'ollama',
        'displayName': 'Ollama (local)',
        'capabilities': {
          'toolUse': 'partial',
          'structuredOutput': true,
          'jsonMode': true
        },
        'endpoint': `${baseUrl}/v1/chat/completions`,
        'defaultModel': FALLBACK_MODEL,
        'tokenField': 'max_tokens',
        'extraHeaders': {}
      },
      {
        'model': model,
        'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      }
    );
    this.#baseUrl = baseUrl;
  }

  /**
   * List the models the Ollama daemon has pulled, via `GET /api/tags`.
   *
   * The response body is validated against `OllamaTagsResponseSchema`
   * through the framework's shared Ajv before any field is read; the names
   * are returned exactly as the daemon reports them (e.g. `'llama3.2:3b'`,
   * `'nomic-embed-text:latest'`). Consumers discover an installed model
   * instead of hardcoding a tag the host may not have pulled.
   *
   * `baseUrl` defaults to the adapter's loopback default
   * (`http://127.0.0.1:11434`). Never throws: returns `[]` on any failure
   * (daemon down, non-2xx, malformed body, timeout).
   */
  static async listModels(baseUrl: string = DEFAULT_BASE_URL): Promise<readonly string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        'method': 'GET',
        'signal': controller.signal,
      });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      if (!OllamaTagsResponseValidator.is(body)) return [];
      return body.models.map((entry) => entry.name);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Discover the first installed chat model the daemon can answer with,
   * preferring a fully-local model over a `:cloud`-routed one.
   *
   * Lists installed models via `listModels`, drops embedding-only models
   * (names containing `embed`/`bge`/`minilm`/`gte-`), and picks:
   *   1. `options.preferred` when the daemon has that exact tag pulled, else
   *   2. the first fully-local chat model (tag ends in neither `:cloud` nor
   *      `-cloud`), else
   *   3. the first cloud-routed chat model — used only when no fully-local
   *      chat model is installed.
   *
   * A cloud-routed model needs an Ollama account and a network round-trip, so
   * it is the wrong default for a runnable local example; local models win.
   *
   * `baseUrl` defaults to the adapter's loopback default. Returns `null`
   * when no chat model is installed or the daemon is unreachable. Never
   * throws.
   */
  static async firstChatModel(
    baseUrl: string = DEFAULT_BASE_URL,
    options: { readonly preferred?: string } = {},
  ): Promise<string | null> {
    const installed = await OllamaApiAdapter.listModels(baseUrl);
    const preferred = options.preferred;
    if (preferred !== undefined && preferred.length > 0 && installed.includes(preferred)) {
      return preferred;
    }
    const chat = installed.filter(
      (name) => !EMBED_MARKERS.some((marker) => name.toLowerCase().includes(marker)),
    );
    const local = chat.filter(
      (name) => !CLOUD_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix)),
    );
    return local[0] ?? chat[0] ?? null;
  }

  /**
   * Intercept HTTP 404 responses from Ollama's `/v1/chat/completions`
   * endpoint. A 404 means the model has not been pulled yet. Re-throw
   * with a hint so the error surfaces actionably to the visitor.
   */
  protected override async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    try {
      return await super.performChat(request);
    } catch (err) {
      if (
        err instanceof LlmError &&
        err.classification.reason === 'MODEL_NOT_FOUND'
      ) {
        // Extract the model name from the raw error message when available.
        const modelMatch = /model ['"]?([^'"]+)['"]? not found/iu.exec(err.message);
        const modelName = modelMatch?.[1] ?? this.model;
        throw new LlmError(
          `Ollama model '${modelName}' is not installed. Run: ollama pull ${modelName}`,
          Classifications['MODEL_NOT_FOUND'],
          { 'cause': err },
        );
      }
      throw err;
    }
  }

  /**
   * Probe true when the Ollama daemon answers a GET against
   * `/api/tags` (the native model-list endpoint) with 2xx inside a
   * short timeout. Ollama uses a placeholder bearer and gates
   * availability on the daemon being reachable, not on credentials,
   * so availability turns on the daemon answering rather than on
   * key presence. Never throws.
   */
  override async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.#baseUrl}/api/tags`, {
        'method': 'GET',
        'signal': controller.signal
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
