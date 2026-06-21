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
 */

import type {
  AdapterCapabilitiesType,
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ErrorClassificationType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import {
  BaseAdapter,
  ChatResponseMessageBuilder,
  Classifications,
  LlmError,
  ZERO_TOKEN_USAGE,
} from '@studnicky/dagonizer/adapter';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

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
  readonly #timeoutMs: number;

  constructor(apiKey: string, options: AnthropicApiAdapterOptionsType = {}) {
    const coreOptions = options.maxAttempts !== undefined
      ? { 'maxAttempts': options.maxAttempts, 'model': options.model ?? 'claude-3-5-haiku-20241022' }
      : { 'model': options.model ?? 'claude-3-5-haiku-20241022' };
    super(
      'anthropic',
      'Anthropic (claude-3-5-haiku)',
      ADAPTER_CAPABILITIES,
      coreOptions,
    );
    this.#apiKey = apiKey;
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.#anthropicVersion = options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** True when a non-empty API key was supplied. */
  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }

  protected override async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const body = this.#composeBody(request);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => { controller.abort(new LlmError('anthropic request timeout', Classifications['TIMEOUT'])); },
      this.#timeoutMs,
    );
    const signal = AbortSignal.any([request.signal, controller.signal]);

    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/v1/messages`, {
        'method': 'POST',
        'headers': {
          'content-type':      'application/json',
          'x-api-key':         this.#apiKey,
          'anthropic-version': this.#anthropicVersion,
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
      throw new LlmError(
        `Anthropic ${String(res.status)}: ${text}`,
        AnthropicApiAdapter.#classifyHttp(res.status, text),
      );
    }

    const rawBody: unknown = await res.json();
    return AnthropicApiAdapter.#decodeResponse(rawBody);
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
    const finishReason: ChatResponseType['finishReason'] =
      STOP_REASON_DISPATCH[rawStopReason]
      ?? (toolCalls.length > 0 ? 'tool_call' : 'stop');

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
