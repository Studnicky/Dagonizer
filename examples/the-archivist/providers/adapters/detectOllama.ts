/**
 * OllamaProbe: non-throwing probe utilities for the local Ollama daemon.
 *
 * OllamaProbe.detect: Hits `GET /api/version` at `127.0.0.1:11434` with a
 * 600 ms timeout. Returns `true` if the daemon answered with anything in
 * the 2xx range, `false` for any failure (network, CORS, daemon down,
 * timeout). Never throws. The picker uses this to decide whether to mark
 * the Ollama row runnable.
 *
 * OllamaProbe.listModels: Lists models the local Ollama daemon has pulled.
 * Delegates to `OllamaApiAdapter.listModels` so the schema-validated
 * `/api/tags` fetch lives in exactly one place (the adapter package). Returns
 * model names or an empty array on failure.
 *
 * CORS: by default Ollama only accepts requests from a small allowlist.
 * Configure `OLLAMA_ORIGINS=http://localhost:5173` (or your docs origin)
 * before starting the daemon so the browser can probe it.
 */

import { OllamaApiAdapter } from '@studnicky/dagonizer-adapter-ollama';

const PING_URL = 'http://127.0.0.1:11434/api/version';
const TIMEOUT_MS = 600;

export class OllamaProbe {
  /**
   * Non-throwing ping of the local Ollama daemon.
   * Returns `true` if the daemon answered 2xx, `false` on any failure.
   */
  static async detect(): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, TIMEOUT_MS);
    try {
      const res = await fetch(PING_URL, { 'method': 'GET', 'signal': controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * List the models the local Ollama daemon has pulled.
   *
   * Delegates to `OllamaApiAdapter.listModels`, the single schema-validated
   * `/api/tags` reader in the adapter package. Returns the model names (e.g.
   * `['llama3.2:3b', 'nomic-embed-text:latest']`) or an empty array on any
   * failure (daemon down, CORS, timeout). Never throws. The picker uses this
   * to select an installed chat model instead of assuming a fixed default the
   * host may not have pulled.
   */
  static async listModels(): Promise<readonly string[]> {
    if (typeof fetch === 'undefined') return [];
    return OllamaApiAdapter.listModels();
  }
}
