/**
 * LanguageModelHost: JSON Schema 2020-12 description of the browser's
 * built-in `window.LanguageModel` host object (Chrome 138+ / Edge Prompt
 * API), plus the entity-narrowing interfaces that supply the callable
 * signatures the schema cannot express.
 *
 * Host objects are a foreign boundary exactly like a JSON wire body: the
 * raw `globalThis.LanguageModel` is `unknown` until validated. JSON Schema
 * cannot type a method (there is no `function` type keyword), so each
 * schema asserts only the *structural presence* of the host's members —
 * `LanguageModelStaticSchema` requires the `availability` and `create`
 * keys; `LanguageModelSessionSchema` requires `prompt` and `destroy`.
 * The `FromSchema`-derived base types are then narrowed by the tier-3
 * entity interfaces below, which add the precise call signatures used at
 * runtime. The validator on `languageModelStaticValidator` runs once when
 * the adapter first acquires the host object.
 *
 * Both validators are compiled once at module load via the engine's
 * shared `Validator.compile` (`@studnicky/dagonizer/validation`); the
 * package never instantiates its own Ajv.
 */

import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
import { Validator } from '@studnicky/dagonizer/validation';
import type { FromSchema } from 'json-schema-to-ts';

export type GeminiNanoAvailabilityType =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export const LanguageModelStaticSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-adapter-gemini-nano/LanguageModelStatic',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['availability', 'create'],
  'properties': {
    'availability': true,
    'create': true,
  },
  'additionalProperties': true,
} as const;

export const LanguageModelSessionSchema = {
  '$id': 'https://noocodex.dev/schemas/dagonizer-adapter-gemini-nano/LanguageModelSession',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['prompt', 'destroy'],
  'properties': {
    'prompt': true,
    'destroy': true,
  },
  'additionalProperties': true,
} as const;

/** Base object type derived from the host schema (member presence only). */
export type LanguageModelStaticBaseType = FromSchema<typeof LanguageModelStaticSchema>;
/** Base object type derived from the session schema (member presence only). */
export type LanguageModelSessionBaseType = FromSchema<typeof LanguageModelSessionSchema>;

/**
 * Options accepted by `LanguageModelSession.prompt`. Built incrementally
 * by the adapter before each prompt, so `responseConstraint` is mutable.
 */
export type PromptOptionsType = {
  responseConstraint?: Record<string, unknown>;
};

/**
 * Entity-narrowing interface for a live LanguageModel session. Adds the
 * callable signatures the schema validates only structurally.
 */
export interface LanguageModelSessionInterface extends LanguageModelSessionBaseType {
  prompt(input: string, options?: PromptOptionsType): Promise<string>;
  destroy(): void;
}

/**
 * Entity-narrowing interface for the static `window.LanguageModel` host.
 * Adds the callable signatures the schema validates only structurally.
 */
export interface LanguageModelStaticInterface extends LanguageModelStaticBaseType {
  availability(): Promise<GeminiNanoAvailabilityType>;
  create(options?: {
    initialPrompts?: ReadonlyArray<{ role: 'system' | 'user'; content: string }>;
  }): Promise<LanguageModelSessionInterface>;
}

/**
 * Validator for the static `window.LanguageModel` host, compiled once at
 * module load through the engine's shared Ajv (`Validator.compile`). The
 * adapter narrows `globalThis.LanguageModel` through `.is(value)` at the
 * host boundary.
 */
export const languageModelStaticValidator: EntityValidatorInterface<LanguageModelStaticInterface> =
  Validator.compile<LanguageModelStaticInterface>(LanguageModelStaticSchema);

/**
 * Validator for a live `LanguageModel` session, compiled once at module
 * load through the engine's shared Ajv (`Validator.compile`). The adapter
 * narrows the created session through `.validate(value)` before prompting.
 */
export const languageModelSessionValidator: EntityValidatorInterface<LanguageModelSessionInterface> =
  Validator.compile<LanguageModelSessionInterface>(LanguageModelSessionSchema);
