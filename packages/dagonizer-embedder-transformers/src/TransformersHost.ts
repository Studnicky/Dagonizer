/**
 * TransformersHost: JSON Schema 2020-12 description of the dynamically-imported
 * bundled npm `@huggingface/transformers` module and its feature-extraction
 * pipeline, plus the entity-narrowing interfaces that supply the callable
 * signatures the schema cannot express.
 *
 * The dynamic `import()` of the transformers.js bundle is a foreign boundary:
 * the resolved module is `unknown` until validated. JSON Schema has no `function`
 * type keyword, so `TransformersModuleSchema` asserts only that the imported
 * module exposes the `pipeline` member. The `FromSchema`-derived base type is
 * narrowed by the tier-3 entity interface below, which adds the precise call
 * signature used at runtime. The validator runs once at the import boundary
 * in `loadModule()`.
 *
 * Both validators are compiled once at module load via the engine's shared
 * `Validator.compile` (`@studnicky/dagonizer/validation`); the package never
 * instantiates its own Ajv.
 */

import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export const TransformersModuleSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-embedder-transformers/TransformersModule',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['pipeline'],
  'properties': {
    'pipeline': true,
  },
  'additionalProperties': true,
} as const;

/** Base object type derived from the module schema (member presence only). */
export type TransformersModuleBaseType = FromSchema<typeof TransformersModuleSchema>;

/**
 * Result type returned by the feature-extraction pipeline call.
 * The `data` property is a Float32Array holding the pooled, normalised vector.
 */
export type TransformersPipelineOutputType = {
  readonly data: Float32Array;
};

/**
 * Live feature-extraction pipeline instance returned by `mod.pipeline(...)`.
 * The `pipeline` factory is called once per model load; subsequent embed calls
 * reuse this extractor.
 */
export interface TransformersExtractorInterface {
  (
    text: string,
    options: { pooling: 'mean'; normalize: true },
  ): Promise<TransformersPipelineOutputType>;
}

/**
 * Entity-narrowing interface for the imported transformers.js module. Adds the
 * callable signature the schema validates only structurally.
 */
export interface TransformersModuleInterface extends TransformersModuleBaseType {
  pipeline(
    task: 'feature-extraction',
    model: string,
  ): Promise<TransformersExtractorInterface>;
}

/**
 * Validator for the dynamically-imported `@huggingface/transformers` module,
 * compiled once at module load through the engine's shared Ajv
 * (`Validator.compile`). `connect()` narrows the resolved module through
 * `.validate(value)` at the import boundary.
 */
export const transformersModuleValidator: EntityValidatorInterface<TransformersModuleInterface> =
  Validator.compile<TransformersModuleInterface>(TransformersModuleSchema);
