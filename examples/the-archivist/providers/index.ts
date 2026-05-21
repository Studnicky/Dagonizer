/**
 * Browser LLM provider matrix for the Archivist demo.
 *
 *   gemini-nano  →  Chrome built-in Prompt API (LanguageModel global)
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
 * backends is just a choice of adapter — the high-level `LlmClient`
 * surface is identical.
 *
 * `detectBackends()` probes each one and returns rows for all. Cloud
 * adapters (groq/cerebras/mistral/openrouter/gemini-api) are runnable
 * when their key is present in `apiKeys`.
 *
 * `pickBestBackend(backends, { isMobile })` excludes on-device backends
 * when `isMobile` is true, then ranks remaining runnable entries by
 * priority: groq → cerebras → gemini-api → mistral → openrouter →
 * gemini-nano → web-llm → stub.
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
  GroqApiAdapter,
  MistralApiAdapter,
  OllamaApiAdapter,
  OpenRouterApiAdapter,
  ArchivistStub,
  WebLlmAdapter,
  detectGeminiNano,
  detectOllama,
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
 * Priority order for `pickBestBackend`. Cloud-first (no download, works
 * everywhere), then on-device options. Lower index = higher priority.
 */
const PRIORITY_ORDER: readonly ProviderId[] = [
  'ollama',         // local daemon — no key, no network, fastest if running
  'groq',
  'cerebras',
  'gemini-api',
  'mistral',
  'openrouter',
  'gemini-nano',
  'web-llm',
  'stub',
];

/** Backends that need a local/desktop runtime — excluded on mobile. */
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
}

export interface DetectionInputs {
  /** Per-provider API keys. Cloud adapters are runnable when their key is present. */
  readonly apiKeys?: Partial<Record<ProviderId, string>>;
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

export async function detectBackends(inputs: DetectionInputs = {}): Promise<readonly BackendAvailability[]> {
  const keys = inputs.apiKeys ?? {};
  const out: BackendAvailability[] = [];

  const nanoStatus: GeminiNanoAvailability = await detectGeminiNano();
  out.push({
    'id': 'gemini-nano',
    'displayName': 'Gemini Nano (Chrome on-device)',
    'runnable': nanoStatus === 'available',
    'needsAction': nanoStatus === 'downloadable' || nanoStatus === 'downloading' ? 'download' : null,
    'hint': nanoStatus === 'unavailable'
      ? 'Requires Chrome 138+ or the Prompt API origin trial.'
      : nanoStatus === 'downloadable'
        ? 'Chrome will download the model (~2 GB) on first use.'
        : nanoStatus === 'downloading'
          ? 'Chrome is currently downloading the model — try again shortly.'
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
    'displayName': 'Groq (llama-3.3-70b — free tier)',
    'runnable': hasGroqKey,
    'needsAction': hasGroqKey ? null : 'api-key',
    'hint': 'Free key at console.groq.com/keys. ~30 RPM on llama-3.3-70b-versatile.',
  });

  const hasCerebrasKey = typeof keys['cerebras'] === 'string' && keys['cerebras'].length > 0;
  out.push({
    'id': 'cerebras',
    'displayName': 'Cerebras (llama-3.3-70b — free tier)',
    'runnable': hasCerebrasKey,
    'needsAction': hasCerebrasKey ? null : 'api-key',
    'hint': 'Free key at cloud.cerebras.ai. Ultra-fast inference on Wafer-Scale Engine.',
  });

  const hasMistralKey = typeof keys['mistral'] === 'string' && keys['mistral'].length > 0;
  out.push({
    'id': 'mistral',
    'displayName': 'Mistral (mistral-small — free tier)',
    'runnable': hasMistralKey,
    'needsAction': hasMistralKey ? null : 'api-key',
    'hint': 'Free key at console.mistral.ai/api-keys/. mistral-small-latest.',
  });

  const hasOpenRouterKey = typeof keys['openrouter'] === 'string' && keys['openrouter'].length > 0;
  out.push({
    'id': 'openrouter',
    'displayName': 'OpenRouter (llama-3.3-70b — free tier)',
    'runnable': hasOpenRouterKey,
    'needsAction': hasOpenRouterKey ? null : 'api-key',
    'hint': 'Free key at openrouter.ai/keys. Routes to llama-3.3-70b-instruct:free.',
  });

  // Ollama — local daemon detection. Browser hits 127.0.0.1:11434; if the
  // daemon is up and CORS-permissive, the version endpoint replies in <50 ms.
  // No API key required. Model is whatever the user has pulled.
  const ollamaUp = await detectOllama();
  out.push({
    'id': 'ollama',
    'displayName': 'Ollama (local daemon)',
    'runnable': ollamaUp,
    'needsAction': null,
    'hint': ollamaUp
      ? 'Local daemon detected. Override model + baseUrl via the adapter constructor.'
      : 'Start the Ollama daemon at 127.0.0.1:11434 and ensure CORS allows the docs origin (OLLAMA_ORIGINS).',
  });

  // Stub is always emitted last. The picker uses browserVisibleBackends
  // to hide it on desktop (where on-device options exist), but on mobile
  // it is the guaranteed zero-setup fallback.
  out.push({
    'id':           'stub',
    'displayName':  'Canned responses (no real LLM)',
    'runnable':     true,
    'needsAction':  null,
    'hint':         'Pattern-matched offline responses — demonstrates the DAG without an API key. Add a key above for real model output.',
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
    // On desktop, skip stub — visitors have real keyless options via Nano/WebLLM.
    if (!isMobile && id === 'stub') continue;
    if (!BROWSER_VISIBLE.includes(id)) continue;
    const entry = byId.get(id);
    if (entry !== undefined && entry.runnable) return entry;
  }
  return null;
}

/**
 * True when no real model is available and the visitor must enable one.
 * On mobile this always returns false — stub is the guaranteed fallback,
 * so mobile visitors never see the no-model gate.
 */
export function hasNoRunnableModel(
  available: readonly BackendAvailability[],
  options: PickBestOptions = {},
): boolean {
  // Mobile path: stub is always runnable — bypass the gate entirely.
  if (options.isMobile === true) return false;
  return pickBestBackend(available, options) === null;
}

/**
 * Returns the subset of `BROWSER_VISIBLE` backends appropriate for the
 * given device context. On mobile, stub is included (zero-setup fallback)
 * and desktop-only backends are excluded. On desktop, stub is excluded
 * (on-device options like Gemini Nano and WebLLM are available).
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
  /** Override the Ollama model the consumer has pulled (e.g. 'llama3.2:latest'). */
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
      return new BaseLlmClient(new GeminiApiAdapter({ 'apiKey': key }));
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
      return new BaseLlmClient(new GroqApiAdapter({ 'apiKey': key }));
    }
    case 'cerebras': {
      const key = keys['cerebras'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('cerebras requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new CerebrasApiAdapter({ 'apiKey': key }));
    }
    case 'mistral': {
      const key = keys['mistral'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('mistral requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new MistralApiAdapter({ 'apiKey': key }));
    }
    case 'openrouter': {
      const key = keys['openrouter'];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError('openrouter requires an API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return new BaseLlmClient(new OpenRouterApiAdapter({ 'apiKey': key }));
    }
    case 'ollama': {
      // No API key required — Ollama's loopback daemon accepts a
      // placeholder Bearer header. Pass the model the user has pulled.
      return new BaseLlmClient(new OllamaApiAdapter(
        inputs.ollamaModel !== undefined ? { 'model': inputs.ollamaModel } : {},
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
  GroqApiAdapter,
  MistralApiAdapter,
  OllamaApiAdapter,
  OpenRouterApiAdapter,
  ArchivistStub,
  WebLlmAdapter,
  detectGeminiNano,
  detectOllama,
  detectWebGpu,
} from './adapters/index.ts';
export { MobileDetection } from './MobileDetection.ts';
export type { GeminiNanoAvailability, WebLlmInitReport };
