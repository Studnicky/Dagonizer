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
import { BaseAdapter, ChatResponseMessageBuilder, Classifications, DEFAULT_MAX_ATTEMPTS, LlmError, ModelCost, ToolCallCodec, ZERO_TOKEN_USAGE } from '@studnicky/dagonizer/adapter';
import type { LlmModelType } from '@studnicky/dagonizer/entities';

import type {
  GeminiNanoAvailabilityType,
  LanguageModelStaticInterface,
  PromptOptionsType,
} from './LanguageModelHost.js';
import {
  LanguageModelHost,
  languageModelSessionValidator,
} from './LanguageModelHost.js';

/** Stable model identifier for the browser's built-in on-device model. */
const GEMINI_NANO_MODEL_ID = 'gemini-nano';

export type GeminiNanoAdapterOptionsType = {
  readonly maxAttempts?: number;
  /**
   * Default system prompt the base injects as the leading turn of any request
   * that carries no system message of its own. Consumer-supplied persona/format
   * framing; empty (the default) means no injection.
   */
  readonly systemPrompt?: string;
  /**
   * Per-request timeout in milliseconds. Defaults to 60 000 ms when omitted.
   * Raise it for slow on-device models so the base deadline does not pre-empt
   * a longer generation.
   */
  readonly timeoutMs?: number;
};

export class GeminiNanoAdapter extends BaseAdapter {
  /**
   * Read `globalThis.LanguageModel` as `unknown` and narrow it through the
   * structural `LanguageModelHost.is` guard at the host boundary. Returns the
   * narrowed host object, or `undefined` when the global is absent or fails
   * the structural check. The host is a callable object (`typeof === 'function'`),
   * so a JSON-Schema `type: 'object'` validator can't narrow it — see
   * `LanguageModelHost`. This is the single foreign-boundary narrowing for the
   * Nano host object — every other method receives the already-narrowed
   * `LanguageModelStaticInterface`.
   */
  private static languageModel(): LanguageModelStaticInterface | undefined {
    if (typeof globalThis === 'undefined') return undefined;
    const candidate: unknown = Reflect.get(globalThis, 'LanguageModel');
    if (!LanguageModelHost.is(candidate)) return undefined;
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
      {
        'maxAttempts': options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        'systemPrompt': options.systemPrompt ?? '',
        ...(options.timeoutMs !== undefined ? { 'timeoutMs': options.timeoutMs } : {}),
      },
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
    return Promise.resolve([{ 'name': GEMINI_NANO_MODEL_ID, 'variant': 'chat', 'cloud': false, 'costRank': ModelCost.rankFromName(GEMINI_NANO_MODEL_ID) }]);
  }

  protected async performChat(request: ChatRequestType): Promise<ChatResponseType> {
    const lm = GeminiNanoAdapter.languageModel();
    if (lm === undefined) {
      throw new LlmError('window.LanguageModel is not present', Classifications['MODEL_NOT_FOUND']);
    }

    const systemPrompt = this.#collapseSystemMessages(request);
    const userPrompt = this.#collapseUserMessages(request);

    // The Prompt API rejects a `{ role: 'system' }` entry placed anywhere but
    // index 0 of `initialPrompts` — and a second system entry necessarily lands
    // at a non-zero index — with a `TypeError`. Collapse every system turn into
    // one leading system prompt so the constraint holds for any consumer message
    // shape; user turns go to `prompt()` below. No system turn → no
    // `initialPrompts` (a user-only session is valid).
    // `request.signal` carries the base's composed deadline+caller signal, so
    // forwarding it to both `lm.create()` and `session.prompt()` is sufficient
    // for abort and timeout enforcement.
    const createOptions = systemPrompt === ''
      ? { 'signal': request.signal }
      : { 'initialPrompts': [{ 'role': 'system' as const, 'content': systemPrompt }], 'signal': request.signal };

    let rawSession: unknown;
    try {
      rawSession = await lm.create(createOptions);
    } catch (err) {
      throw this.#classifyNanoError(err);
    }
    const session = languageModelSessionValidator.validate(rawSession);
    try {
      const options: PromptOptionsType = { 'signal': request.signal };
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

  #collapseSystemMessages(request: ChatRequestType): string {
    // Nano permits exactly one system prompt, and only at index 0 of
    // `initialPrompts`. Join every system turn into one block so multiple or
    // out-of-order system messages can never form a sequence the Prompt API
    // rejects with a `TypeError`.
    return request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
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
    // Preserve an already-classified LlmError (e.g. a TIMEOUT from the base
    // deadline signal) so its classification survives unwrapped.
    if (err instanceof LlmError) return err;
    const message = err instanceof Error ? err.message : String(err);
    if (/schema|constraint/iu.test(message)) {
      return new LlmError(message, Classifications['SCHEMA_VIOLATION'], { 'cause': err });
    }
    if (/quota/iu.test(message)) return new LlmError(message, Classifications['QUOTA_EXHAUSTED'], { 'cause': err });
    if (/aborted|timeout/iu.test(message)) return new LlmError(message, Classifications['TIMEOUT'], { 'cause': err });
    return new LlmError(message, Classifications['UNKNOWN'], { 'cause': err });
  }
}
