/**
 * WebLlmAdapter — fully in-browser MLC WebLLM adapter.
 *
 * Lazy-loads the WebLLM ESM bundle and a small Phi-3.5 / Llama 3.2
 * quantized model (~700 MB) on first use; subsequent calls reuse the
 * engine. WebGPU is required (`navigator.gpu`).
 *
 * Tool calling is not native to WebLLM — we use `response_format` with
 * `{ type: 'json_object' }` and the tool-plan JSON Schema in the
 * system context. The model returns a JSON blob that we decode back
 * into `ToolCall[]`.
 */

import { BaseAdapter } from './BaseAdapter.ts';
import type {
  ChatRequest,
  ChatResponse,
  ToolCall,
  ToolDefinition,
} from './LlmAdapter.ts';
import { Classifications, LlmError, type ErrorClassification } from './LlmError.ts';

const DEFAULT_MODEL = 'Phi-3.5-mini-instruct-q4f16_1-MLC';
const WEBLLM_ESM = 'https://esm.run/@mlc-ai/web-llm';

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

export function detectWebGpu(): boolean {
  const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
  if (nav === undefined) return false;
  return 'gpu' in nav;
}

export interface WebLlmAdapterOptions {
  readonly model?: string;
  readonly onProgress?: (report: WebLlmInitReport) => void;
}

export class WebLlmAdapter extends BaseAdapter {
  readonly #model: string;
  readonly #onProgress?: (report: WebLlmInitReport) => void;
  #enginePromise: Promise<WebLlmEngine> | null = null;

  constructor(options: WebLlmAdapterOptions = {}) {
    super({
      'id': 'web-llm',
      'displayName': 'WebLLM (Phi-3.5 in-browser)',
      // Phi-3.5 supports structured output but tool-call format is
      // inconsistent across the small in-browser model class.
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'maxAttempts': 2,
    });
    this.#model = options.model ?? DEFAULT_MODEL;
    if (options.onProgress !== undefined) this.#onProgress = options.onProgress;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const engine = await this.engine();

    // Tool-calling via JSON-coerce: inject a system message with the
    // tool-plan schema then ask for json_object.
    const messages = this.#buildMessages(request);
    const wantsJson = (request.tools !== undefined && request.tools.length > 0)
      || request.outputSchema !== undefined;

    let result;
    try {
      result = await engine.chat.completions.create({
        'messages':         messages,
        'temperature':      request.temperature ?? 0.2,
        ...(wantsJson ? { 'response_format': { 'type': 'json_object' as const } } : {}),
      });
    } catch (err) {
      throw classifyWebLlmError(err);
    }

    const raw = result.choices[0]?.message.content ?? '';

    if (request.tools !== undefined && request.tools.length > 0) {
      const calls = decodeToolCalls(raw);
      if (calls.length > 0) return { 'message': { 'toolCalls': calls }, 'finishReason': 'tool_call' };
    }

    return { 'message': { 'content': raw.trim() }, 'finishReason': 'stop' };
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
        messages.push({ 'role': 'user', 'content': `[tool ${m.toolName ?? 'unknown'} result] ${m.content}` });
        continue;
      }
      if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
        messages.push({ 'role': m.role, 'content': m.content });
      }
    }

    if (request.tools !== undefined && request.tools.length > 0) {
      messages.push({
        'role': 'system',
        'content': `You must respond with a JSON object of the form { "tool_calls": [{ "name": "...", "arguments": { ... } }] } using only these tool names: ${request.tools.map(quote).join(', ')}. Emit an empty array when no tool helps.`,
      });
    } else if (request.outputSchema !== undefined) {
      messages.push({
        'role': 'system',
        'content': `You must respond with a JSON object that satisfies this JSON Schema: ${JSON.stringify(request.outputSchema.schema)}`,
      });
    }

    return messages;
  }

  private engine(): Promise<WebLlmEngine> {
    if (this.#enginePromise === null) this.#enginePromise = this.boot();
    return this.#enginePromise;
  }

  private async boot(): Promise<WebLlmEngine> {
    if (!detectWebGpu()) {
      throw new LlmError('navigator.gpu unavailable', Classifications['MODEL_NOT_FOUND']);
    }
    const mod = await import(/* @vite-ignore */ WEBLLM_ESM) as WebLlmModule;
    const options = this.#onProgress === undefined ? undefined : { 'initProgressCallback': this.#onProgress };
    return mod.CreateMLCEngine(this.#model, options);
  }
}

function quote(t: ToolDefinition): string { return `"${t.name}"`; }

function decodeToolCalls(raw: string): ToolCall[] {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0) return [];
    const json = raw.slice(start, end + 1);
    const parsed = JSON.parse(json) as { tool_calls?: ReadonlyArray<{ name?: string; arguments?: Record<string, unknown> }> };
    const calls = parsed.tool_calls ?? [];
    return calls
      .filter((c): c is { name: string; arguments: Record<string, unknown> } =>
        typeof c.name === 'string' && c.arguments !== undefined,
      )
      .map((c, i) => ({
        'id':   `webllm-${String(i)}-${String(Date.now())}`,
        'name': c.name,
        'arguments': c.arguments,
      }));
  } catch {
    return [];
  }
}

function classifyWebLlmError(err: unknown): LlmError {
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError(message, Classifications['UNKNOWN'], err);
}
