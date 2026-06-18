/**
 * Timeout: a reified per-operation time budget — either a positive
 * millisecond duration or the explicit "no limit" case. The single
 * canonical representation of "no timeout" is `Timeout.none()`.
 *
 * This class is intentionally dependency-free so that `contracts/` can
 * type-import it without creating a cycle.
 *
 * The `ms` field is `readonly` and the constructor is `private`, so no
 * external code can mutate or construct instances — the static factories
 * (`none()`, `ofMs()`, `fromWire()`) are the only creation points. Using
 * a public readonly field (rather than a private field + getter) ensures
 * structural compatibility when this class appears in interfaces that
 * span multiple TypeScript compilation roots (e.g. `dist/` vs `src/`
 * in test builds).
 */
export class Timeout {
  static readonly #NONE = new Timeout(null);

  /** The millisecond budget, or null when there is no limit. */
  readonly ms: number | null;

  private constructor(ms: number | null) {
    this.ms = ms;
  }

  /** No time limit. */
  static none(): Timeout {
    return Timeout.#NONE;
  }

  /** A positive millisecond budget; `ms <= 0` collapses to `none()`. */
  static ofMs(ms: number): Timeout {
    return ms > 0 ? new Timeout(ms) : Timeout.#NONE;
  }

  /**
   * Narrow a wire value (`number | null`; null or ≤0 = none) to a Timeout.
   */
  static fromWire(value: number | null): Timeout {
    return value === null ? Timeout.none() : Timeout.ofMs(value);
  }

  /** True when there is no time limit. */
  get isNone(): boolean {
    return this.ms === null;
  }

  /** Serialise to the wire representation (`number | null`). */
  toWire(): number | null {
    return this.ms;
  }
}
