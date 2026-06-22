/**
 * ObservedDag: generic Dagonizer subclass that wires every lifecycle hook to
 * an injected ConsoleLogger.
 *
 * This is the shared observability base class for both the CLI runner and the
 * in-browser demo runners. Consumers subclass it and override lifecycle hooks
 * to add domain-specific behavior; each override calls `super.<hook>(...)` to
 * preserve the leveled log lines that come from this base, then adds its own
 * effects (graph animation, trace feed, provenance recording, etc.).
 *
 * The logger is INJECTED (not constructed here) so that:
 *   - The CLI runner passes a plain `ConsoleLogger`.
 *   - The browser runner passes a `DomConsoleLogger` (subclass of ConsoleLogger)
 *     that mirrors every event into a reactive Vue ref for the trace panel.
 *
 * Lifecycle hook taxonomy:
 *   onFlowStart  – `info`  DAG entry
 *   onFlowEnd    – `info`  outcome
 *   onNodeStart  – `debug` node name + placement path
 *   onNodeEnd    – `debug` node name + output routing decision
 *   onError      – `error` error message and class
 *   onPhaseEnter – `trace` phase entry (pre/post)
 *   onPhaseExit  – `trace` phase exit (pre/post)
 */

// #region observed-dag
import { Dagonizer } from '@studnicky/dagonizer';
import type { DagonizerOptionsType, ExecutionResultType, NodeStateInterface } from '@studnicky/dagonizer';

import type { ConsoleLogger } from './logger/ConsoleLogger.ts';

export class ObservedDag<TState extends NodeStateInterface> extends Dagonizer<TState> {
  readonly #logger: ConsoleLogger;

  constructor(logger: ConsoleLogger, options: DagonizerOptionsType = {}) {
    super(options);
    this.#logger = logger;
  }

  /** The injected logger. Subclasses and drivers read this for co-located output. */
  get logger(): ConsoleLogger { return this.#logger; }

  protected override onFlowStart(dagName: string): void {
    this.#logger.info(`[dag:flow] start dag=${dagName}`);
  }

  protected override onFlowEnd(
    dagName: string,
    state: TState,
    result: ExecutionResultType<TState>,
  ): void {
    void state;
    const outcome = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    this.#logger.info(`[dag:flow] end dag=${dagName} outcome=${outcome}`);
  }

  protected override onNodeStart(
    nodeName: string,
    state: TState,
    placementPath: readonly string[],
  ): void {
    void state;
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.debug(`[dag:node] start ${path}${nodeName}`);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: TState,
    placementPath: readonly string[],
  ): void {
    void state;
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#logger.debug(`[dag:node] end ${path}${nodeName} → ${outTag}`);
  }

  protected override onError(
    nodeName: string,
    error: Error,
    state: TState,
    placementPath: readonly string[],
  ): void {
    void state;
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.error(`[dag:error] ${path}${nodeName} threw ${error.constructor.name}: ${error.message}`);
  }

  protected override onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string): void {
    this.#logger.trace(`[dag:phase] enter dag=${dagName} phase=${phase} placement=${placementName}`);
  }

  protected override onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string): void {
    this.#logger.trace(`[dag:phase] exit dag=${dagName} phase=${phase} placement=${placementName}`);
  }
}
// #endregion observed-dag
