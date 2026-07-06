/**
 * ConsoleLogger: the Cartographer example's self-contained leveled logger.
 *
 * Duplicated per example by design (Decision D5): reference code optimizes
 * for copyability over DRY. A consumer copies the whole example and it
 * works without importing from a sibling example or a framework export.
 * This logger is never a framework contract — it lives strictly under
 * `examples/` and is the example's own concern.
 *
 * Two surfaces from one class:
 *
 *   • Level taxonomy: `trace` / `debug` / `info` / `warn` / `error` /
 *     `fatal`. Each is a method. `warn` / `error` / `fatal` route to
 *     `process.stderr`; `trace` / `debug` / `info` route to
 *     `process.stdout`. Diagnostic / progress / status lines flow through
 *     these from the `ObservedCartographer` hook overrides.
 *
 *   • Non-level display surface: `result(message)` emits the final tabular
 *     report output. It is not a diagnostic level — it is the example's
 *     human-facing display channel, written verbatim to `process.stdout`
 *     with no level tag so the tables render clean.
 *
 * One file owns platform detection (`process.*`); every caller sees the
 * leveled method surface, not the stream plumbing.
 */

// #region cartographer-console-logger
import { CircularBuffer } from '@studnicky/circular-buffer';
import { Clock as SubstrateClock, RealTimeClockProvider } from '@studnicky/clock';

const HAS_NODE_STDIO =
  typeof process !== 'undefined'
  && typeof process.stdout?.write === 'function';

export type LogLevelType = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEventInterface {
  readonly level: LogLevelType;
  readonly component: string;
  readonly operation: string;
  readonly message: string;
  readonly ts: number;
}

const STDERR_LEVELS: ReadonlySet<LogLevelType> = new Set<LogLevelType>(['warn', 'error', 'fatal']);

export class ConsoleLogger {
  readonly #buffer: CircularBuffer<LogEventInterface>;
  readonly #clock: SubstrateClock;

  constructor(options: { readonly clock?: SubstrateClock; readonly maxBuffer?: number } = {}) {
    this.#buffer = CircularBuffer.create<LogEventInterface>({
      'capacity': options.maxBuffer ?? 500,
      'overflow': 'overwrite',
    });
    this.#clock = options.clock ?? SubstrateClock.create(RealTimeClockProvider.create());
  }

  /** All events captured so far (most recent last). */
  history(): readonly LogEventInterface[] { return this.#snapshot(); }

  /** Empty the buffer; invoked at the top of each Cartographer run. */
  clear(): void {
    let event = this.#buffer.shift();
    while (event !== undefined) event = this.#buffer.shift();
  }

  /** Finest-grained diagnostic; stdout. */
  trace(component: string, operation: string, message: string): void {
    this.#emit('trace', component, operation, message);
  }

  /** Developer-facing detail; stdout. */
  debug(component: string, operation: string, message: string): void {
    this.#emit('debug', component, operation, message);
  }

  /** Standard progress / status line; stdout. */
  info(component: string, operation: string, message: string): void {
    this.#emit('info', component, operation, message);
  }

  /** Recoverable concern; stderr. */
  warn(component: string, operation: string, message: string): void {
    this.#emit('warn', component, operation, message);
  }

  /** Operation failure; stderr. */
  error(component: string, operation: string, message: string): void {
    this.#emit('error', component, operation, message);
  }

  /** Unrecoverable failure; stderr. */
  fatal(component: string, operation: string, message: string): void {
    this.#emit('fatal', component, operation, message);
  }

  /**
   * Final tabular / report display output. NOT a diagnostic level: written
   * verbatim to stdout with no tag so the report tables render clean.
   */
  result(message: string): void {
    if (HAS_NODE_STDIO) {
      process.stdout.write(`${message}\n`);
    }
  }

  #emit(level: LogLevelType, component: string, operation: string, message: string): void {
    const event: LogEventInterface = { level, component, operation, message, 'ts': this.#clock.now() };
    this.#buffer.push(event);
    if (HAS_NODE_STDIO) {
      const stream = STDERR_LEVELS.has(level) ? process.stderr : process.stdout;
      stream.write(`[cartographer:${level}] ${component}.${operation} ${message}\n`);
    }
  }

  #snapshot(): readonly LogEventInterface[] {
    const events: LogEventInterface[] = [];
    let event = this.#buffer.shift();
    while (event !== undefined) {
      events.push(event);
      event = this.#buffer.shift();
    }
    for (const retained of events) this.#buffer.push(retained);
    return events;
  }
}
// #endregion cartographer-console-logger
