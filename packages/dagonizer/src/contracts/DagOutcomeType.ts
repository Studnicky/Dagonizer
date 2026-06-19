/**
 * DagOutcomeType: adapter contract for the result returned by a
 * `DagContainerInterface.runDag()` call after an embedded DAG completes
 * in an isolate.
 *
 * `terminalOutput`  — the routing output the child DAG resolved to (e.g.
 *                     `'success'` | `'error'`).
 * `errors`          — collected errors from the child run (never thrown;
 *                     always collected).
 * `stateSnapshot`   — terminal child state snapshot; `null` when the
 *                     container cannot produce a snapshot (e.g. transport
 *                     failure). Parent calls
 *                     `cloneState.applySnapshot(stateSnapshot)` when non-null.
 * `intermediates`   — per-node results from the child DAG, forwarded to the
 *                     parent execution stream as intermediate yields.
 */

import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import type { JsonObjectType } from '../entities/json.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';

export type DagOutcomeType = {
  readonly terminalOutput: string;
  readonly errors: readonly NodeErrorWireType[];
  readonly stateSnapshot: JsonObjectType | null;
  readonly intermediates: readonly ExecutorIntermediateType[];
};