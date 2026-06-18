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

import { Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, OpenAiCompatibleAdapter } from '@noocodex/dagonizer/adapter';
import type { ChatRequest, ChatResponse } from '@noocodex/dagonizer/adapter';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
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
export interface OllamaApiAdapterOptions {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly maxAttempts?: number;
}

const PROBE_TIMEOUT_MS = 500;

export class OllamaApiAdapter extends OpenAiCompatibleAdapter {
  readonly #baseUrl: string;

  constructor(options: OllamaApiAdapterOptions = {}) {
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
   * Intercept HTTP 404 responses from Ollama's `/v1/chat/completions`
   * endpoint. A 404 means the model has not been pulled yet. Re-throw
   * with a hint so the error surfaces actionably to the visitor.
   */
  protected override async performChat(request: ChatRequest): Promise<ChatResponse> {
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
