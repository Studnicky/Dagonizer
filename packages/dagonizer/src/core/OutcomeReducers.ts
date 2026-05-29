/**
 * OutcomeReducers — pluggable registry that maps per-clone records to a
 * single routing output token for the scatter placement.
 *
 * A `OutcomeReducer` is a class with a `name` and a `reduce` method.
 * The dispatcher resolves a reducer by name (the `reducer` field on
 * `ScatterNode`, defaulting to `'aggregate'` when `source` is present
 * and `'terminal'` when absent) and calls `.reduce(records)` after all
 * clones have reported.
 *
 * Two defaults register at module load: `aggregate` and `terminal`.
 * Consumers extend `OutcomeReducer` and call
 * `OutcomeReducers.register(new MyReducer())` to add their own.
 *
 * @example
 * ```ts
 * class ThresholdReducer extends OutcomeReducer {
 *   readonly name = 'threshold-75';
 *   reduce(records: ReadonlyArray<OutcomeRecord>): string {
 *     const successRate = records.filter((r) => r.output === 'success').length / records.length;
 *     return successRate >= 0.75 ? 'all-success' : 'partial';
 *   }
 * }
 *
 * OutcomeReducers.register(new ThresholdReducer());
 * ```
 */

import { DAGError } from '../errors/DAGError.js';

/**
 * Per-clone summary passed to `OutcomeReducer.reduce`. Contains only
 * the information needed for routing — no clone state.
 */
export interface OutcomeRecord {
  readonly index: number;
  readonly output: string;
  readonly terminalOutcome: 'completed' | 'failed' | null;
}

/**
 * Extension point for outcome reducers.
 *
 * Subclass and override `reduce`. Return an output token that maps to a
 * key in the scatter placement's `outputs` map.
 */
export abstract class OutcomeReducer {
  /** Wire-shape identifier; matches `ScatterNode.reducer`. */
  abstract readonly name: string;

  /**
   * Reduce per-clone records to a single routing output token.
   */
  abstract reduce(records: ReadonlyArray<OutcomeRecord>): string;
}

/**
 * `aggregate` — multi-clone semantics. Counts records where
 * `output === 'success'` as successes. Returns:
 *   - `'empty'`       when there are no records
 *   - `'all-success'` when every record is a success
 *   - `'all-error'`   when no record is a success
 *   - `'partial'`     otherwise
 */
class AggregateOutcomeReducer extends OutcomeReducer {
  readonly name = 'aggregate';
  reduce(records: ReadonlyArray<OutcomeRecord>): string {
    if (records.length === 0) return 'empty';
    const successCount = records.filter((r) => r.output === 'success').length;
    if (successCount === records.length) return 'all-success';
    if (successCount === 0) return 'all-error';
    return 'partial';
  }
}

/**
 * `terminal` — singleton semantics (no `source`). Routes `'error'` when:
 *   - a DAG body's `terminalOutcome === 'failed'`
 *   - a node body's `output === 'error'`
 * Otherwise routes `'success'`. Unrecoverable-error poisoning is applied
 * by the dispatcher before `reduce` is called; a poisoned record arrives
 * with `output === 'error'`.
 */
class TerminalOutcomeReducer extends OutcomeReducer {
  readonly name = 'terminal';
  reduce(records: ReadonlyArray<OutcomeRecord>): string {
    if (records.length === 0) return 'error';
    const rec = records[0];
    if (rec === undefined) return 'error';
    if (rec.terminalOutcome === 'failed' || rec.output === 'error') return 'error';
    return 'success';
  }
}

/**
 * Static registry of `OutcomeReducer` instances. Defaults register at
 * module load. Consumers add more via `OutcomeReducers.register`.
 */
export class OutcomeReducers {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, OutcomeReducer>([
    ['aggregate', new AggregateOutcomeReducer()],
    ['terminal', new TerminalOutcomeReducer()],
  ]);

  /**
   * Register a reducer. Replaces any prior registration with the same
   * `name` — last-write-wins.
   */
  static register(reducer: OutcomeReducer): void {
    OutcomeReducers.registry.set(reducer.name, reducer);
  }

  /**
   * Resolve a reducer by name. Throws `DAGError` when no reducer is
   * registered under `name`.
   */
  static resolve(name: string): OutcomeReducer {
    const reducer = OutcomeReducers.registry.get(name);
    if (reducer === undefined) {
      throw new DAGError(`Unknown outcome reducer: ${name}`);
    }
    return reducer;
  }

  /** Names of every registered reducer, in registration order. */
  static list(): readonly string[] {
    return [...OutcomeReducers.registry.keys()];
  }
}
