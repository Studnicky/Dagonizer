/**
 * DagOutcomeType: adapter contract for the result returned by a
 * `DagContainerInterface.runDag()` call after an embedded DAG completes
 * in an isolate.
 *
 * `terminalOutput`  — the routing output the child DAG resolved to (e.g.
 *                     `'success'` | `'error'`).
 * `errors`          — collected errors from the child run (never thrown;
 *                     always collected).
 * `graphState`      — terminal child graph-state transfer restored through
 *                     the graph-state port.
 * `intermediates`   — per-node results from the child DAG, forwarded to the
 *                     parent execution stream as intermediate yields.
 */

import type { ExecutorIntermediateType } from '../entities/executor/ExecutorIntermediate.js';
import type { NodeErrorWireType } from '../entities/node/NodeError.js';

import type { GraphStateTransferType } from './GraphStateTransfer.js';

export type DagOutcomeType = {
  readonly terminalOutput: string;
  readonly errors: readonly NodeErrorWireType[];
  readonly graphState?: GraphStateTransferType;
  readonly intermediates: readonly ExecutorIntermediateType[];
};
