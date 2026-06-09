/**
 * Browser LLM provider matrix for the Archivist demo.
 *
 *   gemini-nano  →  browser built-in Prompt API (LanguageModel global)
 *   gemini-api   →  Google AI Studio REST with a user-supplied key
 *   web-llm      →  fully in-browser inference via WebGPU + @mlc-ai/web-llm
 *   groq         →  Groq REST (llama-3.3-70b-versatile, ~30 RPM free tier)
 *   cerebras     →  Cerebras REST (llama-3.3-70b, free tier)
 *   mistral      →  Mistral AI REST (mistral-small-latest, free tier)
 *   openrouter   →  OpenRouter REST (llama-3.3-70b-instruct:free, free-tier models)
 *   stub         →  canned responses, always available
 *
 * Every backend is one `LlmAdapter` (transport + native tool format)
 * wrapped by `BaseLlmClient` (prompt choreography). The choice between
 * backends is just a choice of adapter; the high-level `LlmClient`
 * surface is identical.
 *
 * `detectBackends()` probes each one and returns rows for all. Cloud
 * adapters (groq/cerebras/mistral/openrouter/gemini-api) are runnable
 * when their key is present in `apiKeys`.
 *
 * `pickBestBackend(backends, { isMobile })` excludes on-device backends
 * when `isMobile` is true, then ranks remaining runnable entries by
 * priority: groq → cerebras → gemini-api → mistral → openrouter →
 * gemini-nano (browser built-in) → web-llm → stub.
 *
 * API keys are stored as a JSON blob in `dagonizer-api-keys` in
 * localStorage, keyed by `ProviderId`. Use `loadApiKeys()` /
 * `saveApiKeys()` to read/write.
 */

import type { MemoryStore } from '../memory/MemoryStore.js';
import type { LlmClient } from '../services.ts';

import {
  CerebrasApiAdapter,
  GeminiApiAdapter,
  GeminiNanoAdapter,
  detectGeminiNano,
  GroqApiAdapter,
  MistralApiAdapter,
  OllamaApiAdapter,
  OpenRouterApiAdapter,
  ArchivistStub,
  WebLlmAdapter,
  detectOllama,
  listOllamaModels,
  detectWebGpu,
  type GeminiNanoAvailability,
  type WebLlmInitReport,
} from './adapters/index.ts';
import { LlmError } from '@noocodex/dagonizer/adapter';
import { BaseLlmClient } from './BaseLlmClient.ts';

export type ProviderId =
  | 'gemini-nano'
  | 'gemini-api'
  | 'web-llm'
  | 'groq'
  | 'cerebras'
  | 'mistral'
  | 'openrouter'
  | 'ollama'
  | 'stub';

/** Backends visible in the browser picker. Stub is included so mobile
 *  callers can surface it as a zero-setup fallback; `browserVisibleBackends`
 *  filters it out for desktop where on-device options exist. */
const BROWSER_VISIBLE: readonly ProviderId[] = [
  'gemini-nano',
  'gemini-api',
  'web-llm',
  'groq',
  'cerebras',
  'mistral',
  'openrouter',
  'ollama',
  'stub',
];

/**
 * Priority order for `pickBestBackend`. Cloud APIs first (no download,
 * works everywhere with a free key), then local daemon, then on-device
 * inference. Lower index = higher priority.
 */
const PRIORITY_ORDER: readonly ProviderId[] = [
  'groq',          // cloud, fast, reliable structured output
  'cerebras',      // cloud, very fast
  'gemini-api',    // cloud, strong tool-use
  'mistral',       // cloud
  'openrouter',    // cloud, broad model access
  'ollama',        // local daemon (needs model pulled)
  'gemini-nano',   // browser built-in LanguageModel
  'web-llm',       // browser WASM
  'stub',          // last-resort fallback
];

/** Backends that need a local/desktop runtime, excluded on mobile. */
const DESKTOP_ONLY: readonly ProviderId[] = ['gemini-nano', 'web-llm', 'ollama'];

export interface BackendAvailability {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Runnable right now (no further user action required). */
  readonly runnable: boolean;
  /** Runnable but requires a one-time action (download, key entry). */
  readonly needsAction: 'download' | 'api-key' | null;
  /** Free-text hint for the UI (download size, error reason, etc.). */
  readonly hint?: string;
  /**
   * For the `ollama` backend: the installed chat model the picker resolved
   * (e.g. `'llama3.2:3b'`), or `undefined` when the daemon is down or no chat
   * model is installed. The runner instantiates the adapter with this model so
   * it always names a model the host has actually pulled.
   */
  readonly resolvedModel?: string;
}

export interface DetectionInputs {
  /** Per-provider API keys. Cloud adapters are runnable when their key is present. */
  readonly apiKeys?: Partial<Record<ProviderId, string>>;
  /**
   * The visitor's explicitly-chosen Ollama model, if any. When this names a
   * model the daemon has installed it is preferred; otherwise the picker
   * auto-selects the first installed chat model.
   */
  readonly preferredOllamaModel?: string;
}

/** Load the per-provider API key map from localStorage. */
export function loadApiKeys(): Partial<Record<ProviderId, string>> {
  if (typeof localStorage === 'undefined') return {};
  const raw = localStorage.getItem('dagonizer-api-keys');
  if (raw === null) {
    // Migrate legacy single-key entry.
    const legacy = localStorage.getItem('dagonizer-gemini-key');
    if (legacy !== null && legacy.length > 0) {
      const migrated: Partial<Record<ProviderId, string>> = { 'gemini-api': legacy };
      localStorage.setItem('dagonizer-api-keys', JSON.stringify(migrated));
      localStorage.removeItem('dagonizer-gemini-key');
      return migrated;
    }
    return {};
  }
  try {
    return JSON.parse(raw) as Partial<Record<ProviderId, string>>;
  } catch {
    return {};
  }
}

/** Persist the per-provider API key map to localStorage. */
export function saveApiKeys(keys: Partial<Record<ProviderId, string>>): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('dagonizer-api-keys', JSON.stringify(keys));
}

const OLLAMA_MODEL_KEY = 'dagonizer-ollama-model';

/**
 * Substrings that mark an Ollama model as embedding-only, so the chat-model
 * picker skips them (an embedder cannot answer a chat prompt).
 */
const OLLAMA_EMBED_MARKERS: readonly string[] = ['embed', 'bge', 'minilm', 'gte-'];

/**
 * Load the visitor's explicitly-chosen Ollama model from localStorage, or the
 * empty string when they have not chosen one. Empty means "auto": the picker
 * resolves an installed chat model from the daemon's tag list.
 */
export function loadOllamaModel(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(OLLAMA_MODEL_KEY) ?? '';
}

/**
 * Choose an installed Ollama chat model. Prefers `preferred` when the daemon
 * has it pulled; otherwise returns the first installed model that is not an
 * embedding-only model. Returns `null` when no chat model is installed.
 */
export function pickOllamaChatModel(installed: readonly string[], preferred?: string): string | null {
  if (preferred !== undefined && preferred.length > 0 && installed.includes(preferred)) {
    return preferred;
  }
  const chat = installed.filter(
    (name) => !OLLAMA_EMBED_MARKERS.some((marker) => name.toLowerCase().includes(marker)),
  );
  return chat[0] ?? null;
}

/** Persist the Ollama model name. */
export function saveOllamaModel(model: string): void {
  if (typeof localStorage === 'undefined') return;
  if (model.trim().length === 0) {
    localStorage.removeItem(OLLAMA_MODEL_KEY);
    return;
  }
  localStorage.setItem(OLLAMA_MODEL_KEY, model.trim());
}

export async function detectBackends(inputs: DetectionInputs = {}): Promise<readonly BackendAvailability[]> {
  const keys = inputs.apiKeys ?? {};
  const out: BackendAvailability[] = [];

  const nanoStatus: GeminiNanoAvailability = await detectGeminiNano();
  out.push({
    'id': 'gemini-nano',
    'displayName': 'Browser built-in LanguageModel (on-device)',
    'runnable': nanoStatus === 'available',
    'needsAction': nanoStatus === 'downloadable' || nanoStatus === 'downloading' ? 'download' : null,
    'hint': nanoStatus === 'unavailable'
      ? 'Requires Chrome 138+ or Edge with the Prompt API enabled.'
      : nanoStatus === 'downloadable'
        ? 'The browser will download the model (~2 GB) on first use.'
        : nanoStatus === 'downloading'
          ? 'The browser is currently downloading the model. Try again shortly.'
          : 'Ready.',
  });

  const hasGeminiKey = typeof keys['gemini-api'] === 'string' && keys['gemini-api'].length > 0;
  out.push({
    'id': 'gemini-api',
    'displayName': 'Gemini API (your AI Studio key)',
    'runnable': hasGeminiKey,
    'needsAction': hasGeminiKey ? null : 'api-key',
    'hint': 'Paste a free Google AI Studio key. Nothing leaves your browser except the request itself.',
  });

  const webGpu = detectWebGpu();
  out.push({
    'id': 'web-llm',
    'displayName': 'WebLLM (Phi-3.5 in-browser)',
    'runnable': webGpu,
    'needsAction': null,
    'hint': webGpu
      ? 'Phi-3.5 mini lazy-loads (~780 MB) on first use. Cached afterwards.'
      : 'This browser does not support WebGPU.',
  });

  const hasGroqKey = typeof keys['groq'] === 'string' && keys['groq'].length > 0;
  out.push({
    'id': 'groq',
    'displayName': 'Groq (llama-3.3-70b, free tier)',
    'runnable': hasGroqKey,
    'needsAction': hasGroqKey ? null : 'api-key',
    'hint': 'Free key at console.groq.com/keys. ~30 RPM on llama-3.3-70b-versatile.',
  });

  const hasCerebrasKey = typeof keys['cerebras'] === 'string' && keys['cerebras'].length > 0;
  out.push({
    'id': 'cerebras',
    'displayName': 'Cerebras (llama-3.3-70b, free tier)',
    'runnable': hasCerebrasKey,
    'needsAction': hasCerebrasKey ? null : 'api-key',
    'hint': 'Free key at cloud.cerebras.ai. Ultra-fast inference on Wafer-Scale Engine.',
  });

  const hasMistralKey = typeof keys['mistral'] === 'string' && keys['mistral'].length > 0;
  out.push({
    'id': 'mistral',
    'displayName': 'Mistral (mistral-small, free tier)',
    'runnable': hasMistralKey,
    'needsAction': hasMistralKey ? null : 'api-key',
    'hint': 'Free key at console.mistral.ai/api-keys/. mistral-small-latest.',
  });

  const hasOpenRouterKey = typeof keys['openrouter'] === 'string' && keys['openrouter'].length > 0;
  out.push({
    'id': 'openrouter',
    'displayName': 'OpenRouter (llama-3.3-70b, free tier)',
    'runnable': hasOpenRouterKey,
    'needsAction': hasOpenRouterKey ? null : 'api-key',
    'hint': 'Free key at openrouter.ai/keys. Routes to llama-3.3-70b-instruct:free.',
  });

  // Ollama: local daemon detection. Browser hits 127.0.0.1:11434; if the
  // daemon is up and CORS-permissive, the version endpoint replies in <50 ms.
  // No API key required. Model is whatever the user has pulled.
  const ollamaUp = await detectOllama();
  const ollamaModel = ollamaUp
    ? pickOllamaChatModel(await listOllamaModels(), inputs.preferredOllamaModel)
    : null;
  out.push({
    'id': 'ollama',
    'displayName': ollamaModel !== null
      ? `Ollama (local · ${ollamaModel})`
      : 'Ollama (local daemon)',
    // Runnable only when a chat model is actually installed; otherwise every
    // node would fail with "model not installed" and salvage to canned output.
    'runnable': ollamaUp && ollamaModel !== null,
    'needsAction': null,
    ...(ollamaModel !== null ? { 'resolvedModel': ollamaModel } : {}),
    'hint': !ollamaUp
      ? 'Start the Ollama daemon at 127.0.0.1:11434 and ensure CORS allows the docs origin (OLLAMA_ORIGINS).'
      : ollamaModel === null
        ? 'Daemon detected but no chat model is installed. Run e.g. `ollama pull llama3.2:3b`.'
        : `Local daemon detected; using installed model "${ollamaModel}".`,
  });

  // Stub is always emitted last. The picker uses browserVisibleBackends
  // to hide it on desktop (where on-device options exist), but on mobile
  // it is the guaranteed zero-setup fallback.
  out.push({
    'id':           'stub',
    'displayName':  'Canned responses (no real LLM)',
    'runnable':     true,
    'needsAction':  null,
    'hint':         'Pattern-matched offline responses. Demonstrates the DAG without an API key. Add a key above for real model output.',
  });
  return out;
}

export interface PickBestOptions {
  /** When true, desktop-only backends (gemini-nano, web-llm) are excluded. */
  readonly isMobile?: boolean;
}

/**
 * Pick the highest-priority runnable backend. Filters desktop-only backends
 * when `options.isMobile` is true. On mobile, falls back to the stub row
 * when no cloud backend is runnable so the demo always starts. Returns
 * `null` only on desktop when nothing is runnable.
 */
export function pickBestBackend(
  available: readonly BackendAvailability[],
  options: PickBestOptions = {},
): BackendAvailability | null {
  const { isMobile = false } = options;
  const byId = new Map(available.map((b) => [b.id, b]));

  for (const id of PRIORITY_ORDER) {
    if (isMobile && DESKTOP_ONLY.includes(id)) continue;
    // On desktop, skip stub: visitors have real keyless options via Nano/WebLLM.
    if (!isMobile && id === 'stub') continue;
    if (!BROWSER_VISIBLE.includes(id)) continue;
    const entry = byId.get(id);
    if (entry !== undefined && entry.runnable) return entry;
  }
  return null;
}

/**
 * True when no real model is available and the visitor must enable one.
 * On mobile this always returns false. The stub is the guaranteed fallback,
 * so mobile visitors never see the no-model gate.
 */
export function hasNoRunnableModel(
  available: readonly BackendAvailability[],
  options: PickBestOptions = {},
): boolean {
  // Mobile path: stub is always runnable, so bypass the gate entirely.
  if (options.isMobile === true) return false;
  return pickBestBackend(available, options) === null;
}

/**
 * Returns the subset of `BROWSER_VISIBLE` backends appropriate for the
 * given device context. On mobile, stub is included (zero-setup fallback)
 * and desktop-only backends are excluded. On desktop, stub is excluded
 * (on-device options like Browser built-in LanguageModel and WebLLM are available).
 */
export function browserVisibleBackends(isMobile: boolean): readonly ProviderId[] {
  if (isMobile) {
    // Stub IS visible on mobile (zero-setup fallback); desktop-only backends hidden.
    return BROWSER_VISIBLE.filter((id) => !DESKTOP_ONLY.includes(id));
  }
  // Desktop: hide stub (visitors have real keyless options via nano/web-llm).
  return BROWSER_VISIBLE.filter((id) => id !== 'stub');
}

export interface InstantiateInputs {
  readonly apiKeys?: Partial<Record<ProviderId, string>>;
  readonly webLlmModel?: string;
  readonly onWebLlmProgress?: (report: WebLlmInitReport) => void;
  /**
   * Ollama chat model to use. Defaults to the installed model the detector
   * resolved from the daemon's tag list (e.g. 'llama3.2:3b'); pass a value to
   * override with a specific model the host has pulled.
   */
  readonly ollamaModel?: string;
  /** Passed to StubAdapter so canned responses cite real seed-library titles. */
  readonly memoryStore?: MemoryStore;
}

export function instantiateProvider(id: ProviderId, inputs: InstantiateInputs = {}): LlmClient {
  const keys = inputs.apiKeys ?? {};
  switch (id) {
    case 'gemini-nano':
      return new BaseLlmClient(new GeminiNanoAdapter());
    case 'gemini-api': {
      const key = keys['gemini-api'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('gemini-api requires an AI Studio API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new GeminiApiAdapter(key));
    }
    case 'web-llm': {
      const options: { model?: string; onProgress?: (report: WebLlmInitReport) => void } = {};
      if (inputs.webLlmModel !== undefined) options.model = inputs.webLlmModel;
      if (inputs.onWebLlmProgress !== undefined) options.onProgress = inputs.onWebLlmProgress;
      return new BaseLlmClient(new WebLlmAdapter(options));
    }
    case 'groq': {
      const key = keys['groq'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('groq requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new GroqApiAdapter(key));
    }
    case 'cerebras': {
      const key = keys['cerebras'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('cerebras requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new CerebrasApiAdapter(key));
    }
    case 'mistral': {
      const key = keys['mistral'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('mistral requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new MistralApiAdapter(key));
    }
    case 'openrouter': {
      const key = keys['openrouter'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('openrouter requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new OpenRouterApiAdapter(key));
    }
    case 'ollama': {
      // No API key required. Ollama's loopback daemon accepts a
      // placeholder Bearer header. Pass the installed model the picker
      // resolved; an empty string means "no explicit model" and is treated
      // as absent so the adapter never sends a blank model name.
      const model = inputs.ollamaModel;
      return new BaseLlmClient(new OllamaApiAdapter(
        typeof model === 'string' && model.length > 0 ? { 'model': model } : {},
      ));
    }
    case 'stub': {
      if (inputs.memoryStore === undefined) {
        throw new LlmError('stub requires a memoryStore so canned responses cite real seed-library titles', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new ArchivistStub({ 'memoryStore': inputs.memoryStore }));
    }
    default: {
      const exhaustive: never = id;
      throw new LlmError(`unknown provider id: ${String(exhaustive)}`, { 'reason': 'UNKNOWN', 'retryable': false });
    }
  }
}

export { BaseLlmClient } from './BaseLlmClient.ts';
export {
  CerebrasApiAdapter,
  GeminiApiAdapter,
  GeminiNanoAdapter,
  detectGeminiNano,
  GroqApiAdapter,
  MistralApiAdapter,
  OllamaApiAdapter,
  OpenRouterApiAdapter,
  ArchivistStub,
  WebLlmAdapter,
  detectOllama,
  listOllamaModels,
  detectWebGpu,
} from './adapters/index.ts';
export { MobileDetection } from './MobileDetection.ts';
export type { GeminiNanoAvailability, WebLlmInitReport };
