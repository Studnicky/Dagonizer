/**
 * OutcomeReducers: pluggable registry that maps per-clone records to a
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
 *   reduce(records: ReadonlyArray<OutcomeRecordType>): string {
 *     const successRate = records.filter((r) => r.output === 'success').length / records.length;
 *     return successRate >= 0.75 ? 'all-success' : 'partial';
 *   }
 * }
 *
 * OutcomeReducers.register(new ThresholdReducer());
 * ```
 */

import type { OutcomeRecordType } from '../contracts/OutcomeRecord.js';
import { DAGError } from '../errors/DAGError.js';

export type { OutcomeRecordType };

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
  abstract reduce(records: ReadonlyArray<OutcomeRecordType>): string;
}

/**
 * `aggregate`: multi-clone semantics. Counts records where
 * `output === 'success'` as successes. Returns:
 *   - `'empty'`       when there are no records
 *   - `'all-success'` when every record is a success
 *   - `'all-error'`   when no record is a success
 *   - `'partial'`     otherwise
 */
class AggregateOutcomeReducer extends OutcomeReducer {
  readonly name = 'aggregate';
  reduce(records: ReadonlyArray<OutcomeRecordType>): string {
    if (records.length === 0) return 'empty';
    const successCount = records.filter((r) => r.output === 'success').length;
    if (successCount === records.length) return 'all-success';
    if (successCount === 0) return 'all-error';
    return 'partial';
  }
}

/**
 * `terminal`: singleton semantics (no `source`). Routes `'error'` when:
 *   - a DAG body's `terminalOutcome === 'failed'`
 *   - a node body's `output === 'error'`
 * Otherwise routes `'success'`. Unrecoverable-error poisoning is applied
 * by the dispatcher before `reduce` is called; a poisoned record arrives
 * with `output === 'error'`.
 */
class TerminalOutcomeReducer extends OutcomeReducer {
  readonly name = 'terminal';
  reduce(records: ReadonlyArray<OutcomeRecordType>): string {
    if (records.length === 0) return 'error';
    const rec = records[0];
    if (rec === undefined) return 'error';
    if (rec.terminalOutcome === 'failed' || rec.output === 'error') return 'error';
    return 'success';
  }
}

/**
 * `all-success`: routes `'success'` when every clone output === `'success'`,
 * otherwise routes `'error'`, evaluated over the scatter clone records.
 *
 * Returns `'error'` for an empty record set (no clones → not all success).
 */
class AllSuccessOutcomeReducer extends OutcomeReducer {
  readonly name = 'all-success';
  reduce(records: ReadonlyArray<OutcomeRecordType>): string {
    if (records.length === 0) return 'error';
    return records.every((r) => r.output === 'success') ? 'success' : 'error';
  }
}

/**
 * `any-success`: routes `'success'` when at least one clone output === `'success'`,
 * otherwise routes `'error'`, evaluated over the scatter clone records.
 *
 * Returns `'error'` for an empty record set (no clones → none succeeded).
 */
class AnySuccessOutcomeReducer extends OutcomeReducer {
  readonly name = 'any-success';
  reduce(records: ReadonlyArray<OutcomeRecordType>): string {
    if (records.length === 0) return 'error';
    return records.some((r) => r.output === 'success') ? 'success' : 'error';
  }
}

/** Built-in reducer instances; used by `OutcomeReducers.reset()`. */
const BUILTIN_REDUCERS: ReadonlyArray<OutcomeReducer> = [
  new AggregateOutcomeReducer(),
  new AllSuccessOutcomeReducer(),
  new AnySuccessOutcomeReducer(),
  new TerminalOutcomeReducer(),
];

/**
 * Static registry of `OutcomeReducer` instances. Defaults register at
 * module load. Consumers add more via `OutcomeReducers.register`.
 */
export class OutcomeReducers {
  private constructor() { /* static class */ }

  private static readonly registry = new Map<string, OutcomeReducer>(
    BUILTIN_REDUCERS.map((r) => [r.name, r]),
  );

  /**
   * Register a reducer. Throws `DAGError` when a reducer with the same
   * `name` is already registered — protects against silent overwrite of
   * built-ins or consumer-registered reducers. Use `replace()` for
   * intentional overrides (e.g. test-time substitution).
   */
  static register(reducer: OutcomeReducer): void {
    if (OutcomeReducers.registry.has(reducer.name)) {
      throw new DAGError(`OutcomeReducer '${reducer.name}' is already registered; use OutcomeReducers.replace() to intentionally override`);
    }
    OutcomeReducers.registry.set(reducer.name, reducer);
  }

  /**
   * Explicitly replace an existing registration. Does not throw when the
   * name is already present. Use this for intentional test-time or
   * plugin-override substitution where overwriting an existing entry is
   * the deliberate goal.
   */
  static replace(reducer: OutcomeReducer): void {
    OutcomeReducers.registry.set(reducer.name, reducer);
  }

  /**
   * Remove a previously registered reducer by name. No-op if the name is
   * not present. Used in test `afterEach` to undo `register` calls and
   * prevent cross-test pollution of the global registry.
   */
  static unregister(name: string): void {
    OutcomeReducers.registry.delete(name);
  }

  /**
   * Reset the registry to the four built-in reducers, discarding any
   * consumer-registered entries. Used in test `afterEach` to restore a clean
   * baseline.
   */
  static reset(): void {
    OutcomeReducers.registry.clear();
    for (const r of BUILTIN_REDUCERS) {
      OutcomeReducers.registry.set(r.name, r);
    }
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
