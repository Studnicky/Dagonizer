/**
 * CerebrasApiAdapter — Cerebras REST adapter (OpenAI-chat-completions shape).
 *
 * Maps the shared `ChatRequest` to the OpenAI-compatible body Cerebras expects:
 *
 *   { model, messages, tools?, tool_choice?, response_format?, … }
 *
 * Tool-use is gated behind a try/catch — when the model returns a structured
 * error indicating tools are unsupported the adapter retries as plain chat.
 * Structured output via `response_format: { type: 'json_object' }`.
 *
 * Free tier available. Detection: key supplied.
 */

import {
  asNetworkError,
  BaseAdapter,
  ChatResponseMessageBuilder as ChatResponseMessage,
  ZERO_TOKEN_USAGE,
  Classifications,
  classifyHttp,
  LlmError,
} from '@noocodex/dagonizer/adapter';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ErrorClassification,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from '@noocodex/dagonizer/adapter';

const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
// `gpt-oss-120b` is a production-tier Cerebras model with reliable tool-call
// support. Cerebras's catalog as of v0.9.2 is `llama3.1-8b`, `gpt-oss-120b`
// (production), `qwen-3-235b-a22b-instruct-2507`, `zai-glm-4.7` (preview).
const DEFAULT_MODEL = 'gpt-oss-120b';
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

export interface CerebrasApiAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxAttempts?: number;
}

export class CerebrasApiAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #model: string;

  constructor(options: CerebrasApiAdapterOptions) {
    super({
      'id': 'cerebras',
      'displayName': 'Cerebras (gpt-oss-120b)',
      'capabilities': { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': true },
      'maxAttempts': options.maxAttempts ?? 3,
    });
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_MODEL;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    // When tools are requested, attempt tool-enabled call first; fall back
    // to plain chat if the model/endpoint signals tools are unsupported.
    if (request.tools.length > 0) {
      try {
        return await this.#doFetch(request, true);
      } catch (err) {
        // If the error indicates tools are not supported by this model,
        // silently retry without tools as a degraded plain-text call.
        if (isToolsUnsupported(err)) {
          return await this.#doFetch(request, false);
        }
        throw err;
      }
    }
    return this.#doFetch(request, false);
  }

  protected override classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    if (error instanceof Error && /aborted|timeout/iu.test(error.message)) return Classifications['TIMEOUT'];
    return Classifications['UNKNOWN'];
  }

  async #doFetch(request: ChatRequest, withTools: boolean): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(new Error('cerebras request timeout')); }, TIMEOUT_MS);
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
      throw new LlmError(`Cerebras REST ${String(res.status)}: ${text}`, classifyHttp(res.status, text));
    }

    const payload = (await res.json()) as OpenAiResponseBody;
    return parseOpenAiResponse(payload);
  }

  #buildBody(request: ChatRequest, withTools: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      'model': this.#model,
      'messages': request.messages.map(toOpenAiMessage),
      'temperature': request.temperature ?? 0.2,
      'max_completion_tokens': request.maxTokens ?? 512,
    };

    if (withTools && request.tools.length > 0) {
      body['tools'] = request.tools.map(toOpenAiTool);
      if (request.toolChoice !== undefined) {
        body['tool_choice'] = toOpenAiToolChoice(request.toolChoice);
      }
    } else if (request.outputSchema.kind === 'schema') {
      body['response_format'] = { 'type': 'json_object' };
    }

    return body;
  }
}

function isToolsUnsupported(err: unknown): boolean {
  if (!(err instanceof LlmError)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('tool') && (msg.includes('not supported') || msg.includes('unsupported'));
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
    'message': ChatResponseMessage.from(text, toolCalls),
    'finishReason': finishReason,
    'usage': payload.usage !== undefined
      ? { 'promptTokens': payload.usage.prompt_tokens ?? 0, 'completionTokens': payload.usage.completion_tokens ?? 0 }
      : ZERO_TOKEN_USAGE,
  };
}

function parseJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}
