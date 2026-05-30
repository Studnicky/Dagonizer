/**
 * OpenAiCompatibleAdapter — shared base for providers that speak the
 * OpenAI `chat/completions` wire format.
 *
 * Most LPU- and GPU-hosted open-model providers (Groq, Cerebras,
 * Mistral, OpenRouter, Together, Anyscale, …) expose the same
 * request/response schema with small per-provider tweaks (endpoint,
 * default model, `max_tokens` vs `max_completion_tokens`, extra
 * headers). This class owns the wire code; concrete adapters supply
 * a config object naming their endpoint and quirks.
 *
 * Per project standards: class extension only. Concrete adapters
 * `extends OpenAiCompatibleAdapter` and pass the provider-specific
 * fields via the constructor options.
 *
 * The optional `toolsFallback` hook lets adapters whose models don't
 * uniformly support `tools` retry as plain chat when the provider
 * signals tools-unsupported (Cerebras does this).
 */

import { BaseAdapter } from './BaseAdapter.js';
import {
  ChatResponseMessageBuilder,
  ZERO_TOKEN_USAGE,
} from './LlmAdapter.js';
import type {
  AdapterCapabilities,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from './LlmAdapter.js';
import { asNetworkError, Classifications, classifyHttp, LlmError } from './LlmError.js';
import type { ErrorClassification } from './LlmError.js';

const DEFAULT_TIMEOUT_MS = 60_000;

/** Provider-specific configuration the subclass passes in. */
export interface OpenAiCompatibleConfig {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities;

  /** Full chat-completions endpoint URL. */
  readonly endpoint: string;
  /** Default model id when the consumer doesn't override. */
  readonly defaultModel: string;
  /** Token-cap field name. OpenAI: `max_tokens`. Groq + Cerebras: `max_completion_tokens`. */
  readonly tokenField: 'max_tokens' | 'max_completion_tokens';
  /** Extra headers beyond Authorization + Content-Type. */
  readonly extraHeaders: Readonly<Record<string, string>>;
  /**
   * Optional fallback for providers whose models don't uniformly
   * support `tools`. Returns `true` if the adapter should retry the
   * request without `tools` after seeing this error.
   */
  readonly toolsFallback?: (error: unknown) => boolean;

  /** Per-request timeout. Defaults to 60s. */
  readonly timeoutMs?: number;
}

/** Per-consumer options every OpenAI-compatible adapter accepts. */
export interface OpenAiCompatibleAdapterOptions {
  readonly model?: string;
  readonly maxAttempts?: number;
}

interface OpenAiToolCallShape {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

interface OpenAiResponseBody {
  choices?: ReadonlyArray<{
    message?: {
      content?: string | null;
      tool_calls?: readonly OpenAiToolCallShape[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export abstract class OpenAiCompatibleAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #config: OpenAiCompatibleConfig;

  protected constructor(
    apiKey: string,
    config: OpenAiCompatibleConfig,
    options: OpenAiCompatibleAdapterOptions = {},
  ) {
    super(
      config.id,
      config.displayName,
      config.capabilities,
      { 'maxAttempts': options.maxAttempts ?? 3 },
    );
    this.#apiKey = apiKey;
    this.#model = options.model ?? config.defaultModel;
    this.#config = config;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    try {
      return await this.#doRequest(request, /* withTools */ true);
    } catch (err) {
      const fallback = this.#config.toolsFallback;
      if (fallback !== undefined && fallback(err) && request.tools.length > 0) {
        return this.#doRequest(request, false);
      }
      throw err;
    }
  }

  /**
   * Default availability probe — true when a non-empty API key was
   * supplied. Every OpenAI-compatible provider this base targets
   * (Cerebras, Groq, Mistral, OpenRouter, …) gates access on a bearer
   * token; a missing key is a definitive "unavailable" signal that
   * lets a cascade route around the adapter without ever hitting the
   * wire. Subclasses with non-key availability constraints (Ollama
   * runs locally with no auth) override.
   */
  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }

  protected override classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    if (error instanceof Error && /aborted|timeout/iu.test(error.message)) return Classifications['TIMEOUT'];
    return Classifications['UNKNOWN'];
  }

  async #doRequest(request: ChatRequest, withTools: boolean): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutMs = this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => { controller.abort(new Error(`${this.#config.id} request timeout`)); }, timeoutMs);
    const signal = AbortSignal.any([request.signal, controller.signal]);

    let res: Response;
    try {
      res = await fetch(this.#config.endpoint, {
        'method': 'POST',
        'headers': {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.#apiKey}`,
          ...this.#config.extraHeaders,
        },
        'body': JSON.stringify(this.#buildBody(request, withTools)),
        signal,
      });
    } catch (err) {
      throw asNetworkError(err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.#config.displayName} ${String(res.status)}: ${text}`, classifyHttp(res.status, text));
    }

    const payload = (await res.json()) as OpenAiResponseBody;
    return parseOpenAiResponse(payload);
  }

  #buildBody(request: ChatRequest, withTools: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.#model,
      'messages': request.messages.map(toOpenAiMessage),
      'temperature': request.temperature,
      [this.#config.tokenField]: request.maxTokens,
    };

    if (withTools && request.tools.length > 0) {
      body['tools'] = request.tools.map(toOpenAiTool);
      body['tool_choice'] = toOpenAiToolChoice(request.toolChoice);
    } else if (request.outputSchema.kind === 'schema') {
      body['response_format'] = { 'type': 'json_object' };
    }

    return body;
  }
}

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      'role': 'tool',
      'tool_call_id': message.toolCallId,
      'content': message.content,
    };
  }
  return { 'role': message.role, 'content': message.content };
}

function toOpenAiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    'type': 'function',
    'function': {
      'name': tool.name,
      'description': tool.description,
      'parameters': tool.inputSchema,
      ...(tool.strict ? { 'strict': true } : {}),
    },
  };
}

function toOpenAiToolChoice(choice: ToolChoice): unknown {
  switch (choice.type) {
    case 'auto':     return 'auto';
    case 'required': return 'required';
    case 'none':     return 'none';
    case 'tool':     return { 'type': 'function', 'function': { 'name': choice.name } };
  }
}

function parseOpenAiResponse(payload: OpenAiResponseBody): ChatResponse {
  const choice = payload.choices?.[0];
  const msg = choice?.message;
  const rawToolCalls = msg?.tool_calls ?? [];
  const toolCalls: ToolCall[] = rawToolCalls.map((tc) => ({
    'id': tc.id,
    'name': tc.function.name,
    'arguments': parseJson(tc.function.arguments),
  }));
  const text = msg?.content ?? '';
  const finishReason = toolCalls.length > 0
    ? 'tool_call'
    : choice?.finish_reason === 'length' ? 'length' : 'stop';
  return {
    'message': ChatResponseMessageBuilder.from(text, toolCalls),
    'finishReason': finishReason,
    'usage': payload.usage !== undefined
      ? { 'promptTokens': payload.usage.prompt_tokens ?? 0, 'completionTokens': payload.usage.completion_tokens ?? 0 }
      : ZERO_TOKEN_USAGE,
  };
}

function parseJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}
