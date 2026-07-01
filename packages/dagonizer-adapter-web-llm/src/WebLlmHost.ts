/**
 * WebLlmHost: JSON Schema 2020-12 description of the dynamically-imported
 * `@mlc-ai/web-llm` ESM module and its engine, plus the entity-narrowing
 * interfaces that supply the callable signatures the schema cannot express.
 *
 * The dynamic `import()` of the WebLLM bundle is a foreign boundary: the
 * resolved module is `unknown` until validated. JSON Schema has no
 * `function` type keyword, so `WebLlmModuleSchema` asserts only that the
 * imported module exposes the `CreateMLCEngine` member, and
 * `WebLlmEngineSchema` asserts the `chat` member is present. The
 * `FromSchema`-derived base types are narrowed by the tier-3 entity
 * interfaces below, which add the precise call signatures used at runtime.
 * The validator on `webLlmModuleValidator` runs once at the import
 * boundary in `#boot`.
 *
 * Both validators are compiled once at module load via the engine's
 * shared `Validator.compile` (`@studnicky/dagonizer/validation`); the
 * package never instantiates its own Ajv.
 */

import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export type WebLlmInitReportType = {
  readonly progress: number;
  readonly text: string;
};

export const WebLlmEngineSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-adapter-web-llm/WebLlmEngine',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['chat'],
  'properties': {
    'chat': { 'type': 'object', 'additionalProperties': true },
  },
  'additionalProperties': true,
} as const;

export const WebLlmModuleSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-adapter-web-llm/WebLlmModule',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['CreateMLCEngine'],
  'properties': {
    'CreateMLCEngine': true,
  },
  'additionalProperties': true,
} as const;

/** Base object type derived from the engine schema (member presence only). */
export type WebLlmEngineBaseType = FromSchema<typeof WebLlmEngineSchema>;
/** Base object type derived from the module schema (member presence only). */
export type WebLlmModuleBaseType = FromSchema<typeof WebLlmModuleSchema>;

/** Chat-completion request the adapter sends to the WebLLM engine (non-streaming). */
export type WebLlmCompletionParamsType = {
  readonly messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly response_format?: { type: 'json_object' | 'text' };
  /**
   * Requests a final chunk carrying token-usage totals, mirroring the OpenAI
   * streaming convention. WebLLM's engine attaches `usage` to the last
   * streamed chunk when this is set; the adapter's streaming path reads it
   * to populate `ChatResponseType.usage` instead of hardcoding
   * `ZERO_TOKEN_USAGE`.
   */
  readonly stream_options?: { readonly include_usage: true };
};

/** Streaming variant of the chat-completion request. */
export type WebLlmStreamingParamsType = WebLlmCompletionParamsType & {
  readonly stream: true;
};

/**
 * One chunk emitted by the streaming completion. The final chunk of a
 * request sent with `stream_options: { include_usage: true }` carries
 * `usage` alongside an empty (or absent) delta.
 */
export type WebLlmStreamChunkType = {
  readonly choices: ReadonlyArray<{ delta: { content?: string } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
};

/** Chat-completion result returned by the WebLLM engine (non-streaming). */
export type WebLlmCompletionResultType = {
  readonly choices: ReadonlyArray<{ message: { content: string } }>;
};

/**
 * Entity-narrowing type for the live WebLLM engine. Adds the callable
 * signatures the schema validates only structurally.
 *
 * `create` accepts `WebLlmStreamingParamsType` (stream: true) and returns
 * a `Promise` that resolves to an `AsyncIterable` of chunk objects.
 * The adapter uses the streaming path exclusively; `interruptGenerate()`
 * halts in-flight generation and is called from the deadline timer and the
 * external abort-signal handler.
 */
export type WebLlmEngineType = WebLlmEngineBaseType & {
  readonly interruptGenerate: () => void;
  chat: {
    completions: {
      create(params: WebLlmStreamingParamsType): Promise<AsyncIterable<WebLlmStreamChunkType>>;
    };
  };
};

/**
 * Entity-narrowing interface for the imported WebLLM module. Adds the
 * callable signature the schema validates only structurally.
 */
export interface WebLlmModuleInterface extends WebLlmModuleBaseType {
  CreateMLCEngine(
    model: string,
    options?: { initProgressCallback?: (report: WebLlmInitReportType) => void },
  ): Promise<WebLlmEngineType>;
}

/**
 * Validator for the dynamically-imported `@mlc-ai/web-llm` module,
 * compiled once at module load through the engine's shared Ajv
 * (`Validator.compile`). `#boot` narrows the resolved module through
 * `.validate(value)` at the import boundary.
 */
export const webLlmModuleValidator: EntityValidatorInterface<WebLlmModuleInterface> =
  Validator.compile<WebLlmModuleInterface>(WebLlmModuleSchema);

/**
 * Validator for the created WebLLM engine, compiled once at module load
 * through the engine's shared Ajv (`Validator.compile`). `#boot` narrows
 * the engine through `.validate(value)` before first chat completion.
 */
export const webLlmEngineValidator: EntityValidatorInterface<WebLlmEngineType> =
  Validator.compile<WebLlmEngineType>(WebLlmEngineSchema);
