/**
 * OllamaApiAdapter — local-first Ollama via the OpenAI-compatible endpoint.
 *
 * Ollama exposes two HTTP surfaces. The native `/api/chat` and
 * `/api/generate` endpoints carry Ollama-specific options (`keep_alive`,
 * `num_ctx`, `num_predict`); the alternate `/v1/chat/completions`
 * endpoint speaks the OpenAI wire format. We target the OpenAI-compatible
 * surface so this adapter reuses `OpenAiCompatibleAdapter` end-to-end
 * (tools, tool_choice, response_format, finish_reason mapping) without
 * a second wire-protocol implementation. Ollama-native knobs that don't
 * map to the OpenAI spec are deferred — set them at the model layer
 * (e.g. via a Modelfile) or via the daemon's `OLLAMA_*` environment.
 *
 * Authentication: Ollama doesn't validate credentials on the loopback
 * default. We send a placeholder `Authorization: Bearer ollama` header
 * so the wire shape stays identical to upstream providers; consumers can
 * override via `apiKey` when proxying Ollama behind a gateway that does
 * enforce auth.
 *
 * Identifier: `'ollama'` — matches the convention used by the other
 * adapter plugins (`'mistral'`, `'groq'`, `'cerebras'`).
 */

import { OpenAiCompatibleAdapter } from '@noocodex/dagonizer/adapter';
import type {
  OpenAiCompatibleAdapterOptions
} from '@noocodex/dagonizer/adapter';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.2:latest';

/**
 * Options accepted at construction.
 *
 * `model` is required — Ollama models are pulled per-host and there is
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

export class OllamaApiAdapter extends OpenAiCompatibleAdapter {
  public constructor(options: OllamaApiAdapterOptions = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const merged: OpenAiCompatibleAdapterOptions = {
      'apiKey': options.apiKey ?? 'ollama',
      'model': options.model ?? DEFAULT_MODEL,
      ...(options.maxAttempts !== undefined ? { 'maxAttempts': options.maxAttempts } : {})
    };

    super(
      {
        'id': 'ollama',
        'displayName': 'Ollama (local)',
        'capabilities': {
          'toolUse': 'partial',
          'structuredOutput': true,
          'jsonMode': true
        },
        'endpoint': `${baseUrl}/v1/chat/completions`,
        'defaultModel': DEFAULT_MODEL,
        'tokenField': 'max_tokens',
        'extraHeaders': {}
      },
      merged
    );
  }
}
