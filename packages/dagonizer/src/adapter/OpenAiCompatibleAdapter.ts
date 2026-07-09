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
 * Tool support is declared through adapter capabilities. A request that carries
 * tools is sent with tools; provider rejection is surfaced to the caller.
 */

import { Signal } from '@studnicky/signal';
import { Guard } from '@studnicky/types';

import type { StreamSinkInterface } from '../contracts/StreamSinkInterface.js';
import { ChatStreamChunk } from '../entities/adapter/ChatStreamChunk.js';
import type { ChatStreamChunkType } from '../entities/adapter/ChatStreamChunk.js';
import type { LlmModelType } from '../entities/adapter/LlmModel.js';
import type { OpenAiResponseBodyType } from '../entities/adapter/OpenAiResponseBody.js';
import type { OpenAiStreamChunkType } from '../entities/adapter/OpenAiStreamChunk.js';
import { Validator } from '../validation/Validator.js';

import { BaseAdapter } from './BaseAdapter.js';
import { DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS } from './BaseAdapterCore.js';
import {
  ChatResponseMessage,
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
import { ModelCost } from './ModelCost.js';
import { SseLineParser } from './SseLineParser.js';

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

/** Per-consumer options every OpenAI-compatible adapter accepts. */
export type OpenAiCompatibleAdapterOptionsType = {
  readonly model?: string;
  readonly maxAttempts?: number;
  /** First retry delay in ms forwarded to the base retry policy. */
  readonly baseDelayMs?: number;
  /**
   * Default system prompt the base injects as the leading turn of any request
   * that carries no system message of its own. The directive can include
   * persona, format, or language framing; empty (the default) means no
   * injection.
   */
  readonly systemPrompt?: string;
}

export class OpenAiCompatibleAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #config: OpenAiCompatibleConfigType;

  constructor(
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
        ...(options.systemPrompt !== undefined && options.systemPrompt.length > 0 ? { 'systemPrompt': options.systemPrompt } : {}),
        ...(config.timeoutMs !== undefined ? { 'timeoutMs': config.timeoutMs } : {}),
      },
    );
    this.#apiKey = apiKey;
    this.#config = config;
  }

  /**
   * Enumerate models from the provider's configured `modelsEndpoint`. Maps each
   * entry to an `LlmModelType` with `variant: 'chat'` and `cloud: true` (these
   * are all cloud-routed). Entries with an empty id are skipped. `costRank`
   * comes from `ModelCost.fromOpenAiEntry`: OpenRouter's per-token pricing when
   * present, the name heuristic otherwise (Groq, Cerebras, Mistral).
   *
   * Returns `[]` on any transport failure, non-ok response, or schema
   * violation — never throws (mirrors `probe` discipline).
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    const signal = Signal.compose({
      'deadlineMs': DISCOVERY_TIMEOUT_MS,
      ...(options?.signal !== undefined ? { 'signal': options.signal } : {}),
    });

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
        .map((entry) => ({ 'name': entry.id, 'variant': 'chat' as const, 'cloud': true, 'costRank': ModelCost.rankFromOpenAiEntry(entry) }));
    } catch {
      return [];
    }
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    return this.#doRequest(request);
  }

  /**
   * Streaming override: POSTs the same endpoint with `stream: true` +
   * `stream_options: { include_usage: true }` and drains the SSE body
   * through `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty
   * `delta.content`. Single-attempt (no retry), matching `chatStream`'s
   * contract.
   *
   * Tool-turns use the buffered stream contract (`super.performChatStream`):
   * partial-JSON `tool_calls` deltas are unsafe to parse mid-stream, so any
   * request carrying tools is never sent with `stream: true`.
   */
  protected override async performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    if (request.tools.length > 0) return super.performChatStream(request, sink);
    return this.#sendStreamRequest(request, sink);
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
    return this.#sendRequest(request, this.#composeBody(request));
  }

  async #sendRequest(request: ChatRequestType, body: Record<string, unknown>): Promise<ChatResponseType> {
    const res = await this.#postJson(request, body);

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.#config.displayName} ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }

    const rawBody: unknown = await res.json();
    // Untrusted provider response: a schema failure is an upstream contract
    // violation, surfaced as SCHEMA_VIOLATION (not a raw DAGError).
    if (!Validator.openAiResponseBody.is(rawBody)) {
      const detail = Validator.openAiResponseBody.errors(rawBody) ?? [];
      throw new LlmError(
        `${this.#config.displayName}: response body schema violation:\n  - ${detail.join('\n  - ')}`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return this.#decodeResponse(rawBody);
  }

  /** Shared headers for every request this adapter sends: `content-type`, bearer auth, provider extras. */
  #requestHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'authorization': `Bearer ${this.#apiKey}`,
      ...this.#config.extraHeaders,
    };
  }

  /** POST `body` to the configured endpoint with the shared headers + signal; classifies transport failures. */
  async #postJson(request: ChatRequestType, body: Record<string, unknown>): Promise<Response> {
    try {
      return await fetch(this.#config.endpoint, {
        'method': 'POST',
        'headers': this.#requestHeaders(),
        'body': JSON.stringify(body),
        'signal': request.signal,
      });
    } catch (err) {
      // The base guard composes the deadline into `request.signal`; a TIMEOUT
      // LlmError is already classified. Preserve it; only a genuine transport
      // failure is NETWORK.
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
    }
  }

  async #sendStreamRequest(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    const body = {
      ...this.#composeBody(request),
      'stream': true,
      'stream_options': { 'include_usage': true },
    };
    const res = await this.#postJson(request, body);

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`${this.#config.displayName} ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }
    if (res.body === null) {
      throw new LlmError(`${this.#config.displayName}: streamed response has no body`, Classifications['NETWORK']);
    }

    return this.#drainStream(res.body, sink, request.signal);
  }

  async #drainStream(
    stream: ReadableStream<Uint8Array>,
    sink: StreamSinkInterface<ChatStreamChunkType>,
    signal: AbortSignal,
  ): Promise<ChatResponseType> {
    let text = '';
    let finishReason: ChatResponseType['finishReason'] = 'stop';
    let usage = ZERO_TOKEN_USAGE;

    try {
      for await (const frame of SseLineParser.linesOf(stream)) {
        if (frame.data === '[DONE]') break;
        if (frame.data.length === 0) continue;

        const chunk = this.#decodeStreamChunk(frame.data);
        const choice = chunk.choices[0];
        if (choice !== undefined) {
          const delta = choice.delta?.content ?? '';
          if (delta.length > 0) {
            text += delta;
            await this.pushChunk(sink, ChatStreamChunk.create(delta));
          }
          if (choice.finish_reason === 'length') finishReason = 'length';
        }
        if (chunk.usage !== undefined) {
          usage = { 'promptTokens': chunk.usage.prompt_tokens ?? 0, 'completionTokens': chunk.usage.completion_tokens ?? 0 };
        }
      }
    } catch (err) {
      if (signal.aborted) {
        throw signal.reason instanceof LlmError
          ? signal.reason
          : new LlmError(`${this.#config.displayName}: stream aborted`, Classifications['TIMEOUT'], { 'cause': signal.reason });
      }
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
    }

    return {
      'message': ChatResponseMessage.create(text, []),
      'finishReason': finishReason,
      'usage': usage,
    };
  }

  /** Parse + schema-validate one SSE `data:` line's JSON payload; SCHEMA_VIOLATION on any failure. */
  #decodeStreamChunk(raw: string): OpenAiStreamChunkType {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new LlmError(
        `${this.#config.displayName}: malformed stream chunk — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
        { cause },
      );
    }
    if (!Validator.openAiStreamChunk.is(parsed)) {
      const detail = Validator.openAiStreamChunk.errors(parsed) ?? [];
      throw new LlmError(
        `${this.#config.displayName}: stream chunk schema violation:\n  - ${detail.join('\n  - ')}`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return parsed;
  }

  #composeBody(request: ChatRequestType): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.model,
      'messages': request.messages.map((m) => this.#toMessage(m)),
      'temperature': request.temperature,
      [this.#config.tokenField]: request.maxTokens,
    };

    if (request.tools.length > 0) {
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
      'message': ChatResponseMessage.create(text, toolCalls),
      'finishReason': finishReason,
      'usage': payload.usage !== undefined
        ? { 'promptTokens': payload.usage.prompt_tokens ?? 0, 'completionTokens': payload.usage.completion_tokens ?? 0 }
        : ZERO_TOKEN_USAGE,
    };
  }

  #decodeJson(raw: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new LlmError(
        `${this.#config.displayName}: malformed tool-call arguments — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
        { cause },
      );
    }
    if (!OpenAiCompatibleAdapter.#isJsonObject(parsed)) {
      throw new LlmError(
        `${this.#config.displayName}: tool-call arguments must be a JSON object — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    // The predicate narrows `parsed` to `Record<string, unknown>` — no cast.
    return parsed;
  }

  /** A non-null, non-array object — the JSON-object ingest shape. */
  static #isJsonObject(value: unknown): value is Record<string, unknown> {
    return Guard.isRecord(value);
  }

  /** Pre-configured adapter for Groq (api.groq.com). Uses max_completion_tokens. */
  static groq(apiKey: string, options?: { readonly model?: string; readonly timeoutMs?: number; readonly systemPrompt?: string }): OpenAiCompatibleAdapter {
    return new OpenAiCompatibleAdapter(apiKey, {
      'id': 'groq',
      'displayName': 'Groq',
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'endpoint': 'https://api.groq.com/openai/v1/chat/completions',
      'modelsEndpoint': 'https://api.groq.com/openai/v1/models',
      'defaultModel': options?.model ?? 'llama-3.3-70b-versatile',
      'tokenField': 'max_completion_tokens',
      'extraHeaders': {},
      ...(options?.timeoutMs !== undefined ? { 'timeoutMs': options.timeoutMs } : {}),
    }, {
      ...(options?.systemPrompt !== undefined && options.systemPrompt.length > 0 ? { 'systemPrompt': options.systemPrompt } : {}),
    });
  }

  /** Pre-configured adapter for Cerebras (api.cerebras.ai). Uses max_completion_tokens. */
  static cerebras(apiKey: string, options?: { readonly model?: string; readonly timeoutMs?: number; readonly systemPrompt?: string }): OpenAiCompatibleAdapter {
    return new OpenAiCompatibleAdapter(apiKey, {
      'id': 'cerebras',
      'displayName': 'Cerebras',
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'endpoint': 'https://api.cerebras.ai/v1/chat/completions',
      'modelsEndpoint': 'https://api.cerebras.ai/v1/models',
      'defaultModel': options?.model ?? 'gpt-oss-120b',
      'tokenField': 'max_completion_tokens',
      'extraHeaders': {},
      ...(options?.timeoutMs !== undefined ? { 'timeoutMs': options.timeoutMs } : {}),
    }, {
      ...(options?.systemPrompt !== undefined && options.systemPrompt.length > 0 ? { 'systemPrompt': options.systemPrompt } : {}),
    });
  }

  /** Pre-configured adapter for Mistral (api.mistral.ai). Uses max_tokens. */
  static mistral(apiKey: string, options?: { readonly model?: string; readonly timeoutMs?: number; readonly systemPrompt?: string }): OpenAiCompatibleAdapter {
    return new OpenAiCompatibleAdapter(apiKey, {
      'id': 'mistral',
      'displayName': 'Mistral',
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'endpoint': 'https://api.mistral.ai/v1/chat/completions',
      'modelsEndpoint': 'https://api.mistral.ai/v1/models',
      'defaultModel': options?.model ?? 'mistral-small-latest',
      'tokenField': 'max_tokens',
      'extraHeaders': {},
      ...(options?.timeoutMs !== undefined ? { 'timeoutMs': options.timeoutMs } : {}),
    }, {
      ...(options?.systemPrompt !== undefined && options.systemPrompt.length > 0 ? { 'systemPrompt': options.systemPrompt } : {}),
    });
  }

  /**
   * Pre-configured adapter for OpenRouter (openrouter.ai).
   * Routes to any provider model via a single API key and endpoint.
   * Model IDs: 'anthropic/claude-3-haiku', 'meta-llama/llama-3.3-70b-instruct:free', etc.
   * listModels() returns the full OpenRouter catalogue (200+ models across providers).
   */
  static openRouter(apiKey: string, options?: {
    readonly model?: string;
    readonly referer?: string;
    readonly title?: string;
    readonly timeoutMs?: number;
    readonly systemPrompt?: string;
  }): OpenAiCompatibleAdapter {
    return new OpenAiCompatibleAdapter(apiKey, {
      'id': 'openrouter',
      'displayName': 'OpenRouter',
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'endpoint': 'https://openrouter.ai/api/v1/chat/completions',
      'modelsEndpoint': 'https://openrouter.ai/api/v1/models',
      'defaultModel': options?.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
      'tokenField': 'max_tokens',
      'extraHeaders': {
        ...(options?.referer !== undefined ? { 'HTTP-Referer': options.referer } : {}),
        ...(options?.title !== undefined ? { 'X-Title': options.title } : {}),
      },
      ...(options?.timeoutMs !== undefined ? { 'timeoutMs': options.timeoutMs } : {}),
    }, {
      ...(options?.systemPrompt !== undefined && options.systemPrompt.length > 0 ? { 'systemPrompt': options.systemPrompt } : {}),
    });
  }
}
