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
 *
 * The `TServices` on `DagTaskInterface` in `runDag` is `unknown` so the container
 * interface remains decoupled from the dispatcher's services record.
 */

import type { DagOutcomeType } from './DagOutcomeType.js';
import type { DagTaskInterface } from './DagTaskInterface.js';
import type { ObserverRelayInterface } from './ObserverRelayInterface.js';

export interface DagContainerInterface {
  /**
   * Run a whole embedded DAG to completion inside the isolate.
   *
   * The task carries a live seeded child clone (`task.state`) and a composed
   * abort signal (`task.context.signal`). Isolating containers call
   * `task.toRequest()` to snapshot the clone for transport; in-process
   * containers may use `task.state` directly.
   *
   * The `TServices` on the task is intentionally unconstrained (unknown) so
   * the container interface remains decoupled from the dispatcher's services
   * record. Containers access only `task.state`, `task.toRequest()`, and
   * `task.context.signal` — they never read `task.context.services`.
   *
   * The optional `options.relay` is an internal observer provided by the parent
   * `Dagonizer` so that worker-side hook events (nodeStart, nodeEnd, error,
   * phaseEnter, phaseExit) are forwarded to the parent's protected hooks.
   * The container must forward this relay to its channel routing layer.
   *
   * Must never throw. Transport failures, host crashes, and serialization
   * errors are returned as collected errors in `DagOutcomeType.errors`
   * with `recoverable: false`.
   */
  runDag(task: DagTaskInterface<unknown>, options?: { readonly relay?: ObserverRelayInterface }): Promise<DagOutcomeType>;

  /**
   * Release pool resources. Called by the dispatcher's `destroy()`. Optional:
   * containers without pool resources need not implement it.
   */
  destroy?(): Promise<void>;
}
