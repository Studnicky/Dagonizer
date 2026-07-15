/**
 * CheckpointRestoreAdapterInterface: typed contract for constructing the graph
 * state class used by a checkpoint restore.
 *
 * Consumers implement this interface (typically as a static class) to
 * construct a `TState` instance that receives a checkpoint's graph-state JSON-LD
 * document through the graph port. Use `CheckpointRestoreAdapter.wrap` from
 * `checkpoint/Checkpoint.ts` to wrap a plain factory in this contract.
 */

export interface CheckpointRestoreAdapterInterface<TState> {
  /** Construct a state instance that will receive the checkpoint graph. */
  restore(): TState;
}
