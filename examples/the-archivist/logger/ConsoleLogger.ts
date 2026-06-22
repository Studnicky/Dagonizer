/**
 * ConsoleLogger: Archivist's logger service.
 *
 * Two surfaces from one class:
 *
 *   • Emit hook: `onEmit(event)` is a protected no-op called on every log
 *     emission with a structured `LogEvent`. Subclasses override it to fan
 *     a log line out to a UI surface (the in-browser demo's trace tab or a
 *     `<pre>` panel) without the base class knowing anything about the DOM.
 *     The hook is class extension, not a function passed in.
 *
 *   • Level surface: `trace` / `debug` / `info` / `warn` / `error` / `fatal`
 *     emit a leveled line. In Node, `warn` / `error` / `fatal` go to
 *     `process.stderr`; the rest to `process.stdout`. In the browser the
 *     runtime guard skips that branch so `process.*` never resolves.
 *
 *   • Display surface: `result(message)` is a non-level presentation call for
 *     final tabular demo output. It is off the level union: it is a deliberate
 *     display channel, not diagnostic severity.
 *
 * Stays Node-only-output without spreading `process.*` across the
 * codebase: one file owns the platform detection, every other file
 * sees the abstract logger surface.
 */

const HAS_NODE_STDIO =
  typeof process !== 'undefined'
  && typeof process.stdout?.write === 'function';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Levels routed to `process.stderr` in Node; the rest go to `process.stdout`. */
const STDERR_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['warn', 'error', 'fatal']);

/** Per-level CLI tag prefix. The `result` display channel carries its own tag. */
const LEVEL_TAGS: Readonly<Record<LogLevel, string>> = {
  'trace': '[archivist:trace]',
  'debug': '[archivist:debug]',
  'info':  '[archivist]',
  'warn':  '[archivist:warn]',
  'error': '[archivist:error]',
  'fatal': '[archivist:fatal]',
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

  /** All events captured so far (most recent last). */
  history(): readonly LogEvent[] { return [...this.#buffer]; }

  /** Empty the buffer; invoked at the top of each Archivist run. */
  clear(): void {
    this.#buffer.length = 0;
    this.onEmit({ 'level': 'info', 'message': '(log cleared)', 'ts': Date.now() });
  }

  /** Finest-grained diagnostic; CLI stdout. */
  trace(message: string): void { this.#emit('trace', message); }

  /** Developer-facing detail; CLI stdout. */
  debug(message: string): void { this.#emit('debug', message); }

  /** Standard log; visible in CLI stdout and in the browser stream. */
  info(message: string): void { this.#emit('info', message); }

  /** Warning: CLI stderr, browser stream renders amber. */
  warn(message: string): void { this.#emit('warn', message); }

  /** Recoverable error: CLI stderr. */
  error(message: string): void { this.#emit('error', message); }

  /** Unrecoverable error: CLI stderr. */
  fatal(message: string): void { this.#emit('fatal', message); }

  /**
   * Non-level display channel for the demo's final tabular output. Off the
   * `LogLevel` union by design: it is presentation, not severity. Routes to
   * CLI stdout and through the same `onEmit` hook (carrying the `info` level
   * so UI surfaces render it inline) so the browser panel still streams it.
   */
  result(message: string): void {
    const event: LogEvent = { 'level': 'info', message, 'ts': Date.now() };
    this.#buffer.push(event);
    if (this.#buffer.length > this.#maxBuffer) this.#buffer.shift();
    this.onEmit(event);
    if (HAS_NODE_STDIO) process.stdout.write(`[archivist:result] ${message}\n`);
  }

  /**
   * Called on every log emission. No-op in the base class.
   *
   * Subclasses override this to mirror the event onto a UI surface (DOM,
   * reactive view, etc.). The base class never depends on the override:
   * the engine path (level method → buffer + stdout/stderr) runs
   * identically whether or not a subclass extends the hook.
   */
  protected onEmit(event: LogEvent): void {
    void event;
    // No-op in the base class. Subclasses mirror the event to a UI surface.
  }

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
