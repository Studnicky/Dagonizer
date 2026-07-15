/**
 * LanguageModelHost: JSON Schema 2020-12 description of the browser's
 * built-in `window.LanguageModel` host object (Chrome 138+ / Edge Prompt
 * API), plus the entity-narrowing interfaces that supply the callable
 * signatures the schema cannot express.
 *
 * Host objects are a foreign boundary exactly like a JSON wire body: the
 * raw `globalThis.LanguageModel` is `unknown` until narrowed. The schemas
 * below assert only the *structural presence* of each host's members —
 * `LanguageModelStaticSchema` requires the `availability` and `create`
 * keys; `LanguageModelSessionSchema` requires `prompt` and `destroy`. The
 * `FromSchema`-derived base types are then refined by the tier-3 entity
 * interfaces below, which add the precise call signatures used at runtime.
 *
 * Two different runtime narrowings, because the two hosts have different
 * runtime shapes:
 *   • The static host (`globalThis.LanguageModel`) is a CALLABLE object —
 *     a constructor-like function carrying static `availability`/`create`
 *     methods (`typeof globalThis.LanguageModel === 'function'`). An Ajv
 *     `type: 'object'` validator REJECTS a function, so the static host is
 *     narrowed by the structural `LanguageModelHost.is` type-predicate
 *     (function-or-object carrying callable `availability`/`create`).
 *   • The session host (returned by `create()`) is a plain object, so the
 *     `languageModelSessionValidator` Ajv validator narrows it correctly.
 *
 * The session validator is compiled once at module load via the engine's
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
  '$id': 'https://noocodec.dev/schemas/dagonizer-adapter-gemini-nano/LanguageModelStatic',
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
  '$id': 'https://noocodec.dev/schemas/dagonizer-adapter-gemini-nano/LanguageModelSession',
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

/** Text language expectation descriptor accepted by Chrome's Prompt API. */
export type LanguageModelTextExpectationType = {
  readonly type: 'text';
  readonly languages: readonly string[];
};

/** Language expectations shared by availability, session creation, and prompt requests. */
export type LanguageModelLanguageOptionsType = {
  readonly expectedInputs?: readonly LanguageModelTextExpectationType[];
  readonly expectedOutputs?: readonly LanguageModelTextExpectationType[];
};

/**
 * Options accepted by `LanguageModelSession.prompt`. Built incrementally
 * by the adapter before each prompt, so `responseConstraint` is mutable.
 */
export type PromptOptionsType = LanguageModelLanguageOptionsType & {
  responseConstraint?: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * Entity-narrowing interface for a live LanguageModel session. Adds the
 * callable signatures the schema validates only structurally.
 */
export interface LanguageModelSessionInterface extends LanguageModelSessionBaseType {
  prompt(input: string, options?: PromptOptionsType): Promise<string>;
  /**
   * Streaming counterpart to `prompt`. The real W3C/WICG "Prompt API for Web"
   * spec defines `LanguageModelSession.promptStreaming` as returning
   * `ReadableStream<string>` — not a bare async iterable, not a Promise.
   * `ReadableStream` is an ambient global under this package's ES2024 lib +
   * `@types/node`, whose `stream/web` declaration carries
   * `[Symbol.asyncIterator]`, so `for await` over the return value type-checks
   * with no import and no cast.
   */
  promptStreaming(input: string, options?: PromptOptionsType): ReadableStream<string>;
  destroy(): void;
}

/**
 * Entity-narrowing interface for the static `window.LanguageModel` host.
 * Adds the callable signatures the schema validates only structurally.
 */
export interface LanguageModelStaticInterface extends LanguageModelStaticBaseType {
  availability(options?: LanguageModelLanguageOptionsType): Promise<GeminiNanoAvailabilityType>;
  create(options?: LanguageModelLanguageOptionsType & {
    initialPrompts?: ReadonlyArray<{ role: 'system' | 'user'; content: string }>;
    /**
     * Session abort signal. The base adapter composes caller cancellation and
     * per-request timeout into this one signal.
     */
    signal?: AbortSignal;
  }): Promise<LanguageModelSessionInterface>;
}

/**
 * Entity-narrowing type for the browser's `navigator` global, narrowed to
 * the single member this package reads: the BCP-47 UI-language tag used to
 * derive default Prompt API language expectations.
 */
export type NavigatorLanguageType = {
  readonly language: string;
};

/**
 * Structural type-guard for `globalThis.navigator`.
 *
 * `NavigatorLanguageHost.is(x)` narrows `unknown → NavigatorLanguageType`.
 * Node test environments carry no `navigator` global at all; browsers carry
 * one with a `language: string` member. The guard is cast-free — the same
 * `typeof`/`in` narrowing idiom as `LanguageModelHost.is` and the engine's
 * `BroadcastChannelGlobal.is` — so this package stays DOM-lib-independent.
 */
export class NavigatorLanguageHost {
  private constructor() { /* static class */ }

  /** Narrows `unknown → NavigatorLanguageType`. Never throws. */
  static is(x: unknown): x is NavigatorLanguageType {
    if (typeof x !== 'object' || x === null) return false;
    if (!('language' in x)) return false;
    return typeof x.language === 'string';
  }
}

/**
 * Structural type-guard for the static `window.LanguageModel` host.
 *
 * `LanguageModelHost.is(x)` narrows `unknown → LanguageModelStaticInterface`.
 * The browser exposes the host as a CALLABLE object — a constructor-like
 * function carrying static `availability`/`create` methods — so an Ajv
 * `type: 'object'` validator would reject it (`object` excludes functions).
 * The guard therefore accepts a function OR a non-null object that carries
 * callable `availability` and `create` members. The body is cast-free: it
 * narrows with `typeof` and the `in` operator at each step (the same pattern
 * as the engine's `BroadcastChannelGlobal.is`).
 */
export class LanguageModelHost {
  private constructor() { /* static class */ }

  /** Narrows `unknown → LanguageModelStaticInterface`. Never throws. */
  static is(x: unknown): x is LanguageModelStaticInterface {
    if (typeof x !== 'function' && typeof x !== 'object') return false;
    if (x === null) return false;
    if (!('availability' in x) || !('create' in x)) return false;
    return typeof x.availability === 'function' && typeof x.create === 'function';
  }
}

/**
 * Validator for a live `LanguageModel` session, compiled once at module
 * load through the engine's shared Ajv (`Validator.compile`). The adapter
 * narrows the created session through `.validate(value)` before prompting.
 */
export const languageModelSessionValidator: EntityValidatorInterface<LanguageModelSessionInterface> =
  Validator.compile<LanguageModelSessionInterface>(LanguageModelSessionSchema);
