/**
 * ConsoleLogger: leveled logger with ring buffer and override hook.
 *
 * Demo/example utility — NOT a framework export. Lives here in examples/
 * because logging strategy is the consumer's responsibility.
 */

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

  trace(message: string): void { this.#emit('trace', message); }
  debug(message: string): void { this.#emit('debug', message); }
  info(message: string):  void { this.#emit('info',  message); }
  warn(message: string):  void { this.#emit('warn',  message); }
  error(message: string): void { this.#emit('error', message); }
  fatal(message: string): void { this.#emit('fatal', message); }

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
