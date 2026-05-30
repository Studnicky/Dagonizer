/**
 * StateAccessor: adapter contract for resolving paths into node state.
 *
 * The dispatcher walks dotted paths (`'plan.tasks'`, `'data.items'`)
 * to read scatter source arrays and write gather results. The resolution
 * strategy is pluggable: install a custom `StateAccessor` to swap in
 * JSONPath, JSON Pointer, or any other path language.
 *
 * Implementations are stateless and safe to share across executions.
 * The default implementation (`DottedPathAccessor` in `runtime/`) walks
 * `path.split('.')` and creates intermediate objects on `set` when they
 * don't exist.
 */
export interface StateAccessor {
  /**
   * Read the value at `path` on `state`. Returns `undefined` when the
   * path traverses a missing or non-object segment.
   */
  get(state: object, path: string): unknown;

  /**
   * Write `value` at `path` on `state`. Implementations must create
   * intermediate objects as needed so `set(state, 'a.b.c', x)` succeeds
   * on an empty `state`.
   */
  set(state: object, path: string, value: unknown): void;
}
