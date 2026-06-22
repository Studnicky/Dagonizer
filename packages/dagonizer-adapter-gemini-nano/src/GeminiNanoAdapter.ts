/**
 * GeminiNanoAdapter: the browser's built-in `window.LanguageModel`.
 *
 * Chrome 138+ and Edge expose an on-device LanguageModel via
 * `window.LanguageModel` (behind `chrome://flags/#prompt-api-for-gemini-nano`
 * on earlier versions). The Prompt API exposes
 * `responseConstraint` for JSON-schema-constrained outputs; we use it
 * to enforce the tool-plan shape, since Nano does not yet have a
 * native function-calling channel like the REST API does.
 *
 *   - Without `tools`:    plain text generation
 *   - With `outputSchema`: structured output via `responseConstraint`
 *   - With `tools`:        emit a `responseConstraint` for `{ tool_calls: [...] }`
 *                          and decode the JSON back into `ToolCall[]` via
 *                          JSON coercion (`responseConstraint` + `ToolCallCodec.decode`)
 *
 * Sessions are short-lived: one prompt per session, destroyed in
 * `finally` to release the on-device GPU buffer.
 */

import type {
  ChatRequestType,
  ChatResponseType,
  ErrorClassificationType,
  ToolDefinitionType,
} from '@studnicky/dagonizer/adapter';
import { BaseAdapter, ChatResponseMessageBuilder, Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, ToolCallCodec, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import type {
  GeminiNanoAvailabilityType,
  LanguageModelStaticInterface,
  PromptOptionsType,
} from './LanguageModelHost.js';
import {
  languageModelSessionValidator,
  languageModelStaticValidator,
} from './LanguageModelHost.js';

/** Stable model identifier for the browser's built-in on-device model. */
const GEMINI_NANO_MODEL_ID = 'gemini-nano';

export type GeminiNanoAdapterOptionsType = {
  readonly maxAttempts?: number;
};

export class GeminiNanoAdapter extends BaseAdapter {
  /**
   * Read `globalThis.LanguageModel` as `unknown` and validate it against
   * `LanguageModelStaticSchema` at the host boundary. Returns the narrowed
   * host object, or `undefined` when the global is absent or fails the
   * structural check. This is the single foreign-boundary narrowing for
   * the Nano host object — every other method receives the already-narrowed
   * `LanguageModelStaticInterface`.
   */
  private static languageModel(): LanguageModelStaticInterface | undefined {
    if (typeof globalThis === 'undefined') return undefined;
    const candidate: unknown = Reflect.get(globalThis, 'LanguageModel');
    if (!languageModelStaticValidator.is(candidate)) return undefined;
    return candidate;
  }

  /** Public probe. Used by the provider matrix to pick the best backend. */
  static async detect(): Promise<GeminiNanoAvailabilityType> {
    const lm = GeminiNanoAdapter.languageModel();
    if (lm === undefined) return 'unavailable';
    try {
      return await lm.availability();
    } catch {
      return 'unavailable';
    }
  }

  constructor(options: GeminiNanoAdapterOptionsType = {}) {
    super(
      'gemini-nano',
      'Browser built-in LanguageModel (on-device)',
      // ToolInterface calls are emitted via JSON coercion (responseConstraint +
      // ToolCallCodec.decode) rather than a native function-calling channel.
      { 'toolUse': 'partial', 'structuredOutput': true, 'jsonMode': false },
      { 'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS },
    );
  }

  /**
   * Probe true only when the browser's `window.LanguageModel` is present
   * AND `availability()` reports `'available'`. `'downloadable'` and
   * `'downloading'` resolve as false; the model isn't ready to serve
   * a chat call immediately, and a cascade should pick a different
   * adapter while the on-device weights warm up. Never throws.
   */
  override async probe(): Promise<boolean> {
    return (await GeminiNanoAdapter.detect()) === 'available';
  }

  /**
   * Returns the single on-device model descriptor for Gemini Nano.
   * No network or browser API is required to enumerate it. The
   * returned Promise always resolves immediately.
   */
  override listModels(): Promise<readonly LlmModelType[]> {
    return Promise.resolve([{ 'name': GEMINI_NANO_MODEL_ID, 'variant': 'chat', 'cloud': false }]);
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const lm = GeminiNanoAdapter.languageModel();
    if (lm === undefined) {
      throw new LlmError('window.LanguageModel is not present', Classifications['MODEL_NOT_FOUND']);
    }

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const userPrompt = this.#collapseUserMessages(request);

    const initialPrompts = systemMessages.length > 0
      ? systemMessages.map((m) => ({ 'role': 'system' as const, 'content': m.content }))
      : undefined;

    const rawSession: unknown = await lm.create(initialPrompts === undefined ? undefined : { initialPrompts });
    const session = languageModelSessionValidator.validate(rawSession);
    try {
      const options: PromptOptionsType = {};
      if (request.tools.length > 0) {
        options.responseConstraint = this.#toolPlanSchema(request.tools);
      } else if (request.outputSchema.variant === 'schema') {
        options.responseConstraint = request.outputSchema.schema;
      }

      let raw: string;
      try {
        raw = await session.prompt(userPrompt, options);
      } catch (err) {
        throw this.#classifyNanoError(err);
      }

      const text = raw.trim();
      const toolCalls = request.tools.length > 0 ? ToolCallCodec.decode(raw, 'nano') : [];
      return {
        'message': ChatResponseMessageBuilder.from(text, toolCalls),
        'finishReason': toolCalls.length > 0 ? 'tool_call' : 'stop',
        'usage': ZERO_TOKEN_USAGE,
      };
    } finally {
      session.destroy();
    }
  }

  protected override classify(error: unknown): ErrorClassificationType {
    const msg = error instanceof Error ? error.message : String(error);
    if (/availability|not present/iu.test(msg)) return Classifications['MODEL_NOT_FOUND'];
    return super.classify(error);
  }

  #collapseUserMessages(request: ChatRequestType): string {
    // Nano sessions take one prompt; concatenate user turns. ToolInterface
    // results round-tripped from the DAG land as `role: 'tool'`; we
    // surface them as `[tool <name> result] <content>` so the next turn knows.
    return request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') return BaseAdapter.formatToolResult(m);
        return m.content;
      })
      .join('\n\n');
  }

  #toolPlanSchema(tools: readonly ToolDefinitionType[]): Record<string, unknown> {
    // Per-tool variants: each enforces the tool's own inputSchema on
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

  #classifyNanoError(err: unknown): LlmError {
    const message = err instanceof Error ? err.message : String(err);
    if (/schema|constraint/iu.test(message)) {
      return new LlmError(message, Classifications['SCHEMA_VIOLATION'], { 'cause': err });
    }
    if (/quota/iu.test(message)) return new LlmError(message, Classifications['QUOTA_EXHAUSTED'], { 'cause': err });
    if (/aborted|timeout/iu.test(message)) return new LlmError(message, Classifications['TIMEOUT'], { 'cause': err });
    return new LlmError(message, Classifications['UNKNOWN'], { 'cause': err });
  }
}
