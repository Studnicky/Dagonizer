/**
 * GeminiApiAdapter: Google AI Studio REST adapter.
 *
 * Maps the shared `ChatRequestType` to Gemini's `generateContent` body:
 *
 *   { contents:           ChatMessage[] → contents[]
 *   , tools:              ToolDefinition[] → tools.functionDeclarations[]
 *   , toolConfig:         ToolChoiceType → toolConfig.functionCallingConfig
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
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import { BaseAdapter, ChatResponseMessageBuilder, Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, ModelCost, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import { GeminiModelsResponseValidator } from './GeminiModelsResponse.js';
import type { GeminiResponseBodyType } from './GeminiResponseBody.js';
import { geminiResponseBodyValidator } from './GeminiResponseBody.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Per-request timeout in ms before the adapter aborts and surfaces TIMEOUT. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Short timeout for model discovery — no payload, just a list response. */
const DISCOVERY_TIMEOUT_MS = 3_000;

export type GeminiApiAdapterOptionsType = {
  readonly model?: string;
  readonly maxAttempts?: number;
  /** Per-request timeout in ms. Defaults to 60 000 ms. */
  readonly timeoutMs?: number;
};

export class GeminiApiAdapter extends BaseAdapter {
  readonly #apiKey:    string;
  readonly #timeoutMs: number;

  constructor(apiKey: string, options: GeminiApiAdapterOptionsType = {}) {
    const coreOptions: { maxAttempts: number; model?: string } = {
      'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    };
    if (options.model !== undefined) {
      coreOptions.model = options.model;
    }
    super(
      'gemini-api',
      'Gemini API (your AI Studio key)',
      { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
      coreOptions,
    );
    this.#apiKey    = apiKey;
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

  /**
   * Query the Gemini v1beta/models endpoint and map each entry to `LlmModelType`.
   *
   * Name prefix `models/` is stripped (e.g. `models/gemini-2.0-flash` → `gemini-2.0-flash`).
   * Variant is `'embedding'` when `supportedGenerationMethods` includes `embedContent`,
   * `'chat'` when it includes `generateContent`, and `'unknown'` otherwise.
   * All Gemini models are cloud-hosted (`cloud: true`).
   *
   * Never throws — returns `[]` on any failure (network error, non-2xx, malformed body,
   * timeout). Composes `options.signal` with an internal discovery timeout via
   * `AbortSignal.any`.
   */
  override async listModels(options?: { readonly signal?: AbortSignal }): Promise<readonly LlmModelType[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, DISCOVERY_TIMEOUT_MS);
    const signal = options?.signal !== undefined
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    try {
      const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(this.#apiKey)}`, {
        'method': 'GET',
        signal,
      });
      if (!res.ok) return [];
      const body: unknown = await res.json();
      if (!GeminiModelsResponseValidator.is(body)) return [];
      return body.models.map((entry): LlmModelType => {
        const rawName = entry.name;
        const name = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
        const methods = entry.supportedGenerationMethods ?? [];
        const variant: LlmModelType['variant'] = methods.includes('embedContent')
          ? 'embedding'
          : methods.includes('generateContent')
            ? 'chat'
            : 'unknown';
        return { name, variant, 'cloud': true, 'costRank': ModelCost.rankFromName(name) };
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const url = `${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.#apiKey)}`;
    const body = this.#composeBody(request);

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
      throw LlmError.ofNetworkError(err);
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
    return this.#decodeResponse(rawBody);
  }

  #composeBody(request: ChatRequestType): Record<string, unknown> {
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
    } else if (request.outputSchema.variant === 'schema') {
      // Structured-output path: JSON Schema constrains the response
      // body to the requested shape. (Gemini honours `responseSchema` on
      // text models since v1beta.)
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseSchema'] = request.outputSchema.schema;
    }

    return body;
  }

  #decodeResponse(payload: GeminiResponseBodyType): ChatResponseType {
    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: ToolCallType[] = [];
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

  #toGeminiContent(message: ChatMessageType): Record<string, unknown> {
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

  #toFunctionDeclaration(tool: ToolDefinitionType): Record<string, unknown> {
    return {
      'name':        tool.name,
      'description': tool.description,
      'parameters':  tool.inputSchema,
    };
  }

  #toGeminiToolConfig(choice: ToolChoiceType): Record<string, unknown> {
    const choiceDispatch: Record<ToolChoiceType['type'], (c: ToolChoiceType) => Record<string, unknown>> = {
      'auto':     () => ({ 'mode': 'AUTO' }),
      'required': () => ({ 'mode': 'ANY' }),
      'none':     () => ({ 'mode': 'NONE' }),
      'tool':     (c) => ({ 'mode': 'ANY', 'allowedFunctionNames': [(c as ToolChoiceType & { type: 'tool' }).name] }),
    };
    return choiceDispatch[choice.type](choice);
  }
}
