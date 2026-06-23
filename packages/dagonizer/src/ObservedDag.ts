/**
 * ObservedDag: generic Dagonizer subclass that wires every lifecycle hook to
 * an injected logger.
 *
 * Consumers subclass `ObservedDag<TState>` and pass any object implementing
 * `DagLoggerInterface` (four methods: `trace`, `debug`, `info`, `error`).
 * Each lifecycle hook calls the corresponding level; subclass overrides call
 * `super.<hook>(...)` first to preserve the base log lines, then add their own
 * effects (DAG graph animation, trace feed updates, provenance recording, etc.).
 *
 * The logger is INJECTED so that CLI runners, browser runners, and test harnesses
 * can each supply a different implementation — a ConsoleLogger, a DomConsoleLogger,
 * a no-op, or a spy — without the base class depending on any specific logger class.
 *
 * Lifecycle hook taxonomy:
 *   onFlowStart  – info  DAG entry
 *   onFlowEnd    – info  outcome + executed-node count
 *   onNodeStart  – debug node name + placement path
 *   onNodeEnd    – debug node name + output routing decision
 *   onError      – error error message and class name
 *   onPhaseEnter – trace phase entry (pre/post)
 *   onPhaseExit  – trace phase exit (pre/post)
 */

import type { DagonizerOptionsType } from './Dagonizer.js';
import { Dagonizer } from './Dagonizer.js';
import type { ExecutionResultType } from './entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from './NodeStateBase.js';

/**
 * Minimal logger contract accepted by `ObservedDag`.
 *
 * Any object with these four methods works — a ConsoleLogger, a structured
 * logger, a test spy, or a plain `console` object.
 */
export interface DagLoggerInterface {
  trace(message: string): void;
  debug(message: string): void;
  info(message:  string): void;
  error(message: string): void;
}

export class ObservedDag<TState extends NodeStateInterface> extends Dagonizer<TState> {
  readonly #logger: DagLoggerInterface;

  constructor(logger: DagLoggerInterface, options: DagonizerOptionsType = {}) {
    super(options);
    this.#logger = logger;
  }

  /** The injected logger. Subclasses and drivers may read this for co-located output. */
  get logger(): DagLoggerInterface { return this.#logger; }

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
