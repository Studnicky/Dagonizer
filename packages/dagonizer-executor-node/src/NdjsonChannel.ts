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
 * Buffer safety: the accumulator is capped at MAX_BUFFER_BYTES (8 MiB). On
 * overflow the channel emits an NDJSON_PARSE_ERROR and resets the buffer;
 * a partial un-terminated trailing line at stream close is traced as an
 * NDJSON_PARSE_ERROR rather than silently discarded.
 *
 * Stream events: readable 'error' and 'close' are handled — an error surfaces
 * as an NDJSON_PARSE_ERROR; a close with a non-empty buffer emits a trace.
 *
 * send    → writable.write(JSON.stringify(message) + '\n')
 * onMessage → accumulate readable data; parse each '\n'-terminated line
 * close   → stop delivering; destroy streams
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import type { Readable, Writable } from 'node:stream';

import { BaseMessageChannel } from '@studnicky/dagonizer/container';
import { BridgeMessage } from '@studnicky/dagonizer/entities';
import type { BridgeMessageType } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum accumulated NDJSON buffer size before the channel emits an overflow error. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024; // 8 MiB

// ---------------------------------------------------------------------------
// NdjsonChannel
// ---------------------------------------------------------------------------

export class NdjsonChannel extends BaseMessageChannel {
  readonly #readable: Readable;
  readonly #writable: Writable;
  #buffer: string;

  constructor(readable: Readable, writable: Writable) {
    super();
    this.#readable = readable;
    this.#writable = writable;
    this.#buffer = '';

    // Install exactly one underlying 'data' listener for the channel's lifetime.
    // Inbound chunks are buffered and routed through the base's guarded dispatch.
    // onMessage() replaces the base handler — it never re-subscribes to the stream.
    this.#readable.on('data', (chunk: Buffer | string) => {
      if (this.closed) return;
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.#buffer += text;

      // Buffer overflow guard: cap at MAX_BUFFER_BYTES to prevent unbounded growth.
      if (this.#buffer.length > MAX_BUFFER_BYTES) {
        this.#buffer = '';
        this.dispatch(BridgeMessage.create({
          'code': 'NDJSON_PARSE_ERROR',
          'message': `NDJSON buffer overflow: accumulated data exceeded ${MAX_BUFFER_BYTES} bytes; buffer reset`,
        }));
        return;
      }

      this.#processBuffer();
    });

    this.#readable.on('error', (err: Error) => {
      if (this.closed) return;
      this.dispatch(BridgeMessage.create({
        'code': 'NDJSON_PARSE_ERROR',
        'message': `NDJSON readable stream error: ${err.message}`,
      }));
    });

    this.#readable.on('close', () => {
      if (this.closed) return;
      // Trace any un-terminated trailing line that was never delimited.
      const trailing = this.#buffer.trim();
      if (trailing.length > 0) {
        this.#buffer = '';
        this.dispatch(BridgeMessage.create({
          'code': 'NDJSON_PARSE_ERROR',
          'message': `NDJSON stream closed with un-terminated trailing line: ${trailing.slice(0, 200)}`,
        }));
      }
    });
  }

  override send(message: BridgeMessageType): void {
    if (this.closed) return;
    try {
      this.#writable.write(JSON.stringify(message) + '\n');
    } catch {
      // Fire-and-forget: swallow write errors.
    }
  }

  override close(): void {
    super.close();
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
    if (this.closed) return;

    let parsed: unknown;
    try {
      // JSON.parse returns `any`; assigning to a typed `unknown` variable
      // narrows at the ingest boundary without a cast.
      parsed = JSON.parse(line);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.dispatch(BridgeMessage.create({
        'code': 'NDJSON_PARSE_ERROR',
        'message': `Failed to parse NDJSON line: ${message}`,
      }));
      return;
    }

    let validated: BridgeMessageType;
    try {
      validated = Validator.bridgeMessage.validate(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.dispatch(BridgeMessage.create({
        'code': 'NDJSON_VALIDATION_ERROR',
        'message': `BridgeMessage validation failed: ${message}`,
      }));
      return;
    }

    this.dispatch(validated);
  }
}
