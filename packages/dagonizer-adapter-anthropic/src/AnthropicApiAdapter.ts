/**
 * AnthropicApiAdapter: Anthropic Messages API adapter.
 *
 * Extends `BaseAdapter` (not `OpenAiCompatibleAdapter`) because Anthropic's
 * Messages API is a distinct wire format — separate from the OpenAI
 * chat/completions schema:
 *
 *   - Authentication: `x-api-key` header (not `Authorization: Bearer`)
 *   - Protocol header: `anthropic-version: 2023-06-01`
 *   - Endpoint: `POST {baseUrl}/v1/messages`
 *   - System prompt: top-level `system` field (not a `messages` entry)
 *   - Tool results: `tool_result` content block inside a `user` turn
 *   - Tool definitions: `input_schema` field (not `parameters`)
 *   - Response blocks: typed array under `content`, not `choices[0].message`
 *   - Stop signals: `stop_reason` field with values `end_turn`, `tool_use`,
 *     `max_tokens` (not OpenAI `finish_reason`)
 *
 * Wire mapping (dagonizer → Anthropic):
 *   ChatMessageType[role='system']    → top-level `system` string
 *   ChatMessageType[role='tool']      → `{ role:'user', content:[{ type:'tool_result', ... }] }`
 *   ChatMessageType[role='assistant'] → `{ role:'assistant', content: string }`
 *   ChatMessageType[role='user']      → `{ role:'user', content: string }`
 *   ToolDefinitionType                → `{ name, description, input_schema }`
 *   ToolChoiceType.type='auto'        → `{ type:'auto' }`
 *   ToolChoiceType.type='required'    → `{ type:'any' }`
 *   ToolChoiceType.type='none'        → `{ type:'none' }`
 *   ToolChoiceType.type='tool'        → `{ type:'tool', name }`
 *
 * Response decoding (Anthropic → dagonizer):
 *   content[type='text']     → text part of `ChatResponseMessageType`
 *   content[type='tool_use'] → `ToolCallType { id, name, arguments: input }`
 *   stop_reason              → finishReason ('end_turn'→'stop', 'tool_use'→'tool_call', 'max_tokens'→'length')
 *   usage.input_tokens       → TokenUsageType.promptTokens
 *   usage.output_tokens      → TokenUsageType.completionTokens
 *
 * Error classification:
 *   400             → SCHEMA_VIOLATION (non-retryable; bad request body)
 *   401, 403        → AUTH_FAILED      (non-retryable)
 *   429             → QUOTA_EXHAUSTED  (retryable; Retry-After honored)
 *   408, 504        → TIMEOUT          (retryable)
 *   5xx             → NETWORK          (retryable)
 *   network failure → NETWORK          (retryable)
 *   else            → UNKNOWN          (non-retryable)
 *
 * Streaming (`performChatStream`):
 *   Tool-bearing requests fall back to the buffered path
 *   (`super.performChatStream`) — partial tool-call JSON is unsafe to parse
 *   mid-stream. Tool-less requests POST with `stream: true` and drain the SSE
 *   body through `SseLineParser`. Anthropic emits named SSE events whose
 *   `data:` payload carries a mirrored `type` field; dispatch happens on that
 *   `type`:
 *     message_start        → `message.usage.input_tokens` seeds prompt tokens
 *     content_block_delta   → `delta.type === 'text_delta'` pushes one
 *                             `ChatStreamChunkType` per text fragment
 *     message_delta         → `delta.stop_reason` maps to `finishReason`;
 *                             `usage.output_tokens` is the cumulative
 *                             completion-token count (last value wins)
 *     message_stop           → terminal; ends the drain loop
 *     ping                   → no-op
 *     error                  → throws a `SCHEMA_VIOLATION` `LlmError`
 *   The drain loop is wrapped in a try/catch so a mid-stream abort or read
 *   error never escapes as a raw `AbortError`/`DOMException`: if the
 *   request's signal is aborted, the composed abort reason is rethrown
 *   unchanged when it is already an `LlmError`, else wrapped as `TIMEOUT`;
 *   otherwise the error is classified the same way the buffered path
 *   classifies transport failures (`LlmError` passthrough, else `NETWORK`
 *   via `LlmError.ofNetworkError`).
 */

import type { StreamSinkInterface } from '@studnicky/dagonizer';
import type {
  AdapterCapabilitiesType,
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ChatStreamChunkType,
  ErrorClassificationType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import {
  BaseAdapter,
  ChatResponseMessageBuilder,
  ChatStreamChunkBuilder,
  Classifications,
  LlmError,
  ModelCost,
  SseLineParser,
  ZERO_TOKEN_USAGE,
} from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import { AnthropicModelsResponseValidator } from './AnthropicModelsResponse.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

/** Short timeout (ms) for the `GET /v1/models` discovery call. */
const DISCOVERY_TIMEOUT_MS = 2_000;

const ADAPTER_CAPABILITIES: AdapterCapabilitiesType = {
  'toolUse':         'full',
  'structuredOutput': false,
  'jsonMode':         false,
};

// ── Anthropic wire shapes ─────────────────────────────────────────────────
//
// These types describe the Anthropic Messages API JSON envelope. They are
// internal to this module — never exported. camelCase field names are OUR
// identifiers; snake_case names appear only inside JSON key strings or
// Record field access where the wire demands them.

type AnthropicTextBlock = {
  readonly type: 'text';
  readonly text: string;
};

type AnthropicToolUseBlock = {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
};

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

type AnthropicToolResultBlock = {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
};

type AnthropicUserMessage = {
  readonly role: 'user';
  readonly content: string | readonly AnthropicToolResultBlock[];
};

type AnthropicAssistantMessage = {
  readonly role: 'assistant';
  readonly content: string;
};

type AnthropicWireMessage = AnthropicUserMessage | AnthropicAssistantMessage;

type AnthropicTool = {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
};

type AnthropicToolChoiceAuto     = { readonly type: 'auto' };
type AnthropicToolChoiceAny      = { readonly type: 'any' };
type AnthropicToolChoiceNone     = { readonly type: 'none' };
type AnthropicToolChoiceSpecific = { readonly type: 'tool'; readonly name: string };

type AnthropicToolChoice =
  | AnthropicToolChoiceAuto
  | AnthropicToolChoiceAny
  | AnthropicToolChoiceNone
  | AnthropicToolChoiceSpecific;

type AnthropicResponseBody = {
  readonly content?: readonly AnthropicContentBlock[];
  readonly stop_reason?: string | null;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
};

// ── Streaming wire shapes ─────────────────────────────────────────────────
//
// Anthropic's SSE `data:` payload is a JSON object whose own `type` field
// mirrors the frame's `event:` name. These are internal, hand-guarded
// discriminated-union shapes for the streaming drain loop only.

type AnthropicMessageStartEvent = {
  readonly type: 'message_start';
  readonly message: {
    readonly usage: {
      readonly input_tokens: number;
    };
  };
};

type AnthropicTextDelta = { readonly type: 'text_delta'; readonly text: string };

type AnthropicContentBlockDeltaEvent = {
  readonly type: 'content_block_delta';
  readonly delta: Record<string, unknown>;
};

type AnthropicMessageDeltaEvent = {
  readonly type: 'message_delta';
  readonly delta: {
    readonly stop_reason: string;
  };
  readonly usage: {
    readonly output_tokens: number;
  };
};

type AnthropicMessageStopEvent = { readonly type: 'message_stop' };
type AnthropicPingEvent = { readonly type: 'ping' };

type AnthropicStreamErrorEvent = {
  readonly type: 'error';
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
};

type AnthropicOtherStreamEvent = { readonly type: string };

type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | AnthropicStreamErrorEvent
  | AnthropicOtherStreamEvent;

// ── Dispatch map: dagonizer ToolChoiceType → Anthropic wire ───────────────

const TOOL_CHOICE_DISPATCH: Readonly<Record<string, AnthropicToolChoice>> = {
  'auto':     { 'type': 'auto' },
  'required': { 'type': 'any' },
  'none':     { 'type': 'none' },
} as const;

// ── Dispatch map: Anthropic stop_reason → dagonizer finishReason ──────────

const STOP_REASON_DISPATCH: Readonly<Record<string, ChatResponseType['finishReason']>> = {
  'end_turn':   'stop',
  'tool_use':   'tool_call',
  'max_tokens': 'length',
} as const;

// ── Options ────────────────────────────────────────────────────────────────

/** Options accepted by `AnthropicApiAdapter` at construction. */
export type AnthropicApiAdapterOptionsType = {
  /** Default model id when a caller does not override via `selectChatModel`. */
  readonly model?: string;
  /** Maximum retry attempts. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Anthropic Messages API base URL. Defaults to `https://api.anthropic.com`. */
  readonly baseUrl?: string;
  /** Anthropic API version header. Defaults to `2023-06-01`. */
  readonly anthropicVersion?: string;
  /** Per-request timeout in ms. Defaults to 60 000. */
  readonly timeoutMs?: number;
  /**
   * Default system prompt the base injects as the leading turn of any request
   * that carries no system message of its own. Consumer-supplied persona/format
   * framing; empty (the default) means no injection.
   */
  readonly systemPrompt?: string;
};

// ── Adapter ────────────────────────────────────────────────────────────────

/**
 * `AnthropicApiAdapter`: first-class adapter for the Anthropic Messages API.
 *
 * Extends `BaseAdapter` directly rather than `OpenAiCompatibleAdapter` because
 * Anthropic's wire format is distinct: system extraction, `tool_result`
 * content blocks, `input_schema` tool definitions, and `content[]` response
 * blocks require their own mapping.
 *
 * ```ts
 * const llm = new AnthropicApiAdapter('sk-ant-…');
 * const response = await llm.chat(ChatRequestBuilder.from({
 *   messages: [{ role: 'user', content: 'Hello' }],
 * }));
 * ```
 */
export class AnthropicApiAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #anthropicVersion: string;

  constructor(apiKey: string, options: AnthropicApiAdapterOptionsType = {}) {
    const coreOptions: { model: string; maxAttempts?: number; systemPrompt?: string; timeoutMs?: number } = {
      'model': options.model ?? 'claude-haiku-4-5',
    };
    if (options.maxAttempts !== undefined) {
      coreOptions.maxAttempts = options.maxAttempts;
    }
    if (options.systemPrompt !== undefined && options.systemPrompt.length > 0) {
      coreOptions.systemPrompt = options.systemPrompt;
    }
    if (options.timeoutMs !== undefined) {
      coreOptions.timeoutMs = options.timeoutMs;
    }
    super(
      'anthropic',
      'Anthropic (claude-haiku-4-5)',
      ADAPTER_CAPABILITIES,
      coreOptions,
    );
    this.#apiKey = apiKey;
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
  }

  /** True when a non-empty API key was supplied. */
  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }

  /**
   * Enumerate models available from Anthropic's `GET /v1/models` endpoint.
   * Maps each entry to an `LlmModelType` with `variant: 'chat'` and
   * `cloud: true` (all Anthropic models are cloud-routed).
   *
   * Returns `[]` on any transport failure, non-ok response, or schema
   * violation — never throws (mirrors `probe` discipline). Composes
   * `options.signal` with an internal discovery timeout.
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    const signals: AbortSignal[] = [controller.signal];
    if (options?.signal !== undefined) signals.push(options.signal);
    const signal = AbortSignal.any(signals);

    try {
      const res = await fetch(`${this.#baseUrl}/v1/models`, {
        'method': 'GET',
        'headers': {
          'x-api-key':         this.#apiKey,
          'anthropic-version': this.#anthropicVersion,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal,
      });
      if (!res.ok) return [];
      const rawBody: unknown = await res.json();
      if (!AnthropicModelsResponseValidator.is(rawBody)) return [];
      return rawBody.data
        .filter((entry) => entry.id.length > 0)
        .map((entry) => ({ 'name': entry.id, 'variant': 'chat' as const, 'cloud': true, 'costRank': ModelCost.rankFromName(entry.id) }));
    } catch {
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  protected override async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const body = this.#composeBody(request);
    const res = await this.#postJson('/v1/messages', body, request.signal);

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(
        `Anthropic ${String(res.status)}: ${text}`,
        AnthropicApiAdapter.#classifyHttp(res.status, text),
      );
    }

    const rawBody: unknown = await res.json();
    return AnthropicApiAdapter.#decodeResponse(rawBody);
  }

  /**
   * Streaming override: tool-bearing requests fall back to the buffered
   * default (`super.performChatStream`) — partial tool-call JSON is unsafe to
   * parse mid-stream. Tool-less requests POST the same endpoint with
   * `stream: true` and drain the SSE body through `SseLineParser`, dispatching
   * on each frame's `type` field (`message_start`, `content_block_delta`,
   * `message_delta`, `message_stop`).
   */
  protected override async performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    if (request.tools.length > 0) return super.performChatStream(request, sink);

    const body = { ...this.#composeBody(request), 'stream': true };
    const res = await this.#postJson('/v1/messages', body, request.signal);

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(
        `Anthropic ${String(res.status)}: ${text}`,
        AnthropicApiAdapter.#classifyHttp(res.status, text),
      );
    }
    if (res.body === null) {
      throw new LlmError('Anthropic: streamed response has no body', Classifications['NETWORK']);
    }

    return this.#drainStream(res.body, sink, request.signal);
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  /** POST `path` with `body` against the configured base URL; classifies transport failures. */
  async #postJson(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(`${this.#baseUrl}${path}`, {
        'method': 'POST',
        'headers': {
          'content-type':      'application/json',
          'x-api-key':         this.#apiKey,
          'anthropic-version': this.#anthropicVersion,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        'body': JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // The base composes the deadline into request.signal before calling
      // performChat, so an abort reason that is already a classified LlmError
      // (e.g. TIMEOUT from the base ceiling) is preserved unchanged. A genuine
      // transport failure maps to NETWORK.
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
    }
  }

  // ── Request composition ──────────────────────────────────────────────────

  #composeBody(request: ChatRequestType): Record<string, unknown> {
    const { systemPrompt, remainingMessages } = AnthropicApiAdapter.#extractSystem(request.messages);

    const body: Record<string, unknown> = {
      'model':      this.model,
      'max_tokens': request.maxTokens > 0 ? request.maxTokens : 1024,
      'messages':   remainingMessages.map((m) => AnthropicApiAdapter.#toWireMessage(m)),
    };

    if (systemPrompt.length > 0) {
      body['system'] = systemPrompt;
    }

    if (request.tools.length > 0) {
      body['tools']       = request.tools.map((t) => AnthropicApiAdapter.#toWireTool(t));
      body['tool_choice'] = AnthropicApiAdapter.#toWireToolChoice(request.toolChoice);
    }

    return body;
  }

  // ── Message mapping ──────────────────────────────────────────────────────

  /**
   * Partition `messages` into a concatenated system prompt string and the
   * remaining non-system messages. Anthropic requires `system` as a top-level
   * field; system messages cannot appear in the `messages` array.
   */
  static #extractSystem(messages: readonly ChatMessageType[]): {
    readonly systemPrompt: string;
    readonly remainingMessages: readonly ChatMessageType[];
  } {
    const systemParts: string[] = [];
    const rest: ChatMessageType[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        rest.push(m);
      }
    }

    return {
      'systemPrompt':      systemParts.join('\n\n'),
      'remainingMessages': rest,
    };
  }

  static #toWireMessage(message: ChatMessageType): AnthropicWireMessage {
    if (message.role === 'tool') {
      return {
        'role': 'user',
        'content': [
          {
            'type':        'tool_result',
            'tool_use_id': message.toolCallId,
            'content':     message.content,
          },
        ],
      };
    }

    if (message.role === 'assistant') {
      return { 'role': 'assistant', 'content': message.content };
    }

    // role === 'user'
    return { 'role': 'user', 'content': message.content };
  }

  static #toWireTool(tool: ToolDefinitionType): AnthropicTool {
    return {
      'name':         tool.name,
      'description':  tool.description,
      'input_schema': tool.inputSchema,
    };
  }

  static #toWireToolChoice(choice: ToolChoiceType): AnthropicToolChoice {
    if (choice.type === 'tool') {
      return { 'type': 'tool', 'name': choice.name };
    }
    return TOOL_CHOICE_DISPATCH[choice.type] ?? { 'type': 'auto' };
  }

  // ── Response decoding ────────────────────────────────────────────────────

  static #decodeResponse(rawBody: unknown): ChatResponseType {
    if (!AnthropicApiAdapter.#isResponseBody(rawBody)) {
      throw new LlmError(
        'Anthropic: response body schema violation — expected { content?, stop_reason?, usage? }',
        Classifications['SCHEMA_VIOLATION'],
      );
    }

    const blocks = rawBody.content ?? [];
    const toolCalls: ToolCallType[] = [];
    const textParts: string[] = [];

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        if (
          typeof block.id !== 'string'
          || typeof block.name !== 'string'
          || !AnthropicApiAdapter.#isJsonObject(block.input)
        ) {
          throw new LlmError(
            'Anthropic: malformed tool_use block — missing id, name, or input',
            Classifications['SCHEMA_VIOLATION'],
          );
        }
        toolCalls.push({
          'id':        block.id,
          'name':      block.name,
          'arguments': block.input,
        });
      } else if (block.type === 'text') {
        textParts.push(block.text);
      }
    }

    const text = textParts.join('');
    const rawStopReason = rawBody.stop_reason ?? 'end_turn';
    const finishReason = AnthropicApiAdapter.#finishReasonFrom(rawStopReason, toolCalls.length > 0);

    const usage = rawBody.usage;

    return {
      'message':      ChatResponseMessageBuilder.from(text, toolCalls),
      'finishReason': finishReason,
      'usage':        usage !== undefined
        ? {
            'promptTokens':     typeof usage.input_tokens  === 'number' ? usage.input_tokens  : 0,
            'completionTokens': typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
          }
        : ZERO_TOKEN_USAGE,
    };
  }

  /** Shared `stop_reason` → `finishReason` mapping used by both the buffered and streaming paths. */
  static #finishReasonFrom(stopReason: string, hasToolCalls: boolean): ChatResponseType['finishReason'] {
    return STOP_REASON_DISPATCH[stopReason] ?? (hasToolCalls ? 'tool_call' : 'stop');
  }

  // ── Streaming drain ──────────────────────────────────────────────────────

  /**
   * Drain an Anthropic SSE body, pushing one `ChatStreamChunkType` per
   * `text_delta`, and assemble the final `ChatResponseType` from the
   * `message_start` / `message_delta` / `message_stop` frames.
   *
   * The loop body is guarded: a mid-stream abort or read failure is
   * classified rather than left to escape as a raw `AbortError` /
   * `DOMException`, matching the buffered path's error-contract discipline
   * (`#postJson`'s catch). `signal` is checked first because an aborted read
   * is reported through the abort path even when the underlying rejection
   * is not itself an `LlmError`; a `SCHEMA_VIOLATION` thrown for a malformed
   * frame or an `error` SSE event passes through unchanged when the request
   * was not aborted. Chunk delivery uses `pushChunk` (best-effort — a
   * rejecting sink must not fail a valid generation).
   */
  async #drainStream(
    stream: ReadableStream<Uint8Array>,
    sink: StreamSinkInterface<ChatStreamChunkType>,
    signal: AbortSignal,
  ): Promise<ChatResponseType> {
    let text = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let usageSeen = false;
    let finishReason: ChatResponseType['finishReason'] = 'stop';

    try {
      for await (const frame of SseLineParser.linesOf(stream)) {
        if (frame.data.length === 0) continue;

        const parsedEvent = AnthropicApiAdapter.#decodeStreamEvent(frame.data);

        if (AnthropicApiAdapter.#isMessageStartEvent(parsedEvent)) {
          promptTokens = parsedEvent.message.usage.input_tokens;
          usageSeen = true;
        } else if (AnthropicApiAdapter.#isContentBlockDeltaEvent(parsedEvent)) {
          const delta = parsedEvent.delta;
          if (AnthropicApiAdapter.#isTextDelta(delta)) {
            text += delta.text;
            await this.pushChunk(sink, ChatStreamChunkBuilder.of(delta.text));
          }
        } else if (AnthropicApiAdapter.#isMessageDeltaEvent(parsedEvent)) {
          finishReason = AnthropicApiAdapter.#finishReasonFrom(parsedEvent.delta.stop_reason, false);
          completionTokens = parsedEvent.usage.output_tokens;
          usageSeen = true;
        } else if (AnthropicApiAdapter.#isStreamErrorEvent(parsedEvent)) {
          throw new LlmError(
            `Anthropic stream error: ${parsedEvent.error.message}`,
            Classifications['SCHEMA_VIOLATION'],
          );
        } else if (parsedEvent.type === 'message_stop') {
          break;
        }
        // 'ping' and any other unrecognized frame type: no-op, continue draining.
      }
    } catch (err) {
      if (signal.aborted) {
        const reason: unknown = signal.reason;
        throw reason instanceof LlmError
          ? reason
          : new LlmError('Anthropic: stream aborted', Classifications['TIMEOUT'], { 'cause': reason });
      }
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
    }

    return {
      'message':      ChatResponseMessageBuilder.from(text, []),
      'finishReason': finishReason,
      'usage':        usageSeen ? { 'promptTokens': promptTokens, 'completionTokens': completionTokens } : ZERO_TOKEN_USAGE,
    };
  }

  /** Parse + narrow one SSE `data:` line's JSON payload; SCHEMA_VIOLATION on malformed JSON or unrecognized shape. */
  static #decodeStreamEvent(raw: string): AnthropicStreamEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new LlmError(
        `Anthropic: malformed stream event — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
        { cause },
      );
    }
    if (!AnthropicApiAdapter.#isAnthropicStreamEvent(parsed)) {
      throw new LlmError(
        `Anthropic: unrecognized stream event shape — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return parsed;
  }

  // ── Type guards ──────────────────────────────────────────────────────────

  static #isResponseBody(value: unknown): value is AnthropicResponseBody {
    return (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
    );
  }

  static #isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  static #isAnthropicStreamEvent(value: unknown): value is AnthropicStreamEvent {
    if (!AnthropicApiAdapter.#isJsonObject(value) || typeof value['type'] !== 'string') return false;
    const type = value['type'];

    switch (type) {
      case 'message_start':
        return AnthropicApiAdapter.#isMessageStartEvent(value);
      case 'content_block_delta':
        return AnthropicApiAdapter.#isContentBlockDeltaEvent(value);
      case 'message_delta':
        return AnthropicApiAdapter.#isMessageDeltaEvent(value);
      case 'message_stop':
      case 'ping':
        return true;
      case 'error':
        return AnthropicApiAdapter.#isStreamErrorEvent(value);
      default:
        return true;
    }
  }

  static #isMessageStartEvent(value: Record<string, unknown>): value is AnthropicMessageStartEvent {
    const message = value['message'];
    if (!AnthropicApiAdapter.#isJsonObject(message)) return false;
    const usage = message['usage'];
    return AnthropicApiAdapter.#isJsonObject(usage) && typeof usage['input_tokens'] === 'number';
  }

  static #isContentBlockDeltaEvent(value: Record<string, unknown>): value is AnthropicContentBlockDeltaEvent {
    const delta = value['delta'];
    return AnthropicApiAdapter.#isJsonObject(delta) && typeof delta['type'] === 'string';
  }

  static #isTextDelta(delta: Record<string, unknown>): delta is AnthropicTextDelta {
    return delta['type'] === 'text_delta' && typeof delta['text'] === 'string';
  }

  static #isMessageDeltaEvent(value: Record<string, unknown>): value is AnthropicMessageDeltaEvent {
    const delta = value['delta'];
    const usage = value['usage'];
    if (!AnthropicApiAdapter.#isJsonObject(delta) || typeof delta['stop_reason'] !== 'string') return false;
    return AnthropicApiAdapter.#isJsonObject(usage) && typeof usage['output_tokens'] === 'number';
  }

  static #isStreamErrorEvent(value: Record<string, unknown>): value is AnthropicStreamErrorEvent {
    const error = value['error'];
    return (
      AnthropicApiAdapter.#isJsonObject(error)
      && typeof error['type'] === 'string'
      && typeof error['message'] === 'string'
    );
  }

  // ── HTTP error classification ────────────────────────────────────────────

  /**
   * Anthropic-specific HTTP classification. 400 maps to `SCHEMA_VIOLATION`
   * (Anthropic uses 400 for malformed request bodies, not model errors).
   * All other codes delegate to the shared `LlmError.classifyHttp` helper.
   */
  static #classifyHttp(status: number, body: string): ErrorClassificationType {
    if (status === 400) return Classifications['SCHEMA_VIOLATION'];
    return LlmError.classifyHttp(status, { 'body': body });
  }
}
