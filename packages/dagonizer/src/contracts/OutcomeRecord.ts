/**
 * OutcomeRecord: adapter contract between the dispatcher and
 * OutcomeReducer implementations.
 *
 * Per-clone summary passed to `OutcomeReducer.reduce`. Contains only
 * the information needed for routing; no clone state.
 */
export interface OutcomeRecord {
  index: number;
  output: string;
  terminalOutcome: 'completed' | 'failed' | null;
}
