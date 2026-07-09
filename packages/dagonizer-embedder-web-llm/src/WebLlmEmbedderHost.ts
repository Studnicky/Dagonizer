/**
 * WebLlmEmbedderHost: JSON Schema 2020-12 descriptions of the dynamically-
 * imported bundled npm `@mlc-ai/web-llm` module and the embedding engine it
 * creates, plus the entity-narrowing interfaces that supply the callable
 * signatures the schema cannot express.
 *
 * The dynamic `import()` of the WebLLM module is a foreign boundary: the
 * resolved module is `unknown` until validated. JSON Schema has no
 * `function` type keyword, so `WebLlmEmbedderModuleSchema` asserts only that
 * the imported module exposes `CreateMLCEngine`, and
 * `WebLlmEmbedderEngineSchema` asserts the `embeddings` member is present.
 * The `FromSchema`-derived base types are narrowed by the tier-3 entity
 * interfaces below, which add the precise call signatures used at runtime.
 *
 * Both validators are compiled once at module load via the engine's shared
 * `Validator.compile` (`@studnicky/dagonizer/validation`); this package
 * never instantiates its own Ajv.
 *
 * NOTE: This file is distinct from `WebLlmHost.ts` in `dagonizer-adapter-web-llm`.
 * That file validates the chat engine; this one validates the embedding engine,
 * which exposes `embeddings` rather than `chat`.
 */

import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const WebLlmEmbedderEngineSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer-embedder-web-llm/WebLlmEmbedderEngine',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['embeddings'],
  'properties': {
    'embeddings': { 'type': 'object', 'additionalProperties': true },
  },
  'additionalProperties': true,
} as const;

export const WebLlmEmbedderModuleSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer-embedder-web-llm/WebLlmEmbedderModule',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['CreateMLCEngine'],
  'properties': {
    'CreateMLCEngine': true,
  },
  'additionalProperties': true,
} as const;

/** Base object type derived from the engine schema (member presence only). */
export type WebLlmEmbedderEngineBaseType = FromSchema<typeof WebLlmEmbedderEngineSchema>;
/** Base object type derived from the module schema (member presence only). */
export type WebLlmEmbedderModuleBaseType = FromSchema<typeof WebLlmEmbedderModuleSchema>;

/** Embeddings request sent to the WebLLM engine. */
export type WebLlmEmbedRequestType = {
  readonly input: readonly string[];
};

/** Single embedding data item returned by the WebLLM engine. */
export type WebLlmEmbedDataItemType = {
  readonly embedding: readonly number[];
};

/** Embeddings response returned by the WebLLM engine. */
export type WebLlmEmbedResponseType = {
  readonly data: readonly WebLlmEmbedDataItemType[];
};

/**
 * Entity-narrowing type for the live WebLLM embedding engine. Adds the
 * callable signatures the schema validates only structurally.
 */
export type WebLlmEmbedderEngineType = WebLlmEmbedderEngineBaseType & {
  embeddings: {
    create(params: WebLlmEmbedRequestType): Promise<WebLlmEmbedResponseType>;
  };
};

/**
 * Entity-narrowing interface for the imported WebLLM module. Adds the
 * callable signature the schema validates only structurally.
 */
export interface WebLlmEmbedderModuleInterface extends WebLlmEmbedderModuleBaseType {
  CreateMLCEngine(model: string): Promise<WebLlmEmbedderEngineType>;
}

/**
 * Validator for the dynamically-imported `@mlc-ai/web-llm` module,
 * compiled once at module load through the engine's shared Ajv
 * (`Validator.compile`). `connect()` narrows the resolved module through
 * `.validate(value)` at the import boundary.
 */
export const webLlmEmbedderModuleValidator: EntityValidatorInterface<WebLlmEmbedderModuleInterface> =
  Validator.compile<WebLlmEmbedderModuleInterface>(WebLlmEmbedderModuleSchema);

/**
 * Validator for the created WebLLM embedding engine, compiled once at
 * module load through the engine's shared Ajv (`Validator.compile`).
 * `connect()` narrows the engine through `.validate(value)` before first
 * embedding call.
 */
export const webLlmEmbedderEngineValidator: EntityValidatorInterface<WebLlmEmbedderEngineType> =
  Validator.compile<WebLlmEmbedderEngineType>(WebLlmEmbedderEngineSchema);
