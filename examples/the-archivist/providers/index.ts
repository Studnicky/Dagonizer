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
 *   anthropic    →  Anthropic Messages API
 *
 * Every backend is one `LlmAdapterInterface` (transport + native tool format)
 * wrapped by `BaseLlmClient` (prompt choreography). The choice between
 * backends is just a choice of adapter; the high-level `LlmClientInterface`
 * surface is identical.
 *
 * `BackendMatrix.detect(inputs)` probes each backend and returns rows for all.
 * For every runnable backend the detector calls `adapter.selectChatModel()` to
 * resolve the live model name. The adapter's configured default acts as an
 * implicit preference confirmed against the provider's catalogue; when absent
 * the first available chat model is used. The resolved name is stored in
 * `BackendAvailability.resolvedModel` and reflected in `displayName`.
 *
 * Cloud adapters (groq/cerebras/mistral/openrouter/gemini-api/anthropic) are
 * runnable when their key is present in `apiKeys`. On-device backends
 * (gemini-nano, web-llm, ollama) are runnable when the runtime detects them.
 * Ollama requires both the daemon running and at least one chat model installed.
 *
 * `BackendMatrix.pickBest(backends, { isMobile })` excludes on-device backends
 * when `isMobile` is true, then ranks remaining runnable entries by
 * priority: gemini-nano (browser built-in) → web-llm → groq → cerebras →
 * gemini-api → anthropic → mistral → openrouter → ollama.
 *
 * API keys are stored as a JSON blob in `dagonizer-api-keys` in
 * localStorage, keyed by `ProviderId`. Use `ApiKeyStore.load()` /
 * `ApiKeyStore.save()` to read/write.
 */

import type { LlmClientInterface } from '../services.ts';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import { prompts } from './prompts.ts';
import {
  AnthropicApiAdapter,
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
import { BaseLlmClient, type BaseLlmClientOptions } from './BaseLlmClient.ts';
import type { IntentClassifier } from './IntentClassifier.ts';

export type ProviderId =
  | 'gemini-nano'
  | 'gemini-api'
  | 'web-llm'
  | 'groq'
  | 'cerebras'
  | 'mistral'
  | 'openrouter'
  | 'anthropic'
  | 'ollama';

/**
 * Backends visible in the browser picker. On-device web models first, then
 * every other backend alphabetical by displayName — mirrors the dropdown order.
 */
const BROWSER_VISIBLE: readonly ProviderId[] = [
  'gemini-nano',
  'web-llm',
  'anthropic',
  'cerebras',
  'gemini-api',
  'groq',
  'mistral',
  'ollama',
  'openrouter',
];

/**
 * Priority order for `BackendMatrix.pickBest`. On-device web models first
 * (no key, fully in-browser), then cloud APIs, then the local daemon.
 */
const PRIORITY_ORDER: readonly ProviderId[] = [
  'gemini-nano',   // browser built-in LanguageModel
  'web-llm',       // browser WASM
  'groq',          // cloud, fast, reliable structured output
  'cerebras',      // cloud, very fast
  'gemini-api',    // cloud, strong tool-use
  'anthropic',     // cloud, strong tool-use
  'mistral',       // cloud
  'openrouter',    // cloud, broad model access
  'ollama',        // local daemon (needs model pulled)
];

/** Backends that need a local/desktop runtime, excluded on mobile. */
const DESKTOP_ONLY: readonly ProviderId[] = ['gemini-nano', 'web-llm', 'ollama'];

export interface BackendAvailability {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Live model catalogue discovered from the provider, when available. */
  readonly models?: readonly LlmModelType[];
  /** Runnable right now (no further user action required). */
  readonly runnable: boolean;
  /** Runnable but requires a one-time action (download, key entry). */
  readonly needsAction: 'download' | 'api-key' | null;
  /** Free-text hint for the UI (download size, error reason, etc.). */
  readonly hint?: string;
  /**
   * The chat model the adapter resolved via live model-list discovery, or
   * `undefined` when the backend is not runnable (no key, daemon down, etc.).
   * The runner instantiates the adapter with this value so the adapter always
   * targets a model confirmed against the provider's live catalogue.
   */
  readonly resolvedModel?: string;
}

export interface DetectionInputs {
  /** Per-provider API keys. Cloud adapters are runnable when their key is present. */
  readonly apiKeys?: Partial<Record<ProviderId, string>>;
  /** Per-provider preferred model names. Each is honored only when the provider lists it. */
  readonly preferredModels?: Partial<Record<ProviderId, string>>;
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
  /**
   * The chat model to instantiate the adapter with. Set by the runner from the
   * active backend's `BackendAvailability.resolvedModel` (populated by
   * `BackendMatrix.detect` via live model-list discovery). An empty string means
   * "no explicit model": the adapter falls back to its internal default.
   */
  readonly model?: string;
  readonly onWebLlmProgress?: (report: WebLlmInitReportType) => void;
  readonly intentClassifier?: IntentClassifier;
  /** Visitor device language (ISO 639-1); threaded into the instantiated client's prompts. */
  readonly language?: string;
}

/**
 * ApiKeyStore: per-provider API key persistence in localStorage.
 */
export class ApiKeyStore {
  static readonly #VALID_ID_SET: ReadonlySet<string> = new Set<string>(['gemini-nano', 'gemini-api', 'web-llm', 'groq', 'cerebras', 'mistral', 'openrouter', 'anthropic', 'ollama']);

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
 * PreferredModels: per-provider model preference persistence in localStorage.
 *
 * Preferences are discovery inputs only. `BackendMatrix.detect` passes them to
 * `selectChatModel({ preferred })`, then stores the confirmed model in
 * `BackendAvailability.resolvedModel`.
 */
export class PreferredModels {
  static readonly #STORAGE_KEY = 'dagonizer-preferred-models';
  static readonly #LEGACY_OLLAMA_KEY = 'dagonizer-ollama-model';

  static load(): Partial<Record<ProviderId, string>> {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(PreferredModels.#STORAGE_KEY);
    if (raw === null) {
      const legacy = localStorage.getItem(PreferredModels.#LEGACY_OLLAMA_KEY);
      if (legacy !== null && legacy.trim().length > 0) {
        const migrated: Partial<Record<ProviderId, string>> = { 'ollama': legacy.trim() };
        PreferredModels.save(migrated);
        localStorage.removeItem(PreferredModels.#LEGACY_OLLAMA_KEY);
        return migrated;
      }
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const result: Partial<Record<ProviderId, string>> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'string' && ApiKeyStore.isProviderId(key) && val.trim().length > 0) {
          result[key] = val.trim();
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  static get(id: ProviderId): string {
    return PreferredModels.load()[id] ?? '';
  }

  static save(preferences: Partial<Record<ProviderId, string>>): void {
    if (typeof localStorage === 'undefined') return;
    const result: Partial<Record<ProviderId, string>> = {};
    for (const [key, val] of Object.entries(preferences)) {
      if (typeof val === 'string' && ApiKeyStore.isProviderId(key) && val.trim().length > 0) {
        result[key] = val.trim();
      }
    }
    if (Object.keys(result).length === 0) {
      localStorage.removeItem(PreferredModels.#STORAGE_KEY);
      return;
    }
    localStorage.setItem(PreferredModels.#STORAGE_KEY, JSON.stringify(result));
  }

  static set(id: ProviderId, model: string): Partial<Record<ProviderId, string>> {
    const current = PreferredModels.load();
    const next: Partial<Record<ProviderId, string>> = {};
    for (const [key, val] of Object.entries(current)) {
      if (ApiKeyStore.isProviderId(key) && key !== id && val.length > 0) next[key] = val;
    }
    if (model.trim().length > 0) next[id] = model.trim();
    PreferredModels.save(next);
    return next;
  }

  static clear(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PreferredModels.#STORAGE_KEY);
  }
}

/**
 * BackendMatrix: backend detection, ranking, and visibility utilities.
 */
export class BackendMatrix {
  /** Returns `{ preferred: name }` only when a non-empty preferred model is set for `id`. */
  static #preferredOpt(
    preferredModels: Partial<Record<ProviderId, string>>,
    id: ProviderId,
  ): { readonly preferred: string } | undefined {
    const preferred = preferredModels[id];
    return typeof preferred === 'string' && preferred.trim().length > 0
      ? { 'preferred': preferred.trim() }
      : undefined;
  }

  static async detect(inputs: DetectionInputs = {}): Promise<readonly BackendAvailability[]> {
    const keys = inputs.apiKeys ?? {};
    const preferredModels: Partial<Record<ProviderId, string>> = {
      ...(inputs.preferredModels ?? {}),
      ...(inputs.preferredOllamaModel !== undefined && inputs.preferredOllamaModel.length > 0
        ? { 'ollama': inputs.preferredOllamaModel }
        : {}),
    };
    const out: BackendAvailability[] = [];

    // gemini-nano: browser built-in LanguageModel. selectChatModel returns the
    // single on-device nano model id; discovery is pure/static (no network call).
    const nanoStatus: GeminiNanoAvailabilityType = await GeminiNanoAdapter.detect();
    const nanoRunnable = nanoStatus === 'available';
    let nanoModel: string | null = null;
    let nanoModels: readonly LlmModelType[] = [];
    if (nanoRunnable) {
      const adapter = new GeminiNanoAdapter();
      [nanoModel, nanoModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'gemini-nano')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'gemini-nano',
      'displayName': nanoModel !== null
        ? `Browser built-in LanguageModel (${nanoModel})`
        : 'Browser built-in LanguageModel (on-device)',
      'runnable': nanoRunnable,
      'needsAction': nanoStatus === 'downloadable' || nanoStatus === 'downloading' ? 'download' : null,
      ...(nanoModel !== null ? { 'resolvedModel': nanoModel } : {}),
      ...(nanoModels.length > 0 ? { 'models': nanoModels } : {}),
      'hint': nanoStatus === 'unavailable'
        ? 'Requires Chrome 138+ or Edge with the Prompt API enabled.'
        : nanoStatus === 'downloadable'
          ? 'The browser will download the model (~2 GB) on first use.'
          : nanoStatus === 'downloading'
            ? 'The browser is currently downloading the model. Try again shortly.'
            : 'Ready.',
    });

    // gemini-api: cloud REST with user-supplied AI Studio key.
    const geminiKey = keys['gemini-api'];
    const hasGeminiKey = typeof geminiKey === 'string' && geminiKey.length > 0;
    let geminiModel: string | null = null;
    let geminiModels: readonly LlmModelType[] = [];
    if (hasGeminiKey && typeof geminiKey === 'string') {
      const adapter = new GeminiApiAdapter(geminiKey);
      [geminiModel, geminiModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'gemini-api')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'gemini-api',
      'displayName': geminiModel !== null
        ? `Gemini API (${geminiModel})`
        : 'Gemini API (your AI Studio key)',
      'runnable': hasGeminiKey,
      'needsAction': hasGeminiKey ? null : 'api-key',
      ...(geminiModel !== null ? { 'resolvedModel': geminiModel } : {}),
      ...(geminiModels.length > 0 ? { 'models': geminiModels } : {}),
      'hint': 'Paste a free Google AI Studio key. Nothing leaves your browser except the request itself.',
    });

    // web-llm: in-browser inference via WebGPU. selectChatModel returns the
    // default prebuilt model from a static catalogue (no network call).
    const webGpu = await new WebLlmAdapter().probe();
    let webLlmModel: string | null = null;
    let webLlmModels: readonly LlmModelType[] = [];
    if (webGpu) {
      const adapter = new WebLlmAdapter();
      [webLlmModel, webLlmModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'web-llm')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'web-llm',
      'displayName': webLlmModel !== null
        ? `WebLLM (${webLlmModel})`
        : 'WebLLM (in-browser)',
      'runnable': webGpu,
      'needsAction': null,
      ...(webLlmModel !== null ? { 'resolvedModel': webLlmModel } : {}),
      ...(webLlmModels.length > 0 ? { 'models': webLlmModels } : {}),
      'hint': webGpu
        ? 'Model lazy-loads (~700-800 MB) on first use. Cached afterwards.'
        : 'This browser does not support WebGPU.',
    });

    // groq: cloud REST, free tier.
    const groqKey = keys['groq'];
    const hasGroqKey = typeof groqKey === 'string' && groqKey.length > 0;
    let groqModel: string | null = null;
    let groqModels: readonly LlmModelType[] = [];
    if (hasGroqKey && typeof groqKey === 'string') {
      const adapter = OpenAiCompatibleAdapter.groq(groqKey);
      [groqModel, groqModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'groq')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'groq',
      'displayName': groqModel !== null
        ? `Groq (${groqModel})`
        : 'Groq',
      'runnable': hasGroqKey,
      'needsAction': hasGroqKey ? null : 'api-key',
      ...(groqModel !== null ? { 'resolvedModel': groqModel } : {}),
      ...(groqModels.length > 0 ? { 'models': groqModels } : {}),
      'hint': 'Free key at console.groq.com/keys. ~30 RPM on the free tier.',
    });

    // cerebras: cloud REST, free tier.
    const cerebrasKey = keys['cerebras'];
    const hasCerebrasKey = typeof cerebrasKey === 'string' && cerebrasKey.length > 0;
    let cerebrasModel: string | null = null;
    let cerebrasModels: readonly LlmModelType[] = [];
    if (hasCerebrasKey && typeof cerebrasKey === 'string') {
      const adapter = OpenAiCompatibleAdapter.cerebras(cerebrasKey);
      [cerebrasModel, cerebrasModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'cerebras')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'cerebras',
      'displayName': cerebrasModel !== null
        ? `Cerebras (${cerebrasModel})`
        : 'Cerebras',
      'runnable': hasCerebrasKey,
      'needsAction': hasCerebrasKey ? null : 'api-key',
      ...(cerebrasModel !== null ? { 'resolvedModel': cerebrasModel } : {}),
      ...(cerebrasModels.length > 0 ? { 'models': cerebrasModels } : {}),
      'hint': 'Free key at cloud.cerebras.ai. Ultra-fast inference on Wafer-Scale Engine.',
    });

    // mistral: cloud REST, free tier.
    const mistralKey = keys['mistral'];
    const hasMistralKey = typeof mistralKey === 'string' && mistralKey.length > 0;
    let mistralModel: string | null = null;
    let mistralModels: readonly LlmModelType[] = [];
    if (hasMistralKey && typeof mistralKey === 'string') {
      const adapter = OpenAiCompatibleAdapter.mistral(mistralKey);
      [mistralModel, mistralModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'mistral')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'mistral',
      'displayName': mistralModel !== null
        ? `Mistral (${mistralModel})`
        : 'Mistral',
      'runnable': hasMistralKey,
      'needsAction': hasMistralKey ? null : 'api-key',
      ...(mistralModel !== null ? { 'resolvedModel': mistralModel } : {}),
      ...(mistralModels.length > 0 ? { 'models': mistralModels } : {}),
      'hint': 'Free key at console.mistral.ai/api-keys/.',
    });

    // openrouter: cloud REST, free-tier models.
    const openRouterKey = keys['openrouter'];
    const hasOpenRouterKey = typeof openRouterKey === 'string' && openRouterKey.length > 0;
    let openRouterModel: string | null = null;
    let openRouterModels: readonly LlmModelType[] = [];
    if (hasOpenRouterKey && typeof openRouterKey === 'string') {
      const adapter = OpenAiCompatibleAdapter.openRouter(openRouterKey);
      [openRouterModel, openRouterModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'openrouter')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'openrouter',
      'displayName': openRouterModel !== null
        ? `OpenRouter (${openRouterModel})`
        : 'OpenRouter',
      'runnable': hasOpenRouterKey,
      'needsAction': hasOpenRouterKey ? null : 'api-key',
      ...(openRouterModel !== null ? { 'resolvedModel': openRouterModel } : {}),
      ...(openRouterModels.length > 0 ? { 'models': openRouterModels } : {}),
      'hint': 'Free key at openrouter.ai/keys. Routes to free-tier models.',
    });

    // anthropic: cloud REST, requires paid/free key.
    const anthropicKey = keys['anthropic'];
    const hasAnthropicKey = typeof anthropicKey === 'string' && anthropicKey.length > 0;
    let anthropicModel: string | null = null;
    let anthropicModels: readonly LlmModelType[] = [];
    if (hasAnthropicKey && typeof anthropicKey === 'string') {
      const adapter = new AnthropicApiAdapter(anthropicKey);
      [anthropicModel, anthropicModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'anthropic')),
        adapter.listModels(),
      ]);
    }
    out.push({
      'id': 'anthropic',
      'displayName': anthropicModel !== null
        ? `Anthropic (${anthropicModel})`
        : 'Anthropic',
      'runnable': hasAnthropicKey,
      'needsAction': hasAnthropicKey ? null : 'api-key',
      ...(anthropicModel !== null ? { 'resolvedModel': anthropicModel } : {}),
      ...(anthropicModels.length > 0 ? { 'models': anthropicModels } : {}),
      'hint': 'Key at console.anthropic.com/settings/keys.',
    });

    // ollama: local daemon. Browser hits 127.0.0.1:11434; if the daemon is up
    // and CORS-permissive the version endpoint replies in <50 ms. No API key
    // required. selectChatModel queries GET /api/tags, filters embedding models,
    // and selects the best available chat model (honors `preferred` when
    // installed, then prefers local-only models, then first chat model overall).
    const ollamaUp = await OllamaProbe.detect();
    let ollamaModel: string | null = null;
    let ollamaModels: readonly LlmModelType[] = [];
    if (ollamaUp) {
      const adapter = new OllamaApiAdapter();
      [ollamaModel, ollamaModels] = await Promise.all([
        adapter.selectChatModel(BackendMatrix.#preferredOpt(preferredModels, 'ollama')),
        adapter.listModels(),
      ]);
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
      ...(ollamaModels.length > 0 ? { 'models': ollamaModels } : {}),
      'hint': !ollamaUp
        ? 'Start the Ollama daemon at 127.0.0.1:11434 and ensure CORS allows the docs origin (OLLAMA_ORIGINS).'
        : ollamaModel === null
          ? 'Daemon detected but no chat model is installed. Install any chat-capable model.'
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
 *
 * `inputs.model` is the discovered model from `BackendAvailability.resolvedModel`
 * (populated by `BackendMatrix.detect` via live model-list discovery). An empty or
 * absent model means "no explicit override": the adapter uses its internal default.
 */
export class ProviderInstantiator {
  static instantiate(id: ProviderId, inputs: InstantiateInputs = {}): LlmClientInterface {
    const keys = inputs.apiKeys ?? {};
    const model = typeof inputs.model === 'string' && inputs.model.length > 0 ? inputs.model : '';

    /** Require a non-empty API key for cloud-backend providers. */
    const requireKey = (providerId: ProviderId, label: string): string => {
      const key = keys[providerId];
      if (typeof key !== 'string' || key.length === 0) {
        throw new LlmError(`${label} requires an API key`, { 'reason': 'AUTH_FAILED', 'retryable': false });
      }
      return key;
    };

    const modelOpt = model.length > 0 ? { 'model': model } : {};

    // Thread the vector intent classifier and visitor language into every client.
    const clientOptions: BaseLlmClientOptions = {
      ...(inputs.intentClassifier !== undefined ? { 'intentClassifier': inputs.intentClassifier } : {}),
      ...(inputs.language !== undefined ? { 'language': inputs.language } : {}),
    };

    const providerDispatch: Record<ProviderId, () => LlmClientInterface> = {
      // gemini-nano has a single on-device model; no model option accepted.
      'gemini-nano': () => new BaseLlmClient(new GeminiNanoAdapter({ 'systemPrompt': prompts.systemPrompt() }), clientOptions),
      'gemini-api':  () => {
        const key = keys['gemini-api'];
        if (typeof key !== 'string' || key.length === 0) {
          throw new LlmError('gemini-api requires an AI Studio API key', { 'reason': 'AUTH_FAILED', 'retryable': false });
        }
        return new BaseLlmClient(new GeminiApiAdapter(key, { ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions);
      },
      'web-llm': () => {
        const webLlmOpts: { model?: string; onProgress?: (report: WebLlmInitReportType) => void; systemPrompt?: string } = { ...modelOpt };
        if (inputs.onWebLlmProgress !== undefined) webLlmOpts.onProgress = inputs.onWebLlmProgress;
        webLlmOpts.systemPrompt = prompts.systemPrompt();
        return new BaseLlmClient(new WebLlmAdapter(webLlmOpts), clientOptions);
      },
      'groq':       () => new BaseLlmClient(OpenAiCompatibleAdapter.groq(requireKey('groq', 'groq'), { ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions),
      'cerebras':   () => new BaseLlmClient(OpenAiCompatibleAdapter.cerebras(requireKey('cerebras', 'cerebras'), { ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions),
      'mistral':    () => new BaseLlmClient(OpenAiCompatibleAdapter.mistral(requireKey('mistral', 'mistral'), { ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions),
      'openrouter': () => new BaseLlmClient(OpenAiCompatibleAdapter.openRouter(requireKey('openrouter', 'openrouter'), { ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions),
      'anthropic':  () => new BaseLlmClient(new AnthropicApiAdapter(requireKey('anthropic', 'anthropic'), { ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions),
      'ollama': () => {
        // No API key required. Ollama's loopback daemon accepts a placeholder
        // Bearer header. Pass the installed model the detector resolved; an
        // empty string means "no explicit model" so the adapter never sends a
        // blank model name.
        return new BaseLlmClient(new OllamaApiAdapter({ ...modelOpt, 'systemPrompt': prompts.systemPrompt() }), clientOptions);
      },
    };

    const factory = providerDispatch[id];
    return factory();
  }
}

export { BaseLlmClient } from './BaseLlmClient.ts';
export { EmbedderProvisioner } from './EmbedderProvisioner.ts';
export type { EmbedderProvisionOptionsType, EmbedderProvisionResultType } from './EmbedderProvisioner.ts';
export {
  AnthropicApiAdapter,
  GeminiApiAdapter,
  GeminiNanoAdapter,
  OllamaApiAdapter,
  OpenAiCompatibleAdapter,
  WebLlmAdapter,
  OllamaProbe,
} from './adapters/index.ts';
export { MobileDetection } from './MobileDetection.ts';
export type { GeminiNanoAvailabilityType, WebLlmInitReportType };
