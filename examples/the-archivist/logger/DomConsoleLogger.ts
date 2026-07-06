/**
 * DomConsoleLogger: browser/DOM extension of `ConsoleLogger`.
 *
 * Overrides the protected `onEmit(event)` hook to mirror every log event onto
 * an in-browser surface. Two surfaces, both driven from the one override and
 * neither using a callback fan-out:
 *
 *   • `events`: a live array synced from a bounded ring buffer. A reactive
 *     view (the docs `TraceFeed` component) wraps the instance and reads
 *     `events` directly, so new lines appear without the logger calling back
 *     into the view.
 *
 *   • `panel`: an optional `<pre>`-style host element. When supplied, the
 *     override also appends a styled `<span>` line and keeps the panel
 *     scrolled to the newest entry — the path the standalone `main.ts` demo
 *     uses to stream the log into its `#archivist-log` element.
 *
 * The CLI runner keeps using the base `ConsoleLogger` (stdout/stderr only);
 * the browser entrypoints use this subclass.
 */

import { ConsoleLogger } from './ConsoleLogger.ts';
import type { LogEvent } from './ConsoleLogger.ts';
import { CircularBuffer } from '@studnicky/circular-buffer';

const DEFAULT_DOM_LOG_EVENT_CAPACITY = 1000;

/**
 * Minimal host-element contract for the optional log panel. Derived from the
 * `<pre>`/`<div>` surface `onEmit` writes into, so this module does not need
 * the full `HTMLElement` type at its boundary.
 */
export interface LogPanelHost {
  appendChild(line: HTMLSpanElement): void;
  scrollTop: number;
  scrollHeight: number;
}

export class DomConsoleLogger extends ConsoleLogger {
  readonly #eventsBuffer: CircularBuffer<LogEvent>;

  /**
   * Live event log synced from `#eventsBuffer`. A reactive view (the docs
   * `TraceFeed`) supplies its own framework-reactive array via the `events`
   * option so new lines render without the logger calling back into the view;
   * otherwise the logger owns a plain array.
   */
  readonly events: LogEvent[];

  /** Optional `<pre>` panel the override streams styled lines into. */
  readonly #panel: LogPanelHost | null;

  constructor(options: {
    readonly maxBuffer?: number;
    readonly panel?: LogPanelHost;
    readonly events?: LogEvent[];
  } = {}) {
    super(options.maxBuffer !== undefined ? { 'maxBuffer': options.maxBuffer } : {});
    this.#eventsBuffer = CircularBuffer.create<LogEvent>({
      'capacity': options.maxBuffer ?? DEFAULT_DOM_LOG_EVENT_CAPACITY,
      'overflow': 'overwrite',
    });
    this.events = options.events ?? [];
    this.#panel = options.panel ?? null;
  }

  /**
   * Mirror the event to the in-browser surfaces: always append to `events`
   * (the reactive read surface); additionally stream a styled line into the
   * `<pre>` panel when one was supplied at construction.
   */
  protected override onEmit(event: LogEvent): void {
    this.#eventsBuffer.push(event);
    this.#syncEvents();
    const panel = this.#panel;
    if (panel === null) return;
    const line = document.createElement('span');
    line.className = event.level;
    line.textContent = `[${event.level}] ${event.message}\n`;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }

  override clear(): void {
    let event = this.#eventsBuffer.shift();
    while (event !== undefined) event = this.#eventsBuffer.shift();
    this.events.splice(0, this.events.length);
    super.clear();
  }

  #syncEvents(): void {
    const events: LogEvent[] = [];
    let event = this.#eventsBuffer.shift();
    while (event !== undefined) {
      events.push(event);
      event = this.#eventsBuffer.shift();
    }
    for (const retained of events) this.#eventsBuffer.push(retained);
    this.events.splice(0, this.events.length, ...events);
  }
}
