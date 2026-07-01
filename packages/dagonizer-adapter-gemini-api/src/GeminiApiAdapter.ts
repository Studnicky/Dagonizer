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

import type { StreamSinkInterface } from '@studnicky/dagonizer';
import type {
  ChatMessageType,
  ChatRequestType,
  ChatResponseType,
  ChatStreamChunkType,
  ToolCallType,
  ToolChoiceType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import {
  BaseAdapter,
  ChatResponseMessageBuilder,
  ChatStreamChunkBuilder,
  Classifications,
  DEFAULT_MAX_ATTEMPTS,
  LlmError,
  ModelCost,
  SseLineParser,
  ZERO_TOKEN_USAGE,
} from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import { GeminiModelsResponseValidator } from './GeminiModelsResponse.js';
import type { GeminiErrorFrameType, GeminiResponseBodyType } from './GeminiResponseBody.js';
import { geminiErrorFrameValidator, geminiResponseBodyValidator } from './GeminiResponseBody.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Short timeout for model discovery — no payload, just a list response. */
const DISCOVERY_TIMEOUT_MS = 3_000;

export type GeminiApiAdapterOptionsType = {
  readonly model?: string;
  readonly maxAttempts?: number;
  /** Per-request timeout in ms. Defaults to 60 000 ms. */
  readonly timeoutMs?: number;
  /**
   * Default system prompt the base injects as the leading turn of any request
   * that carries no system message of its own. Consumer-supplied persona/format
   * framing; empty (the default) means no injection.
   */
  readonly systemPrompt?: string;
};

export class GeminiApiAdapter extends BaseAdapter {
  readonly #apiKey: string;

  constructor(apiKey: string, options: GeminiApiAdapterOptionsType = {}) {
    const coreOptions: { maxAttempts: number; model?: string; systemPrompt?: string; timeoutMs?: number } = {
      'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    };
    if (options.model !== undefined) {
      coreOptions.model = options.model;
    }
    if (options.systemPrompt !== undefined && options.systemPrompt.length > 0) {
      coreOptions.systemPrompt = options.systemPrompt;
    }
    if (options.timeoutMs !== undefined) {
      coreOptions.timeoutMs = options.timeoutMs;
    }
    super(
      'gemini-api',
      'Gemini API (your AI Studio key)',
      { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
      coreOptions,
    );
    this.#apiKey = apiKey;
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

    let res: Response;
    try {
      res = await fetch(url, {
        'method':  'POST',
        'headers': { 'content-type': 'application/json' },
        'body':    JSON.stringify(body),
        'signal':  request.signal,
      });
    } catch (err) {
      // The base guard composes the deadline into request.signal before calling
      // performChat; an abort from the base or the caller surfaces here as the
      // abort reason. A caller/base LlmError is already classified — preserve
      // it. Only a genuine transport failure maps to NETWORK via ofNetworkError.
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
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

  /**
   * Streaming override: POSTs `streamGenerateContent?alt=sse` (same body as
   * `performChat`, reused via `#composeBody`) and drains the SSE body through
   * `SseLineParser`, pushing one `ChatStreamChunkType` per non-empty text
   * delta. Gemini's SSE frames carry no `event:` line and no `[DONE]`
   * sentinel — each `data:` frame is a full (partial) `generateContent`
   * response body, so the streamed chunks are decoded through the same
   * `geminiResponseBodyValidator` the buffered path uses. Single-attempt (no
   * retry), matching `chatStream`'s contract.
   *
   * Tool-turns fall back to the buffered default (`super.performChatStream`):
   * Gemini's function-call parts arrive fully formed rather than as
   * incremental deltas, so streaming brings no benefit for tool turns.
   */
  protected override async performChatStream(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    if (request.tools.length > 0) return super.performChatStream(request, sink);
    return this.#sendStreamRequest(request, sink);
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
    return {
      'message': ChatResponseMessageBuilder.from(text, toolCalls),
      'finishReason': this.#mapFinishReason(candidate?.finishReason, toolCalls.length > 0),
      'usage': this.#toUsage(payload.usageMetadata),
    };
  }

  /**
   * Shared finish-reason mapping between the buffered and streamed decode
   * paths: a non-empty tool-call set always wins, `MAX_TOKENS` maps to
   * `length`, everything else maps to `stop`.
   */
  #mapFinishReason(rawFinishReason: string | undefined, hasToolCalls: boolean): ChatResponseType['finishReason'] {
    if (hasToolCalls) return 'tool_call';
    return rawFinishReason === 'MAX_TOKENS' ? 'length' : 'stop';
  }

  /** Shared token-usage construction between the buffered and streamed decode paths. */
  #toUsage(usageMetadata: GeminiResponseBodyType['usageMetadata']): ChatResponseType['usage'] {
    return usageMetadata !== undefined
      ? {
        'promptTokens':     usageMetadata.promptTokenCount   ?? 0,
        'completionTokens': usageMetadata.candidatesTokenCount ?? 0,
      }
      : ZERO_TOKEN_USAGE;
  }

  async #sendStreamRequest(
    request: ChatRequestType,
    sink: StreamSinkInterface<ChatStreamChunkType>,
  ): Promise<ChatResponseType> {
    const url = `${ENDPOINT}/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.#apiKey)}`;
    const body = this.#composeBody(request);

    let res: Response;
    try {
      res = await fetch(url, {
        'method':  'POST',
        'headers': { 'content-type': 'application/json' },
        'body':    JSON.stringify(body),
        'signal':  request.signal,
      });
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`Gemini REST ${String(res.status)}: ${text}`, LlmError.classifyHttp(res.status, { 'body': text }));
    }
    if (res.body === null) {
      throw new LlmError('Gemini API: streamed response has no body', Classifications['NETWORK']);
    }

    return this.#drainStream(res.body, sink, request);
  }

  /**
   * Drain the `streamGenerateContent` SSE body: each frame's `data:` payload
   * is a full (partial) `generateContent` response, decoded through the same
   * `geminiResponseBodyValidator` the buffered path uses. Text deltas are
   * pushed to the sink as they arrive and accumulated for the final assembled
   * response; `finishReason` and `usageMetadata` are last-seen-wins since
   * Gemini emits them once, near the end of the stream.
   *
   * A mid-stream `error` frame (quota, safety block, …) is detected by
   * `#decodeStreamChunk` and thrown as a classified `LlmError` rather than
   * decoded as an empty success chunk. The drain loop itself is wrapped so
   * an abort/read failure never escapes as a raw `DOMException`: an abort of
   * `request.signal` rethrows the composed abort reason (already an
   * `LlmError` when it originates from `BaseAdapter.withDeadline`'s deadline
   * timer), and any other read failure is classified through the same
   * network-error path `performChat` uses.
   */
  async #drainStream(
    stream: ReadableStream<Uint8Array>,
    sink: StreamSinkInterface<ChatStreamChunkType>,
    request: ChatRequestType,
  ): Promise<ChatResponseType> {
    let text = '';
    let rawFinishReason: string | undefined;
    let usageMetadata: GeminiResponseBodyType['usageMetadata'];

    try {
      for await (const frame of SseLineParser.linesOf(stream)) {
        if (frame.data.length === 0) continue;
        const chunk = this.#decodeStreamChunk(frame.data);
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        let delta = '';
        for (const part of parts) {
          if (part.text !== undefined) delta += part.text;
        }
        if (delta.length > 0) {
          text += delta;
          await this.pushChunk(sink, ChatStreamChunkBuilder.of(delta));
        }
        if (candidate?.finishReason !== undefined) rawFinishReason = candidate.finishReason;
        if (chunk.usageMetadata !== undefined) usageMetadata = chunk.usageMetadata;
      }
    } catch (err) {
      if (request.signal.aborted) {
        const reason: unknown = request.signal.reason;
        throw reason instanceof LlmError
          ? reason
          : new LlmError('Gemini API: stream aborted', Classifications['TIMEOUT'], { 'cause': reason });
      }
      if (err instanceof LlmError) throw err;
      throw LlmError.ofNetworkError(err);
    }

    return {
      'message': ChatResponseMessageBuilder.from(text, []),
      'finishReason': this.#mapFinishReason(rawFinishReason, false),
      'usage': this.#toUsage(usageMetadata),
    };
  }

  /**
   * Parse one SSE `data:` line's JSON payload. Probes for Gemini's error
   * envelope (`{"error":{"code","message","status"}}`) BEFORE the permissive
   * success-body validator — `GeminiResponseBodySchema` carries no top-level
   * `required` and `additionalProperties: true`, so an error frame would
   * otherwise validate as a legal empty success chunk. A matched error frame
   * is classified through the same `LlmError.classifyHttp` path `performChat`
   * uses (its `code` doubles as an HTTP-shaped status). SCHEMA_VIOLATION on
   * malformed JSON or an unrecognized structure.
   */
  #decodeStreamChunk(raw: string): GeminiResponseBodyType {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new LlmError(
        `Gemini API: malformed stream chunk — ${raw.slice(0, 120)}`,
        Classifications['SCHEMA_VIOLATION'],
        { cause },
      );
    }
    if (geminiErrorFrameValidator.is(parsed)) {
      throw this.#toStreamError(parsed);
    }
    if (!geminiResponseBodyValidator.is(parsed)) {
      throw new LlmError(
        'Gemini API: streamed chunk schema violation — unexpected structure',
        Classifications['SCHEMA_VIOLATION'],
      );
    }
    return parsed;
  }

  /**
   * Classify a mid-stream Gemini error envelope. `error.code` is an
   * HTTP-shaped status (`429`, `403`, …) so it routes through the shared
   * `LlmError.classifyHttp` classifier the buffered path's non-2xx branch
   * uses; an envelope with no `code` (never observed in practice, but the
   * schema does not require it) falls back to `UNKNOWN`.
   */
  #toStreamError(frame: GeminiErrorFrameType): LlmError {
    const message = frame.error.message ?? 'Gemini API: streamed error';
    const classification = frame.error.code !== undefined
      ? LlmError.classifyHttp(frame.error.code, { 'body': message })
      : Classifications['UNKNOWN'];
    return new LlmError(`Gemini API stream error: ${message}`, classification);
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
      'tool':     (c) => {
        if (c.type !== 'tool') return { 'mode': 'ANY' };
        return { 'mode': 'ANY', 'allowedFunctionNames': [c.name] };
      },
    };
    return choiceDispatch[choice.type](choice);
  }
}
