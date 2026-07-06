/**
 * WebLlmAdapter: fully in-browser MLC WebLLM adapter.
 *
 * Lazy-loads the WebLLM ESM bundle and a small Phi-3.5 / Llama 3.2
 * quantized model (~700 MB) on first use; subsequent calls reuse the
 * engine. WebGPU is required (`navigator.gpu`).
 *
 * ToolInterface calling is not native to WebLLM; we use `response_format` with
 * `{ type: 'json_object', schema: <JSON string> }` to pass the tool-plan or
 * output JSON Schema natively to `GrammarCompiler.CompileJSONSchema`. The
 * system message also carries the schema description as belt-and-suspenders
 * reinforcement. The model returns a JSON blob decoded back into `ToolCall[]`
 * via JSON coercion (`ToolCallCodec.decode`).
 */

import type { StreamSinkInterface } from '@studnicky/dagonizer';
import type {
  ChatRequestType,
  ChatResponseType,
  ChatStreamChunkType,
  ErrorClassificationType,
  TokenUsageType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import { BaseAdapter, ChatResponseMessage, ChatStreamChunk, Classifications, LlmError, ModelCost, ToolCallCodec, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';
import { Scheduler } from '@studnicky/dagonizer/runtime';

import type {
  WebLlmEngineType,
  WebLlmInitReportType,
  WebLlmModuleInterface,
  WebLlmStreamChunkType,
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

/**
 * Live engine registry keyed on the adapter instance. Recorded immediately
 * after the engine resolves in `performChat`; used by `onCancelRequested` to
 * issue a best-effort cooperative `interruptGenerate()` without an instance
 * field that would flip type after construction (V8 shape stability).
 */
const liveEngines = new WeakMap<WebLlmAdapter, WebLlmEngineType>();

/**
 * Response format passed to `engine.chat.completions.create`. Widens the
 * engine's base `{ type }` shape with an optional `schema` field so
 * `GrammarCompiler.CompileJSONSchema` receives a valid JSON string rather
 * than an undefined value (which causes a `BindingError`).
 */
type WebLlmResponseFormatType = {
  readonly 'type': 'json_object' | 'text';
  readonly 'schema'?: string;
};

export type WebLlmAdapterOptionsType = {
  readonly model?: string;
  readonly maxAttempts?: number;
  /**
   * Default system prompt the base injects as the leading turn of any request
   * that carries no system message of its own. The directive can include
   * persona, format, or language framing; empty (the default) means no
   * injection.
   */
  readonly systemPrompt?: string;
  /**
   * Per-request timeout in milliseconds forwarded to the base adapter's hard
   * abort+timeout guard. Defaults to 60 s when omitted. Raise it for slow
   * first-token latency on large in-browser models.
   */
  readonly timeoutMs?: number;
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
        'systemPrompt': options.systemPrompt ?? '',
        ...(options.model !== undefined ? { 'model': options.model } : {}),
        ...(options.timeoutMs !== undefined ? { 'timeoutMs': options.timeoutMs } : {}),
      },
    );
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
      const timeout = new AbortController();
      try {
        const adapter = await Promise.race<unknown>([
          Promise.resolve(pending),
          Scheduler.current()
            .after(GPU_PROBE_TIMEOUT_MS, { 'signal': timeout.signal })
            .then(() => null)
            .catch(() => null),
        ]);
        return adapter !== null;
      } finally {
        timeout.abort();
      }
    } catch {
      return false;
    }
  }

  /**
   * Best-effort cooperative interrupt of the in-browser engine. Called by
   * the base class's abort+timeout guard the instant the request deadline
   * elapses or the external signal aborts. Correctness — the caller's
   * promise always rejecting — does not depend on this hook; the base
   * guarantees that regardless of what `interruptGenerate()` does.
   */
  protected override onCancelRequested(): void {
    const engine = liveEngines.get(this);
    if (engine !== undefined) engine.interruptGenerate();
  }

  /**
   * Buffered chat completion from the WebLLM engine.
   *
   * Correctness (the caller's promise always settling) is guaranteed by the
   * base class's abort+timeout race. Opens the stream through `#openStream`
   * (shared with `performChatStream`), discards every delta except the
   * concatenated text, and decodes the result. `usage` is always
   * `ZERO_TOKEN_USAGE` on this path — per-token accounting is only available
   * to a caller that reads the deltas as they arrive, via `chatStream`.
   */
  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const stream = await this.#openStream(request);

    let accumulated = '';
    try {
      for await (const chunk of stream) {
        accumulated += chunk.choices[0]?.delta.content ?? '';
      }
    } catch (err) {
      throw this.#classifyWebLlmError(err);
    }

    const raw = accumulated;
    const text = raw.trim();
    const toolCalls = request.tools.length > 0 ? ToolCallCodec.decode(raw, 'webllm') : [];
    return {
      'message': ChatResponseMessage.create(text, toolCalls),
      'finishReason': toolCalls.length > 0 ? 'tool_call' : 'stop',
      'usage': ZERO_TOKEN_USAGE,
    };
  }

  /**
   * Streaming chat completion from the WebLLM engine: pushes each non-empty
   * delta to `sink` as it arrives instead of discarding it. Opens the stream
   * through the same `#openStream` setup `performChat` uses (identical
   * message composition, response_format, and `stream_options` — the two
   * paths differ only in what they do with the deltas). Captures `usage`
   * from the final chunk when the engine attaches one (requested via
   * `stream_options: { include_usage: true }` in `#openStream`), falling
   * back to `ZERO_TOKEN_USAGE` when the engine never sends it.
   *
   * A tool-bearing request falls back to the buffered default
   * (`super.performChatStream`): partial-JSON `tool_calls` deltas are unsafe
   * to expose mid-stream, so any request carrying tools is never streamed
   * token-by-token.
   *
   * Every loop iteration re-checks `request.signal`: `withDeadline` already
   * guarantees the caller's promise rejects the instant the composed signal
   * aborts, but without this check the in-flight `for await` here would keep
   * running in the background — draining the engine's async iterable and
   * pushing further deltas to `sink` after the call already settled. The
   * in-loop check issues a best-effort `engine.interruptGenerate()` and
   * throws, so an abort stops generation promptly instead of leaking it.
   */
  protected override async performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    if (request.tools.length > 0) return super.performChatStream(request, sink);

    const stream = await this.#openStream(request);
    const engine = liveEngines.get(this);

    let accumulated = '';
    let usage: TokenUsageType = ZERO_TOKEN_USAGE;
    try {
      for await (const chunk of stream) {
        if (request.signal.aborted) {
          if (engine !== undefined) engine.interruptGenerate();
          throw WebLlmAdapter.#abortErrorFrom(request.signal);
        }
        const delta = chunk.choices[0]?.delta.content ?? '';
        if (delta.length > 0) {
          accumulated += delta;
          await this.pushChunk(sink, ChatStreamChunk.create(delta));
        }
        if (chunk.usage !== undefined) {
          usage = {
            'promptTokens': chunk.usage.prompt_tokens ?? 0,
            'completionTokens': chunk.usage.completion_tokens ?? 0,
          };
        }
      }
    } catch (err) {
      throw this.#classifyWebLlmError(err);
    }

    const raw = accumulated;
    const text = raw.trim();
    const toolCalls = request.tools.length > 0 ? ToolCallCodec.decode(raw, 'webllm') : [];
    return {
      'message': ChatResponseMessage.create(text, toolCalls),
      'finishReason': toolCalls.length > 0 ? 'tool_call' : 'stop',
      'usage': usage,
    };
  }

  /**
   * Shared setup for both the buffered and streaming chat paths: resolves
   * the engine, records it in `liveEngines` for `onCancelRequested`,
   * rejects on an already-aborted signal, composes the message array and
   * `response_format`, and opens the stream. `stream_options: { include_usage:
   * true }` is always requested so the streaming path can read `usage` off
   * the final chunk; the buffered path simply ignores it.
   */
  async #openStream(request: ChatRequestType): Promise<AsyncIterable<WebLlmStreamChunkType>> {
    const engine = await this.#engine();
    liveEngines.set(this, engine);

    // Reject immediately if the signal is already aborted before any GPU work
    // begins. This avoids starting a generation that would be interrupted right
    // away and keeps the fast-abort path zero-cost.
    if (request.signal.aborted) throw WebLlmAdapter.#abortErrorFrom(request.signal);

    // ToolInterface-calling via JSON-coerce: inject a system message with the
    // tool-plan schema and pass the schema natively via response_format.schema
    // so GrammarCompiler.CompileJSONSchema receives a valid JSON string.
    const messages = WebLlmAdapter.composeMessages(request);
    const schemaString: string | undefined = request.tools.length > 0
      ? JSON.stringify(this.#toolPlanSchema(request.tools))
      : request.outputSchema.variant === 'schema'
        ? JSON.stringify(request.outputSchema.schema)
        : undefined;

    const responseFormat: WebLlmResponseFormatType = schemaString !== undefined
      ? { 'type': 'json_object', 'schema': schemaString }
      : { 'type': 'text' };

    try {
      return await engine.chat.completions.create({
        'stream':          true,
        'messages':        messages,
        'temperature':     request.temperature,
        'max_tokens':      request.maxTokens,
        'response_format': responseFormat,
        'stream_options':  { 'include_usage': true },
      });
    } catch (err) {
      throw this.#classifyWebLlmError(err);
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

  /**
   * Build a JSON Schema that constrains the `tool_calls` response envelope.
   * Each tool variant enforces the tool's own `inputSchema` on `arguments` so
   * the model cannot hallucinate extra fields. Passed natively via
   * `response_format.schema` to `GrammarCompiler.CompileJSONSchema`.
   */
  #toolPlanSchema(tools: readonly ToolDefinitionType[]): Record<string, unknown> {
    const variants = tools.map((t) => ({
      'type': 'object',
      'additionalProperties': false,
      'properties': {
        'name':      { 'type': 'string', 'const': t.name },
        'arguments': t.inputSchema,
      },
      'required': ['name', 'arguments'],
    }));
    return {
      'type': 'object',
      'additionalProperties': false,
      'properties': {
        'tool_calls': {
          'type':  'array',
          'items': variants.length === 1 ? variants[0] : { 'anyOf': variants },
        },
      },
      'required': ['tool_calls'],
    };
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
   * Classify an already-aborted `AbortSignal` into an `LlmError`. Shared by
   * `#openStream`'s pre-flight check and `performChatStream`'s in-loop
   * check so both abort paths raise the identical classification.
   */
  static #abortErrorFrom(signal: AbortSignal): LlmError {
    const reason: unknown = signal.reason;
    return reason instanceof LlmError
      ? reason
      : new LlmError('web-llm request aborted', Classifications['TIMEOUT']);
  }

  #classifyWebLlmError(err: unknown): LlmError {
    // LlmErrors pass through unchanged so the caller's classification is never
    // clobbered by a re-wrap.
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
