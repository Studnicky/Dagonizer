/**
 * ObservedCartographer: Dagonizer subclass that demonstrates the
 * class-extension observability surface for the Cartographer pipeline.
 *
 * The dispatcher exposes lifecycle hooks as protected no-op methods.
 * Observability is added by SUBCLASSING and overriding them — never by
 * passing callbacks into the engine and never by a framework log sink.
 * This subclass instantiates its OWN logger internally (`#logger`) and
 * emits leveled diagnostic lines from each overridden hook:
 *
 *   onFlowStart   – info: DAG entry
 *   onFlowEnd     – info: outcome + executed-node count + lifecycle
 *   onNodeStart   – trace: node name + placement path
 *   onNodeEnd     – debug: node name + routing decision
 *   onError       – error: error class + message
 *   onPhaseEnter  – trace: phase entry (pre/post)
 *   onPhaseExit   – trace: phase exit (pre/post)
 *
 * The final tabular report DISPLAY output stays in `runCartographer.ts`,
 * routed through `logger.result(...)` (a non-level display channel) so the
 * tables render verbatim. Progress / status / diagnostic writes live here,
 * leveled, where they belong.
 */

// #region observed-cartographer
import { Dagonizer } from '@studnicky/dagonizer';
import type { DagonizerOptionsType, ExecutionResultType } from '@studnicky/dagonizer';

import { CartographerState } from './CartographerState.ts';
import { ConsoleLogger } from './logger/ConsoleLogger.ts';

const COMPONENT = 'ObservedCartographer';

export class ObservedCartographer extends Dagonizer<CartographerState> {
  readonly #logger = new ConsoleLogger();

  constructor(options: DagonizerOptionsType) {
    super(options);
  }

  /** The example's own logger; the CLI routes report display through `result`. */
  get logger(): ConsoleLogger {
    return this.#logger;
  }

  /**
   * Fires before the entrypoint node runs. Logs DAG entry plus the run's
   * configured event count so a reader can correlate scale with throughput.
   */
  protected override onFlowStart(dagName: string, state: CartographerState): void {
    this.#logger.info(COMPONENT, 'onFlowStart', `dag=${dagName} events=${String(state.eventCount)}`);
  }

  /**
   * Fires after the execution loop drains (terminal node, error, or abort).
   * Logs the outcome, executed-node count, and resolved lifecycle variant.
   */
  protected override onFlowEnd(
    dagName: string,
    state: CartographerState,
    result: ExecutionResultType<CartographerState>,
  ): void {
    const executed = result.executedNodes.length;
    const outcome  = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    this.#logger.info(
      COMPONENT,
      'onFlowEnd',
      `dag=${dagName} outcome=${outcome} executed=${String(executed)} lifecycle=${state.lifecycle.variant}`,
    );
  }

  /**
   * Fires before each node's `execute()` call. `placementPath` is the
   * ordered list of parent embedded-DAG placement names (empty for
   * top-level nodes). Fires for in-process AND worker / contained nodes.
   */
  protected override onNodeStart(
    nodeName: string,
    _state: CartographerState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.trace(COMPONENT, 'onNodeStart', `${path}${nodeName}`);
  }

  /**
   * Fires after a node completes successfully. `output` is the routing tag
   * the node returned, or `null` for terminal placements.
   */
  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    _state: CartographerState,
    placementPath: readonly string[],
  ): void {
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#logger.debug(COMPONENT, 'onNodeEnd', `${path}${nodeName} -> ${outTag}`);
  }

  /**
   * Fires when the dispatcher catches an error from a node or from the
   * abort / timeout machinery. Routed to `error` (stderr).
   */
  protected override onError(
    nodeName: string,
    error: Error,
    _state: CartographerState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.error(
      COMPONENT,
      'onError',
      `${path}${nodeName} threw ${error.constructor.name}: ${error.message}`,
    );
  }

  /**
   * Fires before a `pre` or `post` phase placement runs.
   */
  protected override onPhaseEnter(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: CartographerState,
    _placementPath: readonly string[],
  ): void {
    this.#logger.trace(COMPONENT, 'onPhaseEnter', `dag=${dagName} phase=${phase} placement=${placementName}`);
  }

  /**
   * Fires after a `pre` or `post` phase placement completes.
   */
  protected override onPhaseExit(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: CartographerState,
    _placementPath: readonly string[],
  ): void {
    this.#logger.trace(COMPONENT, 'onPhaseExit', `dag=${dagName} phase=${phase} placement=${placementName}`);
  }
}
// #endregion observed-cartographer
