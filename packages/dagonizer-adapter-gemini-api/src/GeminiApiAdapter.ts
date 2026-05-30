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
 * wire format. Errors map through `classifyHttp` from the shared
 * taxonomy.
 */

import { BaseAdapter, ChatResponseMessageBuilder, ZERO_TOKEN_USAGE } from '@noocodex/dagonizer/adapter';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ToolCall,
  ToolChoice,
  ToolDefinition,
} from '@noocodex/dagonizer/adapter';
import { asNetworkError, classifyHttp, Classifications, LlmError, type ErrorClassification } from '@noocodex/dagonizer/adapter';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: { readonly name: string; readonly args?: Record<string, unknown> };
}

interface GeminiResponseBody {
  candidates?: ReadonlyArray<{
    content?:   { parts?: readonly GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export interface GeminiApiAdapterOptions {
  readonly model?: string;
  readonly maxAttempts?: number;
}

export class GeminiApiAdapter extends BaseAdapter {
  readonly #apiKey: string;
  readonly #model:  string;

  constructor(apiKey: string, options: GeminiApiAdapterOptions = {}) {
    super(
      'gemini-api',
      'Gemini API (your AI Studio key)',
      { 'toolUse': 'full', 'structuredOutput': true, 'jsonMode': true },
      { 'maxAttempts': options.maxAttempts ?? 3 },
    );
    this.#apiKey = apiKey;
    this.#model  = options.model ?? DEFAULT_MODEL;
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

    let res: Response;
    try {
      res = await fetch(url, {
        'method':  'POST',
        'headers': { 'content-type': 'application/json' },
        'body':    JSON.stringify(body),
        'signal': request.signal,
      });
    } catch (err) {
      throw asNetworkError(err);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(`Gemini REST ${String(res.status)}: ${text}`, classifyHttp(res.status, text));
    }

    const payload = (await res.json()) as GeminiResponseBody;
    return this.#parseResponse(payload);
  }

  protected override classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    if (error instanceof Error && /aborted/iu.test(error.message)) return Classifications['NETWORK'];
    return Classifications['UNKNOWN'];
  }

  #buildBody(request: ChatRequest): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
      'temperature': request.temperature,
      'maxOutputTokens': request.maxTokens,
    };

    const body: Record<string, unknown> = {
      'contents': request.messages.map(toGeminiContent),
      'generationConfig': generationConfig,
    };

    // Native function calling. Gemini's `tools.functionDeclarations` is
    // the canonical wire format; we forward the JSON Schema as
    // `parameters`. When `tools` is set, the model decides whether to
    // emit `parts[].functionCall` based on the prompt + tool description.
    if (request.tools.length > 0) {
      body['tools'] = [{ 'functionDeclarations': request.tools.map(toFunctionDeclaration) }];
      body['toolConfig'] = { 'functionCallingConfig': toGeminiToolConfig(request.toolChoice) };
    } else if (request.outputSchema.kind === 'schema') {
      // Structured-output path: JSON Schema constrains the response
      // body to the requested shape. (Gemini honours `responseSchema` on
      // text models since v1beta.)
      generationConfig['responseMimeType'] = 'application/json';
      generationConfig['responseSchema'] = request.outputSchema.schema;
    }

    return body;
  }

  #parseResponse(payload: GeminiResponseBody): ChatResponse {
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
          'promptTokens':     payload.usageMetadata.promptTokenCount ?? 0,
          'completionTokens': payload.usageMetadata.candidatesTokenCount ?? 0,
        }
        : ZERO_TOKEN_USAGE,
    };
  }
}

function toGeminiContent(message: ChatMessage): Record<string, unknown> {
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

function toFunctionDeclaration(tool: ToolDefinition): Record<string, unknown> {
  return {
    'name':        tool.name,
    'description': tool.description,
    'parameters':  tool.inputSchema,
  };
}

function toGeminiToolConfig(choice: ToolChoice): Record<string, unknown> {
  switch (choice.type) {
    case 'auto':     return { 'mode': 'AUTO' };
    case 'required': return { 'mode': 'ANY' };
    case 'none':     return { 'mode': 'NONE' };
    case 'tool':     return { 'mode': 'ANY', 'allowedFunctionNames': [choice.name] };
  }
}
