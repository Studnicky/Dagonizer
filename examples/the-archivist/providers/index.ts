/**
 * Browser LLM provider matrix for the Archivist demo.
 *
 *   gemini-nano  →  Chrome built-in Prompt API (LanguageModel global)
 *   gemini-api   →  Google AI Studio REST with a user-supplied key
 *   web-llm      →  fully in-browser inference via WebGPU + @mlc-ai/web-llm
 *   stub         →  canned responses, always available
 *
 * Every backend is one `LlmAdapter` (transport + native tool format)
 * wrapped by `BaseLlmClient` (prompt choreography). The choice between
 * backends is just a choice of adapter — the high-level `LlmClient`
 * surface is identical.
 *
 * `detectBestBackend()` probes each one in priority order and returns
 * the first that is currently runnable. The widget surfaces the choice
 * (with an override dropdown) so visitors know which model answered.
 */

import type { LlmClient } from '../services.ts';

import {
  GeminiApiAdapter,
  GeminiNanoAdapter,
  StubAdapter,
  WebLlmAdapter,
  detectGeminiNano,
  detectWebGpu,
  type GeminiNanoAvailability,
  type WebLlmInitReport,
} from './adapters/index.ts';
import { BaseLlmClient } from './BaseLlmClient.ts';

export type ProviderId = 'gemini-nano' | 'gemini-api' | 'web-llm' | 'stub';

/** Backends visible in the browser picker. Stub is intentionally
 *  excluded — it's CLI-only fallback, not a "model the visitor chose". */
const BROWSER_VISIBLE: readonly ProviderId[] = ['gemini-nano', 'gemini-api', 'web-llm'];

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
  /** API key — if present, gemini-api is runnable without further prompts. */
  readonly apiKey?: string;
}

export async function detectBackends(inputs: DetectionInputs = {}): Promise<readonly BackendAvailability[]> {
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

  out.push({
    'id': 'gemini-api',
    'displayName': 'Gemini API (your AI Studio key)',
    'runnable': typeof inputs.apiKey === 'string' && inputs.apiKey.length > 0,
    'needsAction': typeof inputs.apiKey === 'string' && inputs.apiKey.length > 0 ? null : 'api-key',
    'hint': 'Paste a free Google AI Studio key. Nothing leaves your browser except the request itself.',
  });

  const webGpu = detectWebGpu();
  out.push({
    'id': 'web-llm',
    'displayName': 'WebLLM (Phi-3.5 in-browser)',
    // WebGPU is the only requirement — when present, WebLLM is
    // runnable (the model lazy-loads on first use). No API key, no
    // network beyond the model download from a CDN.
    'runnable': webGpu,
    'needsAction': null,
    'hint': webGpu
      ? 'Phi-3.5 mini lazy-loads (~780 MB) on first use. Cached afterwards.'
      : 'This browser does not support WebGPU.',
  });

  // Stub is intentionally NOT pushed here — when no real model is
  // available the runner surfaces a "no model detected" gate.
  return out;
}

/**
 * Pick the highest-priority runnable backend. Returns `null` when no
 * real model is available — the UI gates on that state and tells the
 * visitor what to enable (Chrome flags / API key / WebGPU).
 */
export function pickBestBackend(available: readonly BackendAvailability[]): BackendAvailability | null {
  return available.find((entry) => BROWSER_VISIBLE.includes(entry.id) && entry.runnable) ?? null;
}

/** True when no real model is available — visitor must enable one. */
export function hasNoRunnableModel(available: readonly BackendAvailability[]): boolean {
  return pickBestBackend(available) === null;
}

export interface InstantiateInputs {
  readonly apiKey?: string;
  readonly webLlmModel?: string;
  readonly onWebLlmProgress?: (report: WebLlmInitReport) => void;
}

export function instantiateProvider(id: ProviderId, inputs: InstantiateInputs = {}): LlmClient {
  switch (id) {
    case 'gemini-nano':
      return new BaseLlmClient(new GeminiNanoAdapter());
    case 'gemini-api':
      if (typeof inputs.apiKey !== 'string' || inputs.apiKey.length === 0) {
        throw new Error('gemini-api requires an AI Studio API key');
      }
      return new BaseLlmClient(new GeminiApiAdapter({ 'apiKey': inputs.apiKey }));
    case 'web-llm': {
      const options: { model?: string; onProgress?: (report: WebLlmInitReport) => void } = {};
      if (inputs.webLlmModel !== undefined) options.model = inputs.webLlmModel;
      if (inputs.onWebLlmProgress !== undefined) options.onProgress = inputs.onWebLlmProgress;
      return new BaseLlmClient(new WebLlmAdapter(options));
    }
    case 'stub':
      return new BaseLlmClient(new StubAdapter());
  }
}

export { BaseLlmClient } from './BaseLlmClient.ts';
export {
  GeminiApiAdapter,
  GeminiNanoAdapter,
  StubAdapter,
  WebLlmAdapter,
  detectGeminiNano,
  detectWebGpu,
} from './adapters/index.ts';
export type { GeminiNanoAvailability, WebLlmInitReport };
