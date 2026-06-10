/**
 * WebLlmAdapter: fully in-browser MLC WebLLM adapter.
 *
 * Lazy-loads the WebLLM ESM bundle and a small Phi-3.5 / Llama 3.2
 * quantized model (~700 MB) on first use; subsequent calls reuse the
 * engine. WebGPU is required (`navigator.gpu`).
 *
 * Tool calling is not native to WebLLM; we use `response_format` with
 * `{ type: 'json_object' }` and the tool-plan JSON Schema in the
 * system context. The model returns a JSON blob that we decode back
 * into `ToolCall[]` via JSON coercion (`ToolCallCodec.decode`).
 */

import { BaseAdapter, ChatResponseMessageBuilder, ToolCallCodec, ZERO_TOKEN_USAGE } from '@noocodex/dagonizer/adapter';
import type {
  ChatRequest,
  ChatResponse,
} from '@noocodex/dagonizer/adapter';
import { Classifications, LlmError, type ErrorClassification } from '@noocodex/dagonizer/adapter';

const DEFAULT_MODEL = 'Phi-3.5-mini-instruct-q4f16_1-MLC';
const WEBLLM_ESM = 'https://esm.run/@mlc-ai/web-llm';
const WEBLLM_MAX_ATTEMPTS = 2;
const GPU_PROBE_TIMEOUT_MS = 1_500;

export interface WebLlmInitReport {
  readonly progress: number;
  readonly text: string;
}

interface WebLlmEngine {
  chat: {
    completions: {
      create(params: {
        messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        temperature?: number;
        response_format?: { type: 'json_object' | 'text' };
      }): Promise<{ choices: ReadonlyArray<{ message: { content: string } }> }>;
    };
  };
}

interface WebLlmModule {
  CreateMLCEngine(model: string, options?: { initProgressCallback?: (report: WebLlmInitReport) => void }): Promise<WebLlmEngine>;
}

export interface WebLlmAdapterOptions {
  readonly model?: string;
  readonly onProgress?: (report: WebLlmInitReport) => void;
}

export class WebLlmAdapter extends BaseAdapter {
  readonly #model: string;
  readonly #onProgress?: (report: WebLlmInitReport) => void;
  #enginePromise: Promise<WebLlmEngine> | null = null;

  static detectWebGpu(): boolean {
    const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
    if (nav === undefined) return false;
    return 'gpu' in nav;
  }

  constructor(options: WebLlmAdapterOptions = {}) {
    super(
      'web-llm',
      'WebLLM (Phi-3.5 in-browser)',
      // Phi-3.5 supports structured output but tool-call format is
      // inconsistent across the small in-browser model class.
      { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      { 'maxAttempts': WEBLLM_MAX_ATTEMPTS },
    );
    this.#model = options.model ?? DEFAULT_MODEL;
    if (options.onProgress !== undefined) this.#onProgress = options.onProgress;
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
    // Cast at a foreign-API boundary: standard lib `Navigator`
    // typings predate WebGPU shipping.
    const nav = (globalThis as { navigator?: { gpu?: { requestAdapter: () => Promise<unknown | null> } } }).navigator;
    if (nav === undefined || nav.gpu === undefined) return false;
    const gpu = nav.gpu;
    try {
      const adapter = await Promise.race<unknown>([
        gpu.requestAdapter(),
        new Promise((resolve) => setTimeout(() => { resolve(null); }, GPU_PROBE_TIMEOUT_MS)),
      ]);
      return adapter !== null;
    } catch {
      return false;
    }
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const engine = await this.#engine();

    // Tool-calling via JSON-coerce: inject a system message with the
    // tool-plan schema then ask for json_object.
    const messages = this.#buildMessages(request);
    const wantsJson = (request.tools.length > 0)
      || request.outputSchema.kind === 'schema';

    let result;
    try {
      result = await engine.chat.completions.create({
        'messages':         messages,
        'temperature':      request.temperature,
        ...(wantsJson ? { 'response_format': { 'type': 'json_object' as const } } : {}),
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

  protected override classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes('webgpu')) return Classifications['MODEL_NOT_FOUND'];
    return Classifications['UNKNOWN'];
  }

  #buildMessages(request: ChatRequest): ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    for (const m of request.messages) {
      if (m.role === 'tool') {
        // Tool result rolled into the user channel as scaffolding.
        messages.push({ 'role': 'user', 'content': `[tool ${m.toolName.length > 0 ? m.toolName : 'unknown'} result] ${m.content}` });
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
    } else if (request.outputSchema.kind === 'schema') {
      messages.push({
        'role': 'system',
        'content': `You must respond with a JSON object that satisfies this JSON Schema: ${JSON.stringify(request.outputSchema.schema)}`,
      });
    }

    return messages;
  }

  #engine(): Promise<WebLlmEngine> {
    if (this.#enginePromise === null) this.#enginePromise = this.#boot();
    return this.#enginePromise;
  }

  async #boot(): Promise<WebLlmEngine> {
    if (!WebLlmAdapter.detectWebGpu()) {
      throw new LlmError('navigator.gpu unavailable', Classifications['MODEL_NOT_FOUND']);
    }
    const mod = await import(/* @vite-ignore */ WEBLLM_ESM) as WebLlmModule;
    const options = this.#onProgress === undefined ? undefined : { 'initProgressCallback': this.#onProgress };
    return mod.CreateMLCEngine(this.#model, options);
  }

  #classifyWebLlmError(err: unknown): LlmError {
    const message = err instanceof Error ? err.message : String(err);
    return new LlmError(message, Classifications['UNKNOWN'], { 'cause': err });
  }
}
