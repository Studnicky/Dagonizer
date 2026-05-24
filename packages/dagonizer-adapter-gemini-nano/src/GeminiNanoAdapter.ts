/**
 * GeminiNanoAdapter — Chrome's built-in `window.LanguageModel`.
 *
 * Chrome (138+ stable / behind `chrome://flags/#prompt-api-for-gemini-nano`
 * earlier) ships an on-device Gemini Nano model. The Prompt API exposes
 * `responseConstraint` for JSON-schema-constrained outputs — we use it
 * to enforce the tool-plan shape, since Nano does not yet have a
 * native function-calling channel like the REST API does.
 *
 *   - Without `tools`:    plain text generation
 *   - With `outputSchema`: structured output via `responseConstraint`
 *   - With `tools`:        emit a `responseConstraint` for `{ tool_calls: [...] }`
 *                          and decode the JSON back into `ToolCall[]`
 *
 * Sessions are short-lived — one prompt per session, destroyed in
 * `finally` to release the on-device GPU buffer.
 */

import { BaseAdapter, ChatResponseMessageBuilder } from '@noocodex/dagonizer/adapter';
import type {
  ChatRequest,
  ChatResponse,
  ToolCall,
  ToolDefinition,
} from '@noocodex/dagonizer/adapter';
import { Classifications, LlmError, type ErrorClassification } from '@noocodex/dagonizer/adapter';

export type GeminiNanoAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

interface PromptOptions {
  responseConstraint?: Record<string, unknown>;
}

interface LanguageModelSession {
  prompt(input: string, options?: PromptOptions): Promise<string>;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(): Promise<GeminiNanoAvailability>;
  create(options?: {
    initialPrompts?: ReadonlyArray<{ role: 'system' | 'user'; content: string }>;
  }): Promise<LanguageModelSession>;
}

function getLanguageModel(): LanguageModelStatic | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  return (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

/** Public probe — used by the provider matrix to pick the best backend. */
export async function detectGeminiNano(): Promise<GeminiNanoAvailability> {
  const lm = getLanguageModel();
  if (lm === undefined) return 'unavailable';
  try {
    return await lm.availability();
  } catch {
    return 'unavailable';
  }
}

export class GeminiNanoAdapter extends BaseAdapter {
  constructor() {
    super(
      'gemini-nano',
      'Gemini Nano (Chrome on-device)',
      { 'toolUse': 'none', 'structuredOutput': true, 'jsonMode': false },
      { 'maxAttempts': 2 },
    );
  }

  /**
   * Probe true only when Chrome's `window.LanguageModel` is present
   * AND `availability()` reports `'available'`. `'downloadable'` and
   * `'downloading'` resolve as false — the model isn't ready to serve
   * a chat call immediately, and a cascade should pick a different
   * adapter while the on-device weights warm up. Never throws.
   */
  override async probe(): Promise<boolean> {
    const lm = getLanguageModel();
    if (lm === undefined) return false;
    try {
      const status = await lm.availability();
      return status === 'available';
    } catch {
      return false;
    }
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const lm = getLanguageModel();
    if (lm === undefined) {
      throw new LlmError('window.LanguageModel is not present', Classifications['MODEL_NOT_FOUND']);
    }

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const userPrompt = collapseUserMessages(request);

    const initialPrompts = systemMessages.length > 0
      ? systemMessages.map((m) => ({ 'role': 'system' as const, 'content': m.content }))
      : undefined;

    const session = await lm.create(initialPrompts === undefined ? undefined : { initialPrompts });
    try {
      const options: PromptOptions = {};
      if (request.tools.length > 0) {
        options.responseConstraint = toolPlanSchema(request.tools);
      } else if (request.outputSchema.kind === 'schema') {
        options.responseConstraint = request.outputSchema.schema;
      }

      let raw: string;
      try {
        raw = await session.prompt(userPrompt, options);
      } catch (err) {
        throw classifyNanoError(err);
      }

      const text = raw.trim();
      const toolCalls: readonly ToolCall[] = request.tools.length > 0 ? decodeToolCalls(raw) : [];
      return {
        'message': ChatResponseMessageBuilder.from(text, toolCalls),
        'finishReason': toolCalls.length > 0 ? 'tool_call' : 'stop',
        'usage': { 'promptTokens': 0, 'completionTokens': 0 },
      };
    } finally {
      session.destroy();
    }
  }

  protected override classify(error: unknown): ErrorClassification {
    if (error instanceof LlmError) return error.classification;
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes('availability') || msg.includes('not present')) return Classifications['MODEL_NOT_FOUND'];
    if (msg.includes('aborted')) return Classifications['NETWORK'];
    return Classifications['UNKNOWN'];
  }
}

function collapseUserMessages(request: ChatRequest): string {
  // Nano sessions take one prompt — concatenate user turns. Tool
  // results round-tripped from the DAG land as `role: 'tool'`; we
  // surface them as `[tool <name>: <content>]` so the next turn knows.
  return request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') return `[tool ${m.toolName.length > 0 ? m.toolName : 'unknown'}: ${m.content}]`;
      return m.content;
    })
    .join('\n\n');
}

function toolPlanSchema(tools: readonly ToolDefinition[]): Record<string, unknown> {
  // Per-tool variants — each enforces the tool's own inputSchema on
  // `arguments`. Without this Nano gets a free `{}` and tends to
  // hallucinate extra fields (e.g. padding the query with prose) that
  // wreck downstream API calls.
  const variants = tools.map((t) => ({
    'type': 'object',
    'additionalProperties': false,
    'properties': {
      'name':      { 'type': 'string', 'const': t.name },
      'arguments': t.inputSchema,
    },
    'required': ['name', 'arguments'],
  }));
  return {
    'type': 'object',
    'additionalProperties': false,
    'properties': {
      'tool_calls': {
        'type':  'array',
        'items': variants.length === 1 ? variants[0] : { 'anyOf': variants },
      },
    },
    'required': ['tool_calls'],
  };
}

function decodeToolCalls(raw: string): ToolCall[] {
  try {
    const parsed = JSON.parse(raw) as { tool_calls?: ReadonlyArray<{ name?: string; arguments?: Record<string, unknown> }> };
    const calls = parsed.tool_calls ?? [];
    return calls
      .filter((c): c is { name: string; arguments: Record<string, unknown> } =>
        typeof c.name === 'string' && c.arguments !== undefined,
      )
      .map((c, i) => ({
        'id':   `nano-${String(i)}-${String(Date.now())}`,
        'name': c.name,
        'arguments': c.arguments,
      }));
  } catch {
    return [];
  }
}

function classifyNanoError(err: unknown): LlmError {
  const message = err instanceof Error ? err.message : String(err);
  const msg = message.toLowerCase();
  if (msg.includes('schema') || msg.includes('constraint')) {
    return new LlmError(message, Classifications['SCHEMA_VIOLATION'], err);
  }
  if (msg.includes('quota')) return new LlmError(message, Classifications['QUOTA_EXHAUSTED'], err);
  return new LlmError(message, Classifications['UNKNOWN'], err);
}
