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
   * Read the value at `path` on `state`. Returns `null` when the
   * path traverses a missing or non-object segment.
   *
   * The generic parameter `T` narrows the return type at the call site.
   * The implementation performs a single cast at the return boundary;
   * internal traversal stays `unknown` until the final segment.
   */
  get<T = unknown>(state: object, path: string): T | null;

  /**
   * Write `value` at `path` on `state`. Implementations must create
   * intermediate objects as needed so `set(state, 'a.b.c', x)` succeeds
   * on an empty `state`.
   */
  set(state: object, path: string, value: unknown): void;
}
