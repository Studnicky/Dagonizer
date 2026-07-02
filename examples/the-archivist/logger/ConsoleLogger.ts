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

import { LogBody } from '@studnicky/logger';

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
  readonly #buffer: LogEvent[] = [];
  readonly #maxBuffer: number;

  constructor(options: { readonly maxBuffer?: number } = {}) {
    this.#maxBuffer = options.maxBuffer ?? 1000;
  }

  history(): readonly LogEvent[] { return [...this.#buffer]; }

  clear(): void {
    this.#buffer.length = 0;
    this.onEmit({ 'level': 'info', 'message': '(log cleared)', 'ts': Date.now() });
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
      LogBody.create()
        .component('app')
        .operation('log')
        .status('complete')
        .message(message)
        .context({})
        .build(),
    );
  }

  result(message: string): void {
    const event: LogEvent = { 'level': 'info', message, 'ts': Date.now() };
    this.#buffer.push(event);
    if (this.#buffer.length > this.#maxBuffer) this.#buffer.shift();
    this.onEmit(event);
    if (HAS_NODE_STDIO) process.stdout.write(`[dagonizer:result] ${message}\n`);
  }

  protected onEmit(event: LogEvent): void { void event; }

  #emit(level: LogLevel, message: string): void {
    const event: LogEvent = { level, message, 'ts': Date.now() };
    this.#buffer.push(event);
    if (this.#buffer.length > this.#maxBuffer) this.#buffer.shift();
    this.onEmit(event);
    if (HAS_NODE_STDIO) {
      const stream = STDERR_LEVELS.has(level) ? process.stderr : process.stdout;
      stream.write(`${LEVEL_TAGS[level]} ${message}\n`);
    }
  }
}
