/**
 * DagContainerInterface: adapter contract for running a whole embedded DAG
 * in an isolate (worker thread, forked child, spawned process, Web Worker, etc.).
 *
 * The dispatcher binds logical container roles (strings declared on a placement's
 * `container` key) to concrete `DagContainerInterface` instances at construction
 * time via `DagonizerOptionsType.containers`. A placement that declares an
 * unbound role throws a `DAGError` at `registerDAG` time.
 *
 * Implementations are free to pool resources internally. `destroy()` releases
 * pool resources when the dispatcher shuts down.
 */

import type { Batch } from '../entities/batch/Batch.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { DagTaskType } from '../types/DagTask.js';

import type { RunResultType } from './DagOutcomeType.js';
import type { ObserverRelayInterface } from './ObserverRelayInterface.js';

export interface DagContainerInterface {
  /**
   * Run a batch of items through the same embedded DAG to completion inside
   * the isolate, in one transport round-trip. A single item is a batch of one
   * through the identical path — there is no separate single-item path.
   *
   * `task` supplies the DAG IRI, placement path, timeout, and abort signal
   * (`task.context.signal`). `batch` carries the per-item states. Isolating
   * containers snapshot the complete batch into one transport request;
   * in-process containers may use the batch states directly.
   *
   * The optional `options.relay` is an internal observer provided by the parent
   * `Dagonizer` so that worker-side hook events (nodeStart, nodeEnd, error,
   * phaseEnter, phaseExit) are forwarded to the parent's protected hooks.
   * The container must forward this relay to its channel routing layer.
   *
   * Must never throw. Transport failures, host crashes, and serialization
   * errors are returned as collected errors in each `RunResultType.errors`
   * with `recoverable: false`, one entry per item.
   */
  runDag(
    task: DagTaskType,
    batch: Batch<NodeStateInterface>,
    options?: { readonly relay?: ObserverRelayInterface },
  ): Promise<RunResultType[]>;

  /**
   * Release pool resources. Called by the dispatcher's `destroy()`. Optional:
   * containers without pool resources need not implement it.
   */
  destroy?(): Promise<void>;
}
