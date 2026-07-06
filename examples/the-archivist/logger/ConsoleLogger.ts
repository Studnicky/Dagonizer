/**
 * ConsoleLogger: leveled logger with ring buffer and override hook.
 *
 * Demo/example utility — NOT a framework export. Lives here in examples/
 * because logging strategy is the consumer's responsibility.
 *
 * `trace`/`debug`/`info`/`error` accept `@studnicky/logger`'s structured
 * `LogBodyDataType`/`LogFaultDataType` — the same shape `ObservedDag`'s
 * `DagLoggerInterface` calls, so a `ConsoleLogger` instance satisfies that
 * contract directly. `warn`/`fatal` are ConsoleLogger-only levels (outside
 * `DagLoggerInterface`) and keep the plain-string call shape.
 */

import type { LogBodyDataType, LogFaultDataType } from '@studnicky/logger/interfaces';

import { CircularBuffer } from '@studnicky/circular-buffer';
import { Clock as SubstrateClock, RealTimeClockProvider } from '@studnicky/clock';

const HAS_NODE_STDIO =
  typeof process !== 'undefined'
  && typeof process.stdout?.write === 'function';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const STDERR_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['warn', 'error', 'fatal']);

const LEVEL_TAGS: Readonly<Record<LogLevel, string>> = {
  'trace': '[dagonizer:trace]',
  'debug': '[dagonizer:debug]',
  'info':  '[dagonizer]',
  'warn':  '[dagonizer:warn]',
  'error': '[dagonizer:error]',
  'fatal': '[dagonizer:fatal]',
};

export interface LogEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly ts: number;
}

export class ConsoleLogger {
  readonly #buffer: CircularBuffer<LogEvent>;
  readonly #clock: SubstrateClock;

  constructor(options: { readonly clock?: SubstrateClock; readonly maxBuffer?: number } = {}) {
    this.#buffer = CircularBuffer.create<LogEvent>({
      'capacity': options.maxBuffer ?? 1000,
      'overflow': 'overwrite',
    });
    this.#clock = options.clock ?? SubstrateClock.create(RealTimeClockProvider.create());
  }

  history(): readonly LogEvent[] { return this.#snapshot(); }

  clear(): void {
    let event = this.#buffer.shift();
    while (event !== undefined) event = this.#buffer.shift();
    this.onEmit({ 'level': 'info', 'message': '(log cleared)', 'ts': this.#clock.now() });
  }

  trace(body: LogBodyDataType): void { this.#emit('trace', body.message); }
  debug(body: LogBodyDataType): void { this.#emit('debug', body.message); }
  info(body: LogBodyDataType):  void { this.#emit('info',  body.message); }
  warn(message: string):  void { this.#emit('warn',  message); }
  error(fault: LogFaultDataType): void { this.#emit('error', fault.message); }
  fatal(message: string): void { this.#emit('fatal', message); }

  /**
   * Convenience for a plain single-line info message with no extra
   * structured context — builds a minimal `LogBody` and calls `info()`.
   */
  note(message: string): void {
    this.info(
      {
        'context': {},
        'event': 'app.log',
        message,
        'status': 'complete',
      },
    );
  }

  result(message: string): void {
    const event: LogEvent = { 'level': 'info', message, 'ts': this.#clock.now() };
    this.#buffer.push(event);
    this.onEmit(event);
    if (HAS_NODE_STDIO) process.stdout.write(`[dagonizer:result] ${message}\n`);
  }

  protected onEmit(event: LogEvent): void { void event; }

  #emit(level: LogLevel, message: string): void {
    const event: LogEvent = { level, message, 'ts': this.#clock.now() };
    this.#buffer.push(event);
    this.onEmit(event);
    if (HAS_NODE_STDIO) {
      const stream = STDERR_LEVELS.has(level) ? process.stderr : process.stdout;
      stream.write(`${LEVEL_TAGS[level]} ${message}\n`);
    }
  }

  #snapshot(): readonly LogEvent[] {
    const events: LogEvent[] = [];
    let event = this.#buffer.shift();
    while (event !== undefined) {
      events.push(event);
      event = this.#buffer.shift();
    }
    for (const retained of events) this.#buffer.push(retained);
    return events;
  }
}
