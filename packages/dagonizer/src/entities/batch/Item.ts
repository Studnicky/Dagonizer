/**
 * ItemType: a single element in a `Batch`.
 *
 * Each item carries an opaque `ItemIdType` string that survives `map`, `filter`,
 * `partition`, and `concat` operations so routing decisions remain traceable
 * back to the original item. The `state` field is the domain state the node
 * reads from and writes to; it is not copied — the same reference flows
 * through all batch operations.
 */

export type ItemIdType = string;

export type ItemType<TState> = {
  readonly id: ItemIdType;
  readonly state: TState;
}
