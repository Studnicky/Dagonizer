/**
 * ArchivistInstrumentation: plugin-surface observability for the Archivist.
 *
 * Extends `NoopInstrumentation<ArchivistState>` and overrides every hook to
 * log via an injected logger. This surface fires alongside the `ObservedArchivist`
 * subclass hooks — both coexist on the same dispatcher instance; neither
 * suppresses the other.
 *
 * Pass an instance through `DagonizerOptionsInterface.instrumentation` when
 * constructing the dispatcher:
 *
 *   new ObservedArchivist(
 *     { services, instrumentation: new ArchivistInstrumentation(logger) },
 *     logger,
 *   )
 *
 * The plugin surface is the recommended extension mechanism when you need
 * composable, third-party observability (e.g. OpenTelemetry spans, Prometheus
 * counters) without subclassing. Multiple instrumentation plugins compose by
 * wrapping: `new CompositeInstrumentation([a, b])`.
 */

// #region instrumentation
import type { ExecutionResultInterface } from '@noocodex/dagonizer';
import { NoopInstrumentation } from '@noocodex/dagonizer';

import type { ArchivistState } from '../ArchivistState.ts';

/** Subset of `ConsoleLogger` the instrumentation plugin needs. */
interface InstrumentationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export class ArchivistInstrumentation extends NoopInstrumentation<ArchivistState> {
  readonly #logger: InstrumentationLogger;

  constructor(logger: InstrumentationLogger) {
    super();
    this.#logger = logger;
  }

  /**
   * Fires before the entrypoint node runs (top-level DAG only; suppressed
   * for embedded-DAG re-entry).
   */
  override flowStart(dagName: string, _state: ArchivistState): void {
    this.#logger.info(`[instr:flow] start dag=${dagName}`);
  }

  /**
   * Fires after the execution loop drains.
   *
   * `result.executedNodes` lists every node that ran (including phase
   * placements appended by `runPostPhasesAndFinalize`).
   */
  override flowEnd(
    dagName: string,
    _state: ArchivistState,
    result: ExecutionResultInterface<ArchivistState>,
  ): void {
    const executed = result.executedNodes.length;
    const skipped  = result.skippedNodes.length;
    this.#logger.info(
      `[instr:flow] end dag=${dagName} executed=${String(executed)} skipped=${String(skipped)}`,
    );
  }

  /**
   * Fires before each node's `execute()` call.
   *
   * `placementPath` disambiguates same-named inner placements across multiple
   * embedded-DAG instances. Top-level: `[]`. One level deep: `['book-search-scatter']`.
   */
  override nodeStart(
    dagName: string,
    nodeName: string,
    _state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const path = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    this.#logger.info(`[instr:node] start dag=${dagName} ${path}${nodeName}`);
  }

  /**
   * Fires after the node result is recorded.
   *
   * `output` is the routing tag returned by the node, or `null` for terminal
   * placements that carry an `outcome` instead.
   */
  override nodeEnd(
    dagName: string,
    nodeName: string,
    output: string | null,
    _state: ArchivistState,
    placementPath: readonly string[],
  ): void {
    const path   = placementPath.length > 0 ? `[${placementPath.join('/')}] ` : '';
    const outTag = output ?? '(terminal)';
    this.#logger.info(`[instr:node] end dag=${dagName} ${path}${nodeName} → ${outTag}`);
  }

  /**
   * Fires before a `pre` or `post` phase placement runs.
   *
   * `phase` is the literal string `'pre'` or `'post'`; `placementName` is
   * the placement's `name` field in the DAG definition.
   */
  override phaseEnter(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: ArchivistState,
    _placementPath: readonly string[],
  ): void {
    this.#logger.info(`[instr:phase] enter dag=${dagName} phase=${phase} placement=${placementName}`);
  }

  /**
   * Fires after a `pre` or `post` phase placement completes (whether it
   * succeeded or was collected as a warning on post-phase failure).
   */
  override phaseExit(
    dagName: string,
    phase: 'pre' | 'post',
    placementName: string,
    _state: ArchivistState,
    _placementPath: readonly string[],
  ): void {
    this.#logger.info(`[instr:phase] exit dag=${dagName} phase=${phase} placement=${placementName}`);
  }

  /**
   * Fires for each non-fatal dead-write warning from `ContractRegistryValidator`
   * during DAG registration.
   */
  override contractWarning(message: string): void {
    this.#logger.warn(`[instr:contract] ${message}`);
  }
}
// #endregion instrumentation
