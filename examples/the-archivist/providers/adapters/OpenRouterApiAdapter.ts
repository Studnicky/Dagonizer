/**
 * OpenRouterApiAdapter — OpenRouter REST adapter (OpenAI-chat-completions shape).
 *
 * Maps the shared `ChatRequest` to the OpenAI-compatible body OpenRouter expects.
 * Includes the required OpenRouter-specific headers:
 *
 *   HTTP-Referer: https://studnicky.github.io/Dagonizer/
 *   X-Title: Dagonizer Archivist
 *
 * Default model: `meta-llama/llama-3.3-70b-instruct:free` (the `:free` suffix
 * selects the free-tier routing, so no billing for demo use).
 *
 * Tool-use via `tools` + `tool_choice`. Structured output via
 * `response_format: { type: 'json_object' }`.
 *
 * Detection: key supplied. Free-tier models available without credits.
 */

import { BaseAdapter } from './BaseAdapter.ts';
import type { ChatMessage, ChatRequest, ChatResponse, ToolCall, ToolChoice, ToolDefinition } from './LlmAdapter.ts';
import { asNetworkError, classifyHttp, Classifications, LlmError, type ErrorClassification } from './LlmError.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const SITE_URL = 'https://studnicky.github.io/Dagonizer/';
const SITE_TITLE = 'Dagonizer Archivist';
const TIMEOUT_MS = 60_000;

interface OpenAiToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface OpenAiResponseBody {
  choices?: ReadonlyArray<{
    message?: {
      content?: string | null;
      tool_calls?: readonly OpenAiToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface OpenRouterApiAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxAttempts?: number;
}

export class OpenRouterApiAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #model: string;

  constructor(options: OpenRouterApiAdapterOptions) {
    super({
      'id': 'openrouter',
      'displayName': 'OpenRouter (llama-3.3-70b free)',
      // `:free` tier may downgrade to non-tool endpoints; treat as partial
      // until per-route capability negotiation is in place.
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'maxAttempts': options.maxAttempts ?? 3,
    });
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_MODEL;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(new Error('openrouter request timeout')); }, TIMEOUT_MS);
    const signal = request.signal !== undefined
      ? AbortSignal.any([request.signal, controller.signal])
      : controller.signal;

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        'method': 'POST',
        'headers': {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.#apiKey}`,
          'HTTP-Referer': SITE_URL,
          'X-Title': SITE_TITLE,
        },
        'body': JSON.stringify(this.#buildBody(request)),
        signal,
      });
    } catch (err) {
      throw asNetworkError(err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`OpenRouter REST ${String(res.status)}: ${text}`, classifyHttp(res.status, text));
    }

    const payload = (await res.json()) as OpenAiResponseBody;
    return parseOpenAiResponse(payload);
  }

  protected override classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    if (error instanceof Error && /aborted|timeout/iu.test(error.message)) return Classifications['TIMEOUT'];
    return Classifications['UNKNOWN'];
  }

  #buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.#model,
      'messages': request.messages.map(toOpenAiMessage),
      'temperature': request.temperature ?? 0.2,
      'max_tokens': request.maxTokens ?? 512,
    };

    if (request.tools !== undefined && request.tools.length > 0) {
      body['tools'] = request.tools.map(toOpenAiTool);
      if (request.toolChoice !== undefined) {
        body['tool_choice'] = toOpenAiToolChoice(request.toolChoice);
      }
    } else if (request.outputSchema !== undefined) {
      body['response_format'] = { 'type': 'json_object' };
    }

    return body;
  }
}

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      'role': 'tool',
      'tool_call_id': message.toolCallId ?? '',
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
      ...(tool.strict === true ? { 'strict': true } : {}),
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
    'message': toolCalls.length > 0
      ? { 'toolCalls': toolCalls, 'content': text.length === 0 ? undefined : text }
      : { 'content': text },
    'finishReason': finishReason,
    ...(payload.usage !== undefined ? {
      'usage': {
        'promptTokens': payload.usage.prompt_tokens,
        'completionTokens': payload.usage.completion_tokens,
      } as { promptTokens?: number; completionTokens?: number },
    } : {}),
  };
}

function parseJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}
