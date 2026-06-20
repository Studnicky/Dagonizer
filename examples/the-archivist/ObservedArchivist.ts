/**
 * ObservedArchivist: Dagonizer subclass wiring every lifecycle hook to the
 * Archivist's logger (and, optionally, to RdfProvObserver / StateProjection).
 *
 * Demonstrates the subclass observability surface of the dispatcher. The
 * subclass owns its logger: it instantiates a `ConsoleLogger` internally and
 * is the sole observability surface — nodes never log. Each lifecycle hook
 * emits a leveled line through the full taxonomy:
 *   onFlowStart  – `info`  DAG entry; where RdfProvObserver.recordFlowStart would be called
 *   onFlowEnd    – `info`  outcome + executed-node count; where StateProjection.capture would flush
 *   onNodeStart  – `debug` node name + placement path
 *   onNodeEnd    – `debug` node name + output routing decision
 *   onError      – `error` error message and class
 *   onPhaseEnter – `trace` phase entry (pre/post)
 *   onPhaseExit  – `trace` phase exit (pre/post)
 *
 * The CLI / DOM driver reads `observed.logger` to stream the same events into
 * stdout / a `<pre>` panel (the DOM driver subscribes via `DomConsoleLogger`'s
 * `onEmit` override). The logger is not injected: construction takes only the
 * base `DagonizerOptionsType`.
 */

// #region observed-archivist
import type { ExecutionResultType } from '@studnicky/dagonizer';
import { Dagonizer } from '@studnicky/dagonizer';

import type { ArchivistState } from './ArchivistState.ts';
import type { ArchivistServices } from './services.ts';
import { ConsoleLogger } from './logger/ConsoleLogger.ts';

export class ObservedArchivist extends Dagonizer<ArchivistState, ArchivistServices> {
  readonly #logger = new ConsoleLogger();

  /**
   * The subclass-owned logger. The CLI / DOM driver reads this to stream the
   * same leveled events the hooks emit into stdout or an in-browser panel.
   */
  get logger(): ConsoleLogger { return this.#logger; }

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
   * Fires after the execution loop drains (terminal node, error, or abort).
   *
   * Extension point: call `StateProjection.capture(state)` here to flush the
   * per-run state graph into the memory store before `recordFindings` runs.
   * Also a good place to drive `RdfProvObserver.recordFlowEnd`.
   */
  protected override onFlowEnd(
    dagName: string,
    state: ArchivistState,
    result: ExecutionResultType<ArchivistState>,
  ): void {
    const executed = result.executedNodes.length;
    const outcome  = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    this.#logger.info(
      `[archivist:flow] end dag=${dagName} outcome=${outcome} executed=${String(executed)} lifecycle=${state.lifecycle.variant}`,
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
    this.#logger.debug(`[archivist:node] start ${path}${nodeName}`);
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
    this.#logger.debug(`[archivist:node] end ${path}${nodeName} → ${outTag}`);
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
    this.#logger.error(
      `[archivist:error] ${path}${nodeName} threw ${error.constructor.name}: ${error.message}`,
    );
    // RdfProvObserver.recordError(nodeName, error) — surface in prov graph here
  }

  /**
   * Fires before a `pre` or `post` phase placement runs.
   *
   * `phase` is the literal string `'pre'` or `'post'`; `placementName` is
   * the placement's `name` field in the DAG definition.
   */
  protected override onPhaseEnter(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: ArchivistState,
    _placementPath: readonly string[],
  ): void {
    this.#logger.trace(`[archivist:phase] enter dag=${dagName} phase=${phase} placement=${placementName}`);
  }

  /**
   * Fires after a `pre` or `post` phase placement completes.
   */
  protected override onPhaseExit(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: ArchivistState,
    _placementPath: readonly string[],
  ): void {
    this.#logger.trace(`[archivist:phase] exit dag=${dagName} phase=${phase} placement=${placementName}`);
  }
}
// #endregion observed-archivist
