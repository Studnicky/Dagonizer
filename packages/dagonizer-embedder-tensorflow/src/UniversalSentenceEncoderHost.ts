/**
 * UniversalSentenceEncoderHost: JSON Schema 2020-12 description of the
 * dynamically-imported `@tensorflow-models/universal-sentence-encoder` ESM
 * module and its loaded model, plus the entity-narrowing interfaces that
 * supply the callable signatures the schema cannot express.
 *
 * The dynamic `import()` of the USE bundle is a foreign boundary: the
 * resolved module is `unknown` until validated. JSON Schema has no
 * `function` type keyword, so `TfjsUseModuleSchema` asserts only that the
 * imported module exposes the `load` member, and `TfjsUseModelSchema`
 * asserts the `embed` member is present. The `FromSchema`-derived base
 * types are narrowed by the tier-3 entity interfaces below, which add the
 * precise call signatures used at runtime. The validators run once at the
 * import boundary in `UniversalSentenceEncoderEmbedder.connect`.
 *
 * Both validators are compiled once at module load via the engine's
 * shared `Validator.compile` (`@studnicky/dagonizer/validation`); the
 * package never instantiates its own Ajv.
 */

import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

/**
 * CDN ESM URL for the TensorFlow.js Universal Sentence Encoder bundle.
 * The esm.run CDN resolves the correct version and pulls tfjs transitively.
 */
export const TFJS_USE_ESM = 'https://esm.run/@tensorflow-models/universal-sentence-encoder';

export const TfjsUseModuleSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-embedder-tensorflow/TfjsUseModule',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['load'],
  'properties': {
    'load': true,
  },
  'additionalProperties': true,
} as const;

export const TfjsUseModelSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-embedder-tensorflow/TfjsUseModel',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['embed'],
  'properties': {
    'embed': true,
  },
  'additionalProperties': true,
} as const;

/** Base object type derived from the module schema (member presence only). */
export type TfjsUseModuleBaseType = FromSchema<typeof TfjsUseModuleSchema>;
/** Base object type derived from the model schema (member presence only). */
export type TfjsUseModelBaseType = FromSchema<typeof TfjsUseModelSchema>;

/**
 * Tensor2D result returned by the USE model's `embed` call.
 * Shape is `[N, 512]`. `array()` resolves to `number[][]`.
 */
export type TfjsUseTensor2DType = {
  array(): Promise<number[][]>;
  dispose(): void;
};

/**
 * Entity-narrowing interface for the loaded USE model. Adds the callable
 * `embed` signature the schema validates only structurally.
 */
export interface TfjsUseModelInterface extends TfjsUseModelBaseType {
  embed(inputs: string[]): Promise<TfjsUseTensor2DType>;
}

/**
 * Entity-narrowing interface for the imported USE module. Adds the
 * callable `load` signature the schema validates only structurally.
 */
export interface TfjsUseModuleInterface extends TfjsUseModuleBaseType {
  load(): Promise<TfjsUseModelInterface>;
}

/**
 * Validator for the dynamically-imported USE module, compiled once at
 * module load through the engine's shared Ajv (`Validator.compile`).
 * `connect` narrows the resolved module through `.validate(value)` at
 * the import boundary.
 */
export const tfjsUseModuleValidator: EntityValidatorInterface<TfjsUseModuleInterface> =
  Validator.compile<TfjsUseModuleInterface>(TfjsUseModuleSchema);

/**
 * Validator for the loaded USE model, compiled once at module load
 * through the engine's shared Ajv (`Validator.compile`). `connect`
 * narrows the model through `.validate(value)` before first embed call.
 */
export const tfjsUseModelValidator: EntityValidatorInterface<TfjsUseModelInterface> =
  Validator.compile<TfjsUseModelInterface>(TfjsUseModelSchema);
