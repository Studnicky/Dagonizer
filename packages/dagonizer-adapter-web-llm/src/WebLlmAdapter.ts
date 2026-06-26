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
import { BaseAdapter, ChatResponseMessageBuilder, Classifications, LlmError, ModelCost, ToolCallCodec, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import type {
  WebLlmEngineType,
  WebLlmInitReportType,
  WebLlmModuleInterface,
} from './WebLlmHost.js';
import {
  webLlmEngineValidator,
  webLlmModuleValidator,
} from './WebLlmHost.js';

const DEFAULT_MODEL = 'Phi-3.5-mini-instruct-q4f16_1-MLC';
const WEBLLM_ESM = 'https://esm.run/@mlc-ai/web-llm';
const WEBLLM_MAX_ATTEMPTS = 2;
const GPU_PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

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
  (id): LlmModelType => ({ 'name': id, 'variant': 'chat', 'cloud': false, 'costRank': ModelCost.rankFromName(id) }),
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
  /**
   * Default system prompt the base injects as the leading turn of any request
   * that carries no system message of its own. Consumer-supplied persona/format
   * framing; empty (the default) means no injection.
   */
  readonly systemPrompt?: string;
  /**
   * Per-request timeout in milliseconds enforced around the in-browser
   * generation. Defaults to `DEFAULT_REQUEST_TIMEOUT_MS` (60s) when omitted.
   * Raise it for slow first-token latency on large in-browser models so the
   * timeout does not pre-empt a longer generation.
   */
  readonly timeoutMs?: number;
};

export class WebLlmAdapter extends BaseAdapter {
  readonly #timeoutMs: number;

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
        'systemPrompt': options.systemPrompt ?? '',
        ...(options.model !== undefined ? { 'model': options.model } : {}),
      },
    );
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Called for each progress report emitted by WebLLM during model
   * download and initialisation. Subclasses override to observe progress
   * (e.g. update a loading indicator). The default implementation is a
   * no-op; the adapter is usable without overriding this method.
   */
  protected onInitProgress(report: WebLlmInitReportType): void {
    void report;
    // no-op default — subclasses override to handle progress events
  }

  /**
   * Returns the static prebuilt catalog shipped with `@mlc-ai/web-llm`.
   * All entries are on-device chat models — no network call and no WebGPU
   * required to enumerate them. The catalog is a constant; the returned
   * Promise always resolves immediately.
   */
  override listModels(): Promise<readonly LlmModelType[]> {
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

  /**
   * Stream a chat completion from the WebLLM engine, with real cancellation.
   *
   * Starts a deadline timer that calls `engine.interruptGenerate()` when it
   * fires, and listens on `request.signal` for an external abort that does
   * the same. The streaming loop detects the interruption (the iterator
   * returns early) and rejects with the appropriate `LlmError`. The
   * `finally` block always clears the timer and removes the abort listener.
   */
  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const engine = await this.#engine();

    // Reject immediately if the signal is already aborted before any GPU work
    // begins. This avoids starting a generation that would be interrupted right
    // away and keeps the fast-abort path zero-cost.
    if (request.signal.aborted) {
      const reason: unknown = request.signal.reason;
      throw reason instanceof LlmError
        ? reason
        : new LlmError('web-llm request aborted', Classifications['TIMEOUT']);
    }

    // ToolInterface-calling via JSON-coerce: inject a system message with the
    // tool-plan schema then ask for json_object.
    const messages = WebLlmAdapter.composeMessages(request);
    const wantsJson = (request.tools.length > 0)
      || request.outputSchema.variant === 'schema';

    const responseFormat: { 'type': 'json_object' | 'text' } = { 'type': wantsJson ? 'json_object' : 'text' };

    let timedOut = false;
    let abortedExternally = false;
    let externalAbortReason: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    try {
      timer = setTimeout(() => {
        timedOut = true;
        engine.interruptGenerate();
      }, this.#timeoutMs);

      onAbort = () => {
        abortedExternally = true;
        externalAbortReason = request.signal.reason;
        engine.interruptGenerate();
      };
      request.signal.addEventListener('abort', onAbort);

      let stream: AsyncIterable<{ choices: ReadonlyArray<{ delta: { content?: string } }> }>;
      try {
        stream = await engine.chat.completions.create({
          'stream':          true,
          'messages':        messages,
          'temperature':     request.temperature,
          'max_tokens':      request.maxTokens,
          'response_format': responseFormat,
        });
      } catch (err) {
        throw this.#classifyWebLlmError(err);
      }

      let accumulated = '';
      try {
        for await (const chunk of stream) {
          accumulated += chunk.choices[0]?.delta.content ?? '';
        }
      } catch (err) {
        // `interruptGenerate()` may surface as a thrown iterator error rather
        // than an early return. When our own deadline/abort tripped the
        // interrupt, the timeout/abort classification wins over whatever the
        // engine threw, so a cascade still falls through instead of stalling.
        throw this.#interruptError(timedOut, abortedExternally, externalAbortReason)
          ?? this.#classifyWebLlmError(err);
      }

      // If the stream ended (returned early) because of an interrupt, reject accordingly.
      const interrupted = this.#interruptError(timedOut, abortedExternally, externalAbortReason);
      if (interrupted !== null) throw interrupted;

      const raw = accumulated;
      const text = raw.trim();
      const toolCalls = request.tools.length > 0 ? ToolCallCodec.decode(raw, 'webllm') : [];
      return {
        'message': ChatResponseMessageBuilder.from(text, toolCalls),
        'finishReason': toolCalls.length > 0 ? 'tool_call' : 'stop',
        'usage': ZERO_TOKEN_USAGE,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) request.signal.removeEventListener('abort', onAbort);
    }
  }

  protected override classify(error: unknown): ErrorClassificationType {
    const msg = error instanceof Error ? error.message : String(error);
    if (/webgpu/iu.test(msg)) return Classifications['MODEL_NOT_FOUND'];
    return super.classify(error);
  }

  /**
   * Flatten a chat request into the message array MLC's engine accepts.
   *
   * The MLC engine — like Chrome's Prompt API — rejects a `{ role: 'system' }`
   * entry at any index but 0. So every system turn the caller supplied AND the
   * tool/schema coercion instruction are folded into a SINGLE leading system
   * message; the user/assistant/tool conversation follows in order. Appending
   * the coercion as a trailing system message (the previous shape) put a system
   * role at a non-zero index, which the engine rejects — the exact failure that
   * surfaced on every structured-output edge. Pure: a function of `request`
   * alone, exposed as a static so the index-0 invariant is directly testable.
   */
  static composeMessages(request: ChatRequestType): ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const systemParts: string[] = [];
    const conversation: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of request.messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
        continue;
      }
      if (m.role === 'tool') {
        // ToolInterface result rolled into the user channel as scaffolding.
        conversation.push({ 'role': 'user', 'content': BaseAdapter.formatToolResult(m) });
        continue;
      }
      if (m.role === 'user' || m.role === 'assistant') {
        conversation.push({ 'role': m.role, 'content': m.content });
      }
    }

    if (request.tools.length > 0) {
      systemParts.push(`You must respond with a JSON object of the form { "tool_calls": [{ "name": "...", "arguments": { ... } }] } using only these tool names: ${request.tools.map((t) => `"${t.name}"`).join(', ')}. Emit an empty array when no tool helps.`);
    } else if (request.outputSchema.variant === 'schema') {
      systemParts.push(`You must respond with a JSON object that satisfies this JSON Schema: ${JSON.stringify(request.outputSchema.schema)}`);
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    if (systemParts.length > 0) {
      messages.push({ 'role': 'system', 'content': systemParts.join('\n\n') });
    }
    messages.push(...conversation);
    return messages;
  }

  #engine(): Promise<WebLlmEngineType> {
    const existing = enginePromises.get(this);
    if (existing !== undefined) return existing;
    const pending = this.loadEngine();
    enginePromises.set(this, pending);
    return pending;
  }

  /**
   * Materialise the WebLLM engine. The default implementation boots the real
   * MLC engine from the CDN. Subclasses may override this to supply a stub
   * engine in tests without needing to intercept the CDN import.
   */
  protected loadEngine(): Promise<WebLlmEngineType> {
    return this.#boot();
  }

  async #boot(): Promise<WebLlmEngineType> {
    if (!WebLlmAdapter.detectWebGpu()) {
      throw new LlmError('navigator.gpu unavailable', Classifications['MODEL_NOT_FOUND']);
    }
    const selectedModel = this.modelOrEmpty !== '' ? this.modelOrEmpty : DEFAULT_MODEL;
    let mod: WebLlmModuleInterface;
    try {
      const rawModule: unknown = await import(/* @vite-ignore */ WEBLLM_ESM);
      mod = webLlmModuleValidator.validate(rawModule);
    } catch (err) {
      // The WebLLM runtime is fetched from a CDN at first use, and the model
      // weights stream from a CDN after that — an in-browser model runtime
      // cannot run offline. A failed import is the runtime being unreachable,
      // not a transient fault, so classify it MODEL_NOT_FOUND: a cascade then
      // falls through to another backend instead of retrying a CDN that will
      // never resolve, and the message names the cause instead of leaking a
      // raw `Failed to fetch dynamically imported module`.
      throw new LlmError(
        `WebLLM runtime unavailable: failed to load ${WEBLLM_ESM} (the in-browser runtime requires network access to the CDN) — ${err instanceof Error ? err.message : String(err)}`,
        Classifications['MODEL_NOT_FOUND'],
        { 'cause': err },
      );
    }
    let rawEngine: unknown;
    try {
      rawEngine = await mod.CreateMLCEngine(selectedModel, {
        'initProgressCallback': (report) => { this.onInitProgress(report); },
      });
    } catch (err) {
      throw this.#classifyWebLlmError(err);
    }
    return webLlmEngineValidator.validate(rawEngine);
  }

  /**
   * The `LlmError` an in-flight interrupt should surface as, or `null` when no
   * interrupt fired. A deadline maps to `TIMEOUT`; an external abort preserves a
   * caller-supplied `LlmError` reason and otherwise falls back to `TIMEOUT` so a
   * cascade falls through instead of stalling.
   */
  #interruptError(timedOut: boolean, abortedExternally: boolean, externalAbortReason: unknown): LlmError | null {
    if (timedOut) return new LlmError('web-llm request timeout', Classifications['TIMEOUT']);
    if (abortedExternally) {
      return externalAbortReason instanceof LlmError
        ? externalAbortReason
        : new LlmError('web-llm request aborted', Classifications['TIMEOUT']);
    }
    return null;
  }

  #classifyWebLlmError(err: unknown): LlmError {
    // LlmErrors (e.g. TIMEOUT from #interruptError) pass through unchanged so
    // the caller's classification is never clobbered by a re-wrap.
    if (err instanceof LlmError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/aborted|timeout/iu.test(message)) return new LlmError(message, Classifications['TIMEOUT'], { 'cause': err });
    // A fetch/network failure while streaming model weights from the CDN is the
    // runtime being unreachable, not a transient fault — route it like a missing
    // model so a cascade falls through cleanly rather than retrying.
    if (/failed to fetch|network ?error/iu.test(message)) {
      return new LlmError(message, Classifications['MODEL_NOT_FOUND'], { 'cause': err });
    }
    return new LlmError(message, Classifications['UNKNOWN'], { 'cause': err });
  }
}
