/**
 * GroqApiAdapter — Groq REST adapter (OpenAI-chat-completions shape).
 *
 * Maps the shared `ChatRequest` to the OpenAI-compatible body Groq expects:
 *
 *   { model, messages, tools?, tool_choice?, response_format?, … }
 *
 * Response shape is standard OpenAI `chat.completion` — adapter translates
 * `choices[0].message.tool_calls` back to `ChatResponse.message.toolCalls`
 * so callers never see the wire format.
 *
 * Free tier: ~30 RPM on llama-3.3-70b-versatile. Detection: key supplied.
 * Detection is key-presence-only — we trust the key until the first 401.
 */

import {
  asNetworkError,
  BaseAdapter,
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

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
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

export interface GroqApiAdapterOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly maxAttempts?: number;
}

export class GroqApiAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #model: string;

  constructor(options: GroqApiAdapterOptions) {
    super({
      'id': 'groq',
      'displayName': 'Groq (llama-3.3-70b)',
      'capabilities': { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
      'maxAttempts': options.maxAttempts ?? 3,
    });
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_MODEL;
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => { controller.abort(new Error('groq request timeout')); }, TIMEOUT_MS);
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
      throw new LlmError(`Groq REST ${String(res.status)}: ${text}`, classifyHttp(res.status, text));
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
      'max_completion_tokens': request.maxTokens ?? 512,
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
