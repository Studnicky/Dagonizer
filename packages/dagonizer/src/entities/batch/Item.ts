/**
 * Item: a single element in a `Batch`.
 *
 * Each item carries an opaque `ItemId` string that survives `map`, `filter`,
 * `partition`, and `concat` operations so routing decisions remain traceable
 * back to the original item. The `state` field is the domain state the node
 * reads from and writes to; it is not copied — the same reference flows
 * through all batch operations.
 */

export type ItemId = string;

export interface Item<TState> {
  readonly id: ItemId;
  readonly state: TState;
}
