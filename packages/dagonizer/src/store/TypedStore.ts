/**
 * TypedStore: schema-validated view over any `StoreInterface`.
 *
 * Wraps a base `StoreInterface` (which is type-erased — `get` returns
 * `JsonValueType`) and exposes get/set/has/delete/update keyed by `Schema`
 * keys. The value type is `Schema[K]`; callers never specify `<T>` at the
 * call site.
 *
 * Typed reads are CONFIGURED runtime validation — the same opt-in shape as the
 * dispatcher's `validateOutputs`. The constructor takes a per-key validator
 * record; `get`/`update` call `validator.validate(raw)` on each read, and the
 * validator IS the type-guard (an Ajv `ValidateFunction<Schema[K]>`), so the
 * typed value is produced without a cast. A stored value that does not match
 * its key's schema throws a `DAGError` (code `VALIDATION_ERROR`) on read. For raw, unvalidated
 * access, use the underlying `StoreInterface` (`typedStore.inner`).
 *
 * `Schema` is constrained so every value type must extend `JsonValueType`.
 * Plain interfaces with named keys satisfy this constraint without needing
 * an explicit index signature; only the declared values are checked.
 *
 * @example
 * interface AppSchema {
 *   users: User[];
 *   count: number;
 * }
 * const inner = new MemoryStore();
 * const typed = new TypedStore<AppSchema>(inner, {
 *   users: Validator.compile(UsersSchema),
 *   count: Validator.compile(CountSchema),
 * });
 * await typed.set('count', 42);            // ok
 * const n = await typed.get('count');      // n: number | null (validated)
 * await typed.set('count', 'wrong');       // TS error
 */

import type { StoreInterface } from '../contracts/StoreInterface.js';
import type { JsonValueType } from '../entities/json.js';
import type { EntityValidatorInterface } from '../validation/Validator.js';

/** Per-key validator record: one `EntityValidatorInterface` per `Schema` key. */
export type TypedStoreValidatorsType<Schema> = {
  readonly [K in keyof Schema]: EntityValidatorInterface<Schema[K]>;
};

export class TypedStore<Schema extends { [K in keyof Schema]: JsonValueType }> {
  readonly #inner: StoreInterface;
  readonly #validators: TypedStoreValidatorsType<Schema>;

  constructor(inner: StoreInterface, validators: TypedStoreValidatorsType<Schema>) {
    this.#inner = inner;
    this.#validators = validators;
  }

  async get<K extends keyof Schema & string>(key: K): Promise<Schema[K] | null> {
    const raw = await this.#inner.get(key);
    if (raw === null) return null;
    return this.#validators[key].validate(raw);
  }

  async set<K extends keyof Schema & string>(key: K, value: Schema[K]): Promise<void> {
    await this.#inner.set(key, value);
  }

  async has<K extends keyof Schema & string>(key: K): Promise<boolean> {
    return this.#inner.has(key);
  }

  async delete<K extends keyof Schema & string>(key: K): Promise<boolean> {
    return this.#inner.delete(key);
  }

  async update<K extends keyof Schema & string>(
    key: K,
    fn: (current: Schema[K] | undefined) => Schema[K],
  ): Promise<Schema[K]> {
    const validator = this.#validators[key];
    const result = await this.#inner.update(key, (raw) =>
      fn(raw === undefined ? undefined : validator.validate(raw)),
    );
    return validator.validate(result);
  }

  /**
   * Access the underlying `StoreInterface` for lifecycle operations (`connect`,
   * `disconnect`, `snapshot`, `restore`) and any other heterogeneous
   * calls that TypedStore does not narrow. The underlying instance is the
   * same object passed to the constructor.
   *
   * @example
   * await typedStore.inner.connect();
   * const snap = await typedStore.inner.snapshot();
   */
  get inner(): StoreInterface { return this.#inner; }
}
