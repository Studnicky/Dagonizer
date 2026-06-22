/**
 * StateAccessorInterface: adapter contract for resolving paths into node state.
 *
 * The dispatcher walks dotted paths (`'plan.tasks'`, `'data.items'`)
 * to read scatter source arrays and write gather results. The resolution
 * strategy is pluggable: install a custom `StateAccessorInterface` to swap in
 * JSONPath, JSON Pointer, or any other path language.
 *
 * Implementations are stateless and safe to share across executions.
 * The default implementation (`DottedPathAccessor` in `runtime/`) walks
 * `path.split('.')` and creates intermediate objects on `set` when they
 * don't exist.
 */
export interface StateAccessorInterface {
  /**
   * Read the value at `path` on `state`. Returns `null` when the path
   * traverses a missing or non-object segment, otherwise the resolved value
   * as `unknown`. Callers narrow the result to the shape they expect
   * (`Array.isArray(value)`, a `typeof` check, or a `Validator`) rather than
   * trusting a call-site type argument — the read surface stays honest.
   */
  get(state: object, path: string): unknown;

  /**
   * Write `value` at `path` on `state`. Implementations must create
   * intermediate objects as needed so `set(state, 'a.b.c', x)` succeeds
   * on an empty `state`.
   */
  set(state: object, path: string, value: unknown): void;
}
