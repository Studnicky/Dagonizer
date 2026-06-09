/**
 * DagOutcomeInterface: result returned by a `DagContainerInterface.runDag()`
 * call after an embedded DAG completes in an isolate.
 *
 * `terminalOutput`  — the routing output the child DAG resolved to (e.g. `'success'` | `'error'`).
 * `errors`          — collected errors from the child run (never thrown; always collected).
 * `stateSnapshot`   — terminal child state snapshot; `null` when the container cannot
 *                     produce a snapshot (e.g. transport failure). Parent calls
 *                     `cloneState.applySnapshot(stateSnapshot)` when non-null.
 * `intermediates`   — per-node results from the child DAG, forwarded to the parent
 *                     execution stream as intermediate yields.
 */

import type { ExecutorIntermediate } from '../entities/executor/ExecutorIntermediate.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeError } from '../entities/node/NodeError.js';

export interface DagOutcomeInterface {
  readonly terminalOutput: string;
  readonly errors: readonly NodeError[];
  readonly stateSnapshot: JsonObject | null;
  readonly intermediates: readonly ExecutorIntermediate[];
}
