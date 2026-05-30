/**
 * ConsoleLogger: Archivist's logger service.
 *
 * Two surfaces from one class:
 *
 *   • Subscriber surface: `subscribe(fn)` / `unsubscribe(fn)` for the
 *     in-browser demo. Every log call fans out to subscribers with a
 *     structured `LogEvent` so the Vue runner's trace tab can render the
 *     same lines the CLI sees.
 *
 *   • Sink surface: `info(message)` / `warn(message)` satisfy the
 *     `ArchivistServices.logger` contract. In Node, lines also go to
 *     `process.stdout` / `process.stderr`; in the browser the runtime
 *     guard skips that branch so `process.*` never resolves.
 *
 * Stays Node-only-output without spreading `process.*` across the
 * codebase: one file owns the platform detection, every other file
 * sees the abstract logger interface.
 */

const HAS_NODE_STDIO =
  typeof process !== 'undefined'
  && typeof process.stdout?.write === 'function';

export type LogLevel = 'info' | 'warn' | 'result';

export interface LogEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly ts: number;
}

export type LogSubscriber = (event: LogEvent) => void;

export class ConsoleLogger {
  readonly #subscribers = new Set<LogSubscriber>();
  readonly #buffer: LogEvent[] = [];
  readonly #maxBuffer: number;

  constructor(options: { readonly maxBuffer?: number } = {}) {
    this.#maxBuffer = options.maxBuffer ?? 500;
  }

  /** All events captured so far (most recent last). */
  history(): readonly LogEvent[] { return [...this.#buffer]; }

  /** Empty the buffer; invoked at the top of each Archivist run. */
  clear(): void {
    this.#buffer.length = 0;
    for (const fn of this.#subscribers) fn({ 'level': 'info', 'message': '(log cleared)', 'ts': Date.now() });
  }

  subscribe(fn: LogSubscriber): void { this.#subscribers.add(fn); }
  unsubscribe(fn: LogSubscriber): void { this.#subscribers.delete(fn); }

  /** Standard log; visible in CLI stdout and in the browser stream. */
  info(message: string): void { this.#emit('info', message); }

  /** Warning: CLI stderr, browser stream renders amber. */
  warn(message: string): void { this.#emit('warn', message); }

  /** Demo summary line; same stream, distinct level so the UI can highlight. */
  result(message: string): void { this.#emit('result', message); }

  #emit(level: LogLevel, message: string): void {
    const event: LogEvent = { level, message, 'ts': Date.now() };
    this.#buffer.push(event);
    if (this.#buffer.length > this.#maxBuffer) this.#buffer.shift();
    for (const fn of this.#subscribers) fn(event);
    if (HAS_NODE_STDIO) {
      const stream = level === 'warn' ? process.stderr : process.stdout;
      const tag = level === 'warn' ? '[archivist:warn]' : level === 'result' ? '[archivist:result]' : '[archivist]';
      stream.write(`${tag} ${message}\n`);
    }
  }
}
