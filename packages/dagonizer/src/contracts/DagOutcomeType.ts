/**
 * DagOutcomeType: adapter contract for the result returned by a
 * `DagContainerInterface.runDag()` call after an embedded DAG completes
 * in an isolate.
 *
 * `terminalOutput`  — the routing output the child DAG resolved to (e.g.
 *                     `'success'` | `'error'`).
 * `errors`          — collected errors from the child run (never thrown;
 *                     always collected).
 * `runIri`          — the run IRI for this item's restored clone. Absent on
 *                     transport-error outcomes.
 * `intermediates`   — per-node results from the child DAG, forwarded to the
 *                     parent execution stream as intermediate yields.
 */

import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';

export type DagOutcomeType = {
  readonly terminalOutput: string;
  readonly errors: readonly NodeErrorWireType[];
  readonly runIri?: string;
  readonly intermediates: readonly ExecutorIntermediateType[];
};

/**
 * Per-item result from a `DagContainerInterface.runDag()` batch call. Carries
 * the item `id` alongside the full `DagOutcomeType` so callers can correlate
 * results back to input items. Every `runDag` call is a batch call — a single
 * item is a batch of one through the identical path, so this is the only
 * result shape the interface returns.
 */
export type RunResultType = DagOutcomeType & {
  readonly id: string;
};
