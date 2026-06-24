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

import { Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, ModelCost, OpenAiCompatibleAdapter } from '@studnicky/dagonizer/adapter';
import type { ChatRequestType, ChatResponseType } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

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
 * network round-trip, so the discovery picker deprioritises both.
 */
const CLOUD_SUFFIXES: readonly string[] = [':cloud', '-cloud'];

const DISCOVERY_TIMEOUT_MS = 1500;

const PROBE_TIMEOUT_MS = 500;

/**
 * Options accepted at construction.
 *
 * `model` is optional. When omitted, call `selectChatModel()` before the
 * first `chat()` call — `selectChatModel()` discovers available models via
 * `listModels()` and sets the active model. Pass `model` only when the
 * caller already knows which tag has been pulled.
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

export class OllamaApiAdapter extends OpenAiCompatibleAdapter {
  readonly #baseUrl: string;

  constructor(options: OllamaApiAdapterOptionsType = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
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
        'endpoint':       `${baseUrl}/v1/chat/completions`,
        'modelsEndpoint': `${baseUrl}/v1/models`,
        'tokenField': 'max_tokens',
        'extraHeaders': {}
      },
      {
        ...(options.model !== undefined ? { 'model': options.model } : {}),
        'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      }
    );
    this.#baseUrl = baseUrl;
  }

  /**
   * List the models the Ollama daemon has pulled, via `GET /api/tags`.
   *
   * The response body is validated against `OllamaTagsResponseSchema`
   * through the framework's shared Ajv before any field is read. Each
   * model name is classified as `'embedding'` when it contains any
   * `EMBED_MARKERS` substring (e.g. `nomic-embed-text`, `bge-*`), and
   * as `'chat'` otherwise. The `cloud` flag is `true` when the tag ends
   * with any `CLOUD_SUFFIXES` value (`:cloud`, `-cloud`). `costRank` is the
   * pulled model's on-disk `size` in bytes — a local-cost proxy where a
   * smaller model is cheaper to run — falling back to the name heuristic
   * when the daemon omits a size.
   *
   * Never throws — returns `[]` on any failure (daemon down, non-2xx,
   * malformed body, timeout). Composes `options.signal` with an internal
   * discovery timeout via `AbortSignal.any`.
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    const signal = options?.signal !== undefined
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    try {
      const res = await fetch(`${this.#baseUrl}/api/tags`, {
        'method': 'GET',
        signal,
      });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      if (!OllamaTagsResponseValidator.is(body)) return [];
      return body.models.map((entry): LlmModelType => {
        const lower = entry.name.toLowerCase();
        const variant: LlmModelType['variant'] = EMBED_MARKERS.some((marker) => lower.includes(marker))
          ? 'embedding'
          : 'chat';
        const cloud = CLOUD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
        return { 'name': entry.name, variant, cloud, 'costRank': ModelCost.rankFromSize(entry.name, entry.size) };
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
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
