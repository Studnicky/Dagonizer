/**
 * Browser LLM provider matrix for the Archivist demo.
 *
 *   gemini-nano  →  browser built-in Prompt API (LanguageModel global)
 *   gemini-api   →  Google AI Studio REST with a user-supplied key
 *   web-llm      →  fully in-browser inference via WebGPU + @mlc-ai/web-llm
 *   groq         →  Groq REST (~30 RPM free tier)
 *   cerebras     →  Cerebras REST (free tier)
 *   mistral      →  Mistral AI REST (free tier)
 *   openrouter   →  OpenRouter REST (free-tier models)
 *
 * Every backend is one `LlmAdapterInterface` (transport + native tool format)
 * wrapped by `BaseLlmClient` (prompt choreography). The choice between
 * backends is just a choice of adapter; the high-level `LlmClientInterface`
 * surface is identical.
 *
 * `BackendMatrix.detect(inputs)` probes each one and returns rows for all.
 * Cloud adapters (groq/cerebras/mistral/openrouter/gemini-api) are runnable
 * when their key is present in `apiKeys`. Ollama model discovery uses the
 * adapter instance contract: `adapter.selectChatModel()` queries `GET /api/tags`
 * and selects the best available chat model automatically.
 *
 * `BackendMatrix.pickBest(backends, { isMobile })` excludes on-device backends
 * when `isMobile` is true, then ranks remaining runnable entries by
 * priority: groq → cerebras → gemini-api → mistral → openrouter →
 * gemini-nano (browser built-in) → web-llm.
 *
 * API keys are stored as a JSON blob in `dagonizer-api-keys` in
 * localStorage, keyed by `ProviderId`. Use `ApiKeyStore.load()` /
 * `ApiKeyStore.save()` to read/write.
 */

import type { LlmClientInterface } from '../services.ts';

import {
  GeminiApiAdapter,
  GeminiNanoAdapter,
  OllamaApiAdapter,
  OpenAiCompatibleAdapter,
  WebLlmAdapter,
  OllamaProbe,
  type GeminiNanoAvailabilityType,
  type WebLlmInitReportType,
} from './adapters/index.ts';
import { LlmError } from '@studnicky/dagonizer/adapter';
import { BaseLlmClient } from './BaseLlmClient.ts';

export type ProviderId =
  | 'gemini-nano'
  | 'gemini-api'
  | 'web-llm'
  | 'groq'
  | 'cerebras'
  | 'mistral'
  | 'openrouter'
  | 'ollama';

/** Backends visible in the browser picker. */
const BROWSER_VISIBLE: readonly ProviderId[] = [
  'gemini-nano',
  'gemini-api',
  'web-llm',
  'groq',
  'cerebras',
  'mistral',
  'openrouter',
  'ollama',
];

/**
 * Priority order for `BackendMatrix.pickBest`. Cloud APIs first (no download,
 * works everywhere with a free key), then local daemon, then on-device
 * inference.
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
];

/** Backends that need a local/desktop runtime, excluded on mobile. */
const DESKTOP_ONLY: readonly ProviderId[] = ['gemini-nano', 'web-llm', 'ollama'];

const OLLAMA_MODEL_KEY = 'dagonizer-ollama-model';

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

export interface PickBestOptions {
  /** When true, desktop-only backends (gemini-nano, web-llm) are excluded. */
  readonly isMobile?: boolean;
}

export interface InstantiateInputs {
  readonly apiKeys?: Partial<Record<ProviderId, string>>;
  readonly webLlmModel?: string;
  readonly onWebLlmProgress?: (report: WebLlmInitReportType) => void;
  /**
   * Ollama chat model to use. Defaults to the installed model the detector
   * resolved from the daemon's tag list (e.g. 'llama3.2:3b'); pass a value to
   * override with a specific model the host has pulled.
   */
  readonly ollamaModel?: string;
}

/**
 * ApiKeyStore: per-provider API key persistence in localStorage.
 */
export class ApiKeyStore {
  static readonly #VALID_ID_SET: ReadonlySet<string> = new Set<string>(['gemini-nano', 'gemini-api', 'web-llm', 'groq', 'cerebras', 'mistral', 'openrouter', 'ollama']);

  /** Returns true when `value` is a valid ProviderId string. */
  static isProviderId(value: string): value is ProviderId {
    return ApiKeyStore.#VALID_ID_SET.has(value);
  }

  /** Load the per-provider API key map from localStorage. */
  static load(): Partial<Record<ProviderId, string>> {
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
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const result: Partial<Record<ProviderId, string>> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string' && ApiKeyStore.isProviderId(key)) result[key] = val;
      }
      return result;
    } catch {
      return {};
    }
  }

  /** Persist the per-provider API key map to localStorage. */
  static save(keys: Partial<Record<ProviderId, string>>): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('dagonizer-api-keys', JSON.stringify(keys));
  }
}

/**
 * OllamaModels: Ollama model persistence utilities.
 *
 * Model selection is delegated to the adapter instance contract:
 * `OllamaApiAdapter.selectChatModel({ preferred })` discovers models from
 * `GET /api/tags` and selects the best available chat model, honoring the
 * visitor's `preferred` choice when installed. `loadModel` / `saveModel`
 * persist the visitor's explicit model preference across sessions.
 */
export class OllamaModels {
  /**
   * Load the visitor's explicitly-chosen Ollama model from localStorage, or the
   * empty string when they have not chosen one. Empty means "auto": the adapter
   * resolves an installed chat model from the daemon's tag list.
   */
  static loadModel(): string {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(OLLAMA_MODEL_KEY) ?? '';
  }

  /** Persist the Ollama model name. */
  static saveModel(model: string): void {
    if (typeof localStorage === 'undefined') return;
    if (model.trim().length === 0) {
      localStorage.removeItem(OLLAMA_MODEL_KEY);
      return;
    }
    localStorage.setItem(OLLAMA_MODEL_KEY, model.trim());
  }
}

/**
 * BackendMatrix: backend detection, ranking, and visibility utilities.
 */
export class BackendMatrix {
  static async detect(inputs: DetectionInputs = {}): Promise<readonly BackendAvailability[]> {
    const keys = inputs.apiKeys ?? {};
    const out: BackendAvailability[] = [];

    const nanoStatus: GeminiNanoAvailabilityType = await GeminiNanoAdapter.detect();
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

    const webGpu = await new WebLlmAdapter().probe();
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
    // No API key required. Model discovery uses the adapter instance contract:
    // `selectChatModel` calls `GET /api/tags`, filters embedding models, and
    // selects the best available chat model (honors `preferred` when installed,
    // then prefers local-only models, then first chat model overall).
    const ollamaUp = await OllamaProbe.detect();
    let ollamaModel: string | null = null;
    if (ollamaUp) {
      const ollamaAdapter = new OllamaApiAdapter();
      ollamaModel = await ollamaAdapter.selectChatModel({
        ...(inputs.preferredOllamaModel !== undefined && inputs.preferredOllamaModel.length > 0
          ? { 'preferred': inputs.preferredOllamaModel }
          : {}),
      });
    }
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

    return out;
  }

  /**
   * Pick the highest-priority runnable backend. Filters desktop-only backends
   * when `options.isMobile` is true. Returns `null` when nothing is runnable.
   */
  static pickBest(
    available: readonly BackendAvailability[],
    options: PickBestOptions = {},
  ): BackendAvailability | null {
    const { isMobile = false } = options;
    const byId = new Map(available.map((b) => [b.id, b]));

    for (const id of PRIORITY_ORDER) {
      if (isMobile && DESKTOP_ONLY.includes(id)) continue;
      if (!BROWSER_VISIBLE.includes(id)) continue;
      const entry = byId.get(id);
      if (entry !== undefined && entry.runnable) return entry;
    }
    return null;
  }

  /**
   * True when no model is available and the visitor must enable one.
   */
  static hasNoRunnableModel(
    available: readonly BackendAvailability[],
    options: PickBestOptions = {},
  ): boolean {
    return BackendMatrix.pickBest(available, options) === null;
  }

  /**
   * Returns the subset of `BROWSER_VISIBLE` backends appropriate for the
   * given device context. On mobile, desktop-only backends are excluded.
   */
  static browserVisible(isMobile: boolean): readonly ProviderId[] {
    if (isMobile) {
      return BROWSER_VISIBLE.filter((id) => !DESKTOP_ONLY.includes(id));
    }
    return BROWSER_VISIBLE;
  }
}

/**
 * ProviderInstantiator: factory for LlmClientInterface instances given a ProviderId.
 */
export class ProviderInstantiator {
  static instantiate(id: ProviderId, inputs: InstantiateInputs = {}): LlmClientInterface {
    const keys = inputs.apiKeys ?? {};

    /** Require a non-empty API key for cloud-backend providers. */
    const requireKey = (providerId: ProviderId, label: string): string => {
      const key = keys[providerId];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError(`${label} requires an API key`, { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return key;
    };

    const providerDispatch: Record<ProviderId, () => LlmClientInterface> = {
      'gemini-nano': () => new BaseLlmClient(new GeminiNanoAdapter()),
      'gemini-api':  () => {
        const key = keys['gemini-api'];
        if (typeof key !== 'string' || key.length === 0) {
          throw new LlmError('gemini-api requires an AI Studio API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
        }
        return new BaseLlmClient(new GeminiApiAdapter(key));
      },
      'web-llm': () => {
        const options: { model?: string; onProgress?: (report: WebLlmInitReportType) => void } = {};
        if (inputs.webLlmModel !== undefined) options.model = inputs.webLlmModel;
        if (inputs.onWebLlmProgress !== undefined) options.onProgress = inputs.onWebLlmProgress;
        return new BaseLlmClient(new WebLlmAdapter(options));
      },
      'groq':       () => new BaseLlmClient(OpenAiCompatibleAdapter.groq(requireKey('groq', 'groq'))),
      'cerebras':   () => new BaseLlmClient(OpenAiCompatibleAdapter.cerebras(requireKey('cerebras', 'cerebras'))),
      'mistral':    () => new BaseLlmClient(OpenAiCompatibleAdapter.mistral(requireKey('mistral', 'mistral'))),
      'openrouter': () => new BaseLlmClient(OpenAiCompatibleAdapter.openRouter(requireKey('openrouter', 'openrouter'))),
      'ollama': () => {
        // No API key required. Ollama's loopback daemon accepts a
        // placeholder Bearer header. Pass the installed model the picker
        // resolved; an empty string means "no explicit model" and is treated
        // as absent so the adapter never sends a blank model name.
        const model = inputs.ollamaModel;
        return new BaseLlmClient(new OllamaApiAdapter(
          typeof model === 'string' && model.length > 0 ? { 'model': model } : {},
        ));
      },
    };

    const factory = providerDispatch[id];
    return factory();
  }
}

export { BaseLlmClient } from './BaseLlmClient.ts';
export {
  GeminiApiAdapter,
  GeminiNanoAdapter,
  OllamaApiAdapter,
  OpenAiCompatibleAdapter,
  WebLlmAdapter,
  OllamaProbe,
} from './adapters/index.ts';
export { MobileDetection } from './MobileDetection.ts';
export type { GeminiNanoAvailabilityType, WebLlmInitReportType };
