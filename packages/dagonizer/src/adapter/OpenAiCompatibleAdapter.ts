/**
 * OpenAiCompatibleAdapter: shared base for providers that speak the
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
 * Tool-fallback behavior is controlled by overriding
 * `shouldFallbackWithoutTools(error)` on a concrete subclass (returns
 * false by default). Providers whose models don't uniformly support
 * `tools` (e.g. Cerebras) override to return true on their specific
 * error signal, causing the adapter to retry the request without tools.
 */

import type { ValidateFunction } from 'ajv';

import { sharedAjv } from '../validation/sharedAjv.js';
import type { EntityValidator } from '../validation/Validator.js';

import { DEFAULT_MAX_ATTEMPTS } from './AdapterBase.js';
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
import { Classifications, LlmError } from './LlmError.js';
import type { ErrorClassification } from './LlmError.js';
import { OpenAiResponseBodySchema } from './OpenAiResponseBody.js';
import type { OpenAiResponseBody } from './OpenAiResponseBody.js';

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

  /** Per-request timeout. Defaults to 60s. */
  readonly timeoutMs?: number;
}

/** Per-consumer options every OpenAI-compatible adapter accepts. */
export interface OpenAiCompatibleAdapterOptions {
  readonly model?: string;
  readonly maxAttempts?: number;
}

/**
 * Module-level validator compiled once from `OpenAiResponseBodySchema`.
 * Uses the shared Ajv instance — never builds a new Ajv.
 * On validation failure `#sendRequest` throws `LlmError(SCHEMA_VIOLATION)`.
 */
const openAiResponseBodyValidator: EntityValidator<OpenAiResponseBody> = (() => {
  const id = OpenAiResponseBodySchema.$id;
  let compiled = typeof id === 'string' ? sharedAjv.getSchema(id) : undefined;
  if (typeof compiled !== 'function') {
    compiled = sharedAjv.compile(OpenAiResponseBodySchema);
  }
  const fn: ValidateFunction = compiled;
  return {
    is(value: unknown): value is OpenAiResponseBody { return fn(value) === true; },
    validate(value: unknown): OpenAiResponseBody {
      if (fn(value) === true) return value as OpenAiResponseBody;
      const errs: string[] = (fn.errors ?? []).map((e) => {
        const path = e.instancePath.length > 0 ? e.instancePath : '<root>';
        return `${path}: ${e.message ?? 'invalid'}`;
      });
      throw new LlmError(
        `OpenAI response body schema violation:\n  - ${errs.join('\n  - ')}`,
        Classifications['SCHEMA_VIOLATION'],
      );
    },
    errors(value: unknown): string[] | null {
      if (fn(value) === true) return null;
      return (fn.errors ?? []).map((e) => {
        const path = e.instancePath.length > 0 ? e.instancePath : '<root>';
        return `${path}: ${e.message ?? 'invalid'}`;
      });
    },
  };
})();

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
      { 'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS },
    );
    this.#apiKey = apiKey;
    this.#model = options.model ?? config.defaultModel;
    this.#config = config;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    try {
      return await this.#doRequest(request);
    } catch (err) {
      if (this.shouldFallbackWithoutTools(err) && request.tools.length > 0) {
        return this.#doRequestWithoutTools(request);
      }
      throw err;
    }
  }

  /**
   * Override in a concrete subclass to enable the tools-fallback path.
   * Return `true` when the given error signals that the provider refused
   * the request because of tool definitions (e.g. Cerebras' 400 on
   * models that don't support function calling). The base implementation
   * always returns `false` — no fallback by default.
   *
   * Called only when `request.tools` is non-empty; callers don't need to
   * re-check that guard in their override.
   */
  protected shouldFallbackWithoutTools(_error: unknown): boolean {
    return false;
  }

  /**
   * Default availability probe: true when a non-empty API key was
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

  async #doRequest(request: ChatRequest): Promise<ChatResponse> {
    return this.#sendRequest(request, this.#buildBody(request));
  }

  async #doRequestWithoutTools(request: ChatRequest): Promise<ChatResponse> {
    return this.#sendRequest(request, this.#buildBodyWithoutTools(request));
  }

  async #sendRequest(request: ChatRequest, body: Record<string, unknown>): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutMs = this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => { controller.abort(new LlmError(`${this.#config.id} request timeout`, Classifications['TIMEOUT'])); }, timeoutMs);
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
        'body': JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw LlmError.fromNetworkError(err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.#config.displayName} ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }

    const rawBody: unknown = await res.json();
    const payload = openAiResponseBodyValidator.validate(rawBody);
    return this.#parseResponse(payload);
  }

  #buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.#model,
      'messages': request.messages.map((m) => this.#toMessage(m)),
      'temperature': request.temperature,
      [this.#config.tokenField]: request.maxTokens,
    };

    if (request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => this.#toTool(t));
      body['tool_choice'] = this.#toToolChoice(request.toolChoice);
    } else if (request.outputSchema.kind === 'schema') {
      body['response_format'] = { 'type': 'json_object' };
    }

    return body;
  }

  #buildBodyWithoutTools(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.#model,
      'messages': request.messages.map((m) => this.#toMessage(m)),
      'temperature': request.temperature,
      [this.#config.tokenField]: request.maxTokens,
    };

    if (request.outputSchema.kind === 'schema') {
      body['response_format'] = { 'type': 'json_object' };
    }

    return body;
  }

  #toMessage(message: ChatMessage): Record<string, unknown> {
    if (message.role === 'tool') {
      return {
        'role': 'tool',
        'tool_call_id': message.toolCallId,
        'content': message.content,
      };
    }
    return { 'role': message.role, 'content': message.content };
  }

  #toTool(tool: ToolDefinition): Record<string, unknown> {
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

  #toToolChoice(choice: ToolChoice): unknown {
    switch (choice.type) {
      case 'auto':     return 'auto';
      case 'required': return 'required';
      case 'none':     return 'none';
      case 'tool':     return { 'type': 'function', 'function': { 'name': choice.name } };
    }
  }

  #parseResponse(payload: OpenAiResponseBody): ChatResponse {
    if (payload.choices === undefined || payload.choices.length === 0) {
      throw new LlmError(
        `${this.#config.displayName}: response missing 'choices'`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    const choice = payload.choices[0];
    const msg = choice?.message;
    const rawToolCalls = msg?.tool_calls ?? [];
    const toolCalls: ToolCall[] = rawToolCalls.map((tc) => {
      // Schema validation at L190 guarantees tool_calls items match
      // OpenAiToolCallSchema (id, type, function.name, function.arguments all
      // required strings). Guard here so a provider deviation surfaces as
      // SCHEMA_VIOLATION instead of a raw TypeError.
      if (
        typeof tc.id !== 'string'
        || tc.function === undefined
        || typeof tc.function.name !== 'string'
        || typeof tc.function.arguments !== 'string'
      ) {
        throw new LlmError(
          `${this.#config.displayName}: malformed tool_calls entry — missing id, function.name, or function.arguments`,
          Classifications['SCHEMA_VIOLATION'],
        );
      }
      return {
        'id': tc.id,
        'name': tc.function.name,
        'arguments': this.#parseJson(tc.function.arguments),
      };
    });
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

  #parseJson(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (cause) {
      throw new LlmError(
        `${this.#config.displayName}: malformed tool-call arguments — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
        { cause },
      );
    }
  }
}
