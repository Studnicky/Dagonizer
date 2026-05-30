/**
 * detectOllama: non-throwing ping of the local Ollama daemon.
 *
 * Hits `GET /api/version` at `127.0.0.1:11434` with a 600 ms timeout.
 * Returns `true` if the daemon answered with anything in the 2xx range,
 * `false` for any failure (network, CORS, daemon down, timeout). Never
 * throws. The picker uses this to decide whether to mark the Ollama
 * row runnable.
 *
 * CORS: by default Ollama only accepts requests from a small allowlist.
 * Configure `OLLAMA_ORIGINS=http://localhost:5173` (or your docs origin)
 * before starting the daemon so the browser can probe it.
 */

const PING_URL = 'http://127.0.0.1:11434/api/version';
const TIMEOUT_MS = 600;

export async function detectOllama(): Promise<boolean> {
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
