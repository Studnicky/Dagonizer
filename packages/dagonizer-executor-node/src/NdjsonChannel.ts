/**
 * NdjsonChannel: MessageChannelInterface over Readable/Writable streams with
 * newline-delimited JSON framing.
 *
 * Partial-chunk buffering: input chunks are accumulated until a newline is
 * found; each complete line is parsed and dispatched. Multiple messages per
 * chunk and messages split across chunks are both handled correctly.
 *
 * Malformed lines: JSON parse failures and BridgeMessage validation failures
 * surface as 'error' BridgeMessage dispatched to the handler — the channel
 * never throws.
 *
 * send    → writable.write(JSON.stringify(message) + '\n')
 * onMessage → accumulate readable data; parse each '\n'-terminated line
 * close   → stop delivering; destroy streams
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import type { Readable, Writable } from 'node:stream';

import type { MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { BridgeMessage } from '@noocodex/dagonizer/entities';
import { Validator } from '@noocodex/dagonizer/validation';

// ---------------------------------------------------------------------------
// NdjsonChannel
// ---------------------------------------------------------------------------

export class NdjsonChannel implements MessageChannelInterface {
  readonly #readable: Readable;
  readonly #writable: Writable;
  #handler: ((message: BridgeMessage) => void) | null;
  #buffer: string;
  #closed: boolean;

  constructor(readable: Readable, writable: Writable) {
    this.#readable = readable;
    this.#writable = writable;
    this.#handler = null;
    this.#buffer = '';
    this.#closed = false;

    // Install exactly one underlying 'data' listener for the channel's lifetime.
    // Inbound chunks are buffered and dispatched to this.#handler when set.
    // onMessage() replaces this.#handler — it never re-subscribes to the stream.
    this.#readable.on('data', (chunk: Buffer | string) => {
      if (this.#closed) return;
      this.#buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.#processBuffer();
    });
  }

  send(message: BridgeMessage): void {
    if (this.#closed) return;
    try {
      this.#writable.write(JSON.stringify(message) + '\n');
    } catch {
      // Fire-and-forget: swallow write errors.
    }
  }

  /** Replace the inbound message handler. Single-handler replace semantics. */
  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#closed = true;
    this.#handler = null;
    try { this.#readable.destroy(); } catch { /* suppress */ }
    try { this.#writable.destroy(); } catch { /* suppress */ }
  }

  // ---------------------------------------------------------------------------
  // Buffer processing
  // ---------------------------------------------------------------------------

  #processBuffer(): void {
    let newlineIndex = this.#buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      newlineIndex = this.#buffer.indexOf('\n');

      if (line.length === 0) continue;
      this.#dispatchLine(line);
    }
  }

  #dispatchLine(line: string): void {
    const handler = this.#handler;
    if (handler === null || this.#closed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handler({
        'kind': 'error',
        'requestId': null,
        'code': 'NDJSON_PARSE_ERROR',
        'message': `Failed to parse NDJSON line: ${message}`,
        'recoverable': true,
      });
      return;
    }

    let validated: BridgeMessage;
    try {
      validated = Validator.bridgeMessage.validate(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      handler({
        'kind': 'error',
        'requestId': null,
        'code': 'NDJSON_VALIDATION_ERROR',
        'message': `BridgeMessage validation failed: ${message}`,
        'recoverable': true,
      });
      return;
    }

    handler(validated);
  }
}
