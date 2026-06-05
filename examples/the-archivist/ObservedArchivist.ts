/**
 * ObservedArchivist: Dagonizer subclass wiring every lifecycle hook to the
 * Archivist's logger (and, optionally, to RdfProvObserver / StateProjection).
 *
 * Demonstrates the subclass observability surface of the dispatcher:
 *   onFlowStart   – logs DAG entry; where RdfProvObserver.recordFlowStart would be called
 *   onFlowEnd     – logs outcome + executed-node count; where StateProjection.capture would flush
 *   onNodeStart   – logs node name + placement path
 *   onNodeEnd     – logs node name + output routing decision
 *   onError       – logs error message and class
 *   onContractWarning – surfaces dead-write warnings from DAG derivation
 *
 * Constructor accepts the same `DagonizerOptionsInterface` as the base, plus
 * an injected `logger` that matches `ArchivistServices.logger`.
 */

// #region observed-archivist
import type { ExecutionResultInterface } from '@noocodex/dagonizer';
import { Dagonizer } from '@noocodex/dagonizer';
import type { DagonizerOptionsInterface } from '@noocodex/dagonizer';

import type { ArchivistState } from './ArchivistState.ts';
import type { ArchivistServices } from './services.ts';

/** Subset of `ConsoleLogger` the observer needs; avoids importing the class directly. */
interface ObservabilityLogger {
  info(message: string): void;
  warn(message: string): void;
}

export class ObservedArchivist extends Dagonizer<ArchivistState, ArchivistServices> {
  readonly #logger: ObservabilityLogger;

  constructor(
    options: DagonizerOptionsInterface<ArchivistServices>,
    logger: ObservabilityLogger,
  ) {
    super(options);
    this.#logger = logger;
  }

  /**
   * Fires before the entrypoint node runs.
   *
   * Extension point: call `RdfProvObserver.recordFlowStart(dagName)` here to
   * open the PROV-O activity for this run. The observer needs `state.runId`
   * (stamped by the `pre-run-setup` phase) to derive the named graph IRI.
   */
  protected override onFlowStart(dagName: string, _state: ArchivistState): void {
    this.#logger.info(`[archivist:flow] start dag=${dagName}`);
    // RdfProvObserver.recordFlowStart(dagName) — drive prov here
  }

  /**
   * Fires after the execution loop drains (terminal node, null route, error, or abort).
   *
   * Extension point: call `StateProjection.capture(state)` here to flush the
   * per-run state graph into the memory store before `recordFindings` runs.
   * Also a good place to drive `RdfProvObserver.recordFlowEnd`.
   */
  protected override onFlowEnd(
    dagName: string,
    state: ArchivistState,
    result: ExecutionResultInterface<ArchivistState>,
  ): void {
    const executed = result.executedNodes.length;
    const outcome  = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'null-route';
    this.#logger.info(
      `[archivist:flow] end dag=${dagName} outcome=${outcome} executed=${String(executed)} lifecycle=${state.lifecycle.kind}`,
    );
    // StateProjection.capture(state) — flush state graph here
    // RdfProvObserver.recordFlowEnd(dagName) — close prov activity here
  }

  /**
   * Fires before each node's `execute()` call.
   *
   * `placementPath` is the ordered list of parent embedded-DAG placement names.
   * Empty for top-level nodes; `['book-search-scatter']` for a node one level
   * inside that embedded DAG. Use `[...placementPath, nodeName].join('/')` for
   * a fully-qualified cytoscape-style id.
   *
   * Extension point: `RdfProvObserver.recordNodeStart(nodeName)` opens the per-node
   * `prov:Activity`.
   */
  protected override onNodeStart(
    nodeName: string,
    _state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.info(`[archivist:node] start ${path}${nodeName}`);
    // RdfProvObserver.recordNodeStart(nodeName) — open per-node prov activity here
  }

  /**
   * Fires after the node's result is recorded.
   *
   * `output` is the routing tag the node returned (`'success'`, `'ranked'`,
   * `'retry'`, etc.) or `null` for terminal placements.
   *
   * Extension point: `RdfProvObserver.recordNodeEnd(nodeName, output)` closes
   * the per-node `prov:Activity` with `prov:endedAtTime`.
   */
  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    _state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#logger.info(`[archivist:node] end ${path}${nodeName} → ${outTag}`);
    // RdfProvObserver.recordNodeEnd(nodeName, output) — close per-node prov activity here
  }

  /**
   * Fires when the dispatcher catches an error from a node or from
   * the abort / timeout machinery.
   *
   * Extension point: drive `RdfProvObserver.recordError` here so the PROV-O
   * graph carries the failure reason, allowing a future `recallContext` pass
   * to surface "this node previously failed with X" continuity hints.
   */
  protected override onError(
    nodeName: string,
    error: Error,
    _state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.warn(
      `[archivist:error] ${path}${nodeName} threw ${error.constructor.name}: ${error.message}`,
    );
    // RdfProvObserver.recordError(nodeName, error) — surface in prov graph here
  }

  /**
   * Fires for each non-fatal dead-write warning surfaced during DAG
   * registration when the DAG was derived from a node registry.
   *
   * Extension point: route to a structured warning collector so operators
   * can audit DAG definitions for unreachable output routes.
   */
  protected override onContractWarning(message: string): void {
    this.#logger.warn(`[archivist:contract] ${message}`);
  }
}
// #endregion observed-archivist
