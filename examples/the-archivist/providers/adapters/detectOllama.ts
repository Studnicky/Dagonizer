/**
 * OllamaProbe: non-throwing probe utilities for the local Ollama daemon.
 *
 * OllamaProbe.detect: Hits `GET /api/version` at `127.0.0.1:11434` with a
 * 600 ms timeout. Returns `true` if the daemon answered with anything in
 * the 2xx range, `false` for any failure (network, CORS, daemon down,
 * timeout). Never throws. The picker uses this to decide whether to mark
 * the Ollama row runnable before constructing an adapter.
 *
 * Model discovery is handled by the adapter instance contract:
 * construct an `OllamaApiAdapter` and call `adapter.selectChatModel()`
 * or `adapter.selectEmbeddingModel()` to discover and set a model from
 * the daemon's tag list (`GET /api/tags`).
 *
 * CORS: by default Ollama only accepts requests from a small allowlist.
 * Configure `OLLAMA_ORIGINS=http://localhost:5173` (or your docs origin)
 * before starting the daemon so the browser can probe it.
 */

import { Signal } from '@studnicky/signal';

const PING_URL = 'http://127.0.0.1:11434/api/version';
const TIMEOUT_MS = 600;

export class OllamaProbe {
  /**
   * Non-throwing ping of the local Ollama daemon.
   * Returns `true` if the daemon answered 2xx, `false` on any failure.
   */
  static async detect(): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    const signal = Signal.timeout(TIMEOUT_MS);
    try {
      const res = await fetch(PING_URL, { 'method': 'GET', signal });
      return res.ok;
    } catch {
      return false;
    }
  }
}
