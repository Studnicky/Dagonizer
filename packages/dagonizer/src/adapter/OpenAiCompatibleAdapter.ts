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
 * ToolInterface-fallback behavior is controlled by overriding
 * `shouldFallbackWithoutTools(error)` on a concrete subclass (returns
 * false by default). Providers whose models don't uniformly support
 * `tools` (e.g. Cerebras) override to return true on their specific
 * error signal, causing the adapter to retry the request without tools.
 */

import type { LlmModelType } from '../entities/adapter/LlmModel.js';
import type { OpenAiResponseBodyType } from '../entities/adapter/OpenAiResponseBody.js';
import { Validator } from '../validation/Validator.js';

import { BaseAdapter } from './BaseAdapter.js';
import { DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS } from './BaseAdapterCore.js';
import {
  ChatResponseMessageBuilder,
  ZERO_TOKEN_USAGE,
} from './LlmAdapter.js';
import type {
  AdapterCapabilitiesType,
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from './LlmAdapter.js';
import { Classifications, LlmError } from './LlmError.js';

/** Provider-specific configuration the subclass passes in. */
export type OpenAiCompatibleConfigType = {
  id: string;
  displayName: string;
  capabilities: AdapterCapabilitiesType;

  /** Full chat-completions endpoint URL. */
  endpoint: string;
  /** Full `GET` models-list endpoint URL for discovery (e.g.
   *  `https://api.groq.com/openai/v1/models`). Each provider declares its own;
   *  `listModels` reads it directly — no derivation from `endpoint`. */
  modelsEndpoint: string;
  /** Default model id when the consumer doesn't override. Optional: an
   *  adapter may construct with no model and resolve one via `selectChatModel`. */
  defaultModel?: string;
  /** Token-cap field name. OpenAI: `max_tokens`. Groq + Cerebras: `max_completion_tokens`. */
  tokenField: 'max_tokens' | 'max_completion_tokens';
  /** Extra headers beyond Authorization + Content-Type. */
  extraHeaders: Record<string, string>;

  /** Per-request timeout in ms. Defaults to `DEFAULT_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Default per-request timeout (ms) applied when the config omits `timeoutMs`. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Short timeout (ms) for the `GET /models` discovery call. */
const DISCOVERY_TIMEOUT_MS = 2_000;

/** Config with `timeoutMs` materialised from the default. */
type ResolvedOpenAiCompatibleConfig = OpenAiCompatibleConfigType & { timeoutMs: number };

/** Per-consumer options every OpenAI-compatible adapter accepts. */
export type OpenAiCompatibleAdapterOptionsType = {
  readonly model?: string;
  readonly maxAttempts?: number;
  /** First retry delay in ms forwarded to the base retry policy. */
  readonly baseDelayMs?: number;
}

export abstract class OpenAiCompatibleAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #config: ResolvedOpenAiCompatibleConfig;

  protected constructor(
    apiKey: string,
    config: OpenAiCompatibleConfigType,
    options: OpenAiCompatibleAdapterOptionsType = {},
  ) {
    const resolvedModel = options.model ?? config.defaultModel;
    super(
      config.id,
      config.displayName,
      config.capabilities,
      {
        'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        'baseDelayMs': options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        ...(resolvedModel !== undefined ? { 'model': resolvedModel } : {}),
      },
    );
    this.#apiKey = apiKey;
    this.#config = { ...config, 'timeoutMs': config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS };
  }

  /**
   * Enumerate models from the provider's configured `modelsEndpoint`. Maps each
   * entry to an `LlmModelType` with `variant: 'chat'` and `cloud: true` (these
   * are all cloud-routed). Entries with an empty id are skipped.
   *
   * Returns `[]` on any transport failure, non-ok response, or schema
   * violation — never throws (mirrors `probe` discipline).
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    const signals: AbortSignal[] = [controller.signal];
    if (options?.signal !== undefined) signals.push(options.signal);
    const signal = AbortSignal.any(signals);

    try {
      const res = await fetch(this.#config.modelsEndpoint, {
        'method': 'GET',
        'headers': {
          'authorization': `Bearer ${this.#apiKey}`,
          ...this.#config.extraHeaders,
        },
        signal,
      });
      if (!res.ok) return [];
      const rawBody: unknown = await res.json();
      if (!Validator.openAiModelsResponse.is(rawBody)) return [];
      return rawBody.data
        .filter((entry) => entry.id.length > 0)
        .map((entry) => ({ 'name': entry.id, 'variant': 'chat' as const, 'cloud': true }));
    } catch {
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
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

  async #doRequest(request: ChatRequestType): Promise<ChatResponseType> {
    return this.#sendRequest(request, this.#composeBody(request, true));
  }

  async #doRequestWithoutTools(request: ChatRequestType): Promise<ChatResponseType> {
    return this.#sendRequest(request, this.#composeBody(request, false));
  }

  async #sendRequest(request: ChatRequestType, body: Record<string, unknown>): Promise<ChatResponseType> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(new LlmError(`${this.#config.id} request timeout`, Classifications['TIMEOUT'])); }, this.#config.timeoutMs);
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
      throw LlmError.ofNetworkError(err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.#config.displayName} ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }

    const rawBody: unknown = await res.json();
    // Untrusted provider response: a schema failure is an upstream contract
    // violation, surfaced as SCHEMA_VIOLATION (not a raw ValidationError).
    if (!Validator.openAiResponseBody.is(rawBody)) {
      const detail = Validator.openAiResponseBody.errors(rawBody) ?? [];
      throw new LlmError(
        `${this.#config.displayName}: response body schema violation:\n  - ${detail.join('\n  - ')}`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return this.#decodeResponse(rawBody);
  }

  #composeBody(request: ChatRequestType, includeTools: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.model,
      'messages': request.messages.map((m) => this.#toMessage(m)),
      'temperature': request.temperature,
      [this.#config.tokenField]: request.maxTokens,
    };

    if (includeTools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => this.#toTool(t));
      body['tool_choice'] = this.#toToolChoice(request.toolChoice);
    } else if (request.outputSchema.variant === 'schema') {
      body['response_format'] = { 'type': 'json_object' };
    }

    return body;
  }

  #toMessage(message: ChatMessageType): Record<string, unknown> {
    if (message.role === 'tool') {
      return {
        'role': 'tool',
        'tool_call_id': message.toolCallId,
        'content': message.content,
      };
    }
    return { 'role': message.role, 'content': message.content };
  }

  #toTool(tool: ToolDefinitionType): Record<string, unknown> {
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

  #toToolChoice(choice: ToolChoiceType): unknown {
    const stringChoices: Readonly<Record<string, string>> = {
      'auto':     'auto',
      'required': 'required',
      'none':     'none',
    };
    if (choice.type === 'tool') {
      return { 'type': 'function', 'function': { 'name': choice.name } };
    }
    return stringChoices[choice.type];
  }

  #decodeResponse(payload: OpenAiResponseBodyType): ChatResponseType {
    if (payload.choices === undefined || payload.choices.length === 0) {
      throw new LlmError(
        `${this.#config.displayName}: response missing 'choices'`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    const choice = payload.choices[0];
    const msg = choice?.message;
    const rawToolCalls = msg?.tool_calls ?? [];
    const toolCalls: ToolCallType[] = rawToolCalls.map((tc) => {
      // `Validator.openAiResponseBody` validates tool_calls items against
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
        'arguments': this.#decodeJson(tc.function.arguments),
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

  #decodeJson(raw: string): Record<string, unknown> {
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
