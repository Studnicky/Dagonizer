/**
 * ObservedDag: generic Dagonizer subclass that wires every lifecycle hook to
 * an injected logger.
 *
 * Consumers subclass `ObservedDag<TState>` and pass any object implementing
 * `DagLoggerInterface` (four methods: `trace`, `debug`, `info`, `error`).
 * Each lifecycle hook calls the corresponding level with a structured
 * `LogBodyDataType` (or, for `error`, a `LogFaultDataType`) built via
 * `@studnicky/logger`'s `LogBody`/`LogFault` builders; subclass overrides call
 * `super.<hook>(...)` first to preserve the base log lines, then add their own
 * effects (DAG graph animation, trace feed updates, provenance recording, etc.).
 *
 * The logger is INJECTED so that CLI runners, browser runners, and test harnesses
 * can each supply a different implementation — a `@studnicky/logger` `Logger`
 * instance, a spy, or any object with the same structural shape — without the
 * base class depending on any specific logger class.
 *
 * Lifecycle hook taxonomy:
 *   onFlowStart  – info  DAG entry
 *   onFlowEnd    – info  outcome + executed-node count
 *   onNodeStart  – debug node name + placement path
 *   onNodeEnd    – debug node name + output routing decision
 *   onError      – error error message and class name
 *   onPhaseEnter – trace phase entry (pre/post)
 *   onPhaseExit  – trace phase exit (pre/post)
 *
 * Every log entry carries the run's correlation id, read from
 * `DagExecutionContext` via the `signal` each hook fires with (seeded by
 * `Dagonizer.execute()`/`resume()`, see `runtime/DagExecutionContext.ts`).
 * `onNodeStart`/`onNodeEnd`/`onError` also carry `dagName` from the same
 * context, since — unlike the flow/phase hooks — the dispatcher does not
 * pass `dagName` as a hook argument at that level.
 */

import { LogBody, LogFault } from '@studnicky/logger';
import type { LogBodyDataType, LogFaultDataType } from '@studnicky/logger/interfaces';

import type { DagonizerOptionsType } from './Dagonizer.js';
import { Dagonizer } from './Dagonizer.js';
import type { ExecutionResultType } from './entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from './NodeStateBase.js';
import { DagExecutionContext } from './runtime/DagExecutionContext.js';

/** Correlation id used in log context when no `DagExecutionContext` scope is active. */
const NO_CORRELATION_ID = 'none';

/**
 * Structured logger contract accepted by `ObservedDag`.
 *
 * Matches `@studnicky/logger`'s `Logger` call shape: `trace`/`debug`/`info`
 * take a built `LogBodyDataType`, `error` takes a built `LogFaultDataType`.
 * A real `Logger` instance satisfies this contract directly; no adapter is
 * needed.
 */
export interface DagLoggerInterface {
  trace(body: LogBodyDataType): void;
  debug(body: LogBodyDataType): void;
  info(body: LogBodyDataType): void;
  error(fault: LogFaultDataType): void;
}

export class ObservedDag<TState extends NodeStateInterface> extends Dagonizer<TState> {
  readonly #logger: DagLoggerInterface;

  constructor(logger: DagLoggerInterface, options: DagonizerOptionsType = {}) {
    super(options);
    this.#logger = logger;
  }

  /** The injected logger. Subclasses and drivers may read this for co-located output. */
  get logger(): DagLoggerInterface { return this.#logger; }

  /**
   * Correlation id of the run currently executing, read via
   * `DagExecutionContext.correlationIdOf(signal)` — the same anchor
   * `Dagonizer` seeded the run's scope with. Falls back to
   * `NO_CORRELATION_ID` when `signal` has no registered scope (e.g. a node
   * invoked directly, outside `Dagonizer.execute()`).
   */
  #correlationId(signal: AbortSignal): string {
    return DagExecutionContext.correlationIdOf(signal) ?? NO_CORRELATION_ID;
  }

  protected override onFlowStart(dagName: string, state: TState, signal: AbortSignal): void {
    void state;
    this.#logger.info(
      LogBody.create()
        .component('dag')
        .operation('flow')
        .status('in_progress')
        .message(`start dag=${dagName}`)
        .context({ dagName, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }

  protected override onFlowEnd(
    dagName: string,
    state: TState,
    result: ExecutionResultType<TState>,
    signal: AbortSignal,
  ): void {
    void state;
    const outcome = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    this.#logger.info(
      LogBody.create()
        .component('dag')
        .operation('flow')
        .status('complete')
        .message(`end dag=${dagName} outcome=${outcome}`)
        .context({ dagName, outcome, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }

  protected override onNodeStart(
    nodeName: string,
    state: TState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    void state;
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const dagName = DagExecutionContext.dagNameOf(signal);
    this.#logger.debug(
      LogBody.create()
        .component('dag')
        .operation('node')
        .status('in_progress')
        .message(`start ${path}${nodeName}`)
        .context({ nodeName, placementPath, dagName, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    state: TState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    void state;
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    const dagName = DagExecutionContext.dagNameOf(signal);
    this.#logger.debug(
      LogBody.create()
        .component('dag')
        .operation('node')
        .status('complete')
        .message(`end ${path}${nodeName} → ${outTag}`)
        .context({ nodeName, placementPath, 'output': outTag, dagName, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }

  protected override onError(
    nodeName: string,
    error: Error,
    state: TState,
    placementPath: readonly string[],
    signal: AbortSignal,
  ): void {
    void state;
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const dagName = DagExecutionContext.dagNameOf(signal);
    this.#logger.error(
      LogFault.create()
        .component('dag')
        .operation('node')
        .status('failed')
        .name(error.constructor.name)
        .message(`${path}${nodeName} threw ${error.message}`)
        .context({ nodeName, placementPath, dagName, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }

  protected override onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[], signal: AbortSignal): void {
    void state;
    void placementPath;
    this.#logger.trace(
      LogBody.create()
        .component('dag')
        .operation('phase')
        .status('in_progress')
        .message(`enter dag=${dagName} phase=${phase} placement=${placementName}`)
        .context({ dagName, phase, placementName, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }

  protected override onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[], signal: AbortSignal): void {
    void state;
    void placementPath;
    this.#logger.trace(
      LogBody.create()
        .component('dag')
        .operation('phase')
        .status('complete')
        .message(`exit dag=${dagName} phase=${phase} placement=${placementName}`)
        .context({ dagName, phase, placementName, 'correlationId': this.#correlationId(signal) })
        .build(),
    );
  }
}
