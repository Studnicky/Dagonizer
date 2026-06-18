/**
 * ConsoleLogger: Archivist's logger service.
 *
 * Two surfaces from one class:
 *
 *   • Emit hook: `onEmit(event)` is a protected no-op called on every log
 *     emission with a structured `LogEvent`. Subclasses override it to fan
 *     a log line out to a UI surface (the in-browser demo's trace tab or a
 *     `<pre>` panel) without the base class knowing anything about the DOM.
 *     This replaces the former `subscribe`/`unsubscribe` callback seam: the
 *     hook is class extension, not a function passed in.
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

export class ConsoleLogger {
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
    this.onEmit({ 'level': 'info', 'message': '(log cleared)', 'ts': Date.now() });
  }

  /** Standard log; visible in CLI stdout and in the browser stream. */
  info(message: string): void { this.#emit('info', message); }

  /** Warning: CLI stderr, browser stream renders amber. */
  warn(message: string): void { this.#emit('warn', message); }

  /** Demo summary line; same stream, distinct level so the UI can highlight. */
  result(message: string): void { this.#emit('result', message); }

  /**
   * Called on every log emission. No-op in the base class.
   *
   * Subclasses override this to mirror the event onto a UI surface (DOM,
   * reactive view, etc.). The base class never depends on the override:
   * the engine path (`info`/`warn`/`result` → buffer + stdout) runs
   * identically whether or not a subclass extends the hook.
   */
  protected onEmit(_event: LogEvent): void {
    // No-op in the base class. Subclasses mirror the event to a UI surface.
  }

  #emit(level: LogLevel, message: string): void {
    const event: LogEvent = { level, message, 'ts': Date.now() };
    this.#buffer.push(event);
    if (this.#buffer.length > this.#maxBuffer) this.#buffer.shift();
    this.onEmit(event);
    if (HAS_NODE_STDIO) {
      const stream = level === 'warn' ? process.stderr : process.stdout;
      const tag = level === 'warn' ? '[archivist:warn]' : level === 'result' ? '[archivist:result]' : '[archivist]';
      stream.write(`${tag} ${message}\n`);
    }
  }
}
