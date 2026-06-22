/**
 * SseStream: turns an `EventBus` topic subscription into a Server-Sent-Events
 * text stream.
 *
 * Uses web-standard `ReadableStream` (isomorphic — works in Node 18+ and the
 * browser). Zero external dependencies.
 *
 * Wire format: each event is a `data: <json>\n\n` SSE frame. The heartbeat is
 * a `: heartbeat\n\n` SSE comment frame (invisible to EventSource listeners,
 * keeps the connection alive through proxies).
 *
 * Usage:
 * ```ts
 * const bus = new EventBus();
 * const stream = SseStream.of(bus, ['runs', 'escalations']);
 * // Pipe `stream.readable` as the response body.
 * ```
 *
 * The stream closes cleanly when the consumer cancels (e.g. client disconnects).
 *
 * Heartbeats fire every `heartbeatMs` milliseconds (default 15 000). Pass
 * `heartbeatMs: 0` to disable heartbeats (useful in unit tests).
 */

import type { EventBusInterface } from './EventBus.js';

/** Options for `SseStream.of`. */
export type SseStreamOptionsType = {
  /** Heartbeat interval in milliseconds. Default: 15 000. Pass 0 to disable. */
  readonly 'heartbeatMs': number;
};

const SSE_STREAM_DEFAULT_OPTIONS: SseStreamOptionsType = {
  'heartbeatMs': 15_000,
};

/** SSE comment frame that keeps proxies from closing idle connections. */
const HEARTBEAT_FRAME = ': heartbeat\n\n';

/** Connected announcement frame sent immediately after the stream opens. */
const CONNECTED_FRAME = 'data: {"connected":true}\n\n';

/**
 * Internal teardown holder shared between `start` and `cancel` callbacks.
 * Allocated before the `ReadableStream` constructor so both callbacks close
 * over the same object reference without temporal dead-zone issues.
 */
type TeardownHolderType = {
  fn: (() => void) | null;
};

/**
 * `SseStream`: produces an SSE `ReadableStream<string>` from one or more
 * `EventBus` topic subscriptions.
 *
 * Instantiate via `SseStream.of(bus, topics, options?)`.
 *
 * V8 shape: `readable` is the only instance property, fixed at construction.
 */
export class SseStream {
  /** The underlying `ReadableStream<string>` of SSE frames. */
  readonly readable: ReadableStream<string>;

  private constructor(readable: ReadableStream<string>) {
    this.readable = readable;
  }

  /**
   * Create an `SseStream` that forwards every publish on any of `topics` from
   * `bus` as an SSE `data:` frame.
   *
   * @param bus     - The event bus to subscribe to.
   * @param topics  - One or more topic names to subscribe to.
   * @param options - Optional config (heartbeat interval).
   */
  static of(
    bus: EventBusInterface,
    topics: readonly string[],
    options: SseStreamOptionsType = SSE_STREAM_DEFAULT_OPTIONS,
  ): SseStream {
    const { heartbeatMs } = options;

    // Shared holder between `start` and `cancel`. Allocated before the
    // ReadableStream constructor so both callbacks can close over the same
    // object without temporal dead-zone issues.
    const teardown: TeardownHolderType = { 'fn': null };

    const readable = new ReadableStream<string>({
      start(controller): void {
        // Emit the connected frame immediately.
        controller.enqueue(CONNECTED_FRAME);

        // Subscribe to every requested topic.
        const unsubscribers: (() => void)[] = [];
        for (const topic of topics) {
          const unsub = bus.subscribe(topic, (envelope) => {
            try {
              const frame = `data: ${JSON.stringify(envelope)}\n\n`;
              controller.enqueue(frame);
            } catch {
              // JSON serialization failure — skip this event.
            }
          });
          unsubscribers.push(unsub);
        }

        // Heartbeat timer (omitted when interval is 0).
        let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
        if (heartbeatMs > 0) {
          heartbeatHandle = setInterval(() => {
            try {
              controller.enqueue(HEARTBEAT_FRAME);
            } catch {
              // Stream already closed; stop the interval.
              if (heartbeatHandle !== null) {
                clearInterval(heartbeatHandle);
                heartbeatHandle = null;
              }
            }
          }, heartbeatMs);
        }

        // Wire teardown into the shared holder so the cancel callback can
        // invoke it. This assignment happens synchronously inside `start`,
        // before any async reads can trigger `cancel`.
        teardown.fn = (): void => {
          if (heartbeatHandle !== null) {
            clearInterval(heartbeatHandle);
            heartbeatHandle = null;
          }
          for (const unsub of unsubscribers) unsub();
          unsubscribers.length = 0;
        };
      },

      cancel(): void {
        teardown.fn?.();
      },
    });

    return new SseStream(readable);
  }

  /**
   * Encode a single SSE `data:` frame from an arbitrary value.
   *
   * Utility for consumers building frames individually.
   */
  static frame(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  /**
   * Encode an SSE comment frame.
   *
   * EventSource clients ignore comment frames; they are used for heartbeats
   * and keep-alive signals.
   */
  static comment(text: string): string {
    return `: ${text}\n\n`;
  }
}
