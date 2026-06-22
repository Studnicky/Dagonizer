import type { MetadataReadableInterface } from './contracts/MetadataReadableInterface.js';

/**
 * MetadataGetter: strict-typed reads over a state's metadata record.
 *
 * The metadata store holds arbitrary JSON-serialisable values, so
 * `getMetadata(key)` returns `unknown`. This getter narrows each read to a
 * concrete type with a required default, so call sites read
 * `state.getter.string('url')` — typed, cast-free, and never `undefined`.
 * The narrowing lives here once instead of at every call site.
 *
 * Every state exposes one of these as `state.getter`, constructed in
 * `NodeStateBase` against the state itself. The getter reads through
 * `getMetadata` (not the backing record) so it survives the record being
 * replaced on `clone()` / `applySnapshot()`.
 */
export class MetadataGetter {
  readonly #source: MetadataReadableInterface;

  constructor(source: MetadataReadableInterface) {
    this.#source = source;
  }

  /** Read `key` as a string; `fallback` (default `''`) when absent or non-string. */
  string(key: string, fallback: string = ''): string {
    const value = this.#source.getMetadata(key);
    return typeof value === 'string' ? value : fallback;
  }

  /** Read `key` as a number; `fallback` (default `0`) when absent or non-number. */
  number(key: string, fallback: number = 0): number {
    const value = this.#source.getMetadata(key);
    return typeof value === 'number' ? value : fallback;
  }

  /** Read `key` as a boolean; `fallback` (default `false`) when absent or non-boolean. */
  boolean(key: string, fallback: boolean = false): boolean {
    const value = this.#source.getMetadata(key);
    return typeof value === 'boolean' ? value : fallback;
  }

  /**
   * Read `key` as a string array; `fallback` (default `[]`) when absent, not an
   * array, or holding any non-string element. Returns a fresh copy so callers
   * cannot mutate the backing metadata through the result.
   */
  stringArray(key: string, fallback: readonly string[] = []): string[] {
    const value = this.#source.getMetadata(key);
    if (!Array.isArray(value)) return [...fallback];
    return value.every((item): item is string => typeof item === 'string') ? [...value] : [...fallback];
  }

  /**
   * Read `key` as a number array; `fallback` (default `[]`) when absent, not an
   * array, or holding any non-number element. Returns a fresh copy.
   */
  numberArray(key: string, fallback: readonly number[] = []): number[] {
    const value = this.#source.getMetadata(key);
    if (!Array.isArray(value)) return [...fallback];
    return value.every((item): item is number => typeof item === 'number') ? [...value] : [...fallback];
  }
}
