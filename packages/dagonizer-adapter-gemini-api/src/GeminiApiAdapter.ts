/**
 * GeminiApiAdapter: Google AI Studio REST adapter.
 *
 * Maps the shared `ChatRequest` to Gemini's `generateContent` body:
 *
 *   { contents:           ChatMessage[] → contents[]
 *   , tools:              ToolDefinition[] → tools.functionDeclarations[]
 *   , toolConfig:         ToolChoice → toolConfig.functionCallingConfig
 *   , generationConfig:   { responseMimeType, responseSchema, … }
 *   }
 *
 * Response shape:
 *
 *   { candidates: [{ content: { parts: [{ text, functionCall: {name,args} }] } }] }
 *
 * Function calls land as `parts[].functionCall`; the adapter translates
 * back to `ChatResponse.message.toolCalls` so callers never see the
 * wire format. Errors map through `LlmError.classifyHttp` from the shared
 * taxonomy.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from '@studnicky/dagonizer/adapter';
import { BaseAdapter, ChatResponseMessageBuilder, Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';

import type { GeminiResponseBodyType } from './GeminiResponseBody.js';
import { geminiResponseBodyValidator } from './GeminiResponseBody.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';
/** Per-request timeout in ms before the adapter aborts and surfaces TIMEOUT. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface GeminiApiAdapterOptions {
  readonly model?: string;
  readonly maxAttempts?: number;
  /** Per-request timeout in ms. Defaults to 60 000 ms. */
  readonly timeoutMs?: number;
}

export class GeminiApiAdapter extends BaseAdapter {
  readonly #apiKey:    string;
  readonly #model:     string;
  readonly #timeoutMs: number;

  constructor(apiKey: string, options: GeminiApiAdapterOptions = {}) {
    super(
      'gemini-api',
      'Gemini API (your AI Studio key)',
      { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
      { 'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS },
    );
    this.#apiKey    = apiKey;
    this.#model     = options.model ?? DEFAULT_MODEL;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Probe true when a non-empty API key was supplied. Gemini's REST
   * surface gates every call on the `key` query parameter; an empty
   * key is a deterministic 400/403 with no useful retry path, so a
   * missing key surfaces here as "unavailable" and the cascade
   * routes elsewhere. Never throws.
   */
  override async probe(): Promise<boolean> {
    return Promise.resolve(this.#apiKey.length > 0);
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${ENDPOINT}/${encodeURIComponent(this.#model)}:generateContent?key=${encodeURIComponent(this.#apiKey)}`;
    const body = this.#buildBody(request);

    // Compose a per-request timeout with the caller's signal so either
    // can abort the fetch independently.
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => { controller.abort(new LlmError('gemini-api request timeout', Classifications['TIMEOUT'])); },
      this.#timeoutMs,
    );
    const signal = AbortSignal.any([request.signal, controller.signal]);

    let res: Response;
    try {
      res = await fetch(url, {
        'method':  'POST',
        'headers': { 'content-type': 'application/json' },
        'body':    JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw LlmError.fromNetworkError(err);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`Gemini REST ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }

    const rawBody: unknown = await res.json();
    if (!geminiResponseBodyValidator.is(rawBody)) {
      throw new LlmError(
        'Gemini API: response body schema violation — unexpected structure',
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return this.#parseResponse(rawBody);
  }

  #buildBody(request: ChatRequest): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
      'temperature': request.temperature,
      'maxOutputTokens': request.maxTokens,
    };

    const body: Record<string, unknown> = {
      'contents': request.messages.map((m) => this.#toGeminiContent(m)),
      'generationConfig': generationConfig,
    };

    // Native function calling. Gemini's `tools.functionDeclarations` is
    // the canonical wire format; we forward the JSON Schema as
    // `parameters`. When `tools` is set, the model decides whether to
    // emit `parts[].functionCall` based on the prompt + tool description.
    if (request.tools.length > 0) {
      body['tools'] = [{ 'functionDeclarations': request.tools.map((t) => this.#toFunctionDeclaration(t)) }];
      body['toolConfig'] = { 'functionCallingConfig': this.#toGeminiToolConfig(request.toolChoice) };
    } else if (request.outputSchema.kind === 'schema') {
      // Structured-output path: JSON Schema constrains the response
      // body to the requested shape. (Gemini honours `responseSchema` on
      // text models since v1beta.)
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseSchema'] = request.outputSchema.schema;
    }

    return body;
  }

  #parseResponse(payload: GeminiResponseBodyType): ChatResponse {
    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: ToolCall[] = [];
    let text = '';
    for (const part of parts) {
      if (part.functionCall !== undefined) {
        toolCalls.push({
          'id':   `gemini-${String(toolCalls.length)}-${String(Date.now())}`,
          'name': part.functionCall.name,
          'arguments': part.functionCall.args ?? {},
        });
      } else if (part.text !== undefined) {
        text += part.text;
      }
    }
    const finishReason = toolCalls.length > 0
      ? 'tool_call'
      : candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop';
    return {
      'message': ChatResponseMessageBuilder.from(text, toolCalls),
      'finishReason': finishReason,
      'usage': payload.usageMetadata !== undefined
        ? {
          'promptTokens':     payload.usageMetadata.promptTokenCount   ?? 0,
          'completionTokens': payload.usageMetadata.candidatesTokenCount ?? 0,
        }
        : ZERO_TOKEN_USAGE,
    };
  }

  #toGeminiContent(message: ChatMessage): Record<string, unknown> {
    // Gemini uses `model` instead of `assistant`; `tool` becomes `function`.
    const role = message.role === 'assistant' ? 'model'
      : message.role === 'tool' ? 'function'
      : message.role;
    const parts: Record<string, unknown>[] = [];
    if (message.role === 'tool') {
      parts.push({
        'functionResponse': {
          'name':     message.toolName ?? 'unknown',
          'response': { 'result': message.content },
        },
      });
    } else {
      parts.push({ 'text': message.content });
    }
    return { role, parts };
  }

  #toFunctionDeclaration(tool: ToolDefinition): Record<string, unknown> {
    return {
      'name':        tool.name,
      'description': tool.description,
      'parameters':  tool.inputSchema,
    };
  }

  #toGeminiToolConfig(choice: ToolChoice): Record<string, unknown> {
    switch (choice.type) {
      case 'auto':     return { 'mode': 'AUTO' };
      case 'required': return { 'mode': 'ANY' };
      case 'none':     return { 'mode': 'NONE' };
      case 'tool':     return { 'mode': 'ANY', 'allowedFunctionNames': [choice.name] };
    }
  }
}
