/**
 * ItemType: a single element in a `Batch`.
 *
 * Each item carries an opaque `ItemIdType` string that survives `map`, `filter`,
 * `partition`, and `concat` operations so routing decisions remain traceable
 * back to the original item. The `state` field is the domain state the node
 * reads from and writes to; it is not copied — the same reference flows
 * through all batch operations.
 */

/** Opaque string that uniquely identifies a single item within a `Batch`. Survives all batch transformations. */
export type ItemIdType = string;

export type ItemType<TState> = {
  /** Stable item identifier; used to trace routing decisions back to the original item. */
  readonly id: ItemIdType;
  /** Domain state the node reads from and writes to; the same reference flows through all batch operations. */
  readonly state: TState;
}
