/**
 * WebLlmAdapter: fully in-browser MLC WebLLM adapter.
 *
 * Lazy-loads the WebLLM ESM bundle and a small Phi-3.5 / Llama 3.2
 * quantized model (~700 MB) on first use; subsequent calls reuse the
 * engine. WebGPU is required (`navigator.gpu`).
 *
 * ToolInterface calling is not native to WebLLM; we use `response_format` with
 * `{ type: 'json_object' }` and the tool-plan JSON Schema in the
 * system context. The model returns a JSON blob that we decode back
 * into `ToolCall[]` via JSON coercion (`ToolCallCodec.decode`).
 */

import type {
  ChatRequestType,
  ChatResponseType,
  ErrorClassificationType,
} from '@studnicky/dagonizer/adapter';
import { BaseAdapter, ChatResponseMessageBuilder, Classifications, LlmError, ToolCallCodec, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import type {
  WebLlmCompletionResultType,
  WebLlmEngineType,
  WebLlmInitReportType,
} from './WebLlmHost.js';
import {
  webLlmEngineValidator,
  webLlmModuleValidator,
} from './WebLlmHost.js';

const DEFAULT_MODEL = 'Phi-3.5-mini-instruct-q4f16_1-MLC';
const WEBLLM_ESM = 'https://esm.run/@mlc-ai/web-llm';
const WEBLLM_MAX_ATTEMPTS = 2;
const GPU_PROBE_TIMEOUT_MS = 1_500;

/**
 * Snapshot of the `@mlc-ai/web-llm` prebuilt model catalog
 * (`prebuiltAppConfig.model_list`). The catalog is static data — no network
 * call is needed and no WebGPU is required to enumerate it. This list is
 * accurate as of web-llm 0.2.x; update when upstream adds new model IDs.
 * All web-llm models are on-device chat models (`cloud: false`, `variant: 'chat'`).
 */
const PREBUILT_MODEL_IDS: readonly string[] = [
  'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Llama-3.2-3B-Instruct-q4f32_1-MLC',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  'Llama-3.1-8B-Instruct-q4f16_1-MLC',
  'Llama-3-8B-Instruct-q4f32_1-MLC',
  'Llama-3-8B-Instruct-q4f16_1-MLC',
  'Phi-3.5-mini-instruct-q4f16_1-MLC',
  'Phi-3.5-mini-instruct-q4f32_1-MLC',
  'Phi-3-mini-4k-instruct-q4f16_1-MLC',
  'Phi-3-mini-4k-instruct-q4f32_1-MLC',
  'Mistral-7B-Instruct-v0.3-q4f16_1-MLC',
  'Mistral-7B-Instruct-v0.3-q4f32_1-MLC',
  'gemma-2-2b-it-q4f16_1-MLC',
  'gemma-2-2b-it-q4f32_1-MLC',
  'gemma-2-9b-it-q4f16_1-MLC',
  'gemma-2-9b-it-q4f32_1-MLC',
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  'Qwen2.5-3B-Instruct-q4f16_1-MLC',
  'Qwen2.5-7B-Instruct-q4f16_1-MLC',
  'SmolLM2-135M-Instruct-q4f16_1-MLC',
  'SmolLM2-360M-Instruct-q4f16_1-MLC',
  'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
  'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC',
];

const PREBUILT_MODELS: readonly LlmModelType[] = PREBUILT_MODEL_IDS.map(
  (id): LlmModelType => ({ 'name': id, 'variant': 'chat', 'cloud': false }),
);

/**
 * Pending-engine registry keyed on the adapter instance. Holding the lazy
 * boot promise here (rather than in a `Promise | null` instance field that
 * flips type after construction) keeps every `WebLlmAdapter` instance's
 * hidden class stable: the instance shape is fixed at construction and
 * never transitions a property's type. The entry is set once on first
 * `#engine()` call and reused for the adapter's lifetime.
 */
const enginePromises = new WeakMap<WebLlmAdapter, Promise<WebLlmEngineType>>();

export type WebLlmAdapterOptionsType = {
  readonly model?: string;
  readonly maxAttempts?: number;
};

export class WebLlmAdapter extends BaseAdapter {
  /**
   * Resolve `navigator.gpu` from the global scope as `unknown`. The
   * standard lib `Navigator` typings predate WebGPU, so the WebGPU object
   * enters as `unknown` at this foreign boundary and is probed structurally
   * by the callers — never cast to a fabricated shape.
   */
  private static gpu(): object | undefined {
    const nav: unknown = Reflect.get(globalThis, 'navigator');
    if (typeof nav !== 'object' || nav === null) return undefined;
    const gpu: unknown = Reflect.get(nav, 'gpu');
    if (typeof gpu !== 'object' || gpu === null) return undefined;
    return gpu;
  }

  static detectWebGpu(): boolean {
    return WebLlmAdapter.gpu() !== undefined;
  }

  constructor(options: WebLlmAdapterOptionsType = {}) {
    super(
      'web-llm',
      'WebLLM (Phi-3.5 in-browser)',
      // Phi-3.5 supports structured output but tool-call format is
      // inconsistent across the small in-browser model class.
      { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      {
        'maxAttempts': options.maxAttempts ?? WEBLLM_MAX_ATTEMPTS,
        ...(options.model !== undefined ? { 'model': options.model } : {}),
      },
    );
  }

  /**
   * Called for each progress report emitted by WebLLM during model
   * download and initialisation. Subclasses override to observe progress
   * (e.g. update a loading indicator). The default implementation is a
   * no-op; the adapter is usable without overriding this method.
   */
  protected onInitProgress(_report: WebLlmInitReportType): void {
    // no-op default — subclasses override to handle progress events
  }

  /**
   * Returns the static prebuilt catalog shipped with `@mlc-ai/web-llm`.
   * All entries are on-device chat models — no network call and no WebGPU
   * required to enumerate them. The catalog is a constant; the returned
   * Promise always resolves immediately.
   */
  override listModels(_options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    return Promise.resolve(PREBUILT_MODELS);
  }

  /**
   * Probe true when WebGPU is reachable AND `requestAdapter()` yields a
   * real hardware adapter. `navigator.gpu` presence alone is not
   * enough; some Chromium variants expose the API surface but fail to
   * acquire a backing device (no discrete GPU, missing driver, blocked
   * by enterprise policy). Bounded by a short timeout so a stuck
   * driver call cannot delay cascade selection. Never throws.
   */
  override async probe(): Promise<boolean> {
    const gpu = WebLlmAdapter.gpu();
    if (gpu === undefined) return false;
    const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
    if (typeof requestAdapter !== 'function') return false;
    try {
      const pending: unknown = Reflect.apply(requestAdapter, gpu, []);
      const adapter = await Promise.race<unknown>([
        Promise.resolve(pending),
        new Promise((resolve) => setTimeout(() => { resolve(null); }, GPU_PROBE_TIMEOUT_MS)),
      ]);
      return adapter !== null;
    } catch {
      return false;
    }
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const engine = await this.#engine();

    // ToolInterface-calling via JSON-coerce: inject a system message with the
    // tool-plan schema then ask for json_object.
    const messages = this.#composeMessages(request);
    const wantsJson = (request.tools.length > 0)
      || request.outputSchema.variant === 'schema';

    const responseFormat: { type: 'json_object' | 'text' } = { 'type': wantsJson ? 'json_object' : 'text' };
    let result: WebLlmCompletionResultType;
    try {
      result = await engine.chat.completions.create({
        'messages':        messages,
        'temperature':     request.temperature,
        'response_format': responseFormat,
      });
    } catch (err) {
      throw this.#classifyWebLlmError(err);
    }

    const raw = result.choices[0]?.message.content ?? '';
    const text = raw.trim();
    const toolCalls = request.tools.length > 0 ? ToolCallCodec.decode(raw, 'webllm') : [];
    return {
      'message': ChatResponseMessageBuilder.from(text, toolCalls),
      'finishReason': toolCalls.length > 0 ? 'tool_call' : 'stop',
      'usage': ZERO_TOKEN_USAGE,
    };
  }

  protected override classify(error: unknown): ErrorClassificationType {
    const msg = error instanceof Error ? error.message : String(error);
    if (/webgpu/iu.test(msg)) return Classifications['MODEL_NOT_FOUND'];
    return super.classify(error);
  }

  #composeMessages(request: ChatRequestType): ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    for (const m of request.messages) {
      if (m.role === 'tool') {
        // ToolInterface result rolled into the user channel as scaffolding.
        messages.push({ 'role': 'user', 'content': BaseAdapter.formatToolResult(m) });
        continue;
      }
      if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
        messages.push({ 'role': m.role, 'content': m.content });
      }
    }

    if (request.tools.length > 0) {
      messages.push({
        'role': 'system',
        'content': `You must respond with a JSON object of the form { "tool_calls": [{ "name": "...", "arguments": { ... } }] } using only these tool names: ${request.tools.map((t) => `"${t.name}"`).join(', ')}. Emit an empty array when no tool helps.`,
      });
    } else if (request.outputSchema.variant === 'schema') {
      messages.push({
        'role': 'system',
        'content': `You must respond with a JSON object that satisfies this JSON Schema: ${JSON.stringify(request.outputSchema.schema)}`,
      });
    }

    return messages;
  }

  #engine(): Promise<WebLlmEngineType> {
    const existing = enginePromises.get(this);
    if (existing !== undefined) return existing;
    const pending = this.#boot();
    enginePromises.set(this, pending);
    return pending;
  }

  async #boot(): Promise<WebLlmEngineType> {
    if (!WebLlmAdapter.detectWebGpu()) {
      throw new LlmError('navigator.gpu unavailable', Classifications['MODEL_NOT_FOUND']);
    }
    const selectedModel = this.modelOrEmpty !== '' ? this.modelOrEmpty : DEFAULT_MODEL;
    const rawModule: unknown = await import(/* @vite-ignore */ WEBLLM_ESM);
    const mod = webLlmModuleValidator.validate(rawModule);
    const rawEngine: unknown = await mod.CreateMLCEngine(selectedModel, {
      'initProgressCallback': (report) => { this.onInitProgress(report); },
    });
    return webLlmEngineValidator.validate(rawEngine);
  }

  #classifyWebLlmError(err: unknown): LlmError {
    const message = err instanceof Error ? err.message : String(err);
    if (/aborted|timeout/iu.test(message)) return new LlmError(message, Classifications['TIMEOUT'], { 'cause': err });
    return new LlmError(message, Classifications['UNKNOWN'], { 'cause': err });
  }
}
