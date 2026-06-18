/**
 * OutcomeRecord: adapter contract between the dispatcher and
 * OutcomeReducer implementations.
 *
 * Per-clone summary passed to `OutcomeReducer.reduce`. Contains only
 * the information needed for routing; no clone state.
 */
export interface OutcomeRecord {
  /** 0-based position of this clone in the scatter source array. */
  index: number;
  /** Routing output the scatter body emitted for this clone. */
  output: string;
  /**
   * Terminal outcome of the DAG body for this clone, or `null` when the body
   * was a node body (not a DAG). Reducers use this to distinguish DAG-level
   * completion from node-level success/error routing.
   */
  terminalOutcome: 'completed' | 'failed' | null;
}
